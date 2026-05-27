@echo off
setlocal enabledelayedexpansion
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"

echo.
echo ==================================================
echo   Trading OS - Local Startup (Windows)
echo ==================================================
echo.

REM Check Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker niet gevonden.
    echo.
    echo   Installeer Docker Desktop: https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)
echo [OK] Docker gevonden

REM Check Docker Compose
docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Compose plugin niet gevonden.
    echo   Update Docker Desktop naar de nieuwste versie.
    pause
    exit /b 1
)
echo [OK] Docker Compose gevonden

REM Check .env
if not exist ".env" (
    if exist ".env.example" (
        echo [WARN] .env niet gevonden, kopieer van .env.example...
        copy ".env.example" ".env"
        echo [OK] .env aangemaakt
        echo.
        echo   Vul de API keys in .env in voordat je verdergaat.
        echo   Minimaal aanbevolen: ALPACA_API_KEY, ANTHROPIC_API_KEY
        echo.
    ) else (
        echo [ERROR] .env.example niet gevonden.
        pause
        exit /b 1
    )
) else (
    echo [OK] .env gevonden
)

REM Create memory directories
echo [INFO] Memory directories aanmaken...
for %%d in (raw trades lessons pending-rules active-rules rejected-rules sources strategies reflections daily weekly) do (
    if not exist "memory\%%d" mkdir "memory\%%d"
)
echo [OK] Memory directories klaar

REM Build and start
echo [INFO] Docker images bouwen...
docker compose build --parallel
if %errorlevel% neq 0 (
    echo [ERROR] Docker build mislukt.
    pause
    exit /b 1
)
echo [OK] Docker images gebouwd

echo [INFO] Containers starten...
docker compose up -d
if %errorlevel% neq 0 (
    echo [ERROR] Containers konden niet starten.
    pause
    exit /b 1
)
echo [OK] Containers gestart

echo [INFO] Wachten op services (30 seconden)...
timeout /t 30 /nobreak >nul

REM Run migrations
echo [INFO] Database migrations uitvoeren...
set "TRIES=0"
:migration_loop
docker compose exec -T api python -m alembic -c app/migrations/alembic.ini upgrade head 2>nul
if %errorlevel% equ 0 goto migration_done
set /a TRIES+=1
if %TRIES% geq 20 (
    echo [ERROR] Migrations mislukt. Bekijk: docker compose logs api
    pause
    exit /b 1
)
echo [WARN] Wachten op database... (%TRIES%/20)
timeout /t 5 /nobreak >nul
goto migration_loop
:migration_done
echo [OK] Database migrations uitgevoerd

REM Health checks
echo [INFO] Health checks uitvoeren...
set "TRIES=0"
:health_loop
curl -sf http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 goto health_done
set /a TRIES+=1
if %TRIES% geq 20 (
    echo [WARN] Backend timeout. Bekijk: docker compose logs api
    goto show_urls
)
echo [WARN] Wachten op backend... (%TRIES%/20)
timeout /t 5 /nobreak >nul
goto health_loop
:health_done
echo [OK] Backend bereikbaar

:show_urls
echo.
echo ==================================================
echo   Trading OS draait!
echo ==================================================
echo.
echo   Dashboard:     http://localhost:3000
echo   API:           http://localhost:8000
echo   API Docs:      http://localhost:8000/docs
echo.
echo   Logs:          docker compose logs -f
echo   Stoppen:       stop-local.bat
echo.

start http://localhost:3000

pause
