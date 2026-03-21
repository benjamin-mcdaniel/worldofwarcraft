/**
 * WoW Market Ingestion Worker - Battle.net Auction House API
 * 
 * Fetches auction data from Battle.net API hourly:
 * - Commodities API: Region-wide prices for stackable items (ore, herbs, etc.)
 * - Realm Auctions API: Realm-specific prices for unique items (gear, weapons, etc.)
 * 
 * Architecture:
 * - Commodities stored in: commodities/{region}/current.json + items/{itemId}.json
 * - Realm auctions stored in: realm/{realmId}/current.json + items/{itemKey}.json
 * - Incremental updates with diff detection (only process changed data)
 * - Auto-discovery of new items (fetch metadata from catalog API)
 */

export interface Env {
  R2_BUCKET: R2Bucket;
  BATTLE_NET_KEY: string;
  BATTLE_NET_SECRET: string;
  TRACKED_REALMS?: string; // Comma-separated realm IDs, e.g., "60,11"
}

type Region = 'us' | 'eu';

interface BNetToken { access_token: string; expires_in: number; }

interface CommodityAuction {
  id: number;
  item: { id: number };
  quantity: number;
  unit_price: number;
}

interface RealmAuction {
  id: number;
  item: { id: number; bonus_lists?: number[]; modifiers?: Array<{ type: number; value: number }> };
  buyout?: number;
  unit_price?: number;
  quantity: number;
}

interface CommoditiesResponse {
  auctions: CommodityAuction[];
}

interface AuctionsResponse {
  auctions: RealmAuction[];
}

interface ItemState {
  snapshot: number;
  price: number;
  qty: number;
  auctions: Array<{ price: number; qty: number }>;
  snapshots: Array<[number, number, number]>; // [timestamp, price, qty]
  daily: Array<[number, number, number]>;
}

const REGION_HOST: Record<Region, string> = {
  us: 'https://us.api.blizzard.com',
  eu: 'https://eu.api.blizzard.com',
};

const TOKEN_URLS: Record<Region, string> = {
  us: 'https://oauth.battle.net/token',
  eu: 'https://eu.battle.net/oauth/token',
};

const MAX_SNAPSHOTS = 168; // 1 week of hourly data
const MAX_DAILY = 90; // 90 days of daily aggregates

