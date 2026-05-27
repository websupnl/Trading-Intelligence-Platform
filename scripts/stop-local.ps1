$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
Write-Host "Trading OS stoppen..." -ForegroundColor Cyan
docker compose stop
Write-Host "Containers gestopt. Volumes en memory intact." -ForegroundColor Green
