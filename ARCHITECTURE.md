# WoW Market Tracker — System Architecture

## Stack Summary

| Layer | Technology | Hosting |
|-------|-----------|---------|
| Frontend | Astro SSG + React islands + TailwindCSS | Cloudflare Pages |
| API | Cloudflare Workers (Hono router) | Cloudflare Workers |
| Data Ingestion | Cloudflare Workers (Cron Trigger) | Cloudflare Workers |
| Market Data Storage | Cloudflare R2 | Cloudflare R2 |
| User/Profile DB | Cloudflare D1 (SQLite) | Cloudflare D1 |
| Auth | Simple JWT via Workers (no CF Access needed) | Workers |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    USER BROWSER                          │
│  Astro SSG (Cloudflare Pages)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │
│  │ /search  │ │/item/:id │ │/profiles │ │ /reports  │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │ fetch /api/*
┌───────────────────────▼─────────────────────────────────┐
│           API WORKER  (workers/api)                      │
│  Hono Router + JWT middleware                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │
│  │/realms   │ │/search   │ │/item/:id │ │/deals     │ │
│  │/profiles │ │/reports  │ │/auth     │ │/analytics │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘ │
└────────────┬──────────────────────┬──────────────────────┘
             │ R2 reads             │ D1 reads/writes
┌────────────▼──────┐   ┌───────────▼────────────────────┐
│   Cloudflare R2   │   │      Cloudflare D1             │
│   (market data)   │   │   (users, profiles, reports)   │
│                   │   │                                 │
│ data/             │   │ Tables:                         │
│ ├─ realms/        │   │ - users (id, username, pw_hash) │
│ ├─ items/         │   │ - profiles (saved searches)     │
│ ├─ realm/{id}/    │   │ - favorites (item bookmarks)    │
│ │  ├─ state.json  │   │ - reports (generated trade tips)│
│ │  └─ items/      │   │ - report_items                  │
│ └─ global/        │   └─────────────────────────────────┘
│    └─ deals/      │
└─────────▲─────────┘
          │ writes hourly
┌─────────┴────────────────────────────────────────────────┐
│     INGESTION WORKER  (workers/ingestion)                 │
│     Cron: every 1 hour                                    │
│                                                           │
│  1. Auth with Battle.net OAuth2                          │
│  2. Fetch connected realm list (per region)              │
│  3. Fetch auction data per realm                         │
│  4. Process: resolve item keys, compute stats            │
│  5. Write realm state JSON → R2                          │
│  6. Compute deals (realm price vs region median) → R2    │
│  7. Update D1 metadata (last_updated, realm snapshots)   │
└──────────────────────────────────────────────────────────┘
                        │ Battle.net API
              https://{region}.api.blizzard.com
```

---

## Frontend Pages (Astro)

### Page Map
```
/ (index)          → redirect to /search
/login             → simple username/password form
/dashboard         → overview: realm status, top deals, trending
/search            → main search: realm picker + filters + results table
/item/[id]         → item detail: price chart, history, realm comparison
/profiles          → saved market profiles (custom search presets)
/profiles/[id]     → view/edit a specific profile
/reports           → trade report list
/reports/[id]      → individual trade report detail
```

### Astro Config
- `output: 'static'` — full SSG, no server rendering
- `integrations: [react(), tailwind()]`
- React islands (`client:load`) for: SearchBar, ItemTable, PriceChart, ProfileEditor
- All API calls are client-side fetch to `/api/*`

### Key Components
```
src/
├── layouts/
│   └── Layout.astro          # nav + footer wrapper
├── pages/
│   ├── index.astro
│   ├── login.astro
│   ├── dashboard.astro
│   ├── search.astro
│   ├── item/[id].astro
│   ├── profiles.astro
│   ├── profiles/[id].astro
│   ├── reports.astro
│   └── reports/[id].astro
├── components/
│   ├── Nav.astro              # top nav bar
│   ├── SearchBar.tsx          # realm selector + text search + filter panel
│   ├── FilterPanel.tsx        # collapsible filter sidebar
│   ├── ItemTable.tsx          # search results table with sorting
│   ├── ItemRow.tsx            # single row: icon, name, price, qty, delta
│   ├── PriceChart.tsx         # Chart.js price history (hourly + daily toggle)
│   ├── DealCard.tsx           # deal item card for dashboard
│   ├── RealmStatus.tsx        # last update time per realm
│   ├── ProfileCard.tsx        # saved search profile card
│   ├── ProfileEditor.tsx      # form to create/edit a market profile
│   └── TradeReport.tsx        # trade report display
└── lib/
    ├── api.ts                 # typed fetch wrappers for /api/*
    ├── auth.ts                # JWT storage + auth state (localStorage)
    ├── money.ts               # copper → gold/silver/copper formatter
    ├── itemKey.ts             # ItemKey serialization
    └── types.ts               # shared TypeScript types
```

---

## API Worker Routes

### Auth
```
POST /api/auth/login     body: {username, password}  → {token, expiresAt}
POST /api/auth/logout    header: Authorization: Bearer {token}
GET  /api/auth/me        header: Authorization        → {username}
```

### Market Data
```
GET  /api/realms                          → RealmList[]
GET  /api/realms/{region}                 → ConnectedRealm[]
GET  /api/search?realm={id}&q={text}&...  → PricedItem[]
GET  /api/item/{itemKey}/realm/{realmId}  → ItemState
GET  /api/deals?region={us|eu|tw|kr}      → DealItem[]
GET  /api/trending?realm={id}             → TrendingItem[]
```

### Custom Searches / Analytics
```
GET  /api/analytics/undervalued?realm={id}&threshold={pct}   → PricedItem[]
GET  /api/analytics/weekly-cycle?realm={id}                  → WeeklyCycleItem[]
GET  /api/analytics/volume?realm={id}&class={classId}        → VolumeItem[]
GET  /api/analytics/vendor-flip?realm={id}                   → VendorFlipItem[]
```

### Profiles
```
GET    /api/profiles              → Profile[]
POST   /api/profiles              body: ProfileCreate → Profile
GET    /api/profiles/{id}         → Profile
PUT    /api/profiles/{id}         body: ProfileUpdate → Profile
DELETE /api/profiles/{id}         → 204
POST   /api/profiles/{id}/run     → PricedItem[]  (execute the profile's search)
```

### Reports
```
GET  /api/reports                → TradeReport[]
POST /api/reports/generate       body: {profileIds[], realm} → TradeReport
GET  /api/reports/{id}           → TradeReport
```

### Favorites
```
GET    /api/favorites             → FavoriteItem[]
POST   /api/favorites             body: {itemKey, realmId} → FavoriteItem
DELETE /api/favorites/{itemKey}   → 204
```

---

## Ingestion Worker (Cron)

### Schedule
- Every 1 hour: `0 * * * *`

### Process Flow
```
1. For each region (us, eu, tw, kr):
   a. Authenticate → Battle.net OAuth token (cached 23h)
   b. Fetch connected realm list
   c. For each connected realm (up to N concurrent):
      i.  GET /data/wow/connected-realm/{id}/auctions
      ii. Compute per-item stats: min price, total qty
      iii. Update R2: data/realm/{id}/state.json
      iv. For items with price change >5%: update R2: data/realm/{id}/items/{itemKey}.json
   d. Compute region-wide deals:
      - For each item: find median price across all realms in region
      - Items where (min_price / region_median) < 0.7 → deals list
   e. Write R2: data/global/deals-{region}.json
   f. Update D1: realm_snapshots table

2. Cleanup: remove item files not updated in 30 days
```

### Battle.net API Endpoints Used
```
POST https://us.battle.net/oauth/token
     body: grant_type=client_credentials
     auth: {BATTLE_NET_KEY}:{BATTLE_NET_SECRET}

GET  https://{region}.api.blizzard.com/data/wow/connected-realm/index
     params: namespace=dynamic-{region}, locale=en_US

GET  https://{region}.api.blizzard.com/data/wow/connected-realm/{id}/auctions
     params: namespace=dynamic-{region}, locale=en_US
```

### Environment Variables (set in wrangler.toml / CF dashboard)
```
BATTLE_NET_KEY=...
BATTLE_NET_SECRET=...
JWT_SECRET=...           # for API worker
R2_BUCKET=wow-market     # R2 bucket name
DB=wow-market-db         # D1 binding name
```

---

## R2 Data Schema

### data/realms/{region}.json
```json
[
  {
    "id": 1,
    "name": "Realm Name",
    "category": "US East",
    "region": "us",
    "connectedRealmId": 1,
    "population": "high"
  }
]
```

### data/realm/{connectedRealmId}/state.json
```json
{
  "connectedRealmId": 1,
  "snapshot": 1700000000000,
  "lastCheck": 1700000000000,
  "summary": {
    "12345:80:0": { "snapshot": 1700000000000, "price": 500000, "qty": 3 }
  }
}
```

### data/realm/{connectedRealmId}/items/{itemKey}.json
```json
{
  "itemKey": "12345:80:0",
  "snapshot": 1700000000000,
  "price": 500000,
  "qty": 3,
  "auctions": [[500000, 1], [600000, 2]],
  "snapshots": [[1699990000000, 510000, 2], [1700000000000, 500000, 3]],
  "daily": [[1699920000000, 505000, 15], [1700006400000, 500000, 12]]
}
```

### data/global/deals-{region}.json
```json
{
  "timestamp": 1700000000000,
  "items": {
    "12345:0:0": { "regionMedian": 1000000, "dealPrice": 500000, "realmId": 1 }
  }
}
```

### data/items/metadata.json
```json
{
  "12345": {
    "name": "Item Name",
    "quality": 3,
    "class": 4,
    "subclass": 2,
    "itemLevel": 80,
    "expansion": 11,
    "icon": "inv_sword_20",
    "vendorPrice": 10000,
    "stackSize": 1
  }
}
```

---

## D1 Database Schema

```sql
-- Users
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT UNIQUE NOT NULL,
  pw_hash    TEXT NOT NULL,           -- bcrypt
  created_at INTEGER DEFAULT (unixepoch())
);

-- Market Profiles (saved custom searches)
CREATE TABLE profiles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  description TEXT,
  filters     TEXT NOT NULL,          -- JSON: {realm, class, minQuality, maxPrice, analytics_type, ...}
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);

-- Favorites (starred items)
CREATE TABLE favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  item_key    TEXT NOT NULL,
  realm_id    INTEGER NOT NULL,
  noted_price INTEGER,               -- copper, price when starred
  created_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, item_key, realm_id)
);

-- Trade Reports
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  realm_id    INTEGER NOT NULL,
  generated_at INTEGER DEFAULT (unixepoch()),
  summary     TEXT                   -- JSON summary stats
);

-- Report Line Items
CREATE TABLE report_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL REFERENCES reports(id),
  item_key    TEXT NOT NULL,
  action      TEXT NOT NULL,         -- 'buy', 'sell', 'watch'
  current_price INTEGER,
  target_price  INTEGER,
  reasoning   TEXT,
  confidence  REAL                   -- 0.0 to 1.0
);

-- Realm Snapshots (metadata for dashboard)
CREATE TABLE realm_snapshots (
  connected_realm_id INTEGER PRIMARY KEY,
  region             TEXT NOT NULL,
  last_snapshot      INTEGER,
  item_count         INTEGER
);
```

---

## Analytics Logic (Custom Searches)

### 1. Deals (Below Region Median)
```
dealScore = 1 - (realmPrice / regionMedian)
threshold: dealScore > 0.30 (30% below median)
```

### 2. Undervalued Items
```
Compare: realmPrice vs. 14-day average price for same realm
undervalued if: realmPrice < (14dayAvg * 0.80)
```

### 3. Weekly Cycle Arbitrage
```
Pattern: WoW weekly reset = Tuesday (US) / Wednesday (EU)
Logic: Items often cheaper Mon-Tue (supply flooding before reset), expensive Wed-Thu
Filter: items with price variance > 20% over rolling 7-day window
Show: current position in cycle + recommended action
```

### 4. Volume Analysis
```
Track: total qty per snapshot
Rising volume = potential price crash coming
Low volume + high price = possible bubble
```

### 5. Vendor Flip
```
vendorFlipValue = vendorSellPrice - currentAHPrice - AHCut (5%)
Show: items where AH price < vendor price (free profit)
```

### 6. Craft Profit (future)
```
craftCost = sum(reagentPrices * quantities)
craftProfit = salePrice - craftCost - AHCut
```

---

## Auth Flow

```
1. POST /api/auth/login {username, password}
   → Server: bcrypt compare pw_hash
   → On success: sign JWT {userId, username, exp: now+7d} with JWT_SECRET
   → Return: {token, expiresAt}

2. Client: store token in localStorage
   All subsequent requests: Authorization: Bearer {token}

3. API Worker middleware:
   - Verify JWT signature
   - Check exp not passed
   - Attach user to context

4. Public routes (no auth): /api/realms, /api/search, /api/deals
   Private routes (auth required): /api/profiles, /api/favorites, /api/reports
```

---

## Deployment

### Order of Operations
1. Create R2 bucket: `wow-market`
2. Create D1 database: `wow-market-db`
3. Run D1 migrations
4. Deploy ingestion worker (with cron)
5. Deploy API worker
6. Build + deploy Astro frontend to CF Pages
7. Set custom domain in CF Pages

### wrangler.toml (API Worker)
```toml
name = "wow-market-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "R2"
bucket_name = "wow-market"

[[d1_databases]]
binding = "DB"
database_name = "wow-market-db"
database_id = "YOUR_D1_ID"

[vars]
JWT_SECRET = "set-in-dashboard"
```

### wrangler.toml (Ingestion Worker)
```toml
name = "wow-market-ingestion"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "R2"
bucket_name = "wow-market"

[[d1_databases]]
binding = "DB"
database_name = "wow-market-db"
database_id = "YOUR_D1_ID"

[triggers]
crons = ["0 * * * *"]

[vars]
BATTLE_NET_KEY = "set-in-dashboard"
BATTLE_NET_SECRET = "set-in-dashboard"
```

---

## Key Decisions & Tradeoffs

| Decision | Choice | Reason |
|----------|--------|--------|
| Data format | JSON in R2 (not binary) | Simpler to debug, CF Workers can read/parse easily |
| Auth | Custom JWT Worker | No CF Access cost, private app |
| Charts | Chart.js | Lighter than Highcharts, no license issues |
| ORM | D1 raw SQL | Simple schema, avoid ORM overhead in Workers |
| Item icons | Wowhead CDN | `https://wow.zamimg.com/images/wow/icons/medium/{icon}.jpg` |
| Price history depth | 14d hourly + 90d daily | Balances R2 storage cost vs. usefulness |
| Locale | EN-US only (initially) | Simplify scope |
| Realm selection | Saved in localStorage | No server-side per-user realm preference needed |
