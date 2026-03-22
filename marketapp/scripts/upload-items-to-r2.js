/**
 * Upload items catalog to R2
 * 
 * Uploads the items-with-names.json file to R2 static/items.json
 * Usage: node upload-items-to-r2.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ITEMS_FILE = path.join(__dirname, 'items-with-names.json');
const TEMP_FILE = path.join(__dirname, '.temp-items.json');

console.log('Uploading items catalog to R2...\n');

// Check if items file exists
if (!fs.existsSync(ITEMS_FILE)) {
  console.error(`Error: ${ITEMS_FILE} not found`);
  console.log('Run scrape-wowhead-names.js first to generate the file');
  process.exit(1);
}

// Load and validate items
let items;
try {
  const data = fs.readFileSync(ITEMS_FILE, 'utf8');
  items = JSON.parse(data);
  const itemCount = Object.keys(items).length;
  const withNames = Object.values(items).filter(item => item.name).length;
  
  console.log(`Loaded ${itemCount} items`);
  console.log(`Items with names: ${withNames} (${Math.round(withNames/itemCount*100)}%)`);
  
  if (withNames === 0) {
    console.error('Error: No items have names! Run the scraper first.');
    process.exit(1);
  }
} catch (err) {
  console.error('Error loading items file:', err.message);
  process.exit(1);
}

// Write to temp file (wrangler needs a file path)
fs.writeFileSync(TEMP_FILE, JSON.stringify(items));

try {
  console.log('\nUploading to R2...');
  
  // Upload to R2 using wrangler
  const cmd = `npx wrangler r2 object put wow-market-data/static/items.json --file="${TEMP_FILE}"`;
  execSync(cmd, { 
    cwd: path.join(__dirname, '..', 'workers', 'api'),
    stdio: 'inherit'
  });
  
  console.log('\n✓ Upload complete!');
  console.log('Items catalog updated in R2 at: static/items.json');
  
  // Clean up temp file
  fs.unlinkSync(TEMP_FILE);
  
} catch (err) {
  console.error('Error uploading to R2:', err.message);
  if (fs.existsSync(TEMP_FILE)) {
    fs.unlinkSync(TEMP_FILE);
  }
  process.exit(1);
}
