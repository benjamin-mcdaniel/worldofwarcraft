import { useState, useEffect } from 'react';
import type { Profile, ProfileFilters, PricedItem, ConnectedRealm, AnalyticsType } from '../lib/types';
import { profiles, realms } from '../lib/api';
import { ItemIcon } from './shared/ItemIcon';
import { formatGold } from '../lib/money';
import { MedianDelta } from './shared/MoneyDisplay';

const ANALYTICS_TYPES: { id: AnalyticsType; label: string; desc: string }[] = [
  { id: 'deals', label: '🔥 Deals', desc: 'Items significantly below region median' },
  { id: 'undervalued', label: '📉 Undervalued', desc: 'Below 14-day average price' },
  { id: 'weekly-cycle', label: '📅 Weekly Cycle', desc: 'Buy low on reset, sell high mid-week' },
  { id: 'vendor-flip', label: '🏪 Vendor Flip', desc: 'Items worth less than vendor price' },
  { id: 'volume', label: '📊 High Volume', desc: 'High turnover tradeable items' },
];

type ViewMode = 'list' | 'create' | 'results';

export default function ProfilesPage() {
  const [allRealms, setAllRealms] = useState<ConnectedRealm[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<Profile[]>([]);
  const [view, setView] = useState<ViewMode>('list');
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [runResults, setRunResults] = useState<PricedItem[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    name: string;
    description: string;
    filters: Partial<ProfileFilters>;
  }>({
    name: '',
    description: '',
    filters: { analyticsType: 'deals', thresholdPct: 70 },
  });

  useEffect(() => {
    realms.list().then(setAllRealms).catch(console.error);
    loadProfiles();

    const params = new URLSearchParams(window.location.search);
    const runId = params.get('run');
    if (runId) {
      profiles.get(Number(runId)).then(p => {
        setActiveProfile(p);
        runProfile(p);
      }).catch(console.error);
    }
  }, []);

  async function loadProfiles() {
    try {
      const data = await profiles.list();
      setSavedProfiles(data);
    } catch (err) {
      console.error('Load profiles error:', err);
    }
  }

  async function runProfile(profile: Profile) {
    setRunning(true);
    setActiveProfile(profile);
    setView('results');
    try {
      const data = await profiles.run(profile.id);
      setRunResults(data);
    } catch (err) {
      console.error('Run profile error:', err);
      setRunResults([]);
    } finally {
      setRunning(false);
    }
  }

  async function saveProfile() {
    if (!form.name || !form.filters.analyticsType) return;
    setSaving(true);
    try {
      await profiles.create({
        name: form.name,
        description: form.description || undefined,
        filters: form.filters as ProfileFilters,
      });
      await loadProfiles();
      setView('list');
      setForm({ name: '', description: '', filters: { analyticsType: 'deals', thresholdPct: 70 } });
    } catch (err) {
      console.error('Save profile error:', err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProfile(id: number) {
    if (!confirm('Delete this profile?')) return;
    try {
      await profiles.delete(id);
      setSavedProfiles(p => p.filter(x => x.id !== id));
    } catch (err) {
      console.error('Delete profile error:', err);
    }
  }

  function updateFilter<K extends keyof ProfileFilters>(k: K, v: ProfileFilters[K]) {
    setForm(f => ({ ...f, filters: { ...f.filters, [k]: v } }));
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-wow-gold">Market Profiles</h1>
          <p className="text-xs text-gray-500 mt-0.5">Saved search configurations for repeatable market analysis</p>
        </div>
        <div className="flex gap-2">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="text-sm border border-border text-gray-400 px-3 py-1.5 rounded hover:border-gray-300">
              ← Back
            </button>
          )}
          {view === 'list' && (
            <button onClick={() => setView('create')} className="text-sm bg-wow-blue text-white px-4 py-1.5 rounded hover:opacity-90">
              + New Profile
            </button>
          )}
        </div>
      </div>

      {/* Profile List */}
      {view === 'list' && (
        <div>
          {savedProfiles.length === 0 ? (
            <div className="bg-bg2 border border-border rounded-lg p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-gray-400 mb-2">No profiles saved yet</div>
              <div className="text-xs text-gray-600 mb-4">Create a profile to save your market search configuration</div>
              <button onClick={() => setView('create')} className="text-sm bg-wow-blue text-white px-4 py-2 rounded hover:opacity-90">
                Create First Profile
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {savedProfiles.map(p => {
                const typeInfo = ANALYTICS_TYPES.find(t => t.id === p.filters.analyticsType);
                return (
                  <div key={p.id} className="bg-bg2 border border-border rounded-lg p-4 hover:border-wow-blue transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-semibold text-gray-200">{p.name}</div>
                        {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => runProfile(p)}
                          className="text-xs bg-wow-blue text-white px-2.5 py-1 rounded hover:opacity-90"
                        >
                          ▶ Run
                        </button>
                        <button
                          onClick={() => deleteProfile(p.id)}
                          className="text-xs border border-border text-gray-500 px-2 py-1 rounded hover:border-wow-red hover:text-wow-red"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-[10px] bg-bg3 border border-border px-2 py-0.5 rounded text-gray-400">
                        {typeInfo?.label ?? p.filters.analyticsType}
                      </span>
                      {p.filters.realm && (
                        <span className="text-[10px] bg-bg3 border border-border px-2 py-0.5 rounded text-gray-400">
                          Realm {p.filters.realm}
                        </span>
                      )}
                      {p.filters.region && (
                        <span className="text-[10px] bg-bg3 border border-border px-2 py-0.5 rounded text-gray-400">
                          {p.filters.region.toUpperCase()}
                        </span>
                      )}
                      {p.filters.thresholdPct && (
                        <span className="text-[10px] bg-bg3 border border-border px-2 py-0.5 rounded text-gray-400">
                          ≤{p.filters.thresholdPct}% median
                        </span>
                      )}
                    </div>
                    {p.lastRunAt && (
                      <div className="text-[10px] text-gray-600 mt-2">
                        Last run: {new Date(p.lastRunAt).toLocaleString()} · {p.lastRunCount ?? 0} results
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Profile Form */}
      {view === 'create' && (
        <div className="max-w-2xl">
          <div className="bg-bg2 border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Create New Profile</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Profile Name *</label>
                <input
                  type="text"
                  placeholder="e.g. 'Weekly Consumable Deals'"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded focus:border-wow-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Description (optional)</label>
                <input
                  type="text"
                  placeholder="What does this profile look for?"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded focus:border-wow-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-2">Analytics Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  {ANALYTICS_TYPES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => updateFilter('analyticsType', t.id)}
                      className={`text-left p-3 rounded border text-xs transition-colors ${
                        form.filters.analyticsType === t.id
                          ? 'border-wow-blue bg-blue-950 text-wow-blue'
                          : 'border-border text-gray-400 hover:border-gray-400'
                      }`}
                    >
                      <div className="font-semibold">{t.label}</div>
                      <div className="text-[10px] mt-0.5 opacity-70">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Realm</label>
                  <select
                    value={form.filters.realm ?? ''}
                    onChange={e => updateFilter('realm', e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded focus:border-wow-blue outline-none"
                  >
                    <option value="">Any Realm</option>
                    {allRealms.map(r => (
                      <option key={r.id} value={r.id}>{r.canonical.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Threshold %</label>
                  <input
                    type="number"
                    placeholder="70"
                    min={1} max={100}
                    value={form.filters.thresholdPct ?? ''}
                    onChange={e => updateFilter('thresholdPct', e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded focus:border-wow-blue outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={saveProfile}
                  disabled={saving || !form.name}
                  className="bg-wow-gold text-bg font-semibold text-sm px-5 py-2 rounded hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save Profile'}
                </button>
                <button onClick={() => setView('list')} className="text-sm border border-border text-gray-400 px-4 py-2 rounded hover:border-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results View */}
      {view === 'results' && activeProfile && (
        <div>
          <div className="bg-bg2 border border-border rounded-lg p-4 mb-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-200">{activeProfile.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {ANALYTICS_TYPES.find(t => t.id === activeProfile.filters.analyticsType)?.label} · {running ? 'Running…' : `${runResults.length} results`}
              </div>
            </div>
            <button
              onClick={() => runProfile(activeProfile)}
              disabled={running}
              className="text-sm bg-wow-blue text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
            >
              ↻ Re-run
            </button>
          </div>

          {running ? (
            <div className="p-12 text-center text-gray-500">Running profile…</div>
          ) : runResults.length === 0 ? (
            <div className="p-12 text-center text-gray-500">No results found for this profile.</div>
          ) : (
            <table className="w-full text-xs bg-bg2 border border-border rounded-lg overflow-hidden">
              <thead className="border-b border-border">
                <tr className="text-gray-500 font-medium">
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-right px-3 py-3">Price</th>
                  <th className="text-right px-3 py-3">Qty</th>
                  <th className="text-right px-3 py-3">Region Median</th>
                  <th className="text-right px-3 py-3">vs Median</th>
                </tr>
              </thead>
              <tbody>
                {runResults.map(item => (
                  <tr
                    key={item.itemKey}
                    className="border-b border-bg hover:bg-bg3 cursor-pointer"
                    onClick={() => window.location.href = `/item/${encodeURIComponent(item.itemKey)}`}
                  >
                    <td className="px-4 py-3 flex items-center gap-2">
                      <ItemIcon icon={item.item?.icon} quality={item.item?.quality} size={24} />
                      <span>{item.item?.name ?? item.itemKey}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-wow-gold">{formatGold(item.price)}</td>
                    <td className="px-3 py-3 text-right text-gray-400">{item.qty}</td>
                    <td className="px-3 py-3 text-right text-gray-500">{item.regionMedian ? formatGold(item.regionMedian) : '—'}</td>
                    <td className="px-3 py-3 text-right">
                      {item.regionMedian && item.price
                        ? <MedianDelta current={item.price} reference={item.regionMedian} />
                        : <span className="text-gray-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
