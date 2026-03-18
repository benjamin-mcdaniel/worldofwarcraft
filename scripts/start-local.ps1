# start-local.ps1
# Starts the WoW Market Tracker locally for development and testing.
# Opens two new terminal windows: API worker (port 8787) + Astro frontend (port 4321).
# Run from the repo root: .\scripts\start-local.ps1

param(
    [string]$AdminPass = "admin123",
    [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"
$RepoRoot    = Split-Path $PSScriptRoot -Parent
$ApiDir      = Join-Path $RepoRoot "marketapp\workers\api"
$FrontendDir = Join-Path $RepoRoot "marketapp\frontend"
$WranglerToml = Join-Path $ApiDir "wrangler.toml"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  WoW Market Tracker -- Local Dev Startup" -ForegroundColor Cyan
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

# Check database_id is not still a placeholder
Write-Host ""
Write-Host "[CHECK] Verifying wrangler.toml..." -ForegroundColor DarkCyan
$tomlContent = Get-Content $WranglerToml -Raw
if ($tomlContent -match "REPLACE_WITH_YOUR_D1_DATABASE_ID") {
    Write-Host "[ERROR] wrangler.toml still has a placeholder database_id." -ForegroundColor Red
    Write-Host "        Run: wrangler d1 create wow-market-db" -ForegroundColor Yellow
    Write-Host "        Then paste the database_id into: $WranglerToml" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] wrangler.toml looks good" -ForegroundColor Green

# Check node_modules
Write-Host ""
Write-Host "[CHECK] Checking node_modules..." -ForegroundColor DarkCyan
foreach ($dir in @($ApiDir, $FrontendDir)) {
    $nm = Join-Path $dir "node_modules"
    if (-not (Test-Path $nm)) {
        Write-Host "[INFO] Installing dependencies in $dir..." -ForegroundColor Yellow
        Push-Location $dir
        npm install
        Pop-Location
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] npm install failed in $dir" -ForegroundColor Red
            exit 1
        }
    }
    $leaf = Split-Path $dir -Leaf
    Write-Host "[OK] node_modules found in $leaf" -ForegroundColor Green
}

# Apply D1 schema + seed admin user
if (-not $SkipSeed) {
    Write-Host ""
    Write-Host "[INFO] Applying D1 schema to local database..." -ForegroundColor DarkCyan
    Push-Location $ApiDir
    npx wrangler d1 execute wow-market-db --local --file=schema.sql 2>&1 | ForEach-Object { Write-Host "  $_" }
    $schemaExit = $LASTEXITCODE
    Pop-Location
    if ($schemaExit -ne 0) {
        Write-Host "[WARN] Schema apply returned non-zero (may already be applied, continuing)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Schema applied to local D1" -ForegroundColor Green
    }

    # Compute password hash via Node.js
    Write-Host ""
    Write-Host "[INFO] Seeding local admin user (username: admin, pass: $AdminPass)..." -ForegroundColor DarkCyan

    $hashScript = @'
const crypto = require('crypto');
const pass = process.argv[2];
const hash = crypto.createHash('sha256').update(pass + '1').digest('base64');
process.stdout.write(hash);
'@
    $hashScriptPath = Join-Path $env:TEMP "wow-hash.js"
    Set-Content -Path $hashScriptPath -Value $hashScript -Encoding ASCII
    $passwordHash = node $hashScriptPath $AdminPass
    Remove-Item $hashScriptPath -Force

    $seedSql = "INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (1, 'admin', '$passwordHash');"
    $seedFile = Join-Path $env:TEMP "wow-seed.sql"
    Set-Content -Path $seedFile -Value $seedSql -Encoding ASCII

    Push-Location $ApiDir
    npx wrangler d1 execute wow-market-db --local --file=$seedFile 2>&1 | ForEach-Object { Write-Host "  $_" }
    Pop-Location
    Remove-Item $seedFile -Force

    Write-Host "[OK] Admin user seeded -- Login: admin / $AdminPass" -ForegroundColor Green
}

# Verify .env.development exists
Write-Host ""
Write-Host "[CHECK] Verifying frontend .env.development..." -ForegroundColor DarkCyan
$envDevFile = Join-Path $FrontendDir ".env.development"
if (-not (Test-Path $envDevFile)) {
    Write-Host "[INFO] Creating .env.development..." -ForegroundColor Yellow
    Set-Content -Path $envDevFile -Value "PUBLIC_API_BASE=http://localhost:8787/api`n" -Encoding ASCII
}
Write-Host "[OK] .env.development present (points to http://localhost:8787/api)" -ForegroundColor Green

# Launch API worker in a new terminal window
Write-Host ""
Write-Host "[START] Launching API worker (wrangler dev) on port 8787..." -ForegroundColor Magenta
$apiCmd = "Write-Host 'API Worker - npm run dev' -ForegroundColor Cyan; Set-Location '" + $ApiDir + "'; npm run dev; Read-Host 'Press Enter to close'"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiCmd -WindowStyle Normal

Write-Host "[INFO] Waiting 4 seconds for API worker to initialise..." -ForegroundColor DarkGray
Start-Sleep -Seconds 4

# Launch Astro dev server in a new terminal window
Write-Host "[START] Launching Astro frontend (npm run dev) on port 4321..." -ForegroundColor Magenta
$frontendCmd = "Write-Host 'Astro Frontend - npm run dev' -ForegroundColor Cyan; Set-Location '" + $FrontendDir + "'; npm run dev; Read-Host 'Press Enter to close'"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal

# Summary
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Local dev servers starting!" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend  -->  http://localhost:4321" -ForegroundColor White
Write-Host "  API       -->  http://localhost:8787" -ForegroundColor White
Write-Host "  API check -->  http://localhost:8787/api/realms" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Login: admin / $AdminPass" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Two new terminal windows have opened." -ForegroundColor DarkGray
Write-Host "  Close them to stop the servers." -ForegroundColor DarkGray
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$openBrowser = Read-Host "Open http://localhost:4321 in browser now? (Y/n)"
if ($openBrowser -ne "n" -and $openBrowser -ne "N") {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:4321"
}
