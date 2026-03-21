/**
 * import-auctionator.mjs
 * Parses an Auctionator.lua SavedVariables file and imports the posting history
 * into R2 as ItemState time-series data.
 *
 * Sources parsed:
 *   AUCTIONATOR_POSTING_HISTORY  — items the player listed on the AH (itemId → [{price,qty,time}])
 *   AUCTIONATOR_VENDOR_PRICE_CACHE — vendor buy prices (itemId → copper)
 *
 * Usage:
 *   node scripts/import-auctionator.mjs [--realm <realmId>] [--dry-run]
 *
 * Defaults to Kel'Thuzad US (realmId=3693). Pass --realm 77 for Azgalor US.
 */

import { spawnSync, spawn }                      from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }                        from 'path';
import { fileURLToPath }                        from 'url';

const __dir     = dirname(fileURLToPath(import.meta.url));
const LUA_PATH  = join(__dir, '..', '..', 'sources', 'oldmarketdata', 'Auctionator.lua');
const TMP_DIR   = join(__dir, 'import-tmp');
const WRANGLER_CWD = join(__dir, '..', 'workers', 'api');
const R2_BUCKET = 'wow-market-data';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const realmArg = args.indexOf('--realm');
const REALM_ID = realmArg >= 0 ? parseInt(args[realmArg + 1]) : 3693;
const REALM_NAMES = { 3693: "Kel'Thuzad US", 77: 'Azgalor US' };

console.log(`Import Auctionator → R2`);
console.log(`  Realm: ${REALM_NAMES[REALM_ID] ?? REALM_ID} (id=${REALM_ID})`);
console.log(`  Dry run: ${DRY_RUN}`);
console.log();

// ── R2 helpers ────────────────────────────────────────────────────────────────
function r2GetSync(key) {
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'get', `${R2_BUCKET}/${key}`, '--pipe'],
    { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout.toString('utf8')); } catch { return null; }
}

function r2PutAsync(key, filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx', ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`,
              '--file', filePath, '--content-type', 'application/json'],
      { shell: true, cwd: WRANGLER_CWD, stdio: 'pipe' }
    );
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`R2 put ${key}: ${stderr.slice(-200)}`)));
  });
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r; }).catch(e => { executing.delete(p); throw e; });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) await Promise.race(executing).catch(() => {});
  }
  return Promise.allSettled(results);
}

// ── Lua block extractor ───────────────────────────────────────────────────────
function extractBlock(raw, varName) {
  const start = raw.indexOf(`${varName} = {`);
  if (start < 0) return null;
  let depth = 0, i = raw.indexOf('{', start);
  const begin = i;
  for (; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') { depth--; if (depth === 0) return raw.slice(begin, i + 1); }
  }
  return null;
}

