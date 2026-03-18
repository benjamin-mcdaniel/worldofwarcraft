import { iconUrl } from '../../lib/itemKey';
import { QUALITY_COLORS } from '../../lib/types';
import type { Quality } from '../../lib/types';

interface Props {
  icon?: string;
  quality?: Quality;
  size?: number;
  alt?: string;
}

export function ItemIcon({ icon, quality = 1, size = 32, alt = '' }: Props) {
  const borderColor = QUALITY_COLORS[quality];
  if (!icon) {
    return (
      <div
        style={{ width: size, height: size, borderColor, borderWidth: 1 }}
        className="rounded border bg-bg3 flex-shrink-0"
      />
    );
  }
  return (
    <img
      src={iconUrl(icon, size >= 40 ? 'large' : 'medium')}
      alt={alt}
      width={size}
      height={size}
      style={{ borderColor, borderWidth: 1 }}
      className="rounded border flex-shrink-0 object-cover"
      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
    />
  );
}
