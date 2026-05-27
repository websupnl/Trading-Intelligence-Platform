@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"

echo.
echo ==================================================
echo   Trading OS - RESET (Windows)
echo ==================================================
echo.
echo WAARSCHUWING: Dit verwijdert alle containers en database data!
echo.
set /p confirm="Typ RESET om te bevestigen: "
if /i NOT "%confirm%"=="RESET" (
    echo Reset geannuleerd.
    pause
    exit /b 0
)

echo Containers stoppen...
docker compose down

echo.
set /p removevols="Verwijder ook database volumes? (j/n): "
if /i "%removevols%"=="j" (
    echo Volumes verwijderen...
    docker compose down -v
    echo Volumes verwijderd.
)

echo.
set /p wipemem="Wis ook memory bestanden? (j/n): "
if /i "%wipemem%"=="j" (
    echo Memory wissen...
    del /s /q "%PROJECT_ROOT%\memory\trades\*.md" 2>nul
    del /s /q "%PROJECT_ROOT%\memory\reflections\*.md" 2>nul
    del /s /q "%PROJECT_ROOT%\memory\daily\*.md" 2>nul
    del /s /q "%PROJECT_ROOT%\memory\weekly\*.md" 2>nul
    del /s /q "%PROJECT_ROOT%\memory\pending-rules\*.md" 2>nul
    del /s /q "%PROJECT_ROOT%\memory\active-rules\*.md" 2>nul
    del /s /q "%PROJECT_ROOT%\memory\rejected-rules\*.md" 2>nul
    echo Memory gewist.
)

echo.
echo Reset voltooid. Start opnieuw met: start-local.bat
pause
