import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dir, '..', '..', 'sources', 'oldmarketdata', 'Auctionator.lua'), 'utf8');

// ── Posting History ───────────────────────────────────────────────────────────
const histStart = raw.indexOf('AUCTIONATOR_POSTING_HISTORY');
const histEnd   = raw.indexOf('\nAUCTIONATOR_VENDOR', histStart);
const hist      = raw.slice(histStart, histEnd);

const itemIds   = [...hist.matchAll(/\["(\d+)"\]/g)].map(m => m[1]);
const uniqueIds = new Set(itemIds);
const prices    = [...hist.matchAll(/\["price"\] = (\d+)/g)];
const times     = [...hist.matchAll(/\["time"\] = (\d+)/g)].map(m => parseInt(m[1]));
times.sort((a, b) => a - b);

console.log('=== POSTING HISTORY ===');
console.log('Unique item IDs:', uniqueIds.size);
console.log('Total price entries:', prices.length);
if (times.length) {
  console.log('Date range:', new Date(times[0]*1000).toISOString().slice(0,10), '→', new Date(times[times.length-1]*1000).toISOString().slice(0,10));
}

// ── Vendor Price Cache ────────────────────────────────────────────────────────
const vStart = raw.indexOf('AUCTIONATOR_VENDOR_PRICE_CACHE');
const vEnd   = raw.indexOf('\nAUCTIONATOR_RECENT', vStart);
const vendor = raw.slice(vStart, vEnd);
const vendorItems = [...vendor.matchAll(/\["(\d+)"\] = (\d+)/g)];
console.log('\n=== VENDOR PRICE CACHE ===');
console.log('Vendor item entries:', vendorItems.length);

// ── Price Database structure ──────────────────────────────────────────────────
const dbStart = raw.indexOf('AUCTIONATOR_PRICE_DATABASE');
const dbEnd   = raw.indexOf('\nAUCTIONATOR_POSTING', dbStart);
const db      = raw.slice(dbStart, dbEnd);
// Extract realm names
const realms = [...db.matchAll(/\["([^"]+)"\] = "/g)].map(m => m[1]);
console.log('\n=== PRICE DATABASE ===');
console.log('Realms in database:', realms);
console.log('Price DB size:', (db.length / 1024 / 1024).toFixed(2), 'MB');
