# WoWHead Item Name Scraper

Scripts to fetch missing item names from WoWHead and update the catalog.

## Files

- `test-wowhead-scraper.js` - Test the scraper on a single item
- `scrape-wowhead-names.js` - Main scraper to fetch all missing names
- `upload-items-to-r2.js` - Upload updated catalog to R2

## Usage

### 1. Test the scraper first

```bash
cd scripts
node test-wowhead-scraper.js 168649
```

This will fetch item 168649 from WoWHead and show you the parsed data.

### 2. Run the full scraper

```bash
node scrape-wowhead-names.js
```

**Important:**
- The scraper is rate-limited to 2 requests per second (500ms delay)
- It saves progress every 100 items
- You can stop it anytime with Ctrl+C and resume later
- Progress is saved to `.scrape-progress.json`
- Output is saved to `items-with-names.json`

**Estimated time:**
- ~10,000 items = ~1.5 hours
- ~50,000 items = ~7 hours
- ~100,000 items = ~14 hours

### 3. Upload to R2

Once scraping is complete:

```bash
node upload-items-to-r2.js
```

This uploads `items-with-names.json` to R2 at `static/items.json`.

## Resuming

If the scraper is interrupted, just run it again:

```bash
node scrape-wowhead-names.js
```

It will automatically resume from where it left off using `.scrape-progress.json`.

## Monitoring Progress

The scraper shows:
- Current item being fetched
- Success/failure status
- Item name if found
- Progress saves every 100 items

Example output:
```
[1/10000] Fetching item 25... ✓ "Worn Shortsword"
[2/10000] Fetching item 35... ✓ "Bent Staff"
[3/10000] Fetching item 36... ✓ "Worn Mace"
...
--- Progress saved (100/10000) ---
```

## Rate Limiting

The scraper uses a 500ms delay between requests to avoid being blocked by WoWHead. If you get rate limited (HTTP 429), it will automatically wait 10 seconds before continuing.

## Output Format

The output file `items-with-names.json` has the same structure as `items-auctionable.json` but with names populated:

```json
{
  "168649": {
    "name": "Notorious Gladiator's Plate Chestpiece",
    "icon": "inv_chest_plate_raiddeathknight_s_01",
    "quality": 4,
    "class": 4,
    "subclass": 4,
    ...
  }
}
```

## Troubleshooting

**"Failed to load items file"**
- Make sure `items-auctionable.json` exists in the scripts folder

**"Rate limited"**
- The scraper will automatically wait and retry
- If it happens frequently, increase `DELAY_MS` in the script

**"No name found"**
- Some items may not exist on WoWHead
- These are tracked in the failed list

**Want to start fresh?**
- Delete `.scrape-progress.json`
- Run the scraper again
