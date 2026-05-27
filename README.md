# Trading OS — Trading Intelligence Platform

Een volledig lokaal draaiend Trading Intelligence Operating System voor persoonlijk gebruik.

## Snel starten

### Windows (aanbevolen)
```batch
start-local.bat
```

### PowerShell
```powershell
.\start-local.ps1
```

### Linux / macOS
```bash
chmod +x start-local.sh scripts/*.sh
./start-local.sh
```

## Vereisten

- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- Geen andere installaties nodig (alles draait in Docker)

## Stap-voor-stap

1. Zorg dat Docker Desktop draait
2. Het startscript maakt automatisch `.env` van `.env.example`
3. Vul je API keys in `.env` in (zie sectie hieronder)
4. Voer het startscript uit
5. Dashboard opent op http://localhost:3000

## API Keys

Vul in `.env` in om functies te activeren:

| Key | Waar te krijgen | Verplicht voor |
|-----|----------------|----------------|
| `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` | https://alpaca.markets/ | Paper trading |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/ | AI analyse |
| `OPENAI_API_KEY` | https://platform.openai.com/ | AI fallback |
| `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | https://www.reddit.com/prefs/apps | Social monitoring |
| `X_BEARER_TOKEN` | https://developer.twitter.com/ | Social monitoring |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Telegram `@BotFather` | Safety- en intelligence-alerts |

Het systeem start ook **zonder** API keys. Modules zonder keys tonen een duidelijke melding.

## URLs na opstarten

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
| Qdrant | http://localhost:6333/dashboard |

## Veiligheid

- Standaard: `TRADING_MODE=paper` — alleen paper trading via Alpaca
- Standaard: `LIVE_TRADING_ENABLED=false` — live trading hard geblokkeerd
- Elke order gaat altijd eerst door de Risk Engine
- Kill switch activeerbaar via dashboard

## Stoppen

```batch
stop-local.bat
```

Containers stoppen netjes, volumes en memory blijven intact.

## Resetten

```batch
reset-local.bat
```

Vraagt bevestiging, verwijdert optioneel volumes en memory.

## Logs bekijken

```bash
docker compose logs -f
docker compose logs -f api
docker compose logs -f web
```

## Projectstructuur

```
trading-os/
  apps/
    api/          # Python FastAPI backend (poort 8000)
    web/          # Next.js frontend (poort 3000)
  memory/         # Markdown memory systeem
  docs/           # Volledige documentatie
  scripts/        # Start/stop/reset scripts
  docker-compose.yml
  .env.example
```

## Features

- **Dashboard** — Systeemstatus, account, signals, nieuws, audit
- **Portfolio** — Alpaca posities en account info
- **Orders** — Paper orders plaatsen en annuleren, risk check resultaat
- **Signals** — AI-gegenereerde trading signals met paper trade knop
- **Performance** — Objectieve shadow-outcomes van signalen na 1 en 5 handelsdagen
- **Rumour Radar** — Geruchten uit nieuws en social media
- **Nieuws** — RSS feed ingestie en analyse
- **Social** — Reddit en X monitoring
- **AI War Room** — Bull/Bear/Risk/Strategy agent analyses
- **Memory** — Pending rules goedkeuren/afwijzen, active rules
- **Audit** — Volledig auditlog van alle systeemgebeurtenissen
- **Alerts** — Telegram-meldingen en lokaal notificatielog voor safety-, signal- en outcome-events
- **Instellingen** — Integratiestatus, risk limieten, kill switch

## Disclaimer

Dit systeem garandeert geen winst. Alle AI-analyses zijn ter ondersteuning, geen garantie.
Het systeem is risk-first: bij twijfel geeft het NO TRADE, WATCH of REQUIRE CONFIRMATION.
