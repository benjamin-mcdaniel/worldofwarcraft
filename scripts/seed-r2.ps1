# seed-r2.ps1
# Processes shatari source data and uploads static metadata to Cloudflare R2.
# Run from the repo root: .\scripts\seed-r2.ps1

param(
    [string]$BucketName = "wow-market-data"
)

$ErrorActionPreference = "Stop"
$RepoRoot   = Split-Path $PSScriptRoot -Parent
$SourceDir  = Join-Path $RepoRoot "sources\shatari"
$SourceData = Join-Path $RepoRoot "sources\shatari-data"
$TempDir    = Join-Path $env:TEMP "wow-market-seed"
$ApiDir     = Join-Path $RepoRoot "marketapp\workers\api"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  WoW Market Tracker -- R2 Static Data Seeder" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "[CHECK] Verifying prerequisites..." -ForegroundColor DarkCyan
foreach ($cmd in @("node", "npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] '$cmd' not found in PATH." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] $cmd found" -ForegroundColor Green
}

# Check source files
$ItemsAllJson  = Join-Path $SourceDir  "items.all.json"
$NamesJson     = Join-Path $SourceDir  "names.bound.enus.json"
$VendorJson    = Join-Path $SourceData "vendor-items.json"
$ExpansionJson = Join-Path $SourceData "expansion-items.json"

Write-Host ""
Write-Host "[CHECK] Verifying source files..." -ForegroundColor DarkCyan
foreach ($f in @($ItemsAllJson, $NamesJson, $VendorJson, $ExpansionJson)) {
    if (-not (Test-Path $f)) {
        Write-Host "[ERROR] Missing source file: $f" -ForegroundColor Red
        exit 1
    }
    $sizeMB = [Math]::Round((Get-Item $f).Length / 1MB, 1)
    Write-Host "[OK] $(Split-Path $f -Leaf) ($sizeMB MB)" -ForegroundColor Green
}

# Temp directory
Write-Host ""
Write-Host "[INFO] Preparing temp directory..." -ForegroundColor DarkCyan
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir | Out-Null
Write-Host "[OK] Temp dir: $TempDir" -ForegroundColor Green

# Merge items.all.json + names.bound.enus.json -> items.json
Write-Host ""
Write-Host "[INFO] Merging item metadata + English names (may take 15-30s)..." -ForegroundColor DarkCyan

$MergedItemsJson = Join-Path $TempDir "items.json"
$CatalogDir = Join-Path $TempDir "catalog"

$nodeScript = @'
const fs = require('fs');
const path = require('path');

process.stdout.write('[NODE] Reading items.all.json...\n');
const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write('[NODE] Reading names.bound.enus.json...\n');
const names = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
process.stdout.write('[NODE] Merging...\n');

// AH-tradable item classes only (matches categories.enus.json)
const TRADEABLE_CLASSES = new Set([0, 1, 2, 3, 4, 7, 8, 9, 16, 17, 19, 20]);

const merged = {};
const byClass = {};
let count = 0;

for (const [id, meta] of Object.entries(items)) {
    if (meta.bop) continue;
    const itemClass = meta.class !== undefined ? meta.class : null;
    if (itemClass === null || !TRADEABLE_CLASSES.has(itemClass)) continue;
    const entry = {
        name:      names[id] || null,
        icon:      meta.icon || null,
        quality:   meta.quality || 1,
        class:     itemClass,
        subclass:  meta.subclass !== undefined ? meta.subclass : null,
        expansion: meta.expansion || 0,
        itemLevel: meta.itemLevel || 0,
        stack:     meta.stack || 1,
    };
    merged[id] = entry;
    if (!byClass[itemClass]) byClass[itemClass] = {};
    byClass[itemClass][id] = entry;
    count++;
}

process.stdout.write('[NODE] Processed ' + count + ' tradeable items\n');
fs.writeFileSync(process.argv[4], JSON.stringify(merged));
process.stdout.write('[NODE] items.json: ' + (Buffer.byteLength(JSON.stringify(merged)) / 1024 / 1024).toFixed(1) + ' MB\n');

// Write per-class catalog files
const catalogDir = process.argv[5];
fs.mkdirSync(catalogDir, { recursive: true });
for (const [cls, entries] of Object.entries(byClass)) {
    const outPath = path.join(catalogDir, 'class-' + cls + '.json');
    fs.writeFileSync(outPath, JSON.stringify(entries));
    process.stdout.write('[NODE] class-' + cls + '.json: ' + Object.keys(entries).length + ' items\n');
}
process.stdout.write('[NODE] Done\n');
'@

$nodeScriptPath = Join-Path $TempDir "merge.js"
Set-Content -Path $nodeScriptPath -Value $nodeScript -Encoding ASCII
node $nodeScriptPath $ItemsAllJson $NamesJson $MergedItemsJson $CatalogDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Merge script failed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Merged items.json and per-class catalogs ready" -ForegroundColor Green

# Upload helper
function Send-R2Object {
    param([string]$LocalFile, [string]$R2Key, [string]$Label)
    $sizeKB = [Math]::Round((Get-Item $LocalFile).Length / 1KB, 0)
    Write-Host "[UPLOAD] $Label  -->  r2://$BucketName/$R2Key  ($sizeKB KB)" -ForegroundColor Yellow
    Push-Location $ApiDir
    npx wrangler r2 object put "$BucketName/$R2Key" --file $LocalFile --content-type "application/json"
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Host "[ERROR] Upload failed for $R2Key" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Uploaded $R2Key" -ForegroundColor Green
    Write-Host ""
}

Write-Host ""
Write-Host "[INFO] Uploading to R2 bucket: $BucketName" -ForegroundColor DarkCyan
Write-Host ""

Send-R2Object -LocalFile $MergedItemsJson  -R2Key "static/items.json"           -Label "Item metadata (merged)"
Send-R2Object -LocalFile $VendorJson       -R2Key "static/vendor-items.json"    -Label "Vendor item prices"
Send-R2Object -LocalFile $ExpansionJson    -R2Key "static/expansion-items.json" -Label "Expansion item map"

# Upload per-class catalog files
Write-Host "[INFO] Uploading per-class catalog indexes..." -ForegroundColor DarkCyan
Get-ChildItem -Path $CatalogDir -Filter "class-*.json" | ForEach-Object {
    $classFile = $_.FullName
    $r2Key = "static/catalog/$($_.Name)"
    Send-R2Object -LocalFile $classFile -R2Key $r2Key -Label "Catalog $($_.BaseName)"
}

# Write initial global state placeholder
$statePlaceholder = Join-Path $TempDir "state.json"
@{ lastSnapshot = 0; realmCount = 0; seeded = $true } | ConvertTo-Json | Set-Content -Path $statePlaceholder -Encoding ASCII
Send-R2Object -LocalFile $statePlaceholder -R2Key "global/state.json" -Label "Global state placeholder"

# Cleanup
Remove-Item $TempDir -Recurse -Force

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Seeding complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Uploaded to R2 ($BucketName):" -ForegroundColor Cyan
Write-Host "    static/items.json           item names + metadata" -ForegroundColor White
Write-Host "    static/vendor-items.json    vendor prices" -ForegroundColor White
Write-Host "    static/expansion-items.json expansion map" -ForegroundColor White
Write-Host "    global/state.json           state placeholder" -ForegroundColor White
Write-Host ""
Write-Host "  Trigger ingestion to populate live auction data:" -ForegroundColor Yellow
Write-Host "    Invoke-RestMethod -Uri https://wow-market-ingestion.benjamin-f-mcdaniel.workers.dev/trigger -Method POST" -ForegroundColor DarkGray
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
