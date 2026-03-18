import { useState, useEffect } from 'react';
import type { TradeReport, Profile, ConnectedRealm } from '../lib/types';
import { reports, profiles, realms } from '../lib/api';
import { ItemIcon } from './shared/ItemIcon';
import { formatGold } from '../lib/money';

const ACTION_COLORS = {
  buy: 'text-wow-green border-green-900 bg-green-950',
  sell: 'text-wow-red border-red-900 bg-red-950',
  watch: 'text-wow-gold border-yellow-900 bg-yellow-950',
};

type ViewMode = 'list' | 'generate' | 'detail';

export default function ReportsPage() {
  const [allReports, setAllReports] = useState<TradeReport[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<Profile[]>([]);
  const [allRealms, setAllRealms] = useState<ConnectedRealm[]>([]);
  const [view, setView] = useState<ViewMode>('list');
  const [activeReport, setActiveReport] = useState<TradeReport | null>(null);
  const [generating, setGenerating] = useState(false);

  const [genForm, setGenForm] = useState({
    name: '',
    realmId: 0,
    profileIds: [] as number[],
  });

  useEffect(() => {
    Promise.all([
      reports.list().then(setAllReports),
      profiles.list().then(setSavedProfiles),
      realms.list().then(data => {
        setAllRealms(data);
        if (data.length > 0) setGenForm(f => ({ ...f, realmId: data[0].id }));
      }),
    ]).catch(console.error);
  }, []);

  async function generateReport() {
    if (!genForm.name || !genForm.realmId) return;
    setGenerating(true);
    try {
      const report = await reports.generate(genForm);
      setAllReports(r => [report, ...r]);
      setActiveReport(report);
      setView('detail');
    } catch (err) {
      console.error('Generate report error:', err);
    } finally {
      setGenerating(false);
    }
  }

  async function openReport(id: number) {
    try {
      const data = await reports.get(id);
      setActiveReport(data);
      setView('detail');
    } catch (err) {
      console.error('Open report error:', err);
    }
  }

  function toggleProfile(id: number) {
    setGenForm(f => ({
      ...f,
      profileIds: f.profileIds.includes(id)
        ? f.profileIds.filter(x => x !== id)
        : [...f.profileIds, id],
    }));
  }

  const buyCount = activeReport?.summary.buyCount ?? 0;
  const sellCount = activeReport?.summary.sellCount ?? 0;
  const watchCount = activeReport?.summary.watchCount ?? 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-wow-gold">Trade Reports</h1>
          <p className="text-xs text-gray-500 mt-0.5">Generated market analysis and trading recommendations</p>
        </div>
        <div className="flex gap-2">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="text-sm border border-border text-gray-400 px-3 py-1.5 rounded hover:border-gray-300">
              ← Back
            </button>
          )}
          {view === 'list' && (
            <button onClick={() => setView('generate')} className="text-sm bg-wow-blue text-white px-4 py-1.5 rounded hover:opacity-90">
              + Generate Report
            </button>
          )}
        </div>
      </div>

      {/* Report List */}
      {view === 'list' && (
        <div>
          {allReports.length === 0 ? (
            <div className="bg-bg2 border border-border rounded-lg p-12 text-center">
              <div className="text-4xl mb-3">📊</div>
              <div className="text-gray-400 mb-2">No reports generated yet</div>
              <div className="text-xs text-gray-600 mb-4">Generate a report to get buy/sell/watch recommendations</div>
              <button onClick={() => setView('generate')} className="text-sm bg-wow-blue text-white px-4 py-2 rounded hover:opacity-90">
                Generate First Report
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {allReports.map(r => (
                <div
                  key={r.id}
                  onClick={() => openReport(r.id)}
                  className="bg-bg2 border border-border rounded-lg p-4 hover:border-wow-blue cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-200">{r.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {new Date(r.generatedAt).toLocaleString()} · Realm {r.realmId}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-wow-green">↑ {r.summary.buyCount} buy</span>
                      <span className="text-wow-red">↓ {r.summary.sellCount} sell</span>
                      <span className="text-wow-gold">◉ {r.summary.watchCount} watch</span>
                      {r.summary.estimatedProfit > 0 && (
                        <span className="text-gray-400">~{formatGold(r.summary.estimatedProfit)} profit</span>
                      )}
                      <span className="text-wow-blue hover:underline">View →</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate Form */}
      {view === 'generate' && (
        <div className="max-w-xl">
          <div className="bg-bg2 border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Generate New Report</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Report Name *</label>
                <input
                  type="text"
                  placeholder="e.g. 'Weekly Reset Buy List'"
                  value={genForm.name}
                  onChange={e => setGenForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded focus:border-wow-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Realm *</label>
                <select
                  value={genForm.realmId}
                  onChange={e => setGenForm(f => ({ ...f, realmId: Number(e.target.value) }))}
                  className="w-full bg-bg3 border border-border text-sm text-gray-200 px-3 py-2 rounded focus:border-wow-blue outline-none"
                >
                  {allRealms.map(r => (
                    <option key={r.id} value={r.id}>{r.canonical.name} ({r.region.toUpperCase()})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-2">Profiles to Include</label>
                {savedProfiles.length === 0 ? (
                  <div className="text-xs text-gray-600 bg-bg3 rounded p-3">
                    No profiles saved. <a href="/profiles" className="text-wow-blue hover:underline">Create a profile</a> to include in reports.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedProfiles.map(p => (
                      <label key={p.id} className="flex items-center gap-2.5 cursor-pointer text-xs text-gray-400 hover:text-gray-200">
                        <input
                          type="checkbox"
                          checked={genForm.profileIds.includes(p.id)}
                          onChange={() => toggleProfile(p.id)}
                          className="accent-wow-blue"
                        />
                        <span>{p.name}</span>
                        <span className="text-gray-600">({p.filters.analyticsType})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={generateReport}
                  disabled={generating || !genForm.name || !genForm.realmId}
                  className="bg-wow-gold text-bg font-semibold text-sm px-5 py-2 rounded hover:opacity-90 disabled:opacity-40"
                >
                  {generating ? 'Generating…' : 'Generate Report'}
                </button>
                <button onClick={() => setView('list')} className="text-sm border border-border text-gray-400 px-4 py-2 rounded hover:border-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Report Detail */}
      {view === 'detail' && activeReport && (
        <div>
          {/* Summary bar */}
          <div className="bg-bg2 border border-border rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-200">{activeReport.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Generated {new Date(activeReport.generatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <div className="text-xl font-bold text-wow-green">{buyCount}</div>
                  <div className="text-[10px] text-gray-500">BUY</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-wow-red">{sellCount}</div>
                  <div className="text-[10px] text-gray-500">SELL</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-wow-gold">{watchCount}</div>
                  <div className="text-[10px] text-gray-500">WATCH</div>
                </div>
                {activeReport.summary.estimatedProfit > 0 && (
                  <div className="text-center">
                    <div className="text-sm font-bold text-wow-green">{formatGold(activeReport.summary.estimatedProfit)}</div>
                    <div className="text-[10px] text-gray-500">EST. PROFIT</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action tabs */}
          {(['buy', 'sell', 'watch'] as const).map(action => {
            const actionItems = activeReport.items.filter(i => i.action === action);
            if (actionItems.length === 0) return null;
            const colors = ACTION_COLORS[action];
            return (
              <div key={action} className="mb-4">
                <div className={`text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-t border ${colors}`}>
                  {action === 'buy' ? '↑ Buy' : action === 'sell' ? '↓ Sell' : '◉ Watch'} ({actionItems.length})
                </div>
                <div className="border border-t-0 border-border rounded-b overflow-hidden">
                  {actionItems.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-bg hover:bg-bg2 cursor-pointer"
                      onClick={() => window.location.href = `/item/${encodeURIComponent(item.itemKey)}`}
                    >
                      <ItemIcon icon={item.item?.icon} quality={item.item?.quality} size={28} />
                      <div className="flex-1">
                        <div className="text-sm text-gray-200">{item.item?.name ?? item.itemKey}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{item.reasoning}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-wow-gold">{formatGold(item.currentPrice)}</div>
                        {item.targetPrice && (
                          <div className="text-[10px] text-gray-500">
                            Target: {formatGold(item.targetPrice)}
                          </div>
                        )}
                      </div>
                      <div className="w-16">
                        <div className="h-1.5 bg-bg3 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${action === 'buy' ? 'bg-wow-green' : action === 'sell' ? 'bg-wow-red' : 'bg-wow-gold'}`}
                            style={{ width: `${Math.round(item.confidence * 100)}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5 text-right">
                          {Math.round(item.confidence * 100)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
