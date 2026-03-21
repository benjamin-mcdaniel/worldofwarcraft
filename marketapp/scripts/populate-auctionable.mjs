/**
 * populate-auctionable.mjs
 * Fetches binding information from Battle.net API for all items in static/items.json
 * and adds an "auctionable" flag based on binding type.
 * 
 * Auctionable items: no binding, or binding type is ON_USE/ON_EQUIP
 * Non-auctionable: binding type is ON_ACQUIRE, TO_BNETACCOUNT, TO_WOWACCOUNT
 * 
 * Usage: node scripts/populate-auctionable.mjs [--dry-run]
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WRANGLER_CWD = join(__dir, '..', 'workers', 'api');
const R2_BUCKET = 'wow-market-data';
const R2_KEY = 'static/items.json';

const CATALOG_PATH = join(__dir, 'items-work.json');
const PROGRESS_PATH = join(__dir, 'auctionable-progress.json');
const DRY_RUN = process.argv.includes('--dry-run');

const REGION = 'us';
const LOCALE = 'en_US';
const CONCURRENCY = 30;
const SAVE_EVERY = 500;

const BNET_CLIENT_ID = 'a6da171f7ae24102bee61cbef3b16674';
const BNET_CLIENT_SECRET = 'B9x9l8PsTsX86VgGXFDJytIeTkZrMUCt';

// Download catalog from R2
function downloadCatalog() {
  console.log('Downloading catalog from R2...');
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'get', `${R2_BUCKET}/${R2_KEY}`, '--pipe'],
    { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) throw new Error('Failed to download catalog');
  writeFileSync(CATALOG_PATH, result.stdout);
  console.log(`  Saved to ${CATALOG_PATH}\n`);
}

// Get Battle.net OAuth token
async function getBNetToken() {
  const res = await fetch(`https://oauth.battle.net/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// Fetch binding info for one item
async function fetchBindingInfo(itemId, token) {
  try {
    const url = `https://${REGION}.api.blizzard.com/data/wow/item/${itemId}?namespace=static-${REGION}&locale=${LOCALE}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return { auctionable: false, reason: 'not_found' };
    if (!res.ok) return null;
    
    const data = await res.json();
    const binding = data.preview_item?.binding?.type;
    
    // No binding = tradable (can be auctioned)
    if (!binding) return { auctionable: true };
    
    // ON_USE and ON_EQUIP items can be sold before use/equip
    if (binding === 'ON_USE' || binding === 'ON_EQUIP') {
      return { auctionable: true };
    }
    
    // ON_ACQUIRE, TO_BNETACCOUNT, TO_WOWACCOUNT = soulbound
    return { auctionable: false, binding };
  } catch (e) {
    return null;
  }
}

// Process batch of items
async function processBatch(batch, token) {
  return Promise.all(batch.map(async ({ itemId }) => {
    const info = await fetchBindingInfo(itemId, token);
    return { itemId, info };
  }));
}

// Upload patched catalog
function uploadCatalog(data) {
  const outPath = join(__dir, 'items-auctionable.json');
  writeFileSync(outPath, JSON.stringify(data));
  console.log(`\nUploading patched catalog (${(Buffer.byteLength(JSON.stringify(data)) / 1024 / 1024).toFixed(1)} MB)...`);
  
  if (DRY_RUN) {
    console.log('[DRY RUN] Would upload to R2');
    return;
  }
  
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${R2_KEY}`,
            '--file', outPath, '--content-type', 'application/json'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error('Failed to upload catalog to R2');
  }
  console.log('✓ Upload complete.');
}

async function main() {
  console.log(`Populate Auctionable Flags`);
  console.log(`  Dry run: ${DRY_RUN}\n`);

  // Download catalog if not cached
  if (!existsSync(CATALOG_PATH)) {
    downloadCatalog();
  } else {
    console.log('Using cached catalog (delete scripts/items-work.json to re-download)\n');
  }

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  const itemIds = Object.keys(catalog).map(id => parseInt(id));
  console.log(`Total items in catalog: ${itemIds.length}\n`);

  // Load progress
  const progress = existsSync(PROGRESS_PATH)
    ? JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'))
    : {};

  // Apply cached results
  let cached = 0;
  for (const [itemId, info] of Object.entries(progress)) {
    if (catalog[itemId] && info?.auctionable !== undefined) {
      catalog[itemId].auctionable = info.auctionable;
      cached++;
    }
  }
  console.log(`Applied ${cached} cached results from previous run\n`);

  // Find items needing fetch
  const needsFetch = itemIds.filter(id => catalog[id].auctionable === undefined);
  console.log(`Items needing Battle.net fetch: ${needsFetch.length}\n`);

  if (needsFetch.length === 0) {
    console.log('All items already have auctionable flags. Uploading...');
    uploadCatalog(catalog);
    return;
  }

  // Get token
  console.log('Getting Battle.net token...');
  let token = await getBNetToken();
  let tokenFetchedAt = Date.now();
  console.log('✓ Token obtained\n');

  // Process in batches
  console.log(`Fetching binding info (${CONCURRENCY} parallel)...`);
  let processed = 0;
  let auctionable = 0;
  let notAuctionable = 0;
  let errors = 0;

  for (let i = 0; i < needsFetch.length; i += CONCURRENCY) {
    // Refresh token every 50 minutes
    if (Date.now() - tokenFetchedAt > 50 * 60 * 1000) {
      console.log('  Refreshing token...');
      token = await getBNetToken();
      tokenFetchedAt = Date.now();
    }

    const batch = needsFetch.slice(i, i + CONCURRENCY).map(id => ({ itemId: id }));
    const results = await processBatch(batch, token);

    for (const { itemId, info } of results) {
      if (info) {
        catalog[itemId].auctionable = info.auctionable;
        progress[itemId] = info;
        if (info.auctionable) auctionable++;
        else notAuctionable++;
      } else {
        errors++;
      }
      processed++;
    }

    if (processed % SAVE_EVERY === 0 || processed === needsFetch.length) {
      writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
      console.log(`  ${processed}/${needsFetch.length} (${auctionable} auctionable, ${notAuctionable} not, ${errors} errors)`);
    }
  }

  console.log(`\nFetch complete:`);
  console.log(`  Auctionable: ${auctionable}`);
  console.log(`  Not auctionable: ${notAuctionable}`);
  console.log(`  Errors: ${errors}`);

  uploadCatalog(catalog);
}

main().catch(console.error);
