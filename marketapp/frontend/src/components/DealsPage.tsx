import { useState, useEffect } from 'react';
import { deals as dealsApi } from '../lib/api';
import { ItemIcon } from './shared/ItemIcon';
import { MoneyDisplay } from './shared/MoneyDisplay';

export default function DealsPage() {
  const [region, setRegion] = useState<string>(
    () => (typeof window !== 'undefined' ? localStorage.getItem('wow_market_region') : null) ?? 'us'
  );
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<'pct' | 'price' | 'saving'>('pct');

  async function load(r: string) {
    setLoading(true);
    setError('');
    try {
      const data = await dealsApi.list(r as any);
      setDeals(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const newRegion = typeof d === 'object' ? d.region : (localStorage.getItem('wow_market_region') ?? 'us');
      setRegion(newRegion);
    };
    window.addEventListener('realmChanged', handler);
    return () => window.removeEventListener('realmChanged', handler);
  }, []);

  useEffect(() => { load(region); }, [region]);

  const sorted = [...deals].sort((a, b) => {
    if (sortKey === 'pct') {
      const pa = a.regionMedian ? (a.price / a.regionMedian) : 1;
      const pb = b.regionMedian ? (b.price / b.regionMedian) : 1;
      return pa - pb;
    }
    if (sortKey === 'saving') {
      const sa = (a.regionMedian ?? 0) - (a.price ?? 0);
      const sb = (b.regionMedian ?? 0) - (b.price ?? 0);
      return sb - sa;
    }
    return (a.price ?? 0) - (b.price ?? 0);
  });

  return (
    <div style={{ padding: '24px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f0c060', margin: 0 }}>
          ⚡ Deals
        </h1>
        <span style={{ fontSize: 13, color: '#666' }}>Items priced below region median</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Region:</span>
          <span style={{ fontSize: 12, color: '#4a90d9', fontWeight: 600, background: '#1e2028', border: '1px solid #2e3040', padding: '3px 8px', borderRadius: 4 }}>
            {region.toUpperCase()}
          </span>
          <button
            onClick={() => load(region)}
            style={{ background: '#1e2028', border: '1px solid #2e3040', color: '#d4c5a0', padding: '5px 12px', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#2a0d0d', border: '1px solid #5a1a1a', color: '#cf4e4e', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#666', fontSize: 14, padding: 40, textAlign: 'center' }}>Loading deals...</div>
      ) : deals.length === 0 ? (
        <div style={{ color: '#555', fontSize: 14, padding: 40, textAlign: 'center' }}>
          No deals found for {region.toUpperCase()}.<br />
          <span style={{ fontSize: 12, color: '#444', marginTop: 8, display: 'block' }}>
            Deals are populated by the ingestion worker. Trigger it if this is a fresh install.
          </span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
            {deals.length} deals found &nbsp;·&nbsp; Sort by:&nbsp;
            {(['pct', 'saving', 'price'] as const).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  background: sortKey === k ? '#2e3040' : 'none',
                  border: '1px solid ' + (sortKey === k ? '#4a90d9' : '#2e3040'),
                  color: sortKey === k ? '#4a90d9' : '#666',
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', marginLeft: 4,
                }}
              >
                {k === 'pct' ? '% below median' : k === 'saving' ? 'gold saved' : 'price'}
              </button>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2e3040', color: '#555', fontSize: 11, textAlign: 'left' }}>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>Item</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>Deal Price</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>Region Median</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>% Below</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>You Save</th>
                <th style={{ padding: '6px 10px', fontWeight: 500 }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((deal, i) => {
                const pct = deal.regionMedian ? ((deal.regionMedian - deal.price) / deal.regionMedian) * 100 : 0;
                const saving = (deal.regionMedian ?? 0) - (deal.price ?? 0);
                return (
                  <tr
                    key={deal.itemKey ?? i}
                    style={{ borderBottom: '1px solid #1e2028', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#16181c')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                    onClick={() => { if (deal.itemKey) window.location.href = `/item/${encodeURIComponent(deal.itemKey)}`; }}
                  >
                    <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {deal.item?.icon && (
                        <ItemIcon icon={deal.item.icon} quality={deal.item.quality ?? 1} size={28} />
                      )}
                      <div>
                        <div style={{ color: '#d4c5a0' }}>{deal.item?.name ?? deal.itemKey}</div>
                        <div style={{ fontSize: 11, color: '#555' }}>{deal.itemKey}</div>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}><MoneyDisplay value={deal.price} /></td>
                    <td style={{ padding: '8px 10px', color: '#666' }}><MoneyDisplay value={deal.regionMedian ?? 0} /></td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ color: '#4caf50', fontWeight: 600 }}>-{pct.toFixed(1)}%</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#4caf50' }}><MoneyDisplay value={saving} /></td>
                    <td style={{ padding: '8px 10px', color: '#666' }}>{deal.qty ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
