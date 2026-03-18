import type {
  Realm, ConnectedRealm, ItemMeta, ItemState, PricedItem, DealItem,
  Profile, ProfileFilters, FavoriteItem, TradeReport, RealmSnapshot,
  SearchParams, Region,
} from './types';

const API_BASE = import.meta.env.PUBLIC_API_BASE
  ?? 'https://wow-market-api.benjamin-f-mcdaniel.workers.dev/api';

function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('wow_market_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  login: (username: string, password: string) =>
    request<{ token: string; expiresAt: number }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ username: string }>('/auth/me'),
};

// ─── Realms ──────────────────────────────────────────────────────────────────
export const realms = {
  list: () => request<ConnectedRealm[]>('/realms'),
  byRegion: (region: Region) => request<ConnectedRealm[]>(`/realms/${region}`),
  snapshots: () => request<RealmSnapshot[]>('/realms/snapshots'),
};

// ─── Search ──────────────────────────────────────────────────────────────────
export const search = {
  items: (params: SearchParams) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      )
    ).toString();
    return request<PricedItem[]>(`/search?${qs}`);
  },
};

// ─── Deals ───────────────────────────────────────────────────────────────────
export const deals = {
  list: (region: Region) => request<DealItem[]>(`/deals?region=${region}`),
};

// ─── Items ───────────────────────────────────────────────────────────────────
export const items = {
  getState: (itemKey: string, realmId: number) =>
    request<ItemState>(`/item/${encodeURIComponent(itemKey)}/realm/${realmId}`),
  trending: (realmId: number) => request<PricedItem[]>(`/trending?realm=${realmId}`),
};

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analytics = {
  undervalued: (realmId: number, thresholdPct = 80) =>
    request<PricedItem[]>(`/analytics/undervalued?realm=${realmId}&threshold=${thresholdPct}`),
  weeklyCycle: (realmId: number) =>
    request<PricedItem[]>(`/analytics/weekly-cycle?realm=${realmId}`),
  volume: (realmId: number, itemClass?: number) =>
    request<PricedItem[]>(`/analytics/volume?realm=${realmId}${itemClass ? `&class=${itemClass}` : ''}`),
  vendorFlip: (realmId: number) =>
    request<PricedItem[]>(`/analytics/vendor-flip?realm=${realmId}`),
};

// ─── Profiles ────────────────────────────────────────────────────────────────
export const profiles = {
  list: () => request<Profile[]>('/profiles'),
  get: (id: number) => request<Profile>(`/profiles/${id}`),
  create: (data: { name: string; description?: string; filters: ProfileFilters }) =>
    request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<{ name: string; description: string; filters: ProfileFilters }>) =>
    request<Profile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/profiles/${id}`, { method: 'DELETE' }),
  run: (id: number) => request<PricedItem[]>(`/profiles/${id}/run`, { method: 'POST' }),
};

// ─── Favorites ───────────────────────────────────────────────────────────────
export const favorites = {
  list: () => request<FavoriteItem[]>('/favorites'),
  add: (itemKey: string, realmId: number, notedPrice?: number) =>
    request<FavoriteItem>('/favorites', {
      method: 'POST',
      body: JSON.stringify({ itemKey, realmId, notedPrice }),
    }),
  remove: (itemKey: string) =>
    request<void>(`/favorites/${encodeURIComponent(itemKey)}`, { method: 'DELETE' }),
};

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reports = {
  list: () => request<TradeReport[]>('/reports'),
  get: (id: number) => request<TradeReport>(`/reports/${id}`),
  generate: (data: { name: string; realmId: number; profileIds: number[] }) =>
    request<TradeReport>('/reports/generate', { method: 'POST', body: JSON.stringify(data) }),
};
