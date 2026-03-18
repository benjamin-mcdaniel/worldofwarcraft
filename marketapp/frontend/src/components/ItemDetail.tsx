import { useState, useEffect } from 'react';
import type { ItemState, ItemMeta } from '../lib/types';
import { items, favorites } from '../lib/api';
import { formatGold } from '../lib/money';
import { ItemIcon } from './shared/ItemIcon';
import { MoneyDisplay, MedianDelta } from './shared/MoneyDisplay';

interface Props {
  itemKey: string;
}

const DEFAULT_REALM = 1;

export default function ItemDetail({ itemKey }: Props) {
  const [state, setState] = useState<ItemState | null>(null);
  const [meta, setMeta] = useState<ItemMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFav, setIsFav] = useState(false);
  const [realmId] = useState(DEFAULT_REALM);

  useEffect(() => {
    if (!itemKey) return;
    loadItem();
  }, [itemKey, realmId]);

  async function loadItem() {
    setLoading(true);
    setError(null);
    try {
      const data = await items.getState(itemKey, realmId);
      setState(data);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load item');
    } finally {
      setLoading(false);
    }
  }

  async function toggleFavorite() {
    try {
      if (isFav) {
        await favorites.remove(itemKey);
        setIsFav(false);
      } else {
        await favorites.add(itemKey, realmId);
        setIsFav(true);
      }
    } catch (err) {
      console.error('Favorite toggle error:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading item data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-red-950 border border-red-900 rounded-lg p-6 text-wow-red">
          <div className="font-semibold mb-1">Error loading item</div>
          <div className="text-sm">{error}</div>
          <button onClick={loadItem} className="mt-3 text-sm border border-wow-red px-3 py-1.5 rounded hover:bg-red-900">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const snapshots = state.snapshots ?? [];
  const dailyData = state.daily ?? [];

  const priceHistory = snapshots.slice(-20).map(([ts, price]) => ({
    time: new Date(ts).toLocaleDateString(),
    price,
    gold: price / 10000,
  }));

  const maxPrice = Math.max(...priceHistory.map(p => p.gold), 1);

  return (
    <div className="max-w-5xl mx-auto px-6 py-5">
      {/* Header */}
      <div className="flex items-start gap-4 mb-5">
        <ItemIcon icon={meta?.icon} quality={meta?.quality} size={48} alt={meta?.name} />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold" style={{ color: meta?.quality !== undefined ? undefined : '#d4c5a0' }}>
              {meta?.name ?? itemKey}
            </h1>
            <button
              onClick={toggleFavorite}
              className={`text-xl ${isFav ? 'text-wow-gold' : 'text-gray-600 hover:text-wow-gold'}`}
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFav ? '★' : '☆'}
            </button>
          </div>
          {meta && (
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span>ilvl {meta.itemLevel}</span>
              <span>·</span>
              <span>Class {meta.class}.{meta.subclass}</span>
              {meta.vendorPrice && (
                <>
                  <span>·</span>
                  <span>Vendor: {formatGold(meta.vendorPrice)}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-wow-gold">{formatGold(state.price)}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {state.snapshot ? `Updated ${Math.floor((Date.now() - state.snapshot) / 60000)}m ago` : ''}
          </div>
          <div className="text-xs text-gray-500">Qty: {state.qty}</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Current Price', value: formatGold(state.price), sub: 'per unit' },
          { label: 'Available Qty', value: state.qty.toLocaleString(), sub: 'on AH' },
          { label: 'Listings', value: state.auctions?.length ?? 0, sub: 'open auctions' },
          { label: 'Data Age', value: state.snapshot ? `${Math.floor((Date.now() - state.snapshot) / 60000)}m` : '—', sub: 'last snapshot' },
        ].map(s => (
          <div key={s.label} className="bg-bg2 border border-border rounded-lg p-3 text-center">
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className="text-base font-semibold text-wow-gold">{s.value}</div>
            <div className="text-[10px] text-gray-600 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-5">
        {/* Price history chart (ASCII sparkline placeholder) */}
        <div className="bg-bg2 border border-border rounded-lg p-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Price History (30 days)</div>
          {priceHistory.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">No history data available</div>
          ) : (
            <div className="space-y-1">
              {/* Sparkline bars */}
              <div className="flex items-end gap-0.5 h-24">
                {priceHistory.map((p, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-wow-blue rounded-t opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                    style={{ height: `${(p.gold / maxPrice) * 100}%`, minHeight: 2 }}
                    title={`${p.time}: ${formatGold(p.price)}`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>{priceHistory[0]?.time}</span>
                <span>{priceHistory[priceHistory.length - 1]?.time}</span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 mt-2">
                <span>Low: {formatGold(Math.min(...snapshots.map(([, p]) => p)))}</span>
                <span>Avg: {formatGold(Math.round(snapshots.reduce((s, [, p]) => s + p, 0) / (snapshots.length || 1)))}</span>
                <span>High: {formatGold(Math.max(...snapshots.map(([, p]) => p)))}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right panel: current auctions */}
        <div className="bg-bg2 border border-border rounded-lg p-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Current Auctions</div>
          {(!state.auctions || state.auctions.length === 0) ? (
            <div className="text-center text-gray-500 text-sm py-6">No active auctions</div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {state.auctions.slice(0, 20).map((a, i) => (
                <div key={i} className="flex justify-between text-xs border-b border-bg pb-1">
                  <span className="text-wow-gold">{formatGold(a.price)}</span>
                  <span className="text-gray-500">×{a.qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-5">
        <a href="/search" className="text-sm border border-border text-gray-400 px-4 py-2 rounded hover:border-gray-300">
          ← Back to Search
        </a>
        <button
          onClick={toggleFavorite}
          className={`text-sm px-4 py-2 rounded border transition-colors ${
            isFav ? 'border-wow-gold text-wow-gold' : 'border-border text-gray-400 hover:border-wow-gold'
          }`}
        >
          {isFav ? '★ Saved' : '☆ Save to Favorites'}
        </button>
        <a
          href={`https://www.wowhead.com/item=${itemKey.split(':')[0]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm border border-border text-gray-400 px-4 py-2 rounded hover:border-wow-blue"
        >
          View on Wowhead ↗
        </a>
      </div>
    </div>
  );
}
