# Setup Gids

## Vereisten

- Docker Desktop — https://www.docker.com/products/docker-desktop
- Minimaal 4GB RAM beschikbaar voor Docker
- Minimaal 10GB schijfruimte

## Starten op Windows

1. Installeer en start Docker Desktop
2. Open Terminal of Command Prompt in de projectmap
3. Voer uit:
   ```batch
   start-local.bat
   ```
   Of via PowerShell:
   ```powershell
   .\start-local.ps1
   ```

## Starten op Linux / macOS

```bash
chmod +x start-local.sh scripts/*.sh
./start-local.sh
```

## .env invullen

Het startscript maakt automatisch `.env` van `.env.example`.
Open `.env` en vul de gewenste keys in.

### Minimale configuratie (paper trading):
```env
ALPACA_API_KEY=jouw_alpaca_key
ALPACA_SECRET_KEY=jouw_alpaca_secret
```

### Met AI analyse:
```env
ANTHROPIC_API_KEY=jouw_anthropic_key
```

### Met social monitoring:
```env
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
X_BEARER_TOKEN=...
```

### Met Telegram alerts:
```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Maak de bot via Telegram `@BotFather`, stuur hem eerst een bericht en haal daarna je
`chat.id` op via `https://api.telegram.org/bot<token>/getUpdates`. In de app kun je
de verbinding testen via **Alerts**.

## Dashboard openen

Na succesvol starten: http://localhost:3000

Het startscript opent de browser automatisch.

## Stoppen

```batch
stop-local.bat
```
Of: `./stop-local.sh`

Containers stoppen netjes. Volumes en memory blijven intact.

## Resetten

```batch
reset-local.bat
```

Vraagt bevestiging voor het verwijderen van containers, volumes en memory.

## Problemen oplossen

### Docker niet gevonden
Installeer Docker Desktop en zorg dat het actief is (icoon in systeemvak).

### Port al in gebruik
Controleer of poorten 3000, 8000, 5432, 6379, 6333 vrij zijn.

```bash
# Windows
netstat -ano | findstr :8000
# Linux/macOS
lsof -i :8000
```

### Migrations mislukken
```bash
docker compose logs api
docker compose exec api python -m alembic -c app/migrations/alembic.ini upgrade head
# Verwachte huidige head: 004_token_usage
```

### Frontend niet bereikbaar
```bash
docker compose logs web
docker compose restart web
```

### API start niet
```bash
docker compose logs api
docker compose restart api
```
