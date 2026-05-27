$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "==================================================" -ForegroundColor Red
Write-Host "  Trading OS - RESET" -ForegroundColor Red
Write-Host "==================================================" -ForegroundColor Red
Write-Host ""
Write-Host "WAARSCHUWING: Dit verwijdert alle containers en database data!" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Typ 'RESET' om te bevestigen"
if ($confirm -ne "RESET") { Write-Host "Reset geannuleerd."; exit 0 }

docker compose down

$removeVols = Read-Host "Verwijder ook database volumes? (j/n)"
if ($removeVols -eq "j") { docker compose down -v; Write-Host "Volumes verwijderd." }

$wipeMem = Read-Host "Wis ook memory bestanden? (j/n)"
if ($wipeMem -eq "j") {
    Get-ChildItem "memory" -Filter "*.md" -Recurse | Remove-Item -Force
    Write-Host "Memory gewist."
}

Write-Host "Reset voltooid. Start opnieuw met: .\start-local.ps1"
