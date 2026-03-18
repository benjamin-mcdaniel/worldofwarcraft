export interface Env {
  R2_BUCKET: R2Bucket;
  BATTLE_NET_KEY: string;
  BATTLE_NET_SECRET: string;
  BNET_REGIONS?: string;
  ENVIRONMENT?: string;
}

type Region = 'us' | 'eu' | 'tw' | 'kr';

interface BNetToken { access_token: string; expires_in: number; }
interface ConnectedRealmIndex { connected_realms: Array<{ href: string }>; }
interface AuctionResponse { auctions: AuctionEntry[]; }
interface AuctionEntry {
  id: number;
  item: { id: number; bonus_lists?: number[]; modifiers?: Array<{ type: number; value: number }>; };
  buyout?: number;
  unit_price?: number;
  quantity: number;
}

const REGION_HOST: Record<Region, string> = {
  us: 'https://us.api.blizzard.com',
  eu: 'https://eu.api.blizzard.com',
  tw: 'https://tw.api.blizzard.com',
  kr: 'https://kr.api.blizzard.com',
};
const TOKEN_URLS: Record<Region, string> = {
  us: 'https://oauth.battle.net/token',
  eu: 'https://eu.battle.net/oauth/token',
  tw: 'https://apac.battle.net/oauth/token',
  kr: 'https://apac.battle.net/oauth/token',
};

const COPPER_GOLD = 10000;
const MAX_HISTORY_SNAPSHOTS = 48;
const MAX_DAILY_SNAPSHOTS = 30;

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

async function bnetGet<T>(url: string, token: string, region: Region): Promise<T> {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}namespace=dynamic-${region}&locale=en_US`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`BNet GET failed: ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Item Key ─────────────────────────────────────────────────────────────────
function getItemKey(entry: AuctionEntry): string {
  const itemId = entry.item.id;
  let itemLevel = 0;
  let itemSuffix = 0;

  const bonuses = entry.item.bonus_lists ?? [];
  const mods = entry.item.modifiers ?? [];

  const levelMod = mods.find(m => m.type === 9);
  if (levelMod) itemLevel = levelMod.value;

  const suffixMod = mods.find(m => m.type === 29);
  if (suffixMod) itemSuffix = suffixMod.value;

  return `${itemId}:${itemLevel}:${itemSuffix}`;
}

function getPrice(entry: AuctionEntry): number {
  return entry.unit_price ?? entry.buyout ?? 0;
}

// ─── Analytics ───────────────────────────────────────────────────────────────
function computeDeals(
  realmItems: Map<string, { price: number; qty: number }>,
  regionMedians: Map<string, number>,
  thresholdPct = 0.7
): Array<Record<string, unknown>> {
  const deals: Array<Record<string, unknown>> = [];
  for (const [itemKey, state] of realmItems) {
    const median = regionMedians.get(itemKey);
    if (!median || median === 0) continue;
    if (state.price < median * thresholdPct) {
      deals.push({
        itemKey,
        price: state.price,
        qty: state.qty,
        regionMedian: median,
        discountPct: Math.round((1 - state.price / median) * 100),
      });
    }
  }
  return deals.sort((a, b) => (b.discountPct as number) - (a.discountPct as number));
}

function computeRegionMedians(
  allRealmItems: Map<number, Map<string, { price: number; qty: number }>>
): Map<string, number> {
  const pricesByKey = new Map<string, number[]>();

  for (const realmMap of allRealmItems.values()) {
    for (const [itemKey, state] of realmMap) {
      if (!pricesByKey.has(itemKey)) pricesByKey.set(itemKey, []);
      pricesByKey.get(itemKey)!.push(state.price);
    }
  }

  const medians = new Map<string, number>();
  for (const [key, prices] of pricesByKey) {
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    medians.set(key, prices.length % 2 !== 0 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2));
  }
  return medians;
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

// ─── Process one connected realm ─────────────────────────────────────────────
// Reads the previous realm index to carry forward price history (1 R2 read),
// then writes a single updated index with history appended (1 R2 write).
const MAX_ITEM_HISTORY = 30;

async function processRealm(
  realmId: number,
  region: Region,
  token: string,
  bucket: R2Bucket,
  snapshot: number
): Promise<Map<string, { price: number; qty: number }>> {
  const host = REGION_HOST[region];
  const auctionData = await bnetGet<AuctionResponse>(
    `${host}/data/wow/connected-realm/${realmId}/auctions`,
    token, region
  );

  const itemMap = new Map<string, { price: number; qty: number }>();

  for (const auction of auctionData.auctions) {
    const price = getPrice(auction);
    if (!price) continue;
    const key = getItemKey(auction);
    const existing = itemMap.get(key);
    if (!existing) {
      itemMap.set(key, { price, qty: auction.quantity });
    } else {
      if (price < existing.price) existing.price = price;
      existing.qty += auction.quantity;
    }
  }

  // Load existing index to carry forward price history (1 R2 read)
  type IndexEntry = { itemKey: string; price: number; qty: number; snapshot: number; history?: [number, number][] };
  const prevIndex = await getJson<IndexEntry[]>(bucket, `realm/${realmId}/index.json`) ?? [];
  const historyMap = new Map<string, [number, number][]>();
  for (const e of prevIndex) {
    if (e.history?.length) historyMap.set(e.itemKey, e.history);
  }

  // Build updated index with appended history entry per item (1 R2 write)
  const realmIndex: IndexEntry[] = [...itemMap].map(([itemKey, state]) => {
    const prev = historyMap.get(itemKey) ?? [];
    const history: [number, number][] = [...prev, [snapshot, state.price]];
    if (history.length > MAX_ITEM_HISTORY) history.splice(0, history.length - MAX_ITEM_HISTORY);
    return { itemKey, price: state.price, qty: state.qty, snapshot, history };
  });

  await putJson(bucket, `realm/${realmId}/index.json`, realmIndex);
  console.log(`[${region}] Realm ${realmId}: ${itemMap.size} items indexed`);

  return itemMap;
}

