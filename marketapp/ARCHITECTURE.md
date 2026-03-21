# WoW Market Tracker - Architecture Documentation

## Overview

The application fetches live auction data from Battle.net API and provides price tracking for World of Warcraft items across two distinct markets:

1. **Commodities** - Region-wide fungible items (ore, herbs, gems, etc.)
2. **Realm Auctions** - Server-specific unique items (gear, weapons, BoE items, etc.)

---

## Data Sources

### Battle.net Auction House API

**Commodities API**
- Endpoint: `/data/wow/auctions/commodities`
- Scope: Entire region (all US realms, all EU realms, etc.)
- Items: Stackable, fungible materials
- Update frequency: Hourly
- Response size: 10+ MB

**Realm Auctions API**
- Endpoint: `/data/wow/connected-realm/{realmId}/auctions`
- Scope: Single connected realm
- Items: Unique gear, weapons, BoE items
- Update frequency: Hourly
- Response size: 10+ MB per realm

**Rate Limits**
- 36,000 requests per hour per client credential
- 1 client credential pair per application
- Current usage: ~2-4 requests/hour (well under limit)

---

## R2 Storage Structure

```
wow-market-data/
├── static/
│   ├── items.json              # Item catalog (id, name, icon, quality, class)
│   └── realms.json             # Realm list with IDs and names
│
├── global/
│   └── ingestion-state.json    # Last run metadata
│
├── commodities/
│   └── us/
│       ├── meta.json           # Last-Modified header, item count
│       ├── current.json        # Latest snapshot (all items)
│       └── items/
│           └── {itemId}.json   # Per-item price history
│
└── realm/
    └── {realmId}/
        ├── meta.json           # Last-Modified header, item count
        ├── current.json        # Latest snapshot (all items)
        └── items/
            └── {itemKey}.json  # Per-item price history
```

### Item Key Format

**Commodities**: `{itemId}` (e.g., `2770` for Copper Ore)

**Realm Items**: `{itemId}:{itemLevel}:{itemSuffix}` (e.g., `19019:0:0` for Thunderfury)

### Item State Schema

```typescript
{
  snapshot: number;              // Latest timestamp
  price: number;                 // Current lowest price (copper)
  qty: number;                   // Available quantity
  auctions: Array<{              // Current active auctions
    price: number;
    qty: number;
  }>;
  snapshots: Array<[             // Hourly snapshots (168 max = 1 week)
    timestamp,
    price,
    qty
  ]>;
  daily: Array<[                 // Daily aggregates (90 max = 3 months)
    dayStart,
    lowestPrice,
    qty
  ]>;
}
```

---

## Ingestion Worker

**Location**: `workers/ingestion/`

**Trigger**: Cron schedule `0 * * * *` (every hour at :00)

**Process Flow**:

1. Get Battle.net OAuth token
2. Fetch commodities for US region
   - Check Last-Modified header
   - Skip if unchanged
   - Aggregate by item ID (lowest price)
   - Update current.json + per-item history
3. Fetch realm auctions for tracked realms (currently: Stormrage id=60)
   - Check Last-Modified header
   - Skip if unchanged
   - Aggregate by item key (lowest price)
   - Update current.json + per-item history
4. Write ingestion-state.json with metadata

**Incremental Updates**:
- Uses Last-Modified header to detect changes
- Only processes snapshots when data has changed
- Appends to existing history arrays (no full rewrites)
- Keeps 168 hourly snapshots + 90 daily aggregates per item

**Environment Variables**:
- `TRACKED_REALMS`: Comma-separated realm IDs (e.g., "60,11")
- `BATTLE_NET_KEY`: OAuth client ID (secret)
- `BATTLE_NET_SECRET`: OAuth client secret (secret)

---

## API Worker

**Location**: `workers/api/`

**Existing Endpoints** (to be updated):
- `GET /api/realms` - List of realms
- `GET /api/catalog/items` - Item catalog
- `GET /api/item/:itemKey/realm/:realmId` - Item state (needs update for commodities)
- `GET /api/search` - Search items
- `GET /api/favorites` - User favorites
- `POST /api/favorites` - Add favorite
- `DELETE /api/favorites/:id` - Remove favorite

