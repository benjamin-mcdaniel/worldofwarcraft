import { useState, useEffect } from 'react';
import type { ItemState, ItemMeta } from '../lib/types';
import { QUALITY_COLORS, QUALITY_NAMES } from '../lib/types';
import { items, favorites, catalog as catalogApi } from '../lib/api';
import { formatGold } from '../lib/money';
import { ItemIcon } from './shared/ItemIcon';

const ITEM_CLASS_NAMES: Record<number, string> = {
  0: 'Consumable', 1: 'Container', 2: 'Weapon', 3: 'Gem',
  4: 'Armor', 7: 'Reagent', 8: 'Enhancement', 9: 'Recipe',
  16: 'Glyph', 17: 'Battle Pet', 19: 'Prof. Equipment', 20: 'Housing',
};

const EXPANSION_NAMES = ['Classic','TBC','WotLK','Cata','MoP','WoD','Legion','BfA','SL','DF','TWW','Next'];

function PriceChart({ history }: { history: [number, number][] }) {
  if (history.length < 2) {
    return <div className="text-sm text-gray-600 italic py-4 text-center">Not enough history data yet</div>;
  }
  const W = 600, H = 100, PAD = 8;
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
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <defs>
        <linearGradient id="chartgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a90d9" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#4a90d9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#chartgrad)" />
      <polyline fill="none" stroke="#4a90d9" strokeWidth="1.5" points={polyline} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]}
          r={i === pts.length - 1 ? 4 : 3}
          fill={i === minIdx ? '#4ade80' : i === maxIdx ? '#f87171' : '#4a90d9'}
          stroke={i === pts.length - 1 ? '#0d0e18' : 'none'} strokeWidth="1.5">
          <title>{new Date(history[i][0]).toLocaleDateString()} — {formatGold(history[i][1])}</title>
        </circle>
      ))}
    </svg>
  );
}

interface Props {
  itemKey: string;
}

