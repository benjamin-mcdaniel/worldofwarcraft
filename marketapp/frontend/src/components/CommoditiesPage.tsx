import { useState, useEffect } from 'react';
import { catalog } from '../lib/api';

interface CommodityItem {
  itemId: number;
  price: number;
  qty: number;
}

interface CommoditiesSnapshot {
  snapshot: number;
  items: CommodityItem[];
}

interface ItemMeta {
  id: number;
  name: string;
  icon: string;
  quality: number;
  class: number;
  subclass: number;
}

type Region = 'us' | 'eu';

const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d', // Poor
  1: '#ffffff', // Common
  2: '#1eff00', // Uncommon
  3: '#0070dd', // Rare
  4: '#a335ee', // Epic
  5: '#ff8000', // Legendary
};

export default function CommoditiesPage() {
  const [region, setRegion] = useState<Region>('us');
  const [commodities, setCommodities] = useState<CommoditiesSnapshot | null>(null);
  const [itemMetas, setItemMetas] = useState<Record<number, ItemMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price'>('name');

  // Fetch commodities data
  useEffect(() => {
    setLoading(true);
    setError(null);
    
    const API_BASE = 'https://wow-market-api.benjamin-f-mcdaniel.workers.dev/api';
    fetch(`${API_BASE}/commodities/${region}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch commodities: ${res.status}`);
        return res.json();
      })
      .then((data: CommoditiesSnapshot) => {
        setCommodities(data);
        
        // Fetch item metadata for all commodities
        const itemIds = [...new Set(data.items.map(item => item.itemId))];
        Promise.allSettled(itemIds.map(id => catalog.item(id)))
          .then(results => {
            const metas: Record<number, ItemMeta> = {};
            results.forEach((result, idx) => {
              if (result.status === 'fulfilled') {
                metas[itemIds[idx]] = result.value;
              }
            });
            setItemMetas(metas);
          });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [region]);

  // Filter and sort commodities
  const filteredItems = commodities?.items.filter(item => {
    if (!searchQuery) return true;
    const meta = itemMetas[item.itemId];
    if (!meta) return false;
    return meta.name.toLowerCase().includes(searchQuery.toLowerCase());
  }) || [];

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortBy === 'price') {
      return a.price - b.price;
    }
    const metaA = itemMetas[a.itemId];
    const metaB = itemMetas[b.itemId];
    if (!metaA || !metaB) return 0;
    return metaA.name.localeCompare(metaB.name);
  });

  const formatGold = (copper: number) => {
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const copperRem = copper % 100;
    return (
      <>
        {gold > 0 && <span className="text-yellow-400">{gold}g</span>}
        {silver > 0 && <span className="text-gray-300 ml-1">{silver}s</span>}
        {copperRem > 0 && <span className="text-amber-600 ml-1">{copperRem}c</span>}
      </>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gold mb-2">Commodities Market</h1>
        <p className="text-text2">Region-wide prices for stackable materials, consumables, and trade goods</p>
      </div>

      {/* Region Selector */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setRegion('us')}
          className={`px-4 py-2 rounded ${
            region === 'us'
              ? 'bg-blue text-white'
              : 'bg-bg3 text-text2 hover:bg-bg2'
          }`}
        >
          US Region
        </button>
        <button
          onClick={() => setRegion('eu')}
          className={`px-4 py-2 rounded ${
            region === 'eu'
              ? 'bg-blue text-white'
              : 'bg-bg3 text-text2 hover:bg-bg2'
          }`}
        >
          EU Region
        </button>
      </div>

      {/* Search and Sort */}
      <div className="mb-6 flex gap-4">
        <input
          type="text"
          placeholder="Search commodities..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 bg-bg3 border border-border rounded text-text focus:outline-none focus:border-blue"
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'name' | 'price')}
          className="px-4 py-2 bg-bg3 border border-border rounded text-text focus:outline-none focus:border-blue"
        >
          <option value="name">Sort by Name</option>
          <option value="price">Sort by Price</option>
        </select>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12 text-text2">
          Loading commodities...
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red/10 border border-red rounded p-4 text-red">
          {error}
        </div>
      )}

      {/* Commodities List */}
      {!loading && !error && (
        <div className="bg-bg2 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 p-4 border-b border-border font-semibold text-text2">
            <div>Icon</div>
            <div>Item Name</div>
            <div>Price</div>
            <div>Available</div>
          </div>
          
          {sortedItems.length === 0 ? (
            <div className="p-8 text-center text-text2">
              {searchQuery ? 'No commodities match your search' : 'No commodities available'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedItems.map(item => {
                const meta = itemMetas[item.itemId];

                return (
                  <a
                    key={item.itemId}
                    href={`/commodity/${item.itemId}?region=${region}`}
                    className="grid grid-cols-[auto_1fr_auto_auto] gap-4 p-4 hover:bg-bg3 transition-colors items-center"
                  >
                    {meta ? (
                      <img
                        src={`https://render.worldofwarcraft.com/us/icons/56/${meta.icon}.jpg`}
                        alt={meta.name}
                        className="w-12 h-12 rounded border-2"
                        style={{ borderColor: QUALITY_COLORS[meta.quality] || '#9d9d9d' }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded border-2 border-border bg-bg3 animate-pulse" />
                    )}
                    <div>
                      <div
                        className="font-semibold"
                        style={{ color: meta ? QUALITY_COLORS[meta.quality] || '#ffffff' : '#ffffff' }}
                      >
                        {meta ? meta.name : `Item ${item.itemId}`}
                      </div>
                      <div className="text-sm text-text2">Item ID: {item.itemId}</div>
                    </div>
                    <div className="text-right font-mono">
                      {formatGold(item.price)}
                    </div>
                    <div className="text-right text-text2">
                      {item.qty.toLocaleString()}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stats Footer */}
      {commodities && !loading && (
        <div className="mt-6 text-center text-text2 text-sm">
          Showing {sortedItems.length} of {commodities.items.length} commodities
          {commodities.snapshot && (
            <> · Last updated: {new Date(commodities.snapshot).toLocaleString()}</>
          )}
        </div>
      )}
    </div>
  );
}
