/**
 * cleanup-price-data.mjs
 * Deletes all realm-specific price data from R2 by removing the entire realm/ prefix.
 * This prepares for a fresh import with clean data.
 * 
 * Note: Since wrangler doesn't support bulk delete or prefix-based operations,
 * this script resets the realms-with-data.json file. The actual realm data will be
 * overwritten on next import.
 * 
 * Usage: node scripts/cleanup-price-data.mjs
 */

import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WRANGLER_CWD = join(__dir, '..', 'workers', 'api');
const R2_BUCKET = 'wow-market-data';

console.log(`Cleanup Price Data from R2\n`);

function r2Put(key, content) {
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`, '--pipe'],
    { input: content, encoding: 'utf8', shell: true, cwd: WRANGLER_CWD }
  );
  return result.status === 0;
}

async function main() {
  console.log('Resetting realms-with-data.json to empty array...');
  
  if (r2Put('static/realms-with-data.json', '[]')) {
    console.log('  ✓ Reset realms-with-data.json to []\n');
  } else {
    console.error('  ✗ Failed to reset realms-with-data.json\n');
    process.exit(1);
  }

  console.log('Note: Existing realm price data in R2 will be overwritten on next import.');
  console.log('The import script will create fresh data files.\n');
  
  console.log('Cleanup complete!');
  console.log('\nNext steps:');
  console.log('  1. Run: node populate-auctionable.mjs');
  console.log('     (Fetches binding info from Battle.net and adds auctionable flags)');
  console.log('  2. Run: node import-auctionator.mjs');
  console.log('     (Imports fresh price data from Auctionator.lua)');
  console.log('\nThe import will overwrite any existing realm data with fresh snapshots.');
}

main().catch(console.error);