// ─── Battle.net Auth ──────────────────────────────────────────────────────────
async function getBNetToken(region: Region, key: string, secret: string): Promise<string> {
  const res = await fetch(TOKEN_URLS[region], {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${key}:${secret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`BNet auth failed ${region}: ${res.status}`);
  const data = await res.json() as BNetToken;
  return data.access_token;
}

async function bnetGet<T>(url: string, token: string, region: Region): Promise<{ data: T; lastModified: string | null }> {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}namespace=dynamic-${region}&locale=en_US`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`BNet GET failed: ${url} → ${res.status}`);
  const data = await res.json() as T;
  const lastModified = res.headers.get('Last-Modified');
  return { data, lastModified };
}

// ─── R2 Helpers ──────────────────────────────────────────────────────────────
async function putJson(bucket: R2Bucket, key: string, data: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
}

async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.json<T>();
}

// ─── Item Key Generation ──────────────────────────────────────────────────────
function getItemKey(auction: RealmAuction): string {
  const itemId = auction.item.id;
  let itemLevel = 0;
  let itemSuffix = 0;

  const mods = auction.item.modifiers ?? [];
  const levelMod = mods.find(m => m.type === 9);
  if (levelMod) itemLevel = levelMod.value;

  const suffixMod = mods.find(m => m.type === 29);
  if (suffixMod) itemSuffix = suffixMod.value;

  return `${itemId}:${itemLevel}:${itemSuffix}`;
}

function getPrice(auction: RealmAuction): number {
  return auction.unit_price ?? auction.buyout ?? 0;
}

// ─── Build/Update Item State ─────────────────────────────────────────────────
function buildItemState(
  price: number,
  qty: number,
  snapshot: number,
  existing: ItemState | null
): ItemState {
  const newSnapshot: [number, number, number] = [snapshot, price, qty];
  
  // Append to snapshots array
  const snapshots = existing?.snapshots ?? [];
  snapshots.push(newSnapshot);
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  }

  // Aggregate to daily (keep lowest price per day)
  const daily = existing?.daily ?? [];
  const dayStart = Math.floor(snapshot / 86400000) * 86400000;
  const lastDay = daily.length > 0 ? daily[daily.length - 1] : null;
  
  if (lastDay && lastDay[0] === dayStart) {
    // Same day - update if lower price
    if (price < lastDay[1]) {
      lastDay[1] = price;
      lastDay[2] = qty;
    }
  } else {
    // New day
    daily.push([dayStart, price, qty]);
    if (daily.length > MAX_DAILY) {
      daily.splice(0, daily.length - MAX_DAILY);
    }
  }

  return {
    snapshot,
    price,
    qty,
    auctions: [{ price, qty }],
    snapshots,
    daily,
  };
}

// ─── Process Commodities ──────────────────────────────────────────────────────
async function processCommodities(
  region: Region,
  token: string,
  bucket: R2Bucket,
  snapshot: number
): Promise<number> {
  console.log(`[${region}] Fetching commodities...`);
  
  const host = REGION_HOST[region];
  const { data, lastModified } = await bnetGet<CommoditiesResponse>(
    `${host}/data/wow/auctions/commodities`,
    token,
    region
  );

  console.log(`[${region}] Commodities: ${data.auctions.length} auctions, Last-Modified: ${lastModified}`);

  // Check if data changed
  const metaKey = `commodities/${region}/meta.json`;
  const prevMeta = await getJson<{ lastModified: string; itemCount: number }>(bucket, metaKey);
  
  if (prevMeta?.lastModified === lastModified) {
    console.log(`[${region}] Commodities unchanged, skipping`);
    return 0;
  }

  // Aggregate by item ID (lowest price)
  const itemMap = new Map<number, { price: number; qty: number }>();
  for (const auction of data.auctions) {
    const existing = itemMap.get(auction.item.id);
    if (!existing || auction.unit_price < existing.price) {
      itemMap.set(auction.item.id, { price: auction.unit_price, qty: auction.quantity });
    }
  }

  // Write current snapshot
  await putJson(bucket, `commodities/${region}/current.json`, {
    snapshot,
    items: Array.from(itemMap.entries()).map(([id, state]) => ({
      itemId: id,
      price: state.price,
      qty: state.qty,
    })),
  });

  // Update metadata
  await putJson(bucket, metaKey, {
    lastModified,
    snapshot,
    itemCount: itemMap.size,
  });

  console.log(`[${region}] Commodities: ${itemMap.size} items in snapshot (per-item history skipped for performance)`);
  return itemMap.size;
}

// ─── Process Realm Auctions ───────────────────────────────────────────────────
async function processRealmAuctions(
  realmId: number,
  region: Region,
  token: string,
  bucket: R2Bucket,
  snapshot: number
): Promise<number> {
  console.log(`[${region}] Realm ${realmId}: Fetching auctions...`);
  
  const host = REGION_HOST[region];
  const { data, lastModified } = await bnetGet<AuctionsResponse>(
    `${host}/data/wow/connected-realm/${realmId}/auctions`,
    token,
    region
  );

  console.log(`[${region}] Realm ${realmId}: ${data.auctions.length} auctions, Last-Modified: ${lastModified}`);

  // Check if data changed
  const metaKey = `realm/${realmId}/meta.json`;
  const prevMeta = await getJson<{ lastModified: string; itemCount: number }>(bucket, metaKey);
  
  if (prevMeta?.lastModified === lastModified) {
    console.log(`[${region}] Realm ${realmId}: Unchanged, skipping`);
    return 0;
  }

  // Aggregate by item key (lowest price)
  const itemMap = new Map<string, { price: number; qty: number }>();
  for (const auction of data.auctions) {
    const price = getPrice(auction);
    if (!price) continue;
    
    const key = getItemKey(auction);
    const existing = itemMap.get(key);
    if (!existing || price < existing.price) {
      itemMap.set(key, { price, qty: auction.quantity });
    }
  }

  // Write current snapshot
  await putJson(bucket, `realm/${realmId}/current.json`, {
    snapshot,
    items: Array.from(itemMap.entries()).map(([itemKey, state]) => ({
      itemKey,
      price: state.price,
      qty: state.qty,
    })),
  });

  // Update metadata
  await putJson(bucket, metaKey, {
    lastModified,
    snapshot,
    itemCount: itemMap.size,
  });

  console.log(`[${region}] Realm ${realmId}: ${itemMap.size} items in snapshot (per-item history skipped for performance)`);
  return itemMap.size;
}

// ─── Main Ingestion Run ───────────────────────────────────────────────────────
async function runIngestion(env: Env): Promise<void> {
  const snapshot = Date.now();
  const region: Region = 'us'; // Start with US only
  const trackedRealms = (env.TRACKED_REALMS ?? '60').split(',').map(id => parseInt(id.trim()));

  console.log(`[ingestion] Starting snapshot ${snapshot}`);
  console.log(`[ingestion] Region: ${region}, Realms: ${trackedRealms.join(', ')}`);

  // Get token
  const token = await getBNetToken(region, env.BATTLE_NET_KEY, env.BATTLE_NET_SECRET);

  let totalUpdated = 0;

  // Process commodities
  try {
    const updated = await processCommodities(region, token, env.R2_BUCKET, snapshot);
    totalUpdated += updated;
  } catch (e) {
    console.error(`[${region}] Commodities failed:`, e);
  }

  // Process each tracked realm
  for (const realmId of trackedRealms) {
    try {
      const updated = await processRealmAuctions(realmId, region, token, env.R2_BUCKET, snapshot);
      totalUpdated += updated;
    } catch (e) {
      console.error(`[${region}] Realm ${realmId} failed:`, e);
    }
  }

  // Update global state
  await putJson(env.R2_BUCKET, 'global/ingestion-state.json', {
    lastSnapshot: snapshot,
    region,
    trackedRealms,
    itemsUpdated: totalUpdated,
  });

  console.log(`[ingestion] Complete. ${totalUpdated} items updated.`);
}

// ─── Worker Export ────────────────────────────────────────────────────────────
export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runIngestion(env);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    
    // Manual trigger endpoint
    if (req.method === 'POST' && url.pathname === '/trigger') {
      ctx.waitUntil(runIngestion(env).catch(console.error));
      return new Response(JSON.stringify({ ok: true, message: 'Ingestion triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status endpoint
    if (url.pathname === '/status') {
      const state = await getJson(env.R2_BUCKET, 'global/ingestion-state.json');
      return new Response(JSON.stringify(state ?? { error: 'No state found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
