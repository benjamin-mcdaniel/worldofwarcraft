import { useState, useEffect } from 'react';
import { favorites as favApi } from '../lib/api';
import { ItemIcon } from './shared/ItemIcon';
import { MoneyDisplay } from './shared/MoneyDisplay';
import type { FavoriteItem } from '../lib/types';

export default function FavoritesPage() {
  const [favs, setFavs] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await favApi.list();
      setFavs(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load favorites');
    } finally {
      setLoading(false);
    }
  }

  async function remove(itemKey: string) {
    setRemoving(itemKey);
    try {
      await favApi.remove(itemKey);
      setFavs(f => f.filter(x => x.itemKey !== itemKey));
    } catch (e: any) {
      setError(e.message ?? 'Failed to remove');
    } finally {
      setRemoving(null);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '24px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f0c060', margin: 0 }}>
          &#11088; Favorites
        </h1>
        <span style={{ fontSize: 13, color: '#666' }}>Your starred items</span>
        <button
          onClick={load}
          style={{ marginLeft: 'auto', background: '#1e2028', border: '1px solid #2e3040', color: '#d4c5a0', padding: '5px 12px', borderRadius: 5, fontSize: 13, cursor: 'pointer' }}
        >
          &#8635; Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: '#2a0d0d', border: '1px solid #5a1a1a', color: '#cf4e4e', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#666', fontSize: 14, padding: 40, textAlign: 'center' }}>Loading favorites...</div>
      ) : favs.length === 0 ? (
        <div style={{ color: '#555', fontSize: 14, padding: 40, textAlign: 'center' }}>
          No favorites yet.<br />
          <span style={{ fontSize: 12, color: '#444', marginTop: 8, display: 'block' }}>
            Star items from the Search or Item Detail pages to track them here.
          </span>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2e3040', color: '#555', fontSize: 11, textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', fontWeight: 500 }}>Item</th>
              <th style={{ padding: '6px 10px', fontWeight: 500 }}>Realm</th>
              <th style={{ padding: '6px 10px', fontWeight: 500 }}>Noted Price</th>
              <th style={{ padding: '6px 10px', fontWeight: 500 }}>Added</th>
              <th style={{ padding: '6px 10px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {favs.map(fav => (
              <tr
                key={fav.itemKey}
                style={{ borderBottom: '1px solid #1e2028', transition: 'background 0.1s', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#16181c')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
                onClick={() => window.location.href = `/item/${encodeURIComponent(fav.itemKey)}`}
              >
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 18, color: '#f0c060' }}>&#11088;</div>
                    <div>
                      <div style={{ color: '#d4c5a0' }}>{fav.itemKey}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '8px 10px', color: '#666', fontSize: 12 }}>
                  Realm #{fav.realmId}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {fav.notedPrice ? <MoneyDisplay value={fav.notedPrice} /> : <span style={{ color: '#444' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', color: '#555', fontSize: 12 }}>
                  {fav.createdAt ? new Date(fav.createdAt).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <button
                    onClick={e => { e.stopPropagation(); remove(fav.itemKey); }}
                    disabled={removing === fav.itemKey}
                    style={{
                      background: 'none', border: '1px solid #3a1a1a', color: '#666',
                      padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#cf4e4e'; (e.currentTarget as HTMLButtonElement).style.color = '#cf4e4e'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a1a1a'; (e.currentTarget as HTMLButtonElement).style.color = '#666'; }}
                  >
                    {removing === fav.itemKey ? '...' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
