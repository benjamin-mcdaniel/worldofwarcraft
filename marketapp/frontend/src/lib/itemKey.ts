import type { ItemKey, ItemKeyString } from './types';

export function parseItemKey(key: ItemKeyString): ItemKey {
  const parts = key.split(':');
  return {
    itemId: parseInt(parts[0] ?? '0', 10),
    itemLevel: parseInt(parts[1] ?? '0', 10),
    itemSuffix: parseInt(parts[2] ?? '0', 10),
  };
}

export function stringifyItemKey(key: ItemKey): ItemKeyString {
  return `${key.itemId}:${key.itemLevel}:${key.itemSuffix}`;
}

export function iconUrl(icon: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon.toLowerCase()}.jpg`;
}
