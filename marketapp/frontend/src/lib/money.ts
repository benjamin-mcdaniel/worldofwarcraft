import type { Money } from './types';

const COPPER_SILVER = 100;
const COPPER_GOLD = 10000;

export function formatGold(copper: Money | null | undefined): string {
  if (!copper || copper <= 0) return '—';
  const gold = Math.floor(copper / COPPER_GOLD);
  const silver = Math.floor((copper % COPPER_GOLD) / COPPER_SILVER);
  const cop = copper % COPPER_SILVER;

  if (gold >= 1000) {
    return `${(gold / 1000).toFixed(1)}k g`;
  }
  if (gold > 0) {
    if (silver === 0 && cop === 0) return `${gold.toLocaleString()}g`;
    return `${gold.toLocaleString()}g ${silver}s`;
  }
  if (silver > 0) return `${silver}s ${cop}c`;
  return `${cop}c`;
}

export function formatGoldShort(copper: Money): string {
  const gold = copper / COPPER_GOLD;
  if (gold >= 1_000_000) return `${(gold / 1_000_000).toFixed(1)}M g`;
  if (gold >= 1_000) return `${(gold / 1_000).toFixed(1)}k g`;
  if (gold >= 1) return `${gold.toFixed(gold >= 100 ? 0 : 1)}g`;
  const silver = copper / COPPER_SILVER;
  if (silver >= 1) return `${silver.toFixed(0)}s`;
  return `${copper}c`;
}

export function pctDiff(current: Money | null | undefined, reference: Money | null | undefined): number | null {
  if (!current || !reference || reference === 0) return null;
  return ((current - reference) / reference) * 100;
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}
