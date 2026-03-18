/**
 * populate-item-names.mjs
 * Fetches item names from the Battle.net API for all items in static/items.json
 * that currently have name: null, then uploads the patched catalog back to R2.
 *
 * Usage:
 *   node scripts/populate-item-names.mjs
 *
 * Resumable — saves progress to scripts/name-progress.json so you can Ctrl+C
 * and re-run without losing work.
 *
 * Requirements: wrangler must be authenticated (npx wrangler login or CLOUDFLARE_API_TOKEN set)
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WRANGLER_CWD   = join(__dir, '..', 'workers', 'api');
const CATALOG_PATH   = join(__dir, 'items-work.json');
const PROGRESS_PATH  = join(__dir, 'name-progress.json');
const R2_BUCKET      = 'wow-market-data';
const R2_KEY         = 'static/items.json';
const REGION         = 'us';
const LOCALE         = 'en_US';
const CONCURRENCY    = 20;   // parallel BNet requests
const SAVE_EVERY     = 200;  // write progress file every N items

const BNET_CLIENT_ID     = 'a6da171f7ae24102bee61cbef3b16674';
const BNET_CLIENT_SECRET = 'B9x9l8PsTsX86VgGXFDJytIeTkZrMUCt';

// ─── Step 1: download catalog from R2 ────────────────────────────────────────
function downloadCatalog() {
  console.log(`Downloading ${R2_KEY} from R2...`);
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'get', `${R2_BUCKET}/${R2_KEY}`, '--pipe'],
    { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) {
    console.error(result.stderr?.toString());
    throw new Error('Failed to download catalog from R2');
  }
  writeFileSync(CATALOG_PATH, result.stdout);
  console.log(`Downloaded ${(result.stdout.length / 1024).toFixed(0)} KB`);
}

// ─── Step 2: get BNet OAuth token ────────────────────────────────────────────
async function getBNetToken() {
  const res = await fetch(`https://oauth.battle.net/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`BNet token error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// ─── Step 3: fetch one item name ─────────────────────────────────────────────
async function fetchItemName(itemId, token) {
  try {
    const url = `https://${REGION}.api.blizzard.com/data/wow/item/${itemId}?namespace=static-${REGION}&locale=${LOCALE}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return data?.name ?? null;
  } catch {
    return null;
  }
}

// ─── Step 4: process in batches ──────────────────────────────────────────────
async function processBatch(batch, token) {
  return Promise.all(batch.map(async (itemId) => {
    const name = await fetchItemName(itemId, token);
    return { itemId, name };
  }));
}

// ─── Step 5: upload patched catalog ──────────────────────────────────────────
function uploadCatalog(data) {
  const outPath = join(__dir, 'items-patched.json');
  writeFileSync(outPath, JSON.stringify(data));
  console.log(`Uploading patched catalog (${(Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(0)} KB)...`);
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${R2_KEY}`,
            '--file', outPath, '--content-type', 'application/json'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error('Failed to upload catalog to R2');
  }
  console.log('Upload complete.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Download catalog (skip if already cached locally)
  if (!existsSync(CATALOG_PATH)) {
    downloadCatalog();
  } else {
    console.log('Using cached local catalog (delete scripts/items-work.json to re-download)');
  }

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

  // Load previous progress
  const progress = existsSync(PROGRESS_PATH)
    ? JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'))
    : {};

  // Apply previously fetched names
  let alreadyDone = 0;
  for (const [id, name] of Object.entries(progress)) {
    if (catalog[id] !== undefined) {
      catalog[id].name = name;
      alreadyDone++;
    }
  }
  console.log(`Progress restored: ${alreadyDone} names already fetched`);

  // Collect items still needing names
  const needNames = Object.keys(catalog).filter(id => catalog[id].name === null || catalog[id].name === undefined);
  console.log(`Items needing names: ${needNames.length} / ${Object.keys(catalog).length} total`);

  if (needNames.length === 0) {
    console.log('All items already have names — uploading catalog...');
    uploadCatalog(catalog);
    return;
  }

  // Get BNet token
  console.log('Getting Battle.net token...');
  let token = await getBNetToken();
  let tokenFetchedAt = Date.now();

  let done = 0;
  let found = 0;

  for (let i = 0; i < needNames.length; i += CONCURRENCY) {
    // Refresh token every 20 minutes
    if (Date.now() - tokenFetchedAt > 20 * 60 * 1000) {
      token = await getBNetToken();
      tokenFetchedAt = Date.now();
    }

    const batch = needNames.slice(i, i + CONCURRENCY);
    const results = await processBatch(batch, token);

    for (const { itemId, name } of results) {
      if (name) {
        catalog[itemId].name = name;
        progress[itemId] = name;
        found++;
      }
      done++;
    }

    // Save progress checkpoint
    if (done % SAVE_EVERY < CONCURRENCY) {
      writeFileSync(PROGRESS_PATH, JSON.stringify(progress));
      const pct = ((i + CONCURRENCY) / needNames.length * 100).toFixed(1);
      console.log(`  ${pct}% — ${done} processed, ${found} names found`);
    }
  }

  // Final progress save
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress));
  console.log(`\nDone: ${found} / ${needNames.length} names fetched`);

  // Upload
  uploadCatalog(catalog);
  console.log('\nFinished! Delete scripts/items-work.json and scripts/name-progress.json to clean up.');
}

main().catch(e => { console.error(e); process.exit(1); });
