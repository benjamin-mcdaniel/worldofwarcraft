# WoW Market Tracker — Implementation Guide

## Project Structure

```
marketapp/
├── frontend/          # Astro SSG app (deploy to Cloudflare Pages)
│   ├── src/
│   │   ├── components/    # React island components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── SearchPage.tsx
│   │   │   ├── ItemDetail.tsx
│   │   │   ├── ProfilesPage.tsx
│   │   │   ├── ReportsPage.tsx
│   │   │   └── shared/
│   │   ├── layouts/Layout.astro
│   │   ├── lib/
│   │   │   ├── api.ts       # All API calls (single source of truth)
│   │   │   ├── types.ts     # All shared TypeScript types
│   │   │   ├── money.ts     # Gold/silver/copper formatting
│   │   │   ├── itemKey.ts   # ItemKey parse/stringify + icon URL
│   │   │   └── auth.ts      # localStorage JWT helpers
│   │   └── pages/           # Astro route pages
│   ├── astro.config.mjs
│   ├── tailwind.config.mjs
│   └── package.json
│
└── workers/
    ├── api/               # REST API (deploy as CF Worker)
    │   ├── src/index.ts   # Full router + handlers
    │   ├── schema.sql     # D1 database schema
    │   └── wrangler.toml
    └── ingestion/         # Data fetcher (scheduled CF Worker)
        ├── src/index.ts   # BNet poller + R2 writer
        └── wrangler.toml
```

---

## Step 1 — Prerequisites

- Node.js 18+ and npm
- Cloudflare account with Workers + Pages + R2 + D1 enabled
- Battle.net developer API credentials (key + secret) from https://develop.battle.net
- Wrangler CLI: `npm install -g wrangler`
- Login to CF: `wrangler login`

---

## Step 2 — Cloudflare Resource Setup

### Create R2 Bucket
```bash
wrangler r2 bucket create wow-market-data
```

### Create D1 Database
```bash
wrangler d1 create wow-market-db
# Copy the database_id from output into both wrangler.toml files
```

### Apply D1 Schema
```bash
wrangler d1 execute wow-market-db --file=marketapp/workers/api/schema.sql
```

### Create Admin User
```bash
# Generate password hash (SHA256 of "yourpassword1" + user_id prefix, then base64)
# Simplest: run a one-off script or use the seed endpoint after first deploy
wrangler d1 execute wow-market-db --command \
  "INSERT INTO users (username, password_hash) VALUES ('admin', 'REPLACE_WITH_HASH')"
```

To generate the hash (Node.js one-liner):
```js
const crypto = require('crypto');
const pass = 'yourpassword';
const userId = 1;
console.log(Buffer.from(crypto.createHash('sha256').update(pass + userId).digest()).toString('base64'));
```

---

## Step 3 — Configure Secrets

### API Worker
```bash
cd marketapp/workers/api
wrangler secret put JWT_SECRET
# Enter a long random string (32+ chars)
```

### Ingestion Worker
```bash
cd marketapp/workers/ingestion
wrangler secret put BATTLE_NET_KEY
wrangler secret put BATTLE_NET_SECRET
```

---

## Step 4 — Update wrangler.toml IDs

In `marketapp/workers/api/wrangler.toml`, replace:
```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```
with the actual D1 ID from Step 2.

---

## Step 5 — Deploy Workers

```bash
# Deploy API worker
cd marketapp/workers/api
npm install
wrangler deploy
# Note the deployed URL: https://wow-market-api.<your-subdomain>.workers.dev

# Deploy ingestion worker
cd ../ingestion
npm install
wrangler deploy
```

---

## Step 6 — Deploy Frontend

### Set API base URL
In `marketapp/frontend/`, create `.env`:
```
PUBLIC_API_BASE=https://wow-market-api.<your-subdomain>.workers.dev/api
```

### Install & build
```bash
cd marketapp/frontend
npm install
npm run build
```

### Deploy to Cloudflare Pages
```bash
wrangler pages deploy dist --project-name wow-market-frontend
```

Or connect the GitHub repo to Cloudflare Pages with:
- Build command: `npm run build`
- Build output: `dist`
- Root directory: `marketapp/frontend`

---

## Step 7 — Trigger First Ingestion

After deploying the ingestion worker, trigger it manually:
```bash
curl -X POST https://wow-market-ingestion.<subdomain>.workers.dev/trigger
```

The worker will then run automatically every 30 minutes via its cron trigger.

---

## Step 8 — Seed Static Item Metadata

