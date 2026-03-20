export interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
function cors(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ─── JWT (minimal, symmetric HS256 via Web Crypto) ──────────────────────────
async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sigB64}`;
}

async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const data = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    return JSON.parse(atob(body)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function authenticate(req: Request, env: Env): Promise<{ userId: number; username: string } | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const payload = await verifyJwt(auth.slice(7), env.JWT_SECRET);
  if (!payload || !payload.sub || (payload.exp as number) < Date.now() / 1000) return null;
  return { userId: payload.sub as number, username: payload.username as string };
}

// ─── Router ──────────────────────────────────────────────────────────────────
type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;

interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth: boolean; }

const routes: Route[] = [];

function route(method: string, path: string, auth: boolean, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, pattern, keys, handler, auth });
}

// ─── Route Definitions ───────────────────────────────────────────────────────

// Auth
route('POST', '/api/auth/login', false, async (req, env) => {
  const { username, password } = await req.json() as { username: string; password: string };
  if (!username || !password) return err('Username and password required');

  const row = await env.DB.prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .bind(username).first<{ id: number; username: string; password_hash: string }>();
  if (!row) return err('Invalid credentials', 401);

  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(password + row.id));
  const hash = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
  if (hash !== row.password_hash) return err('Invalid credentials', 401);

  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 7;
  const token = await signJwt({ sub: row.id, username: row.username, exp: expiresAt }, env.JWT_SECRET);
  return json({ token, expiresAt: expiresAt * 1000 });
});

route('GET', '/api/auth/me', true, async (_req, _env, _p) => {
  return json({ ok: true });
});

// Realms
route('GET', '/api/realms', false, async (_req, env) => {
  const obj = await env.R2_BUCKET.get('static/realms.json');
  if (!obj) return json([]);
  return new Response(await obj.text(), {
    headers: { 'Content-Type': 'application/json', ...cors(), 'Cache-Control': 'public, max-age=3600' },
  });
});

route('GET', '/api/realms/snapshots', false, async (_req, env) => {
  const obj = await env.R2_BUCKET.get('global/state.json');
  if (!obj) return json([]);
  return new Response(await obj.text(), { headers: { 'Content-Type': 'application/json', ...cors() } });
});

// Search
route('GET', '/api/search', false, async (req, env) => {
  const url = new URL(req.url);
  const realmId = url.searchParams.get('realm');
  const q = url.searchParams.get('q')?.toLowerCase().trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500);
  const dealsOnly = url.searchParams.get('dealsOnly') === 'true';
  const itemClass = url.searchParams.get('class');
  const minQuality = parseInt(url.searchParams.get('minQuality') ?? '0');
  const minLevel = parseInt(url.searchParams.get('minLevel') ?? '0');
  const maxLevel = parseInt(url.searchParams.get('maxLevel') ?? '99999');

  if (!realmId) return err('realm param required');

  // ── 1. Load item catalog ───────────────────────────────────────────────────
  // Per-class file when browsing a category; full catalog for text search.
  type CatalogEntry = { name: string | null; icon: string | null; quality: number; class: number; subclass: number | null; expansion: number; itemLevel: number; stack: number };
  let catalog: Record<string, CatalogEntry> | null = null;

  if (itemClass !== null) {
    const obj = await env.R2_BUCKET.get(`static/catalog/class-${itemClass}.json`);
    if (obj) catalog = await obj.json<Record<string, CatalogEntry>>();
  } else {
    // Default view and text search both use the full catalog
    const obj = await env.R2_BUCKET.get('static/items.json');
    if (obj) catalog = await obj.json<Record<string, CatalogEntry>>();
  }

  // ── 2. Load realm market data (optional) ──────────────────────────────────
  type MarketEntry = { itemKey: string; price: number; qty: number; snapshot: number };
  const realmPrices = new Map<number, MarketEntry>(); // keyed by itemId (lowest price per item)

  const realmObj = await env.R2_BUCKET.get(`realm/${realmId}/index.json`);
  if (realmObj) {
    const realmItems = await realmObj.json<MarketEntry[]>();
    for (const entry of realmItems) {
      const itemId = parseInt(entry.itemKey.split(':')[0]);
      const existing = realmPrices.get(itemId);
      if (!existing || entry.price < existing.price) realmPrices.set(itemId, entry);
    }
  }

  // ── 3. Build result list ───────────────────────────────────────────────────
  let results: Array<Record<string, unknown>>;

  if (catalog) {
    // Catalog-driven: merge in realm prices, sort priced items first
    results = Object.entries(catalog).map(([itemId, meta]) => {
      const id = parseInt(itemId);
      const market = realmPrices.get(id);
      return {
        itemKey:      market?.itemKey ?? `${itemId}:0:0`,
        price:        market?.price ?? null,
        qty:          market?.qty ?? null,
        snapshot:     market?.snapshot ?? null,
        regionMedian: null,
        item:         { id, ...meta },
        _hasPrices:   market !== undefined,
      };
    });
    // Priced items first, then alphabetical by name
    results.sort((a, b) => {
      if (a._hasPrices !== b._hasPrices) return a._hasPrices ? -1 : 1;
      const na = String((a.item as CatalogEntry | null)?.name ?? a.itemKey);
      const nb = String((b.item as CatalogEntry | null)?.name ?? b.itemKey);
      return na.localeCompare(nb);
    });
    results.forEach(r => { delete (r as any)._hasPrices; });
  } else {
    return json([]);
  }

  // ── 4. Apply filters ───────────────────────────────────────────────────────
  if (q) {
    results = results.filter(r => {
      const name = String((r.item as CatalogEntry | null)?.name ?? r.itemKey);
      return name.toLowerCase().includes(q);
    });
  }

  if (minQuality > 0) {
    results = results.filter(r => ((r.item as CatalogEntry | null)?.quality ?? 0) >= minQuality);
  }

  if (minLevel > 0 || maxLevel < 99999) {
    results = results.filter(r => {
      const ilvl = (r.item as CatalogEntry | null)?.itemLevel ?? 0;
      return ilvl >= minLevel && ilvl <= maxLevel;
    });
  }

  if (dealsOnly) {
    results = results.filter(r => {
      const price = r.price as number | null;
      const median = r.regionMedian as number | null;
      return median !== null && price !== null && price < median * 0.7;
    });
  }

  // ── 5. Sort: priced items first, then alphabetical ─────────────────────────
  results.sort((a, b) => {
    const aHas = a.price !== null ? 1 : 0;
    const bHas = b.price !== null ? 1 : 0;
    if (bHas !== aHas) return bHas - aHas;
    const aName = String((a.item as CatalogEntry | null)?.name ?? a.itemKey);
    const bName = String((b.item as CatalogEntry | null)?.name ?? b.itemKey);
    return aName.localeCompare(bName);
  });

  return json(results.slice(0, limit));
});

// Deals
route('GET', '/api/deals', false, async (req, env) => {
  const region = new URL(req.url).searchParams.get('region') ?? 'us';
  const obj = await env.R2_BUCKET.get(`global/deals-${region}.json`);
  if (!obj) return json([]);

  const deals = await obj.json<Array<Record<string, unknown>>>();
  if (!deals.length) return json([]);

  // Enrich with item metadata (name, icon, quality) from static catalog
  const catalogObj = await env.R2_BUCKET.get('static/items.json');
  const catalog = catalogObj ? await catalogObj.json<Record<string, Record<string, unknown>>>() : {};

  const enriched = deals.map(deal => {
    const itemId = String(deal.itemKey ?? '').split(':')[0];
    const meta = catalog[itemId] ?? null;
    return { ...deal, item: meta };
  });

  return json(enriched);
});

// Item catalog lookup (public — no auth needed)
route('GET', '/api/catalog/:itemId', false, async (_req, env, p) => {
  const obj = await env.R2_BUCKET.get('static/items.json');
  if (!obj) return err('Catalog not available', 503);
  const catalog = await obj.json<Record<string, Record<string, unknown>>>();
  const meta = catalog[p.itemId];
  if (!meta) return err('Item not found', 404);
  return json({ id: parseInt(p.itemId), ...meta });
});

// Item state
route('GET', '/api/item/:itemKey/realm/:realmId', true, async (req, env, p) => {
  const obj = await env.R2_BUCKET.get(`realm/${p.realmId}/items/${encodeURIComponent(p.itemKey)}.json`);
  if (!obj) return err('Item not found', 404);
  return new Response(await obj.text(), { headers: { 'Content-Type': 'application/json', ...cors() } });
});

// Analytics
route('GET', '/api/analytics/:type', true, async (req, env, p) => {
  const url = new URL(req.url);
  const realmId = url.searchParams.get('realm');
  if (!realmId) return err('realm param required');

  const obj = await env.R2_BUCKET.get(`realm/${realmId}/analytics/${p.type}.json`);
  if (!obj) return json([]);
  return new Response(await obj.text(), { headers: { 'Content-Type': 'application/json', ...cors() } });
});

// Profiles
route('GET', '/api/profiles', true, async (_req, env, _p) => {
  const user = await authenticate(_req, env);
  const result = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(user!.userId).all();
  const profiles = result.results.map((r: Record<string, unknown>) => ({
    ...r,
    filters: JSON.parse(r.filters as string),
  }));
  return json(profiles);
});

route('GET', '/api/profiles/:id', true, async (req, env, p) => {
  const user = await authenticate(req, env);
  const row = await env.DB.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?')
    .bind(p.id, user!.userId).first<Record<string, unknown>>();
  if (!row) return err('Profile not found', 404);
  return json({ ...row, filters: JSON.parse(row.filters as string) });
});

route('POST', '/api/profiles', true, async (req, env) => {
  const user = await authenticate(req, env);
  const body = await req.json() as { name: string; description?: string; filters: unknown };
  const now = Date.now();
  const result = await env.DB.prepare(
    'INSERT INTO profiles (user_id, name, description, filters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
  ).bind(user!.userId, body.name, body.description ?? null, JSON.stringify(body.filters), now, now).first<Record<string, unknown>>();
  return json({ ...result, filters: JSON.parse(result!.filters as string) }, 201);
});

route('PUT', '/api/profiles/:id', true, async (req, env, p) => {
  const user = await authenticate(req, env);
  const body = await req.json() as Record<string, unknown>;
  const now = Date.now();
  await env.DB.prepare(
    'UPDATE profiles SET name = COALESCE(?, name), description = COALESCE(?, description), filters = COALESCE(?, filters), updated_at = ? WHERE id = ? AND user_id = ?'
  ).bind(body.name ?? null, body.description ?? null, body.filters ? JSON.stringify(body.filters) : null, now, p.id, user!.userId).run();
  const row = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(p.id).first<Record<string, unknown>>();
  return json({ ...row, filters: JSON.parse(row!.filters as string) });
});

route('DELETE', '/api/profiles/:id', true, async (req, env, p) => {
  const user = await authenticate(req, env);
  await env.DB.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').bind(p.id, user!.userId).run();
  return json({ ok: true });
});

route('POST', '/api/profiles/:id/run', true, async (req, env, p) => {
  const user = await authenticate(req, env);
  const row = await env.DB.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?')
    .bind(p.id, user!.userId).first<Record<string, unknown>>();
  if (!row) return err('Profile not found', 404);
  const filters = JSON.parse(row.filters as string);
  const realmId = filters.realm ?? 1;
  const analyticsType = filters.analyticsType ?? 'deals';

  const obj = await env.R2_BUCKET.get(`realm/${realmId}/analytics/${analyticsType}.json`);
  if (!obj) return json([]);
  const items = await obj.json<unknown[]>();

  await env.DB.prepare('UPDATE profiles SET last_run_at = ?, last_run_count = ? WHERE id = ?')
    .bind(Date.now(), items.length, p.id).run();

  return json(items);
});

// Favorites
route('GET', '/api/favorites', true, async (req, env) => {
  const user = await authenticate(req, env);
  const result = await env.DB.prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC').bind(user!.userId).all();
  return json(result.results);
});

route('POST', '/api/favorites', true, async (req, env) => {
  const user = await authenticate(req, env);
  const body = await req.json() as { itemKey: string; realmId: number; notedPrice?: number };
  const now = Date.now();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO favorites (user_id, item_key, realm_id, noted_price, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *'
  ).bind(user!.userId, body.itemKey, body.realmId, body.notedPrice ?? null, now).first();
  return json(result, 201);
});

route('DELETE', '/api/favorites/:itemKey', true, async (req, env, p) => {
  const user = await authenticate(req, env);
  await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND item_key = ?').bind(user!.userId, decodeURIComponent(p.itemKey)).run();
  return json({ ok: true });
});

// Reports
route('GET', '/api/reports', true, async (req, env) => {
  const user = await authenticate(req, env);
  const result = await env.DB.prepare('SELECT id, name, realm_id, generated_at, summary FROM reports WHERE user_id = ? ORDER BY generated_at DESC').bind(user!.userId).all();
  return json(result.results.map((r: Record<string, unknown>) => ({ ...r, summary: JSON.parse(r.summary as string) })));
});

route('GET', '/api/reports/:id', true, async (req, env, p) => {
  const user = await authenticate(req, env);
  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').bind(p.id, user!.userId).first<Record<string, unknown>>();
  if (!row) return err('Report not found', 404);
  return json({ ...row, summary: JSON.parse(row.summary as string), items: JSON.parse(row.items as string) });
});

route('POST', '/api/reports/generate', true, async (req, env) => {
  const user = await authenticate(req, env);
  const body = await req.json() as { name: string; realmId: number; profileIds: number[] };
  const now = Date.now();

  const items: unknown[] = [];
  const buys: unknown[] = [];
  const sells: unknown[] = [];
  const watches: unknown[] = [];

  for (const profileId of (body.profileIds ?? [])) {
    const row = await env.DB.prepare('SELECT filters FROM profiles WHERE id = ? AND user_id = ?')
      .bind(profileId, user!.userId).first<{ filters: string }>();
    if (!row) continue;
    const filters = JSON.parse(row.filters);
    const obj = await env.R2_BUCKET.get(`realm/${body.realmId}/analytics/${filters.analyticsType ?? 'deals'}.json`);
    if (!obj) continue;
    const results = await obj.json<Array<Record<string, unknown>>>();
    for (const item of results.slice(0, 20)) {
      const action = filters.analyticsType === 'deals' || filters.analyticsType === 'undervalued' ? 'buy'
        : filters.analyticsType === 'vendor-flip' ? 'sell' : 'watch';
      items.push({ id: items.length + 1, itemKey: item.itemKey, action, currentPrice: item.price, reasoning: `${filters.analyticsType}: meets threshold`, confidence: 0.75, item: item.item });
      if (action === 'buy') buys.push(item);
      else if (action === 'sell') sells.push(item);
      else watches.push(item);
    }
  }

  const summary = { buyCount: buys.length, sellCount: sells.length, watchCount: watches.length, estimatedProfit: 0 };
  const result = await env.DB.prepare(
    'INSERT INTO reports (user_id, name, realm_id, generated_at, summary, items) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
  ).bind(user!.userId, body.name, body.realmId, now, JSON.stringify(summary), JSON.stringify(items)).first<{ id: number }>();

  return json({ id: result!.id, name: body.name, realmId: body.realmId, generatedAt: now, summary, items }, 201);
});

// ─── Main fetch handler ───────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    const url = new URL(req.url);

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => { params[k] = match[i + 1]; });

      if (route.auth) {
        const user = await authenticate(req, env);
        if (!user) return err('Unauthorized', 401);
      }

      try {
        return await route.handler(req, env, params);
      } catch (e) {
        console.error('Handler error:', e);
        return err('Internal Server Error', 500);
      }
    }

    return err('Not Found', 404);
  },
};
