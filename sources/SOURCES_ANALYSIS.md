# Sources Analysis — Project Shatari Reference Repos

## Overview

The three repos are the complete open-source stack behind **undermine.exchange** — the most widely-used WoW auction house tracker. We use them as reference/training data only; we do not run their code directly.

---

## 1. shatari-data — Static Game Data Parser

**Path:** `sources/shatari-data/`  
**Language:** PHP  
**Purpose:** One-time/per-patch scripts that read Blizzard's DB2 database files and output static JSON used by the other layers.

### Key Output Files (already committed in repo)

| File | Size | Contents |
|------|------|----------|
| `expansion-items.json` | 3.4 MB | All WoW items with class, subclass, itemLevel, expansion, quality, icon, vendorPrice, etc. |
| `expansion-pets.json` | 45 KB | Battle pet species data |
| `vendor-items.json` | 127 KB | Items that can be purchased from vendors (used for "below vendor price" filter) |

### Item JSON Shape (from `expansion-items.json`)
```json
{
  "12345": {
    "class": 4,
    "subclass": 2,
    "name": "Thunderfury",
    "quality": 5,
    "itemLevel": 80,
    "expansion": 0,
    "icon": "inv_sword_20",
    "vendorPrice": 10000,
    "inventoryType": 13,
    "stackSize": 1
  }
}
```

### Relevant Scripts
- `src/items.php` — extracts item metadata from `ItemSparse.db2`
- `src/bonuses.php` — maps bonus IDs → item level changes, name suffixes, tertiary stats
- `src/categories.php` — builds the left-panel category tree for the AH UI
- `src/battlepets.php` — extracts pet names and stats

---

## 2. shatari — Backend Data Ingestion

**Path:** `sources/shatari/`  
**Language:** Node.js  
**Purpose:** Long-running process (cron-invoked) that calls the Battle.net API hourly and writes custom binary state files to disk.

### Key Concepts

**ItemKey** — Uniquely identifies an item listing variant:
```js
{ itemId: number, itemLevel: number, itemSuffix: number }
// Serialized as: "12345:80:0" or "12345:0:0"
```

**Price Units** — All prices stored in copper (100 copper = 1 silver; 10,000 copper = 1 gold)

**Regions** — `us`, `eu`, `tw`, `kr`

### Data File Hierarchy (binary `.bin`, gzip-compressed)

```
data/
├── global/
│   ├── state.bin          # GlobalState: last snapshot timestamp per realm
│   └── deals-{region}.bin # DealState: region-wide deals (itemKey → [medianPrice, dealPrice])
└── {connectedRealmId}/
    ├── state.bin           # RealmState: summary of all items (itemKey → [snapshot, price, qty])
    ├── {itemId_low8bits}/
    │   └── {itemKey}.bin   # ItemState: full price history for one item on one realm
    └── pet/
        └── {species_low8bits}/
            └── {itemKey}.bin
```

### State Object Shapes

#### ItemState
```js
{
  snapshot: timestamp_ms,     // when this item was last seen
  price: copper,              // cheapest price at last snapshot
  quantity: number,           // total quantity at last snapshot
  auctions: [[price, qty]],   // current auction list by price
  specifics: [[price, modifiers[], bonuses[]]], // per-auction detail
  snapshots: [[timestamp, price, qty]],   // hourly history (14 days)
  daily: [[day_timestamp, price, qty]]    // daily history (since Sep 2022)
}
```

#### RealmState
```js
{
  snapshot: timestamp_ms,
  lastCheck: timestamp_ms,
  snapshots: [timestamp_ms],  // list of recent snapshot times
  summary: {                  // itemKeyString → [snapshot, price, qty]
    "12345:80:0": [1700000000000, 500000, 3]
  },
  bonusStatItems: {           // statId → itemKeyString[]
    "1": ["12345:80:0"]
  }
}
```

#### DealState (Deals)
```js
{
  items: {                    // itemKeyString → [regionMedian, dealPrice]
    "12345:0:0": [1000000, 500000]
  }
}
```

