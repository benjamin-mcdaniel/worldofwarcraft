/**
 * test-bnet-item.mjs
 * Quick test to verify Battle.net API access and see what item data is available
 */

const BNET_CLIENT_ID     = 'a6da171f7ae24102bee61cbef3b16674';
const BNET_CLIENT_SECRET = 'B9x9l8PsTsX86VgGXFDJytIeTkZrMUCt';
const REGION = 'us';
const LOCALE = 'en_US';

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

async function fetchItem(itemId, token) {
  const url = `https://${REGION}.api.blizzard.com/data/wow/item/${itemId}?namespace=static-${REGION}&locale=${LOCALE}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Item fetch failed: ${res.status}`);
  return res.json();
}

async function main() {
  console.log('Getting Battle.net token...');
  const token = await getBNetToken();
  console.log('✓ Token obtained\n');

  // Test with a few different item types
  const testItems = [
    2770,   // Copper Ore (tradable material)
    210805, // Algari Missive (tradable consumable)
    19019,  // Thunderfury (legendary weapon, soulbound)
    6948,   // Hearthstone (soulbound quest item)
  ];

  for (const itemId of testItems) {
    console.log(`\nFetching item ${itemId}...`);
    try {
      const data = await fetchItem(itemId, token);
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
