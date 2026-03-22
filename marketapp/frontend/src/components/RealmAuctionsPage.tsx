import { useState, useEffect } from 'react';
import { catalog, realms } from '../lib/api';
import type { ConnectedRealm } from '../lib/types';

interface AuctionItem {
  itemKey: string;
  price: number;
  qty: number;
}

interface AuctionsSnapshot {
  snapshot: number;
  items: AuctionItem[];
}

interface ItemMeta {
  id: number;
  name: string;
  icon: string;
  quality: number;
  class: number;
  subclass: number;
}

const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d', // Poor
  1: '#ffffff', // Common
  2: '#1eff00', // Uncommon
  3: '#0070dd', // Rare
  4: '#a335ee', // Epic
  5: '#ff8000', // Legendary
};

export default function RealmAuctionsPage() {
  const [realmId, setRealmId] = useState<number>(60); // Default to Stormrage
  const [realmsList, setRealmsList] = useState<ConnectedRealm[]>([]);
  const [auctions, setAuctions] = useState<AuctionsSnapshot | null>(null);
  const [itemMetas, setItemMetas] = useState<Record<number, ItemMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price'>('name');

  // Load realm from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('selectedRealmId');
    if (saved) setRealmId(parseInt(saved));
  }, []);

  // Fetch realms list
  useEffect(() => {
    realms.list()
      .then(data => setRealmsList(data))
      .catch(err => console.error('Failed to load realms:', err));
  }, []);

  // Fetch auction data
  useEffect(() => {
    if (!realmId) return;
    
    setLoading(true);
    setError(null);
    
    const API_BASE = 'https://wow-market-api.benjamin-f-mcdaniel.workers.dev/api';
    fetch(`${API_BASE}/realm/${realmId}/auctions`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch auctions: ${res.status}`);
        return res.json();
      })
      .then((data: AuctionsSnapshot) => {
        setAuctions(data);
        
        // Extract unique item IDs from item keys
        const itemIds = [...new Set(
          data.items.map(item => parseInt(item.itemKey.split(':')[0]))
        )].filter(Boolean);
        
        // Fetch item metadata
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
  }, [realmId]);

  // Handle realm change
  const handleRealmChange = (newRealmId: number) => {
    setRealmId(newRealmId);
    localStorage.setItem('selectedRealmId', String(newRealmId));
  };

  // Filter and sort auctions
  const filteredItems = auctions?.items.filter(item => {
    if (!searchQuery) return true;
    const itemId = parseInt(item.itemKey.split(':')[0]);
    const meta = itemMetas[itemId];
    if (!meta) return false;
    return meta.name.toLowerCase().includes(searchQuery.toLowerCase());
  }) || [];

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortBy === 'price') {
      return a.price - b.price;
    }
    const itemIdA = parseInt(a.itemKey.split(':')[0]);
    const itemIdB = parseInt(b.itemKey.split(':')[0]);
    const metaA = itemMetas[itemIdA];
    const metaB = itemMetas[itemIdB];
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

  const selectedRealm = realmsList.find(r => r.id === realmId);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gold mb-2">Realm Auctions</h1>
        <p className="text-text2">Server-specific prices for unique items, gear, and weapons</p>
      </div>

      {/* Realm Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text2 mb-2">
          Select Realm
        </label>
        <select
          value={realmId}
          onChange={e => handleRealmChange(parseInt(e.target.value))}
          className="w-full max-w-md px-4 py-2 bg-bg3 border border-border rounded text-text focus:outline-none focus:border-blue"
        >
          {realmsList.length === 0 ? (
            <option>Loading realms...</option>
          ) : (
            realmsList.map(realm => (
              <option key={realm.id} value={realm.id}>
                {realm.canonical?.name || `Realm ${realm.id}`} ({realm.region.toUpperCase()})
              </option>
            ))
          )}
        </select>
        {selectedRealm && selectedRealm.canonical && (
          <p className="mt-2 text-sm text-text2">
            Viewing auctions for <span className="text-blue">{selectedRealm.canonical.name}</span>
          </p>
        )}
      </div>

      {/* Search and Sort */}
      <div className="mb-6 flex gap-4">
        <input
          type="text"
          placeholder="Search items..."
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
          Loading auctions...
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red/10 border border-red rounded p-4 text-red">
          {error}
        </div>
      )}

      {/* Auctions List */}
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
              {searchQuery ? 'No items match your search' : 'No auctions available'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedItems.map(item => {
                const itemId = parseInt(item.itemKey.split(':')[0]);
                const meta = itemMetas[itemId];

                return (
                  <a
                    key={item.itemKey}
                    href={`/item/${encodeURIComponent(item.itemKey)}?realm=${realmId}`}
                    className="grid grid-cols-[auto_1fr_auto_auto] gap-4 p-4 hover:bg-bg3 transition-colors items-center"
                  >
                    {meta ? (
                      <img
                        src={`https://render.worldofwarcraft.com/us/icons/56/${meta.icon}.jpg`}
                        alt=""
                        className="w-12 h-12 rounded border-2"
                        style={{ borderColor: QUALITY_COLORS[meta.quality] || '#9d9d9d' }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded border-2 border-border bg-bg3 animate-pulse" />
                    )}
                    <div>
                      <a
                        href={`https://www.wowhead.com/item=${itemId}`}
                        data-wowhead={`item=${itemId}`}
                        className="font-semibold"
                        style={{ color: meta ? QUALITY_COLORS[meta.quality] || '#ffffff' : '#ffffff' }}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        [Item {itemId}]
                      </a>
                      <div className="text-sm text-text2">{item.itemKey}</div>
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
      {auctions && !loading && (
        <div className="mt-6 text-center text-text2 text-sm">
          Showing {sortedItems.length} of {auctions.items.length} items
          {auctions.snapshot && (
            <> · Last updated: {new Date(auctions.snapshot).toLocaleString()}</>
          )}
        </div>
      )}
    </div>
  );
}
