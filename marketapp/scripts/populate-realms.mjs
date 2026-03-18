/**
 * populate-realms.mjs
 * Fetches connected realm data from Battle.net and saves static/realms.json to R2.
 * This populates the realm dropdown in the app header.
 *
 * Usage: node scripts/populate-realms.mjs
 */

import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const WRANGLER_CWD = join(__dir, '..', 'workers', 'api');
const BNET_CLIENT_ID     = 'a6da171f7ae24102bee61cbef3b16674';
const BNET_CLIENT_SECRET = 'B9x9l8PsTsX86VgGXFDJytIeTkZrMUCt';
const REGIONS = ['us', 'eu'];
const CONCURRENCY = 30;

const TOKEN_URLS = {
  us: 'https://oauth.battle.net/token',
  eu: 'https://eu.battle.net/oauth/token',
};

async function getToken(region) {
  const res = await fetch(TOKEN_URLS[region], {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token failed ${region}: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function bnetFetch(url, token, region) {
  const sep = url.includes('?') ? '&' : '?';
  try {
    const res = await fetch(`${url}${sep}namespace=dynamic-${region}&locale=en_US`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function r2Put(key, filePath) {
  const result = spawnSync(
    'npx', ['wrangler', 'r2', 'object', 'put', `wow-market-data/${key}`,
            '--file', filePath, '--content-type', 'application/json'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true, cwd: WRANGLER_CWD }
  );
  if (result.status !== 0) throw new Error(`R2 put failed: ${result.stderr}`);
}

async function main() {
  const allRealms = [];

  for (const region of REGIONS) {
    console.log(`\nFetching ${region.toUpperCase()} connected realms...`);
    const token = await getToken(region);
    const host = `https://${region}.api.blizzard.com`;

    const index = await bnetFetch(`${host}/data/wow/connected-realm/index`, token, region);
    if (!index?.connected_realms) { console.error(`  No realm index for ${region}`); continue; }

    const hrefs = index.connected_realms.map(r => r.href);
    console.log(`  ${hrefs.length} connected realms — fetching details...`);

    let fetched = 0;
    for (let i = 0; i < hrefs.length; i += CONCURRENCY) {
      const batch = hrefs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(href => bnetFetch(href, token, region)));

      for (const cr of results) {
        if (!cr?.realms?.length) continue;
        const primary = cr.realms[0];
        allRealms.push({
          id: cr.id,
          name: cr.realms.map(r => r.name).join(' / '),
          region,
          slug: primary.slug,
        });
        fetched++;
      }
      process.stdout.write(`  ${Math.min(i + CONCURRENCY, hrefs.length)}/${hrefs.length}\r`);
    }
    console.log(`  Done: ${fetched} connected realms`);
  }

  allRealms.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\nTotal: ${allRealms.length} realms across ${REGIONS.join(', ').toUpperCase()}`);

  const outPath = join(__dir, 'realms.json');
  writeFileSync(outPath, JSON.stringify(allRealms));
  r2Put('static/realms.json', outPath);
  console.log('Uploaded static/realms.json ✓');
}

main().catch(e => { console.error(e); process.exit(1); });
