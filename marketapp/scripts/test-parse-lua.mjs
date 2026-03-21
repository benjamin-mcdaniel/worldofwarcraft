/**
 * Quick parser test — no R2, no wrangler. Runs in <5s.
 * Tests: correct item count, known item IDs, price values, timestamps.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const raw   = readFileSync(join(__dir, '..', '..', 'sources', 'oldmarketdata', 'Auctionator.lua'), 'utf8');

function parsePostingHistory(raw) {
  const varStart = raw.indexOf('AUCTIONATOR_POSTING_HISTORY');
  if (varStart < 0) return {};
  let depth = 0, blockStart = -1, blockEnd = -1;
  for (let i = varStart; i < raw.length; i++) {
    if (raw[i] === '{') { if (depth === 0) blockStart = i; depth++; }
    else if (raw[i] === '}') { depth--; if (depth === 0) { blockEnd = i; break; } }
  }
  if (blockStart < 0) return {};
  const block = raw.slice(blockStart, blockEnd + 1);

  const result = {};
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
    const prices = [...sub.matchAll(/\["price"\]\s*=\s*(\d+)/g)].map(m => parseInt(m[1]));
    const qtys   = [...sub.matchAll(/\["quantity"\]\s*=\s*(\d+)/g)].map(m => parseInt(m[1]));
    const times  = [...sub.matchAll(/\["time"\]\s*=\s*(\d+)/g)].map(m => parseInt(m[1]));
    const entries = prices.map((p, i) => ({ price: p, qty: qtys[i] ?? 1, time: times[i] }));
    if (entries.length) result[id] = entries;
  }
  return result;
}

const t0 = Date.now();
const history = parsePostingHistory(raw);
const elapsed = Date.now() - t0;

const ids    = Object.keys(history);
const total  = Object.values(history).reduce((s, e) => s + e.length, 0);

// ── Tests ─────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function test(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

console.log(`\nParse time: ${elapsed}ms\n`);

test('item count = 464',      ids.length,  464);
test('total entries = 1068',  total,       1068); // 1089 raw includes gear keys (g:ID:bonus) intentionally skipped

// Item 210805: price 22200 qty 3, price 8900 qty 6
test('210805 has 2 entries',  history['210805']?.length, 2);
test('210805 first price',    history['210805']?.[0]?.price, 22200);
test('210805 first qty',      history['210805']?.[0]?.qty,   3);
test('210805 first time',     history['210805']?.[0]?.time,  1771535900);
test('210805 second price',   history['210805']?.[1]?.price, 8900);

// Item 217145: 3 entries
test('217145 has 3 entries',  history['217145']?.length, 3);
test('217145 first price',    history['217145']?.[0]?.price, 29989100);

// Item 123918: 4 entries
test('123918 has 4 entries',  history['123918']?.length, 4);
test('123918 last price',     history['123918']?.[3]?.price, 64400);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
