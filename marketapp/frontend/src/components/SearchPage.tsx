import React, { useState, useEffect, useRef } from 'react';
import type { PricedItem, SearchParams } from '../lib/types';
import { QUALITY_COLORS } from '../lib/types';
import { search, realms as realmsApi } from '../lib/api';
import { ItemIcon } from './shared/ItemIcon';
import { formatGold } from '../lib/money';

const ITEM_CLASSES = [
  { id: 2,  name: 'Weapons',         icon: '⚔' },
  { id: 4,  name: 'Armor',           icon: '🛡' },
  { id: 0,  name: 'Consumables',     icon: '🧪' },
  { id: 7,  name: 'Reagents',        icon: '🌿' },
  { id: 9,  name: 'Recipes',         icon: '📖' },
  { id: 3,  name: 'Gems',            icon: '💎' },
  { id: 8,  name: 'Enhancements',    icon: '✨' },
  { id: 1,  name: 'Containers',      icon: '�' },
  { id: 17, name: 'Battle Pets',     icon: '🐾' },
  { id: 19, name: 'Prof. Equipment', icon: '🔧' },
  { id: 20, name: 'Housing',         icon: '🏠' },
  { id: 16, name: 'Glyphs',          icon: '✍' },
];

const EXPANSION_NAMES = ['Classic','TBC','WotLK','Cata','MoP','WoD','Legion','BfA','SL','DF','TWW','Next'];

function PriceChart({ history }: { history?: [number, number][] }) {
  if (!history || history.length < 2) {
    return (
      <div className="text-[11px] text-gray-600 italic py-1">
        {history?.length === 1 ? 'Collecting history — more data after next cron run' : 'No price history recorded yet'}
      </div>
    );
  }
  const W = 320, H = 60, PAD = 6;
  const prices = history.map(h => h[1]);
  const minP = Math.min(...prices) * 0.97;
  const maxP = Math.max(...prices) * 1.03;
  const range = maxP - minP || 1;
  const pts = history.map((h, i) => [
    PAD + (i / (history.length - 1)) * (W - PAD * 2),
    PAD + (1 - (h[1] - minP) / range) * (H - PAD * 2),
  ] as [number, number]);
  const polyline = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = [`${pts[0][0]},${H}`, ...pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`), `${pts[pts.length-1][0]},${H}`].join(' ');
  const minIdx = prices.indexOf(Math.min(...prices));
  const maxIdx = prices.indexOf(Math.max(...prices));
  const gradId = `pg${history[0][0]}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a90d9" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#4a90d9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline fill="none" stroke="#4a90d9" strokeWidth="1.5" points={polyline} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2.5}
          fill={i === minIdx ? '#4ade80' : i === maxIdx ? '#f87171' : '#4a90d9'}
          stroke={i === pts.length - 1 ? '#1a1c26' : 'none'} strokeWidth="1.5" />
      ))}
    </svg>
  );
}

