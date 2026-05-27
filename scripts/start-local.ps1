$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Write-Info    { Write-Host "[INFO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warn    { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Err     { Write-Host "[ERROR] $args" -ForegroundColor Red }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Blue
Write-Host "  Trading OS - Local Startup (PowerShell)" -ForegroundColor Blue
Write-Host "==================================================" -ForegroundColor Blue
Write-Host ""

# Docker check
try { docker --version | Out-Null; Write-Success "Docker gevonden" }
catch { Write-Err "Docker niet gevonden. Installeer Docker Desktop: https://www.docker.com/products/docker-desktop"; exit 1 }

try { docker compose version | Out-Null; Write-Success "Docker Compose gevonden" }
catch { Write-Err "Docker Compose niet gevonden. Update Docker Desktop."; exit 1 }

# .env check
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Warn ".env niet gevonden, kopieer van .env.example..."
        Copy-Item ".env.example" ".env"
        Write-Success ".env aangemaakt"
    } else {
        Write-Err ".env.example niet gevonden."; exit 1
    }
} else { Write-Success ".env gevonden" }

# Memory directories
Write-Info "Memory directories aanmaken..."
$dirs = @("raw","trades","lessons","pending-rules","active-rules","rejected-rules","sources","strategies","reflections","daily","weekly")
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path "memory\$d" | Out-Null }
Write-Success "Memory directories klaar"

# Build and start
Write-Info "Docker images bouwen..."
docker compose build --parallel
Write-Success "Images gebouwd"

Write-Info "Containers starten..."
docker compose up -d
Write-Success "Containers gestart"

Write-Info "Wachten 30 seconden op services..."
Start-Sleep 30

# Migrations
Write-Info "Database migrations uitvoeren..."
$tries = 0
do {
    $result = docker compose exec -T api python -m alembic -c app/migrations/alembic.ini upgrade head 2>&1
    if ($LASTEXITCODE -eq 0) { break }
    $tries++
    if ($tries -ge 20) { Write-Err "Migrations mislukt."; break }
    Write-Warn "Wachten op database... ($tries/20)"
    Start-Sleep 5
} while ($true)
Write-Success "Migrations uitgevoerd"

# Health check
Write-Info "Backend health check..."
$tries = 0
do {
    try { $resp = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 3; break }
    catch { $tries++; if ($tries -ge 20) { Write-Warn "Backend timeout"; break }; Write-Warn "Wachten... ($tries/20)"; Start-Sleep 5 }
} while ($true)

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Trading OS draait!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:  http://localhost:3000"
Write-Host "  API:        http://localhost:8000"
Write-Host "  API Docs:   http://localhost:8000/docs"
Write-Host ""

Start-Process "http://localhost:3000"