// ── Parse POSTING_HISTORY ─────────────────────────────────────────────────────
// Multi-line Lua format:
//   AUCTIONATOR_POSTING_HISTORY = {
//   ["210805"] = {
//   {
//   ["price"] = 22200,
//   ["quantity"] = 3,
//   ["time"] = 1771535900,
//   },
//   ...
//   },
function parsePostingHistory(raw) {
  const varStart = raw.indexOf('AUCTIONATOR_POSTING_HISTORY');
  if (varStart < 0) { console.warn('AUCTIONATOR_POSTING_HISTORY not found'); return {}; }

  // Walk brace-by-brace to extract the entire top-level block
  let depth = 0, blockStart = -1, blockEnd = -1;
  for (let i = varStart; i < raw.length; i++) {
    if (raw[i] === '{') {
      if (depth === 0) blockStart = i;
      depth++;
    } else if (raw[i] === '}') {
      depth--;
      if (depth === 0) { blockEnd = i; break; }
    }
  }
  if (blockStart < 0 || blockEnd < 0) return {};
  const block = raw.slice(blockStart, blockEnd + 1);

  const result = {};

  // Find each item: ["12345"] = { ... }
  // We'll find item key positions, then extract their sub-blocks
  const itemKeyRe = /\["(\d+)"\]\s*=\s*\{/g;
  for (const itemMatch of block.matchAll(itemKeyRe)) {
    const itemId = itemMatch[1];
    // Walk from the opening { of this item's array
    const subStart = itemMatch.index + itemMatch[0].length - 1; // position of '{'
    let d = 0, subEnd = -1;
    for (let i = subStart; i < block.length; i++) {
      if (block[i] === '{') d++;
      else if (block[i] === '}') { d--; if (d === 0) { subEnd = i; break; } }
    }
    if (subEnd < 0) continue;
    const itemBlock = block.slice(subStart, subEnd + 1);

    // Extract individual entry objects within the item block
    const entries = [];
    const entryRe = /\{[^{}]*\["price"\]\s*=\s*(\d+)[^{}]*\["quantity"\]\s*=\s*(\d+)[^{}]*\["time"\]\s*=\s*(\d+)[^{}]*\}/gs;
    for (const e of itemBlock.matchAll(entryRe)) {
      entries.push({ price: parseInt(e[1]), qty: parseInt(e[2]), time: parseInt(e[3]) });
    }

    // Also try alternate field order (time before price, etc.)
    if (entries.length === 0) {
      // Extract all three fields independently and zip
      const prices = [...itemBlock.matchAll(/\["price"\]\s*=\s*(\d+)/g)].map(m => parseInt(m[1]));
      const qtys   = [...itemBlock.matchAll(/\["quantity"\]\s*=\s*(\d+)/g)].map(m => parseInt(m[1]));
      const times  = [...itemBlock.matchAll(/\["time"\]\s*=\s*(\d+)/g)].map(m => parseInt(m[1]));
      for (let j = 0; j < prices.length; j++) {
        if (prices[j] && times[j]) entries.push({ price: prices[j], qty: qtys[j] ?? 1, time: times[j] });
      }
    }

    if (entries.length) result[itemId] = entries;
  }
  return result;
}

// ── Parse VENDOR_PRICE_CACHE ──────────────────────────────────────────────────
function parseVendorCache(raw) {
  const block = extractBlock(raw, 'AUCTIONATOR_VENDOR_PRICE_CACHE');
  if (!block) return {};
  const result = {};
  for (const m of block.matchAll(/\["(\d+)"\]\s*=\s*(\d+)/g)) {
    result[m[1]] = parseInt(m[2]);
  }
  return result;
}

// ── Build ItemState from price entries ────────────────────────────────────────
function buildItemState(entries) {
  // Sort chronologically
  entries.sort((a, b) => a.time - b.time);

  // snapshots: [timestamp_ms, price, qty]
  const snapshots = entries.map(e => [e.time * 1000, e.price, e.qty]);

  // daily: aggregate by UTC day (take lowest price of each day)
  const byDay = new Map();
  for (const e of entries) {
    const dayStart = Math.floor(e.time / 86400) * 86400 * 1000;
    const existing = byDay.get(dayStart);
    if (!existing || e.price < existing[1]) {
      byDay.set(dayStart, [dayStart, e.price, e.qty]);
    }
  }
  const daily = [...byDay.values()].sort((a, b) => a[0] - b[0]);

  // Most recent entry = current state
  const latest = entries[entries.length - 1];

  return {
    snapshot:  latest.time * 1000,
    price:     latest.price,
    qty:       latest.qty,
    auctions:  [{ price: latest.price, qty: latest.qty }],
    snapshots,
    daily,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Reading Lua file...');
  const raw = readFileSync(LUA_PATH, 'utf8');
  console.log(`  Size: ${(raw.length / 1024 / 1024).toFixed(2)} MB\n`);

  // Parse data
  console.log('Parsing AUCTIONATOR_POSTING_HISTORY...');
  const postingHistory = parsePostingHistory(raw);
  const itemIds = Object.keys(postingHistory);
  const totalEntries = Object.values(postingHistory).reduce((s, e) => s + e.length, 0);
  console.log(`  ${itemIds.length} unique items, ${totalEntries} total price entries\n`);

  console.log('Parsing AUCTIONATOR_VENDOR_PRICE_CACHE...');
  const vendorCache = parseVendorCache(raw);
  console.log(`  ${Object.keys(vendorCache).length} vendor prices\n`);

  // Download existing realm index to merge into (skip in dry-run)
  let existingIndex = [];
  if (!DRY_RUN) {
    console.log(`Downloading existing realm index for realm ${REALM_ID}...`);
    existingIndex = r2GetSync(`realm/${REALM_ID}/index.json`) ?? [];
    console.log(`  ${existingIndex.length} existing entries\n`);
  }
  const indexMap = new Map(existingIndex.map(e => [e.itemKey, e]));

  // ── Step 1: Write all item state files to disk (fast) ────────────────────────
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR);
  console.log('Building item state files...');
  const uploadTasks = [];

  for (const itemId of itemIds) {
    const entries  = postingHistory[itemId];
    const itemKey  = `${itemId}:0:0`;
    const r2Key    = `realm/${REALM_ID}/items/${encodeURIComponent(itemKey)}.json`;
    const state    = buildItemState(entries);
    const filePath = join(TMP_DIR, `${itemId}.json`);

    writeFileSync(filePath, JSON.stringify(state));
    uploadTasks.push({ itemKey, r2Key, filePath, state });

    indexMap.set(itemKey, {
      itemKey,
      price:    state.price,
      qty:      state.qty,
      snapshot: state.snapshot,
    });
  }
  console.log(`  ${uploadTasks.length} files written to ${TMP_DIR}\n`);

  // ── Step 2: Upload in parallel (concurrency=10) ───────────────────────────────
  let uploaded = 0, skipped = 0;
  const CONCURRENCY = 10;

  if (DRY_RUN) {
    console.log(`[dry-run] Would upload ${uploadTasks.length} item states + 1 realm index`);
  } else {
    console.log(`Uploading ${uploadTasks.length} item states (${CONCURRENCY} parallel)...`);
    const tasks = uploadTasks.map(({ itemKey, r2Key, filePath }) => async () => {
      await r2PutAsync(r2Key, filePath);
      uploaded++;
      if (uploaded % 50 === 0) console.log(`  ${uploaded}/${uploadTasks.length}...`);
    });

    const results = await runWithConcurrency(tasks, CONCURRENCY);
    skipped = results.filter(r => r.status === 'rejected').length;
    if (skipped > 0) {
      results.filter(r => r.status === 'rejected').forEach(r => console.error('  FAILED:', r.reason?.message));
    }
  }

  console.log(`\n  Done: ${uploaded} uploaded, ${skipped} failed`);

  // ── Step 3: Upload realm index ─────────────────────────────────────────────
  const newIndex = [...indexMap.values()];
  if (!DRY_RUN) {
    console.log('\nUploading realm index...');
    const indexPath = join(TMP_DIR, 'index.json');
    writeFileSync(indexPath, JSON.stringify(newIndex));
    await r2PutAsync(`realm/${REALM_ID}/index.json`, indexPath);
    console.log(`  Index now has ${newIndex.length} entries`);

    // ── Step 4: Update realms-with-data registry ────────────────────────────
    console.log('\nUpdating realms-with-data registry...');
    const existingWithData = r2GetSync('static/realms-with-data.json') ?? [];
    const withDataSet = new Set([...existingWithData, REALM_ID]);
    const withDataPath = join(TMP_DIR, 'realms-with-data.json');
    writeFileSync(withDataPath, JSON.stringify([...withDataSet]));
    await r2PutAsync('static/realms-with-data.json', withDataPath);
    console.log(`  Registry: ${[...withDataSet].join(', ')}`);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Realm:         ${REALM_NAMES[REALM_ID] ?? REALM_ID} (${REALM_ID})`);
  console.log(`  Items imported: ${uploaded}`);
  console.log(`  Realm index:    ${newIndex.length} total entries`);
  console.log(`  Vendor prices:  ${Object.keys(vendorCache).length} (not imported — already in R2 catalog)`);
  if (DRY_RUN) console.log('\n  ** DRY RUN — nothing was written to R2 **');
}

main().catch(e => { console.error(e); process.exit(1); });
