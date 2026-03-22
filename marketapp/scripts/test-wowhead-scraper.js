/**
 * Test WoWHead XML scraper on a single item
 * Usage: node test-wowhead-scraper.js [itemId]
 */

const https = require('https');

const itemId = process.argv[2] || '168649'; // Default to the example item

console.log(`Testing WoWHead XML scraper with item ${itemId}...\n`);

function fetchWoWHeadXML(itemId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.wowhead.com/item=${itemId}&xml`;
    console.log(`Fetching: ${url}`);
    
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

function parseItemData(xml) {
  const data = {};
  
  // Extract name
  const nameMatch = xml.match(/<name><!\[CDATA\[(.*?)\]\]><\/name>/);
  if (nameMatch && nameMatch[1]) {
    data.name = nameMatch[1].trim();
  }
  
  // Extract quality
  const qualityMatch = xml.match(/<quality id="(\d+)"/);
  if (qualityMatch && qualityMatch[1]) {
    data.quality = parseInt(qualityMatch[1]);
  }
  
  // Extract class
  const classMatch = xml.match(/<class id="(\d+)"/);
  if (classMatch && classMatch[1]) {
    data.class = parseInt(classMatch[1]);
  }
  
  // Extract subclass
  const subclassMatch = xml.match(/<subclass id="(\d+)"/);
  if (subclassMatch && subclassMatch[1]) {
    data.subclass = parseInt(subclassMatch[1]);
  }
  
  // Extract icon
  const iconMatch = xml.match(/<icon displayId="\d+">([^<]+)<\/icon>/);
  if (iconMatch && iconMatch[1]) {
    data.icon = iconMatch[1].trim();
  }
  
  return data;
}

async function test() {
  try {
    const xml = await fetchWoWHeadXML(itemId);
    
    console.log('\n--- Raw XML (first 500 chars) ---');
    console.log(xml.substring(0, 500));
    console.log('...\n');
    
    const data = parseItemData(xml);
    
    console.log('--- Parsed Data ---');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.name) {
      console.log(`\n✓ Success! Item name: "${data.name}"`);
    } else {
      console.log('\n✗ Failed to extract item name');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();
