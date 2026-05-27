@echo off
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"
echo Trading OS stoppen...
docker compose stop
echo Containers gestopt. Volumes en memory intact.
pause
