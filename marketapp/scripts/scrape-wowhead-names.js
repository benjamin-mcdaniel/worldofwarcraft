/**
 * WoWHead XML Scraper for Item Names
 * 
 * Fetches item data from WoWHead's XML API and updates the items catalog with names.
 * Usage: node scrape-wowhead-names.js
 * 
 * Rate limited to avoid being blocked by WoWHead (1 request per 500ms = ~2 per second)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const ITEMS_FILE = path.join(__dirname, 'items-auctionable.json');
const OUTPUT_FILE = path.join(__dirname, 'items-with-names.json');
const DELAY_MS = 500; // 500ms between requests (2 per second)
const BATCH_SIZE = 100; // Save progress every 100 items
const RESUME_FILE = path.join(__dirname, '.scrape-progress.json');

// Load existing items
let items = {};
try {
  const data = fs.readFileSync(ITEMS_FILE, 'utf8');
  items = JSON.parse(data);
  console.log(`Loaded ${Object.keys(items).length} items from catalog`);
} catch (err) {
  console.error('Failed to load items file:', err.message);
  process.exit(1);
}

// Load progress if resuming
let progress = { completed: [], failed: [], lastItemId: null };
if (fs.existsSync(RESUME_FILE)) {
  try {
    progress = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    console.log(`Resuming from previous run. Completed: ${progress.completed.length}, Failed: ${progress.failed.length}`);
  } catch (err) {
    console.log('Starting fresh scrape');
  }
}

// Get list of item IDs that need names
const itemIds = Object.keys(items)
  .filter(id => !items[id].name && !progress.completed.includes(id))
  .sort((a, b) => parseInt(a) - parseInt(b));

console.log(`Found ${itemIds.length} items without names to scrape`);

/**
 * Fetch item data from WoWHead XML API
 */
function fetchWoWHeadXML(itemId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.wowhead.com/item=${itemId}&xml`;
    
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      
      res.on('data', chunk => data += chunk);
      
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    }).on('error', reject);
  });
}

/**
 * Parse WoWHead XML and extract item name
 */
function parseItemName(xml) {
  // Extract name from <name><![CDATA[Item Name]]></name>
  const nameMatch = xml.match(/<name><!\[CDATA\[(.*?)\]\]><\/name>/);
  if (nameMatch && nameMatch[1]) {
    return nameMatch[1].trim();
  }
  
  // Fallback: try without CDATA
  const simpleName = xml.match(/<name>(.*?)<\/name>/);
  if (simpleName && simpleName[1]) {
    return simpleName[1].trim();
  }
  
  return null;
}

/**
 * Save progress to resume file
 */
function saveProgress() {
  fs.writeFileSync(RESUME_FILE, JSON.stringify(progress, null, 2));
}

/**
 * Save updated items to output file
 */
function saveItems() {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(items, null, 2));
  console.log(`Saved updated items to ${OUTPUT_FILE}`);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main scraping loop
 */
async function scrapeItems() {
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  console.log(`Starting scrape of ${itemIds.length} items...`);
  console.log(`Rate limit: ${DELAY_MS}ms between requests (~${Math.floor(1000 / DELAY_MS)} per second)`);
  console.log('Press Ctrl+C to stop (progress will be saved)\n');
  
  for (const itemId of itemIds) {
    try {
      process.stdout.write(`[${processed + 1}/${itemIds.length}] Fetching item ${itemId}... `);
      
      const xml = await fetchWoWHeadXML(itemId);
      const name = parseItemName(xml);
      
      if (name) {
        items[itemId].name = name;
        progress.completed.push(itemId);
        successful++;
        console.log(`✓ "${name}"`);
      } else {
        progress.failed.push(itemId);
        failed++;
        console.log(`✗ No name found`);
      }
      
      progress.lastItemId = itemId;
      processed++;
      
      // Save progress periodically
      if (processed % BATCH_SIZE === 0) {
        saveProgress();
        saveItems();
        console.log(`\n--- Progress saved (${processed}/${itemIds.length}) ---\n`);
      }
      
      // Rate limiting
      await sleep(DELAY_MS);
      
    } catch (err) {
      console.log(`✗ Error: ${err.message}`);
      progress.failed.push(itemId);
      failed++;
      
      // If we get rate limited, wait longer
      if (err.message.includes('429') || err.message.includes('Too Many')) {
        console.log('Rate limited! Waiting 10 seconds...');
        await sleep(10000);
      }
    }
  }
  
  // Final save
  saveProgress();
  saveItems();
  
  console.log('\n=== Scraping Complete ===');
  console.log(`Total processed: ${processed}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Output saved to: ${OUTPUT_FILE}`);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nInterrupted! Saving progress...');
  saveProgress();
  saveItems();
  console.log('Progress saved. Run again to resume.');
  process.exit(0);
});

// Start scraping
scrapeItems().catch(err => {
  console.error('Fatal error:', err);
  saveProgress();
  saveItems();
  process.exit(1);
});
