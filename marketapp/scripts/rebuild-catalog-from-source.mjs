/**
 * rebuild-catalog-from-source.mjs
 * Rebuilds static/items.json from authoritative source files in sources/shatari-front
 * and sources/shatari-data, then uploads to R2 and rebuilds per-class catalogs.
 *
 * Sources used:
 *   sources/shatari-front/public/json/items.unbound.json    — metadata (34,323 tradeable items)
 *   sources/shatari-front/public/json/names.unbound.enus.json — English names
 *   sources/shatari-data/vendor-items.json                  — vendor buy prices
 *
 * Usage: node scripts/rebuild-catalog-from-source.mjs
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dir, '..', '..', 'sources');
const WRANGLER_CWD = join(__dir, '..', 'workers', 'api');
const R2_BUCKET    = 'wow-market-data';
const WORK_DIR     = join(__dir, 'catalog-work');

function r2Put(key, filePath) {
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`,
            '--file', filePath, '--content-type', 'application/json'],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) throw new Error(`R2 put failed for ${key}:\n${result.stderr}`);
}

async function main() {
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR);

  // ── Load sources ───────────────────────────────────────────────────────────
  console.log('Loading sources...');
  const itemsMeta  = JSON.parse(readFileSync(join(ROOT, 'shatari-front', 'public', 'json', 'items.unbound.json'), 'utf8'));
  const namesMap   = JSON.parse(readFileSync(join(ROOT, 'shatari-front', 'public', 'json', 'names.unbound.enus.json'), 'utf8'));
  const vendorRaw  = JSON.parse(readFileSync(join(ROOT, 'shatari-data', 'vendor-items.json'), 'utf8'));

  // Build vendor price lookup: itemId → copper price
  const vendorPrices = {};
  for (const [id, v] of Object.entries(vendorRaw)) {
    if (v?.price) vendorPrices[id] = v.price;
  }
  console.log(`  items.unbound:  ${Object.keys(itemsMeta).length} items`);
  console.log(`  names.unbound:  ${Object.keys(namesMap).length} names`);
  console.log(`  vendor-items:   ${Object.keys(vendorPrices).length} vendor prices`);

  // ── Build catalog ──────────────────────────────────────────────────────────
  console.log('\nBuilding catalog...');
  const catalog = {};
  let withName = 0;
  let withVendor = 0;

  for (const [itemId, meta] of Object.entries(itemsMeta)) {
    const name = namesMap[itemId] ?? null;
    const vendorPrice = vendorPrices[itemId] ?? null;
    if (name) withName++;
    if (vendorPrice) withVendor++;

    catalog[itemId] = {
      name,
      icon:        meta.icon        ?? null,
      quality:     meta.quality     ?? 1,
      class:       meta.class       ?? 0,
      subclass:    meta.subclass    ?? 0,
      expansion:   meta.expansion   ?? 0,
      itemLevel:   meta.itemLevel   ?? 0,
      stack:       meta.stackSize   ?? 1,
      ...(vendorPrice ? { vendorPrice } : {}),
    };
  }

  const total = Object.keys(catalog).length;
  console.log(`  Built ${total} items — ${withName} with names (${(withName/total*100).toFixed(1)}%), ${withVendor} with vendor prices`);

  // ── Save master catalog ────────────────────────────────────────────────────
  const masterPath = join(__dir, 'items-patched.json');
  writeFileSync(masterPath, JSON.stringify(catalog));
  console.log(`\nSaved ${masterPath} (${(Buffer.byteLength(JSON.stringify(catalog)) / 1024 / 1024).toFixed(2)} MB)`);

  // ── Upload master catalog to R2 ────────────────────────────────────────────
  console.log('\nUploading static/items.json to R2...');
  r2Put('static/items.json', masterPath);
  console.log('  Done.');

  // ── Split into per-class catalogs and upload ───────────────────────────────
  console.log('\nBuilding per-class catalogs...');
  const byClass = {};
  for (const [itemId, meta] of Object.entries(catalog)) {
    const cls = meta.class ?? -1;
    if (cls < 0) continue;
    if (!byClass[cls]) byClass[cls] = {};
    byClass[cls][itemId] = meta;
  }

  const classes = Object.keys(byClass).sort((a, b) => Number(a) - Number(b));
  console.log(`  ${classes.length} classes found`);

  for (const cls of classes) {
    const data     = byClass[cls];
    const count    = Object.keys(data).length;
    const filePath = join(WORK_DIR, `class-${cls}.json`);
    const key      = `static/catalog/class-${cls}.json`;
    writeFileSync(filePath, JSON.stringify(data));
    process.stdout.write(`  Uploading ${key} (${count} items)... `);
    r2Put(key, filePath);
    console.log('done');
  }

  console.log('\nAll done! Catalog rebuilt and uploaded.');
  console.log(`  ${total} total items, ${withName} named, ${withVendor} with vendor prices`);
}

main().catch(e => { console.error(e); process.exit(1); });
