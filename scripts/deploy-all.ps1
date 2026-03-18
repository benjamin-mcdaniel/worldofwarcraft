# deploy-all.ps1
# Deploys the full WoW Market Tracker stack to Cloudflare.
# Deploys: API worker, ingestion worker, Astro frontend (Pages).
# Run from the repo root: .\scripts\deploy-all.ps1

param(
    [switch]$ApiOnly,
    [switch]$FrontendOnly,
    [switch]$SkipIngestion
)

$ErrorActionPreference = "Stop"
$RepoRoot        = Split-Path $PSScriptRoot -Parent
$ApiDir          = Join-Path $RepoRoot "marketapp\workers\api"
$IngestionDir    = Join-Path $RepoRoot "marketapp\workers\ingestion"
$FrontendDir     = Join-Path $RepoRoot "marketapp\frontend"
$WranglerToml    = Join-Path $ApiDir "wrangler.toml"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  WoW Market Tracker — Cloudflare Deploy" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ── Check prerequisites ───────────────────────────────────────────────────────
Write-Host "[CHECK] Verifying prerequisites..." -ForegroundColor DarkCyan

foreach ($cmd in @("npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] '$cmd' not found in PATH." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] $cmd found" -ForegroundColor Green
}

# ── Check database_id placeholder ────────────────────────────────────────────
$tomlContent = Get-Content $WranglerToml -Raw
if ($tomlContent -match "REPLACE_WITH_YOUR_D1_DATABASE_ID") {
    Write-Host ""
    Write-Host "[ERROR] wrangler.toml still has a placeholder database_id." -ForegroundColor Red
    Write-Host "        Run: wrangler d1 create wow-market-db" -ForegroundColor Yellow
    Write-Host "        Then paste the database_id into: $WranglerToml" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] wrangler.toml database_id configured" -ForegroundColor Green

# ── Check production .env ─────────────────────────────────────────────────────
$envFile = Join-Path $FrontendDir ".env"
if (-not (Test-Path $envFile) -and -not $ApiOnly) {
    Write-Host ""
    Write-Host "[WARN] No .env file found in frontend. Frontend will be built without PUBLIC_API_BASE." -ForegroundColor Yellow
    Write-Host "       Run .\scripts\setup-env.ps1 first to configure the API URL." -ForegroundColor Yellow
    $cont = Read-Host "Continue anyway? (y/N)"
    if ($cont -ne "y" -and $cont -ne "Y") { exit 0 }
}

$deployStart = Get-Date
$results = @{}

# ── Helper: run a deploy step ─────────────────────────────────────────────────
function Invoke-DeployStep {
    param([string]$Label, [string]$Dir, [scriptblock]$Action)
    Write-Host ""
    Write-Host "────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  DEPLOYING: $Label" -ForegroundColor Cyan
    Write-Host "────────────────────────────────────────────────" -ForegroundColor DarkGray
    $stepStart = Get-Date
    Push-Location $Dir
    try {
        & $Action
        $elapsed = [Math]::Round(((Get-Date) - $stepStart).TotalSeconds, 1)
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "[FAIL] $Label failed (exit $LASTEXITCODE)" -ForegroundColor Red
            $script:results[$Label] = "FAILED"
        } else {
            Write-Host ""
            Write-Host "[OK] $Label deployed in ${elapsed}s" -ForegroundColor Green
            $script:results[$Label] = "OK"
        }
    } catch {
        Write-Host "[ERROR] $Label threw: $_" -ForegroundColor Red
        $script:results[$Label] = "ERROR"
    } finally {
        Pop-Location
    }
}

# ── Deploy API Worker ─────────────────────────────────────────────────────────
if (-not $FrontendOnly) {
    Invoke-DeployStep -Label "API Worker" -Dir $ApiDir -Action {
        Write-Host "[INFO] Running npx wrangler deploy..." -ForegroundColor DarkCyan
        npx wrangler deploy
    }
}

# ── Deploy Ingestion Worker ───────────────────────────────────────────────────
if (-not $FrontendOnly -and -not $SkipIngestion) {
    Invoke-DeployStep -Label "Ingestion Worker" -Dir $IngestionDir -Action {
        Write-Host "[INFO] Running npx wrangler deploy..." -ForegroundColor DarkCyan
        npx wrangler deploy
    }
}

# ── Build + Deploy Frontend ───────────────────────────────────────────────────
if (-not $ApiOnly) {
    Invoke-DeployStep -Label "Frontend Build" -Dir $FrontendDir -Action {
        Write-Host "[INFO] Running npm run build..." -ForegroundColor DarkCyan
        npm run build
    }

    if ($results["Frontend Build"] -eq "OK") {
        Invoke-DeployStep -Label "Frontend Deploy (Pages)" -Dir $FrontendDir -Action {
            Write-Host "[INFO] Running wrangler pages deploy dist..." -ForegroundColor DarkCyan
            npx wrangler pages deploy dist --project-name wow-market-frontend
        }
    } else {
        Write-Host "[SKIP] Skipping Pages deploy because build failed." -ForegroundColor Yellow
        $results["Frontend Deploy (Pages)"] = "SKIPPED"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
$totalElapsed = [Math]::Round(((Get-Date) - $deployStart).TotalSeconds, 1)

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Deploy Summary (${totalElapsed}s total)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
foreach ($step in $results.Keys) {
    $status = $results[$step]
    $color = switch ($status) {
        "OK"      { "Green" }
        "SKIPPED" { "DarkGray" }
        default   { "Red" }
    }
    Write-Host ("  {0,-30} {1}" -f $step, $status) -ForegroundColor $color
}

$failed = $results.Values | Where-Object { $_ -notin @("OK", "SKIPPED") }
Write-Host ""
if ($failed.Count -gt 0) {
    Write-Host "  [RESULT] Deploy completed with errors." -ForegroundColor Red
    Write-Host "           Check output above for details." -ForegroundColor DarkGray
    exit 1
} else {
    Write-Host "  [RESULT] All deployments succeeded!" -ForegroundColor Green
    Write-Host ""

    if ($results["Frontend Deploy (Pages)"] -eq "OK") {
        Write-Host "  Your app is live on Cloudflare Pages." -ForegroundColor White
        Write-Host "  Check: https://dash.cloudflare.com → Workers & Pages" -ForegroundColor DarkGray
    }
    if ($results["API Worker"] -eq "OK") {
        Write-Host ""
        Write-Host "  Tip: tail live API logs with:" -ForegroundColor DarkGray
        Write-Host "    wrangler tail wow-market-api" -ForegroundColor DarkGray
    }
    if ($results["Ingestion Worker"] -eq "OK") {
        Write-Host "  Tip: tail ingestion logs with:" -ForegroundColor DarkGray
        Write-Host "    wrangler tail wow-market-ingestion" -ForegroundColor DarkGray
    }
}
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