The frontend and API can serve richer item data (name, icon, quality) if you populate
item metadata in R2. This comes from the `shatari-data` reference repo:

```bash
# 1. Run the PHP scripts in sources/shatari-data/ to generate JSON
php sources/shatari-data/src/items.php > items.all.json

# 2. Upload to R2
wrangler r2 object put wow-market-data/static/items.json --file items.all.json
wrangler r2 object put wow-market-data/static/realms.json --file realms.json
```

The API will serve these as static files from R2. The frontend calls `/api/realms` and
enriches search results with item metadata on the fly.

---

## Data Flow

```
Battle.net AH API
       ↓ (every 30m via CF Cron)
Ingestion Worker
  - Fetches auctions for each connected realm
  - Computes ItemKey, lowest price, total qty
  - Writes per-item JSON to R2: realm/{id}/items/{key}.json
  - Writes realm index to R2: realm/{id}/index.json
  - Computes region medians → deals → analytics JSON
       ↓
R2 Bucket (wow-market-data)
  realm/{realmId}/index.json          # search index
  realm/{realmId}/items/{key}.json    # item history
  realm/{realmId}/analytics/*.json    # deals, undervalued, etc.
  global/deals-{region}.json         # cross-realm deals
  global/state.json                  # snapshot metadata
  static/items.json                  # item name/icon/quality
  static/realms.json                 # realm list
       ↓
API Worker (reads R2, writes D1)
  GET /api/search?realm=X&q=...       → realm index lookup
  GET /api/deals?region=us            → global deals JSON
  GET /api/item/:key/realm/:id        → per-item history
  GET /api/analytics/:type?realm=X   → precomputed analytics
  POST /api/profiles                 → D1 save
  POST /api/reports/generate         → D1 + analytics lookup
       ↓
Frontend (Astro + React)
  /dashboard   → deals + realm status
  /search      → full item search
  /item/:key   → price history chart
  /profiles    → saved searches
  /reports     → trade recommendations
```

---

## Analytics Types Reference

| Type | Logic | R2 Key |
|------|-------|--------|
| `deals` | price < 70% of region median | `realm/{id}/analytics/deals.json` |
| `undervalued` | price < 85% of region median | `realm/{id}/analytics/undervalued.json` |
| `weekly-cycle` | TODO: buy Mon-Tue, sell Wed-Thu | `realm/{id}/analytics/weekly-cycle.json` |
| `vendor-flip` | price < vendor sale price | `realm/{id}/analytics/vendor-flip.json` |
| `volume` | highest qty × price turnover | `realm/{id}/analytics/volume.json` |

Weekly-cycle, vendor-flip, and volume analytics are scaffold stubs — populate them by:
1. Reading `sources/shatari/src/dealState.js` for deal logic
2. Reading `sources/shatari-data/src/items.php` for vendor price data
3. Implementing the compute functions in `ingestion/src/index.ts`

---

## Environment Variables Summary

| Worker | Variable | Source |
|--------|----------|--------|
| api | `JWT_SECRET` | `wrangler secret put` |
| api | `DB` | D1 binding in wrangler.toml |
| api | `R2_BUCKET` | R2 binding in wrangler.toml |
| ingestion | `BATTLE_NET_KEY` | `wrangler secret put` |
| ingestion | `BATTLE_NET_SECRET` | `wrangler secret put` |
| ingestion | `R2_BUCKET` | R2 binding in wrangler.toml |
| ingestion | `BNET_REGIONS` | wrangler.toml vars (default: `us`) |
| frontend | `PUBLIC_API_BASE` | `.env` file |

---

## Known Gaps / Next Steps

1. **Item metadata enrichment** — The API returns `itemKey` strings. To show names/icons,
   populate `static/items.json` from the shatari-data PHP output and add a lookup step
   in the API's search handler.

2. **Weekly-cycle / vendor-flip analytics** — Stubs exist in the ingestion worker; 
   implement using shatari reference logic.

3. **Realm name resolution** — Upload `static/realms.json` to R2 with connected realm
   metadata; the frontend realm selector will populate from it.

4. **Pagination** — Search results are capped at 100/500. Add cursor-based pagination
   for large result sets.

5. **Price history charts** — `ItemDetail.tsx` uses a CSS sparkline. Replace with 
   Chart.js (`react-chartjs-2`) for interactive price history.

6. **GitHub Actions CI** — Add `.github/workflows/deploy.yml` to auto-deploy both
   workers and frontend on push to `main`.
