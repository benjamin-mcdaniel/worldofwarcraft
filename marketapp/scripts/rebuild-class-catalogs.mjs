/**
 * rebuild-class-catalogs.mjs
 * Splits the master static/items.json into per-class catalog files
 * (static/catalog/class-{N}.json) used by the search endpoint for category browsing.
 * Run after populate-item-names.mjs has updated static/items.json.
 *
 * Usage: node scripts/rebuild-class-catalogs.mjs
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WRANGLER_CWD = join(__dir, '..', 'workers', 'api');
const R2_BUCKET = 'wow-market-data';
const WORK_DIR = join(__dir, 'catalog-work');

function r2Get(key) {
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'get', `${R2_BUCKET}/${key}`, '--pipe'],
    { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) throw new Error(`R2 get failed for ${key}: ${result.stderr?.toString()}`);
  return result.stdout;
}

function r2Put(key, filePath) {
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`,
            '--file', filePath, '--content-type', 'application/json'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) throw new Error(`R2 put failed for ${key}: ${result.stderr}`);
}

async function main() {
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR);

  // Download master catalog (use local work file if still present from name population)
  const masterPath = join(__dir, 'items-patched.json');
  let catalogBuf;
  if (existsSync(masterPath)) {
    console.log('Using local items-patched.json');
    catalogBuf = readFileSync(masterPath);
  } else {
    console.log('Downloading static/items.json from R2...');
    catalogBuf = r2Get('static/items.json');
  }

  const catalog = JSON.parse(catalogBuf.toString('utf8'));
  const total = Object.keys(catalog).length;
  console.log(`Loaded ${total} items`);

  // Group by item class
  const byClass = {};
  for (const [itemId, meta] of Object.entries(catalog)) {
    const cls = meta.class ?? -1;
    if (cls < 0) continue;
    if (!byClass[cls]) byClass[cls] = {};
    byClass[cls][itemId] = meta;
  }

  const classes = Object.keys(byClass).sort((a, b) => Number(a) - Number(b));
  console.log(`Found ${classes.length} item classes`);

  for (const cls of classes) {
    const data = byClass[cls];
    const count = Object.keys(data).length;
    const filePath = join(WORK_DIR, `class-${cls}.json`);
    writeFileSync(filePath, JSON.stringify(data));
    const key = `static/catalog/class-${cls}.json`;
    console.log(`  Uploading ${key} (${count} items, ${(Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(0)} KB)...`);
    r2Put(key, filePath);
  }

  console.log('\nDone! All class catalogs rebuilt and uploaded.');
}

main().catch(e => { console.error(e); process.exit(1); });