**New Endpoints Needed**:
- `GET /api/commodities/:region` - List all commodities with current prices
- `GET /api/commodities/:region/item/:itemId` - Single commodity price history
- `GET /api/realm/:realmId/auctions` - List all realm auctions with current prices
- `GET /api/realm/:realmId/item/:itemKey` - Single realm item price history

---

## Frontend Architecture

### Current Structure
- Single search page with realm selector
- Item detail page with price history chart
- Favorites page

### Proposed Changes

**Navigation**:
```
├── 🔍 Commodities (region-wide)
├── 🔍 Realm Auctions (server-specific)
├── ⭐ Favorites
└── 📊 Analytics
```

**Commodities Page** (`/commodities`)
- Region selector (US / EU tabs)
- Search bar for commodity items
- Results show region-wide lowest price
- Click item → commodity detail page with price history

**Realm Auctions Page** (`/auctions`)
- Realm selector in top bar (persisted)
- Search bar for realm-specific items
- Results show realm-specific prices
- Click item → realm item detail page with price history

**Item Detail Pages**:
- Commodity detail: Shows region-wide price history
- Realm item detail: Shows realm-specific price history + region comparison

---

## Realm Request Feature

**User Flow**:
1. User navigates to Settings or Realm Auctions page
2. Clicks "Request a Realm"
3. Fills form: Realm name, Region (US/EU), Reason (optional)
4. Submits request
5. Request stored in D1 database
6. Admin reviews requests and adds realms to `TRACKED_REALMS` env var

**Database Schema**:
```sql
CREATE TABLE realm_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  realm_name TEXT NOT NULL,
  region TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT
);
```

---

## Testing Plan

### Phase 1: Ingestion Verification ✅
- [x] Deploy ingestion worker
- [x] Set Battle.net API credentials
- [x] Trigger manual ingestion
- [ ] Verify commodities data in R2
- [ ] Verify realm auction data in R2
- [ ] Confirm hourly cron runs successfully

### Phase 2: API Updates
- [ ] Update API worker to serve commodities data
- [ ] Update API worker to serve realm auction data
- [ ] Test API endpoints with Postman/curl

### Phase 3: Frontend Updates
- [ ] Create Commodities search page
- [ ] Create Realm Auctions search page
- [ ] Update navigation
- [ ] Update item detail pages
- [ ] Test end-to-end flow

### Phase 4: Realm Request Feature
- [ ] Add realm_requests table to D1
- [ ] Create realm request form
- [ ] Create admin review interface
- [ ] Test request submission and approval flow

---

## Deployment Checklist

- [x] Ingestion worker deployed
- [x] Battle.net credentials set as secrets
- [x] Cron trigger configured (hourly)
- [ ] API worker updated and deployed
- [ ] Frontend updated and deployed
- [ ] Database migrations run
- [ ] Monitor logs for first 24 hours
- [ ] Verify data accuracy against in-game prices

---

## Maintenance

**Daily**:
- Check ingestion-state.json for failures
- Monitor API rate limit usage

**Weekly**:
- Review realm request queue
- Check R2 storage usage

**Monthly**:
- Audit tracked realms list
- Review and clean up stale data
- Update item catalog from Battle.net if needed

---

## Known Limitations

1. **Historical data**: Starting fresh, no historical data preserved
2. **Realm coverage**: Limited to tracked realms only (not all realms)
3. **Item catalog**: Static catalog, requires manual updates for new items
4. **Rate limits**: 36k requests/hour shared across all operations
5. **Update frequency**: Hourly snapshots only (Battle.net limitation)

---

## Future Enhancements

- Auto-discovery of new items from auction data
- Predictive price analytics using historical trends
- Price alerts via email/webhook
- Multi-region price comparison
- Deal finder (items below region median)
- Realm population metrics
- Auction house activity heatmaps
