// ─── Money ───────────────────────────────────────────────────────────────────
/** Expressed in coppers. 100 copper = 1 silver, 10000 copper = 1 gold */
export type Money = number;

// ─── Item Keys ───────────────────────────────────────────────────────────────
/** "itemId:itemLevel:itemSuffix" e.g. "12345:80:0" */
export type ItemKeyString = string;

export interface ItemKey {
  itemId: number;
  itemLevel: number;
  itemSuffix: number;
}

// ─── Quality ─────────────────────────────────────────────────────────────────
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;
export const QUALITY_NAMES: Record<Quality, string> = {
  0: 'Poor',
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Legendary',
};
export const QUALITY_COLORS: Record<Quality, string> = {
  0: '#9d9d9d',
  1: '#ffffff',
  2: '#4caf7d',
  3: '#4a90d9',
  4: '#b47bff',
  5: '#e67e22',
};

// ─── Regions ─────────────────────────────────────────────────────────────────
export type Region = 'us' | 'eu' | 'tw' | 'kr';

// ─── Realms ──────────────────────────────────────────────────────────────────
export interface Realm {
  id: number;
  name: string;
  category: string;
  connectedRealmId: number;
  region: Region;
  population?: 'low' | 'medium' | 'high' | 'full';
}

export interface ConnectedRealm {
  id: number;
  region: Region;
  canonical: Realm;
  secondary: Realm[];
}

// ─── Item Metadata ───────────────────────────────────────────────────────────
export interface ItemMeta {
  id: number;
  name: string;
  quality: Quality;
  class: number;
  subclass: number;
  itemLevel: number;
  expansion: number;
  icon: string;
  vendorPrice?: number;
  stack: number;
}

// ─── Auction / Price Data ────────────────────────────────────────────────────
export interface Auction {
  price: Money;
  qty: number;
}

/** [timestamp_ms, price_copper, qty] */
export type SnapshotTuple = [number, Money, number];

export interface ItemState {
  itemKey: ItemKeyString;
  snapshot: number;
  price: Money;
  qty: number;
  auctions: Auction[];
  snapshots: SnapshotTuple[];
  daily: SnapshotTuple[];
}

// ─── Search / Priced Items ───────────────────────────────────────────────────
export interface PricedItem {
  itemKey: ItemKeyString;
  item: ItemMeta;
  price: Money | null;
  qty: number | null;
  snapshot: number | null;
  regionMedian?: Money | null;
  vsMedianPct?: number;
  vs14dAvgPct?: number;
  history?: [number, number][];
}

// ─── Deals ───────────────────────────────────────────────────────────────────
export interface DealItem extends PricedItem {
  regionMedian: Money;
  discountPct: number;
  realmId: number;
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export type AnalyticsType =
  | 'deals'
  | 'undervalued'
  | 'weekly-cycle'
  | 'vendor-flip'
  | 'volume';

export interface AnalyticsSignal {
  type: 'buy' | 'sell' | 'watch';
  strength: number; // 0.0 – 1.0
  reason: string;
}

// ─── Market Profiles ─────────────────────────────────────────────────────────
export interface ProfileFilters {
  realm?: number;
  region?: Region;
  analyticsType: AnalyticsType;
  itemClass?: number;
  minQuality?: Quality;
  maxQuality?: Quality;
  minItemLevel?: number;
  maxItemLevel?: number;
  thresholdPct?: number;
  expansion?: number;
  includeOutOfStock?: boolean;
}

export interface Profile {
  id: number;
  name: string;
  description?: string;
  filters: ProfileFilters;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunCount?: number;
}

// ─── Favorites ───────────────────────────────────────────────────────────────
export interface FavoriteItem {
  id: number;
  itemKey: ItemKeyString;
  realmId: number;
  notedPrice?: Money;
  createdAt: number;
  item?: ItemMeta;
}

// ─── Trade Reports ───────────────────────────────────────────────────────────
export type TradeAction = 'buy' | 'sell' | 'watch';

export interface ReportItem {
  id: number;
  itemKey: ItemKeyString;
  action: TradeAction;
  currentPrice: Money;
  targetPrice?: Money;
  reasoning: string;
  confidence: number; // 0.0 – 1.0
  item?: ItemMeta;
}

export interface TradeReport {
  id: number;
  name: string;
  realmId: number;
  generatedAt: number;
  summary: {
    buyCount: number;
    sellCount: number;
    watchCount: number;
    estimatedProfit: Money;
  };
  items: ReportItem[];
}

// ─── Realm Status ────────────────────────────────────────────────────────────
export interface RealmSnapshot {
  connectedRealmId: number;
  region: Region;
  lastSnapshot: number;
  itemCount: number;
}

// ─── API Responses ───────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface SearchParams {
  realm?: number;
  q?: string;
  class?: number;
  minQuality?: number;
  maxQuality?: number;
  minLevel?: number;
  maxLevel?: number;
  expansion?: number;
  outOfStock?: boolean;
  ignoreVarieties?: boolean;
  arbitrageMode?: boolean;
  dealsOnly?: boolean;
  limit?: number;
  offset?: number;
}
