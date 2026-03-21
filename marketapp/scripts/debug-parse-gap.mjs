// Finds which items have fewer entries in brace-parser vs simple regex
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const raw   = readFileSync(join(__dir, '..', '..', 'sources', 'oldmarketdata', 'Auctionator.lua'), 'utf8');

const varStart = raw.indexOf('AUCTIONATOR_POSTING_HISTORY');
let depth = 0, blockStart = -1, blockEnd = -1;
for (let i = varStart; i < raw.length; i++) {
  if (raw[i] === '{') { if (depth === 0) blockStart = i; depth++; }
  else if (raw[i] === '}') { depth--; if (depth === 0) { blockEnd = i; break; } }
}
const block = raw.slice(blockStart, blockEnd + 1);

// Simple regex count per item
const simpleByItem = {};
for (const m of block.matchAll(/\["(\d+)"\]\s*=\s*\{/g)) {
  const id = m[1];
  // count ["price"] after this position until the next item key
  const next = block.indexOf(`\n["`, m.index + m[0].length);
  const sub = next > 0 ? block.slice(m.index, next) : block.slice(m.index);
  simpleByItem[id] = (simpleByItem[id] ?? 0) + [...sub.matchAll(/\["price"\]/g)].length;
}

// Brace-counting parser
const braceByItem = {};
const itemKeyRe = /\["(\d+)"\]\s*=\s*\{/g;
for (const m of block.matchAll(itemKeyRe)) {
  const id = m[1];
  const subStart = m.index + m[0].length - 1;
  let d = 0, subEnd = -1;
  for (let i = subStart; i < block.length; i++) {
    if (block[i] === '{') d++;
    else if (block[i] === '}') { d--; if (d === 0) { subEnd = i; break; } }
  }
  if (subEnd < 0) continue;
  const sub = block.slice(subStart, subEnd + 1);
  braceByItem[id] = (braceByItem[id] ?? 0) + [...sub.matchAll(/\["price"\]/g)].length;
}

// Find differences
const gaps = Object.entries(simpleByItem)
  .filter(([id, count]) => count !== (braceByItem[id] ?? 0))
  .map(([id, simple]) => ({ id, simple, brace: braceByItem[id] ?? 0, gap: simple - (braceByItem[id] ?? 0) }));

console.log('Items with count discrepancy:', gaps.length);
for (const g of gaps) {
  console.log(`  item ${g.id}: simple=${g.simple} brace=${g.brace} gap=${g.gap}`);
  // Show the raw block for this item
  const m = block.match(new RegExp(`\\["${g.id}"\\]\\s*=\\s*\\{`));
  if (m) {
    const idx = block.indexOf(m[0]);
    console.log('  block snippet:', JSON.stringify(block.slice(idx, idx + 200)));
  }
}
