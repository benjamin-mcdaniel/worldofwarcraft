import { useState, useEffect } from 'react';
import type { DealItem, PricedItem, Profile, RealmSnapshot, Region } from '../lib/types';
import { deals, items, profiles, realms } from '../lib/api';
import { MoneyDisplay, MedianDelta } from './shared/MoneyDisplay';
import { ItemIcon } from './shared/ItemIcon';
import { formatGold } from '../lib/money';

const REGIONS: Region[] = ['us', 'eu', 'tw', 'kr'];

export default function Dashboard() {
  const [region, setRegion] = useState<Region>('us');
  const [topDeals, setTopDeals] = useState<DealItem[]>([]);
  const [trending, setTrending] = useState<PricedItem[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<Profile[]>([]);
  const [snapshots, setSnapshots] = useState<RealmSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [region]);

  async function loadData() {
    setLoading(true);
    try {
      const [dealsData, profilesData, snapshotsData] = await Promise.all([
        deals.list(region),
        profiles.list(),
        realms.snapshots(),
      ]);
      setTopDeals(dealsData.slice(0, 8));
      setSavedProfiles(profilesData);
      setSnapshots(snapshotsData);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const statCards = [
    { label: 'Active Deals', value: topDeals.length, color: 'text-wow-green', sub: '≥30% below region median' },
    { label: 'Profiles Saved', value: savedProfiles.length, color: 'text-wow-blue', sub: 'custom market searches' },
    { label: 'Realms Tracked', value: snapshots.length, color: 'text-wow-gold', sub: `${region.toUpperCase()} region` },
  ];

  const now = Date.now();
  function snapshotAge(ts: number): { label: string; color: string } {
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 30) return { label: `${mins}m ago`, color: 'text-wow-green' };
    if (mins < 90) return { label: `${mins}m ago`, color: 'text-wow-gold' };
    return { label: `${Math.floor(mins / 60)}h ${mins % 60}m ago`, color: 'text-wow-red' };
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-wow-gold">Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">Market overview and quick actions</p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={region}
            onChange={e => setRegion(e.target.value as Region)}
            className="bg-bg3 border border-border text-sm text-gray-300 px-3 py-1.5 rounded"
          >
            {REGIONS.map(r => <option key={r} value={r}>Region: {r.toUpperCase()}</option>)}
          </select>
          <button
            onClick={loadData}
            className="bg-bg3 border border-border text-sm text-gray-300 px-3 py-1.5 rounded hover:border-wow-blue"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {statCards.map(c => (
          <div key={c.label} className="bg-bg2 border border-border rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{c.label}</div>
            <div className={`text-3xl font-bold ${c.color}`}>{loading ? '…' : c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-[1fr_360px] gap-5 mb-5">
        {/* Top Deals Table */}
        <div className="bg-bg2 border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Top Deals — {region.toUpperCase()}
            </span>
            <a href="/search?deals=true" className="text-xs text-wow-blue hover:underline">View all →</a>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">Loading deals…</div>
          ) : topDeals.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No deals found. Data may still be loading.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-border">
                  <th className="text-left px-4 py-2.5 font-medium">Item</th>
                  <th className="text-right px-3 py-2.5 font-medium">Price</th>
                  <th className="text-right px-3 py-2.5 font-medium">Median</th>
                  <th className="text-right px-3 py-2.5 font-medium">Discount</th>
                  <th className="text-right px-3 py-2.5 font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {topDeals.map(deal => (
                  <tr
                    key={deal.itemKey}
                    className="border-b border-bg hover:bg-bg3 cursor-pointer"
                    onClick={() => window.location.href = `/item/${encodeURIComponent(deal.itemKey)}`}
                  >
                    <td className="px-4 py-2.5 flex items-center gap-2">
                      <ItemIcon icon={deal.item?.icon} quality={deal.item?.quality} size={24} />
                      <span style={{ color: deal.item ? undefined : '#8a8fa8' }}>
                        {deal.item?.name ?? deal.itemKey}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-wow-gold">{formatGold(deal.price)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-500">{formatGold(deal.regionMedian)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <MedianDelta current={deal.price} reference={deal.regionMedian} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{deal.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* Realm Status */}
          <div className="bg-bg2 border border-border rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Realm Data Status</div>
            <div className="flex flex-col gap-2 text-xs">
              {loading ? (
                <div className="text-gray-500">Loading…</div>
              ) : snapshots.slice(0, 6).map(s => {
                const age = snapshotAge(s.lastSnapshot);
                return (
                  <div key={s.connectedRealmId} className="flex justify-between">
                    <span className="text-gray-400">Realm {s.connectedRealmId}</span>
                    <span className={age.color}>{age.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-bg2 border border-border rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Quick Actions</div>
            <div className="flex flex-col gap-2">
              {[
                { label: '🔍 New Search', href: '/search' },
                { label: '📋 Market Profiles', href: '/profiles' },
                { label: '📊 Generate Report', href: '/reports' },
              ].map(a => (
                <a
                  key={a.href}
                  href={a.href}
                  className="block text-center text-xs text-gray-400 border border-border rounded py-2 hover:border-wow-blue hover:text-wow-blue transition-colors"
                >
                  {a.label}
                </a>
              ))}
            </div>
          </div>

          {/* My Profiles */}
          {savedProfiles.length > 0 && (
            <div className="bg-bg2 border border-border rounded-lg p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">My Profiles</div>
              <div className="flex flex-col gap-2">
                {savedProfiles.slice(0, 3).map(p => (
                  <div key={p.id} className="bg-bg3 border border-border rounded px-3 py-2 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-gray-200">{p.name}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{p.filters.analyticsType}</div>
                    </div>
                    <a
                      href={`/profiles?run=${p.id}`}
                      className="text-xs bg-wow-blue text-white px-2.5 py-1 rounded hover:opacity-90"
                    >
                      ▶ Run
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