// ─── Fetch realm list ─────────────────────────────────────────────────────────
async function fetchRealmList(region: Region, token: string): Promise<number[]> {
  const host = REGION_HOST[region];
  const index = await bnetGet<ConnectedRealmIndex>(
    `${host}/data/wow/connected-realm/index`, token, region
  );
  return index.connected_realms.map(r => {
    const match = r.href.match(/connected-realm\/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }).filter(Boolean);
}

// ─── Main ingestion run ───────────────────────────────────────────────────────
// Processes REALMS_PER_RUN realms per region per invocation, rotating through
// the full realm list across successive cron runs to stay under CPU limits.
// Free-tier CPU budget: process 2 realms from ONE region per invocation.
// Alternates between regions each run; full coverage cycles over time.
const REALMS_PER_RUN = 2;

async function runIngestion(env: Env): Promise<void> {
  const allRegions = (env.BNET_REGIONS ?? 'us').split(',').map(r => r.trim()) as Region[];
  const snapshot = Date.now();

  // Load rotation state (tracks next realm offset per region + which region is next)
  const rotation = await getJson<Record<string, number>>(env.R2_BUCKET, 'global/ingestion-rotation.json') ?? {};

  // Pick ONE region to process this run (alternating)
  const regionIdx = (rotation['__regionIdx'] ?? 0) % allRegions.length;
  const regions = [allRegions[regionIdx]];
  rotation['__regionIdx'] = regionIdx + 1;

  console.log(`[ingestion] Snapshot ${snapshot} — processing region: ${regions[0]} (${regionIdx + 1}/${allRegions.length})`);

  let totalRealms = 0;

  for (const region of regions) {
    let token: string;
    try {
      token = await getBNetToken(region, env.BATTLE_NET_KEY, env.BATTLE_NET_SECRET);
    } catch (e) {
      console.error(`[${region}] Auth failed:`, e);
      continue;
    }

    let realmIds: number[];
    try {
      realmIds = await fetchRealmList(region, token);
      console.log(`[${region}] Found ${realmIds.length} connected realms`);
    } catch (e) {
      console.error(`[${region}] Realm list failed:`, e);
      continue;
    }

    // Pick slice of realms for this run, cycling from saved offset
    const offset = rotation[region] ?? 0;
    const slice = realmIds.slice(offset, offset + REALMS_PER_RUN);
    const nextOffset = (offset + REALMS_PER_RUN) >= realmIds.length ? 0 : offset + REALMS_PER_RUN;
    rotation[region] = nextOffset;
    console.log(`[${region}] Realms ${offset}–${offset + slice.length - 1} / ${realmIds.length} (next: ${nextOffset})`);

    // Process each realm — scoped to this region only
    const regionRealmItems = new Map<number, Map<string, { price: number; qty: number }>>();
    for (const realmId of slice) {
      try {
        const items = await processRealm(realmId, region, token, env.R2_BUCKET, snapshot);
        regionRealmItems.set(realmId, items);
        totalRealms++;
      } catch (e) {
        console.error(`[${region}] Realm ${realmId} failed:`, e);
      }
    }

    // Compute medians from this region's realms only
    const regionMedians = computeRegionMedians(regionRealmItems);

    // Write global deals file for this region (used by Deals page)
    const flatPrices = new Map<string, { price: number; qty: number }>();
    for (const realmMap of regionRealmItems.values()) {
      for (const [k, v] of realmMap) {
        if (!flatPrices.has(k) || v.price < flatPrices.get(k)!.price) flatPrices.set(k, v);
      }
    }
    await putJson(env.R2_BUCKET, `global/deals-${region}.json`,
      computeDeals(flatPrices, regionMedians).slice(0, 500)
    );
  }

  // Save rotation state and snapshot meta
  await putJson(env.R2_BUCKET, 'global/ingestion-rotation.json', rotation);
  await putJson(env.R2_BUCKET, 'global/state.json', { lastSnapshot: snapshot, realmCount: totalRealms, rotation });
  console.log(`[ingestion] Complete. Processed ${totalRealms} realms.`);
}

// ─── Worker export ────────────────────────────────────────────────────────────
export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runIngestion(env);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'POST' && new URL(req.url).pathname === '/trigger') {
      ctx.waitUntil(runIngestion(env).catch(console.error));
      return new Response(JSON.stringify({ ok: true, message: 'Ingestion triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
};