export default function SearchPage() {
  const [region, setRegion] = useState<string>(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('wow_market_region') : null) ?? 'us'
  );
  const [realmList, setRealmList] = useState<Array<{ id: number; name: string }>>([]);
  const [realmsLoading, setRealmsLoading] = useState(true);
  const [realmId, setRealmId] = useState(0);
  const [activeClass, setActiveClass] = useState<number | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PricedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [minQuality, setMinQuality] = useState(0);
  const [minLevel, setMinLevel] = useState<number | undefined>();
  const [maxLevel, setMaxLevel] = useState<number | undefined>();

  // Keep a ref so executeSearch always reads latest realmId without stale closure
  const realmIdRef = useRef(0);
  realmIdRef.current = realmId;
  const queryRef = useRef('');
  queryRef.current = query;
  const activeClassRef = useRef<number | undefined>(undefined);
  activeClassRef.current = activeClass;

  // Load realm list whenever region changes
  useEffect(() => {
    setRealmsLoading(true);
    setRealmList([]);
    setRealmId(0);
    setResults([]);

    realmsApi.list()
      .then((all: any[]) => {
        const filtered = (all as any[]).filter((r: any) => r.region === region);
        setRealmList(filtered);
        if (filtered.length === 0) { setRealmsLoading(false); return; }
        const saved = localStorage.getItem(`wow_market_realm_${region}`);
        const match = filtered.find((r: any) => String(r.id) === String(saved));
        const pick = match ?? filtered[0];
        localStorage.setItem(`wow_market_realm_${region}`, String(pick.id));
        setRealmId(pick.id);
        setRealmsLoading(false);
      })
      .catch(() => setRealmsLoading(false));
  }, [region]);

  // Listen to regionChanged from the top-bar selector
  useEffect(() => {
    const handler = (e: Event) => {
      const r = (e as CustomEvent).detail?.region;
      if (r) { setRegion(r); setActiveClass(undefined); setQuery(''); }
    };
    window.addEventListener('regionChanged', handler);
    return () => window.removeEventListener('regionChanged', handler);
  }, []);

  async function executeSearch(overrides: Partial<SearchParams> = {}) {
    const rId = overrides.realm ?? realmIdRef.current;
    if (!rId) return;
    setLoading(true);
    try {
      const params: SearchParams = {
        realm: rId,
        q: ('q' in overrides ? overrides.q : queryRef.current) || undefined,
        class: 'class' in overrides ? overrides.class : activeClassRef.current,
        limit: 200,
        minQuality: minQuality || undefined,
        minLevel,
        maxLevel,
        ...overrides,
      };
      const data = await search.items(params);
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // Auto-search when realm is first selected
  useEffect(() => {
    if (realmId) executeSearch({ realm: realmId, class: activeClassRef.current });
  }, [realmId]);

  function selectCategory(cls: number | undefined) {
    setActiveClass(cls);
    setExpandedKey(null);
    executeSearch({ class: cls });
  }

  return (
    <div className="flex h-[calc(100vh-44px)]">
      {/* Category panel */}
      <aside className="w-44 flex-shrink-0 border-r border-border bg-bg2 overflow-y-auto">
        <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-gray-600 uppercase tracking-widest">Categories</div>
        <div className="flex flex-col pb-2">
          <button
            onClick={() => selectCategory(undefined)}
            className={`text-left px-3 py-1.5 text-xs transition-colors ${activeClass === undefined ? 'text-wow-gold bg-[rgba(240,192,96,0.08)] border-l-2 border-wow-gold' : 'text-gray-400 hover:text-gray-200 hover:bg-bg3'}`}
          >
            All Items
          </button>
          {ITEM_CLASSES.map(c => (
            <button key={c.id} onClick={() => selectCategory(c.id)}
              className={`text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${activeClass === c.id ? 'text-wow-gold bg-[rgba(240,192,96,0.08)] border-l-2 border-wow-gold' : 'text-gray-400 hover:text-gray-200 hover:bg-bg3'}`}
            >
              <span className="w-4 text-center">{c.icon}</span>{c.name}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Search bar */}
        <div className="bg-bg2 border-b border-border px-4 py-2.5 flex gap-2 items-center">
          <select
            value={realmId}
            onChange={e => {
              const id = Number(e.target.value);
              setRealmId(id);
              localStorage.setItem(`wow_market_realm_${region}`, String(id));
            }}
            className="bg-bg3 border border-border text-sm text-gray-300 px-2 py-2 rounded shrink-0 max-w-[180px]"
          >
            {realmList.length === 0
              ? <option value={0}>Loading realms…</option>
              : realmList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)
            }
          </select>
          <div className="flex-1 relative">
            <input type="text" placeholder="Search item name…" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && executeSearch()}
              className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded pr-8"
            />
            {query && <button onClick={() => { setQuery(''); executeSearch({ q: undefined }); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">✕</button>}
          </div>
          <button onClick={() => executeSearch()} className="bg-wow-blue text-white text-sm px-4 py-2 rounded hover:opacity-90">Search</button>
          <button onClick={() => setShowFilters(!showFilters)} className={`text-sm px-3 py-2 rounded border transition-colors ${showFilters ? 'border-wow-blue text-wow-blue' : 'border-border text-gray-400'}`}>▼ Filters</button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-bg2 border-b border-border px-4 py-3">
            <div className="flex gap-4 text-xs items-end flex-wrap">
              <div>
                <label className="block text-gray-500 mb-1">ilvl Min</label>
                <input type="number" placeholder="0" value={minLevel ?? ''} onChange={e => setMinLevel(e.target.value ? Number(e.target.value) : undefined)} className="w-20 bg-bg3 border border-border text-gray-200 px-2 py-1.5 rounded" />
              </div>
              <div>
                <label className="block text-gray-500 mb-1">ilvl Max</label>
                <input type="number" placeholder="999" value={maxLevel ?? ''} onChange={e => setMaxLevel(e.target.value ? Number(e.target.value) : undefined)} className="w-20 bg-bg3 border border-border text-gray-200 px-2 py-1.5 rounded" />
              </div>
              <div>
                <label className="block text-gray-500 mb-1">Min Quality</label>
                <select value={minQuality} onChange={e => setMinQuality(Number(e.target.value))} className="bg-bg3 border border-border text-gray-200 px-2 py-1.5 rounded">
                  {['Any','Common','Uncommon','Rare','Epic','Legendary'].map((q,i) => <option key={i} value={i}>{q}</option>)}
                </select>
              </div>
              <button onClick={() => { setMinQuality(0); setMinLevel(undefined); setMaxLevel(undefined); executeSearch({ minQuality: undefined, minLevel: undefined, maxLevel: undefined }); }} className="text-gray-400 border border-border px-3 py-1.5 rounded hover:border-gray-400">Reset</button>
              <button onClick={() => executeSearch()} className="bg-wow-blue text-white px-4 py-1.5 rounded hover:opacity-90">Apply</button>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {realmsLoading && (
            <div className="p-12 text-center text-gray-500">
              <div className="text-2xl mb-3 animate-pulse">⚙</div>
              <div>Loading realms…</div>
            </div>
          )}
          {!realmsLoading && !realmId && (
            <div className="p-12 text-center text-gray-500">
              <div className="text-3xl mb-3">🌐</div>
              <div>No realms found for {region.toUpperCase()}. Try a different region.</div>
            </div>
          )}
          {!realmsLoading && realmId && loading && <div className="p-12 text-center text-gray-500">Loading…</div>}
          {!realmsLoading && realmId && !loading && results.length === 0 && (
            <div className="p-12 text-center text-gray-500">
              <div className="text-2xl mb-2">📭</div>
              <div>No auction house data yet for this realm.</div>
              <div className="text-xs mt-1 text-gray-600">Try selecting a category to browse the full item catalog.</div>
            </div>
          )}
          {realmId && results.length > 0 && (
            <>
              <div className="px-4 py-2 text-[11px] text-gray-500 border-b border-border bg-bg2 sticky top-0 z-10">
                {results.length} items{activeClass !== undefined ? ` · ${ITEM_CLASSES.find(c => c.id === activeClass)?.name}` : ''}
                <span className="ml-2 text-gray-600">· click a row to see price history</span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-[33px] bg-bg3 z-10">
                  <tr className="text-gray-500 font-medium border-b border-border">
                    <th className="text-left px-3 py-2.5">Item</th>
                    <th className="text-right px-3 py-2.5">Price</th>
                    <th className="text-right px-3 py-2.5">Qty</th>
                    <th className="text-right px-3 py-2.5">Last Seen</th>
                    <th className="w-6 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(item => {
                    const meta = item.item as any;
                    const isExpanded = expandedKey === item.itemKey;
                    const qualColor = (QUALITY_COLORS as any)[meta?.quality ?? 1] ?? '#ffffff';
                    const prices = item.history?.map(h => h[1]) ?? [];
                    const hiPrice = prices.length ? Math.max(...prices) : null;
                    const loPrice = prices.length ? Math.min(...prices) : null;
                    return (
                      <React.Fragment key={item.itemKey}>
                        <tr
                          onClick={() => setExpandedKey(k => k === item.itemKey ? null : item.itemKey)}
                          className={`border-b border-[#1a1c26] cursor-pointer transition-colors ${isExpanded ? 'bg-[#12141e]' : 'hover:bg-bg2'}`}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <ItemIcon icon={meta?.icon} quality={meta?.quality} size={22} />
                              <div>
                                <div style={{ color: qualColor }}>{meta?.name ?? item.itemKey}</div>
                                {meta?.itemLevel > 0 && (
                                  <div className="text-[10px] text-gray-600">
                                    ilvl {meta.itemLevel}{meta.expansion !== undefined ? ` · ${EXPANSION_NAMES[meta.expansion] ?? ''}` : ''}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-wow-gold">
                            {item.price ? formatGold(item.price) : <span className="text-gray-600 font-normal">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-400">
                            {item.qty ?? <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500">
                            {item.snapshot ? `${Math.floor((Date.now() - item.snapshot) / 60000)}m ago` : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-2 py-2 text-center text-gray-600 text-[10px]">{isExpanded ? '▲' : '▼'}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-[#1a1c26] bg-[#0d0e18]">
                            <td colSpan={5} className="px-5 py-4">
                              <div className="flex gap-10 items-start">
                                <div>
                                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Price History</div>
                                  <PriceChart history={item.history} />
                                  {item.history && item.history.length >= 2 && (
                                    <div className="flex gap-4 mt-1 text-[10px] text-gray-600">
                                      <span>
                                        {new Date(item.history[0][0]).toLocaleDateString()} –{' '}
                                        {new Date(item.history[item.history.length - 1][0]).toLocaleDateString()}
                                      </span>
                                      <span>({item.history.length} snapshots)</span>
                                    </div>
                                  )}
                                </div>
                                <div className="text-xs space-y-2 min-w-[140px]">
                                  <div className="flex justify-between gap-6">
                                    <span className="text-gray-500">Current</span>
                                    <span className="text-wow-gold font-semibold">{item.price ? formatGold(item.price) : '—'}</span>
                                  </div>
                                  {hiPrice !== null && (
                                    <div className="flex justify-between gap-6">
                                      <span className="text-gray-500">High</span>
                                      <span className="text-red-400">{formatGold(hiPrice)}</span>
                                    </div>
                                  )}
                                  {loPrice !== null && (
                                    <div className="flex justify-between gap-6">
                                      <span className="text-gray-500">Low</span>
                                      <span className="text-green-400">{formatGold(loPrice)}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between gap-6">
                                    <span className="text-gray-500">Qty</span>
                                    <span className="text-gray-300">{item.qty ?? '—'}</span>
                                  </div>
                                  {meta?.stack > 1 && (
                                    <div className="flex justify-between gap-6">
                                      <span className="text-gray-500">Stack</span>
                                      <span className="text-gray-300">×{meta.stack}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="ml-auto self-end">
                                  <a href={`/item/${encodeURIComponent(item.itemKey)}`} onClick={e => e.stopPropagation()} className="text-wow-blue text-xs hover:underline">
                                    Full detail →
                                  </a>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