export default function ItemDetail({ itemKey }: Props) {
  const [state, setState] = useState<ItemState | null>(null);
  const [meta, setMeta] = useState<ItemMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFav, setIsFav] = useState(false);
  const [realmId, setRealmId] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return 0;
    const region = localStorage.getItem('wow_market_region') ?? 'us';
    return parseInt(localStorage.getItem(`wow_market_realm_${region}`) ?? '0');
  });

  // Sync with global realm selector in the top bar
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.realmId;
      if (id) setRealmId(id);
    };
    window.addEventListener('realmChanged', handler);
    return () => window.removeEventListener('realmChanged', handler);
  }, []);

  useEffect(() => {
    if (!itemKey) return;
    const itemId = parseInt(itemKey.split(':')[0]);
    setLoading(true);
    setState(null);
    Promise.allSettled([
      catalogApi.item(itemId),
      realmId ? items.getState(itemKey, realmId) : Promise.reject('no realm'),
      favorites.check(itemKey),
    ]).then(([metaRes, stateRes, favRes]) => {
      if (metaRes.status === 'fulfilled') setMeta(metaRes.value);
      if (stateRes.status === 'fulfilled') setState(stateRes.value as ItemState);
      if (favRes.status === 'fulfilled') setIsFav(favRes.value.isFavorite);
      setLoading(false);
    });
  }, [itemKey]);

  async function toggleFavorite() {
    try {
      if (isFav) { await favorites.remove(itemKey); setIsFav(false); }
      else { await favorites.add(itemKey, realmId || 1); setIsFav(true); }
    } catch (err) { console.error(err); }
  }

  const itemId = itemKey.split(':')[0];
  const qualColor = meta?.quality !== undefined ? (QUALITY_COLORS as any)[meta.quality] ?? '#d4c5a0' : '#d4c5a0';
  const snapshots = state?.snapshots ?? [];
  const history: [number, number][] = snapshots.map(([ts, price]) => [ts, price]);
  const hiPrice = history.length ? Math.max(...history.map(h => h[1])) : null;
  const loPrice = history.length ? Math.min(...history.map(h => h[1])) : null;
  const avgPrice = history.length ? Math.round(history.reduce((s, h) => s + h[1], 0) / history.length) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        <span className="animate-pulse">Loading item data…</span>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-start gap-5">
        <ItemIcon icon={meta?.icon} quality={meta?.quality} size={56} alt={meta?.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold truncate" style={{ color: qualColor }}>
              {meta?.name ?? itemKey}
            </h1>
            {meta?.quality !== undefined && (
              <span className="text-xs px-2 py-0.5 rounded border" style={{ color: qualColor, borderColor: qualColor + '55' }}>
                {QUALITY_NAMES[meta.quality as keyof typeof QUALITY_NAMES] ?? ''}
              </span>
            )}
            <button onClick={toggleFavorite}
              className={`text-lg ml-1 ${isFav ? 'text-wow-gold' : 'text-gray-600 hover:text-wow-gold'}`}
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}>
              {isFav ? '★' : '☆'}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
            <span className="text-gray-600">ID: <span className="text-gray-400 font-mono">{itemId}</span></span>
            {meta?.itemLevel ? <><span>·</span><span>ilvl {meta.itemLevel}</span></> : null}
            {meta?.class !== undefined ? <><span>·</span><span>{ITEM_CLASS_NAMES[meta.class] ?? `Class ${meta.class}`}</span></> : null}
            {meta?.expansion !== undefined ? <><span>·</span><span>{EXPANSION_NAMES[meta.expansion] ?? ''}</span></> : null}
            {meta?.stack && meta.stack > 1 ? <><span>·</span><span>Stack ×{meta.stack}</span></> : null}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-wow-gold">{formatGold(state?.price ?? null)}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {state?.snapshot ? `${Math.floor((Date.now() - state.snapshot) / 60000)}m ago` : 'No AH data'}
          </div>
          {state?.qty ? <div className="text-xs text-gray-500">Qty: {state.qty}</div> : null}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: 'Current Price', value: formatGold(state?.price ?? null) },
          { label: 'Available Qty',  value: state?.qty?.toLocaleString() ?? '—' },
          { label: 'Open Auctions',  value: state?.auctions?.length?.toString() ?? '—' },
          { label: 'Last Snapshot',  value: state?.snapshot ? `${Math.floor((Date.now() - state.snapshot) / 60000)}m ago` : '—' },
        ] as {label:string;value:string}[]).map(s => (
          <div key={s.label} className="bg-bg2 border border-border rounded-lg p-3 text-center">
            <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">{s.label}</div>
            <div className="text-sm font-semibold text-wow-gold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Price history chart */}
      <div className="bg-bg2 border border-border rounded-lg p-5">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Price History</div>
        {history.length === 0 ? (
          <div className="text-center text-gray-600 text-sm py-8">No price history recorded for this realm yet.</div>
        ) : (
          <>
            <PriceChart history={history} />
            <div className="flex justify-between text-[11px] text-gray-500 mt-3">
              <span>Low: <span className="text-green-400 font-semibold">{formatGold(loPrice)}</span></span>
              <span>Avg: <span className="text-gray-300 font-semibold">{formatGold(avgPrice)}</span></span>
              <span>High: <span className="text-red-400 font-semibold">{formatGold(hiPrice)}</span></span>
              <span className="text-gray-600">{history.length} snapshots</span>
            </div>
          </>
        )}
      </div>

      {/* Two-column: item data table + auctions */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">

        {/* Item data table */}
        <div className="bg-bg2 border border-border rounded-lg p-5">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Item Data</div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              {([
                ['Item ID',       itemId],
                ['Name',          meta?.name ?? '—'],
                ['Quality',       meta?.quality !== undefined ? QUALITY_NAMES[meta.quality as keyof typeof QUALITY_NAMES] : '—'],
                ['Item Level',    meta?.itemLevel ? String(meta.itemLevel) : '—'],
                ['Item Class',    meta?.class !== undefined ? `${ITEM_CLASS_NAMES[meta.class] ?? meta.class} (${meta.class}.${meta.subclass ?? 0})` : '—'],
                ['Expansion',     meta?.expansion !== undefined ? (EXPANSION_NAMES[meta.expansion] ?? String(meta.expansion)) : '—'],
                ['Stack Size',    meta?.stack ? String(meta.stack) : '—'],
                ['Vendor Price',  meta?.vendorPrice ? formatGold(meta.vendorPrice) : '—'],
                ['Current Price', formatGold(state?.price ?? null)],
                ['Region Median', '—'],
                ['Qty on AH',     state?.qty?.toLocaleString() ?? '—'],
                ['AH Listings',   state?.auctions?.length?.toString() ?? '—'],
              ] as [string, string][]).map(([k, v]) => (
                <tr key={k} className="border-b border-[#1e2028]">
                  <td className="py-1.5 pr-4 text-gray-500 w-36">{k}</td>
                  <td className="py-1.5 text-gray-200 font-mono text-[11px]">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Current auctions */}
        <div className="bg-bg2 border border-border rounded-lg p-5">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Current Auctions</div>
          {!state?.auctions?.length ? (
            <div className="text-center text-gray-600 text-sm py-6">No active auctions</div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {state.auctions.slice(0, 30).map((a, i) => (
                <div key={i} className="flex justify-between text-xs py-1 border-b border-[#1e2028]">
                  <span className="text-wow-gold font-semibold">{formatGold(a.price)}</span>
                  <span className="text-gray-500">×{a.qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <a href="/search" className="text-sm border border-border text-gray-400 px-4 py-2 rounded hover:border-gray-300">
          ← Back to Search
        </a>
        <button onClick={toggleFavorite}
          className={`text-sm px-4 py-2 rounded border transition-colors ${
            isFav ? 'border-wow-gold text-wow-gold' : 'border-border text-gray-400 hover:border-wow-gold'
          }`}>
          {isFav ? '★ Saved to Favorites' : '☆ Save to Favorites'}
        </button>
        <a href={`https://www.wowhead.com/item=${itemId}`}
          target="_blank" rel="noopener noreferrer"
          className="text-sm border border-[#f7941d55] text-[#f7941d] px-4 py-2 rounded hover:border-[#f7941d]">
          View on Wowhead ↗
        </a>
      </div>
    </div>
  );
}