### Battle.net API Integration
- OAuth2 client credentials flow (`us.battle.net/oauth/token`)
- Auction data endpoint: `GET /{region}.api.blizzard.com/data/wow/connected-realm/{id}/auctions`
- Connected realm list: `GET /data/wow/connected-realm/index`
- Namespace: `dynamic-{region}`, Locale: `en_US`
- Credentials: `BATTLE_NET_KEY` + `BATTLE_NET_SECRET` env vars

### Key Processing Files
- `src/main.js` — orchestration loop (regions → realms → process → deals)
- `src/realmProcess.js` — processes raw auction JSON into state files
- `src/itemKey.js` — resolves item level/suffix from bonus IDs
- `src/dealState.js` — reads/writes deals binary format
- `src/realmState.js` — reads/writes realm summary binary format
- `src/itemState.js` — reads/writes per-item binary format
- `src/battlenet.js` — Battle.net API client

---

## 3. shatari-front — Frontend

**Path:** `sources/shatari-front/`  
**Language:** Vanilla HTML/CSS/JS (no framework)  
**Purpose:** Single-page app that reads static data files and renders the UI.

### Static Data Files Consumed
```
/json/items.unbound.json          # All tradeable items (name, quality, class, icon, etc.)
/json/names.unbound.{locale}.json # Item names by locale
/json/battlepets.json             # Battle pet species data
/json/battlepets.{locale}.json    # Pet names by locale
/json/categories.{locale}.json    # AH category tree
/json/name-suffixes.{locale}.json # Item name suffix translations
/json/vendor.json                 # Vendor item prices
/json/bonusToStats.json           # Maps bonuses to tertiary stat IDs
/json/realms/                     # Realm lists (per region, written by backend)
/data/...                         # Per-realm/per-item binary state files (written by backend)
```

### UI Features (reference for our design)
- **Realm selector** (dropdown, grouped by region)
- **Text search** with autocomplete
- **Filter panel**: level range, rarity (Poor→Legendary), expansion, ignore varieties, below vendor, out-of-stock, region median column, arbitrage mode
- **Category browser** (left panel — AH category tree)
- **Search results table**: item icon + name, price, quantity, (optional) region median
- **Item detail view**: price chart (Highcharts Stock), current auctions list, realm comparison
- **Deals search** — items priced well below region median
- **Favorites** — starred items

### TypeDefs from main.js (key data shapes for frontend)
```ts
type Money = number; // coppers
type ItemKeyString = string; // "itemId:itemLevel:itemSuffix"

interface ItemState {
  auctions: [price: Money, qty: number][];
  daily: [timestamp: number, price: Money, qty: number][];
  item: Item;
  realm: Realm;
  price: Money;
  quantity: number;
  snapshot: number;
  snapshots: [timestamp: number, price: Money, qty: number][];
  specifics: AuctionDetail[];
}

interface DealsPrices {
  regionMedian: Money;
  dealPrice: Money;
}
```

---

## Key Insights for Our Build

1. **Data volume is massive** — 58M+ files, 56GB in the original. We can't replicate this exactly on Cloudflare. Our approach: store processed JSON in R2, not raw binary files, and use D1 for indexed queries.

2. **Battle.net API required** — You need a Battle.net developer account. Free tier provides auction data. Register at https://develop.battle.net

3. **Items JSON is our static asset** — `expansion-items.json` (3.4MB) and `items.unbound.json` (5.7MB) are the item catalogs. We bundle these into R2 or split them into chunks.

4. **The "deals" concept** is simple: compare current realm price vs. region-wide median price. Items priced significantly below median = deals.

5. **Price history depth**: Original stores 14 days hourly + daily since Sep 2022. We should start with 14-day hourly and 90-day daily.

6. **Custom searches** (beyond undermine.exchange) are the key differentiator. The original only shows "deals" (below median). We want to add: weekly cycle arbitrage, commodity volume analysis, crafting profit, and resell profiles.
