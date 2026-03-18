import type { Money } from '../../lib/types';
import { formatGold, pctDiff, formatPct } from '../../lib/money';

interface Props {
  value: Money;
  className?: string;
}
export function MoneyDisplay({ value, className = '' }: Props) {
  return <span className={`font-semibold text-wow-gold ${className}`}>{formatGold(value)}</span>;
}

interface DeltaProps {
  current: Money;
  reference: Money;
  className?: string;
}
export function MedianDelta({ current, reference, className = '' }: DeltaProps) {
  const pct = pctDiff(current, reference);
  if (pct == null) return <span className={`text-border ${className}`}>—</span>;
  const isGood = pct < 0;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
      isGood ? 'bg-green-950 text-wow-green' : 'bg-red-950 text-wow-red'
    } ${className}`}>
      {formatPct(pct)}
    </span>
  );
}
