# Coolify Deployment (VPS)

## Vereisten

- VPS met minimaal 2GB RAM (4GB aanbevolen)
- Coolify geïnstalleerd op je VPS
- Repo gepusht naar GitHub: https://github.com/websupnl/Trading-Intelligence-Platform

## Stap 1 — Juiste resource type kiezen

**Gebruik NIET "Create a new Application"** — dat is voor single-container apps.

In Coolify dashboard:
1. Klik **+ New Resource**
2. Kies **Docker Compose**
3. Koppel je GitHub repository
4. Zet **Docker Compose File** op `docker-compose.prod.yml`

## Stap 2 — Environment Variables instellen

Voeg deze variabelen toe via **Coolify → je project → Environment Variables**:

### Verplicht
```
POSTGRES_PASSWORD=kies_een_sterk_wachtwoord
SECRET_KEY=genereer_32_random_chars
NEXT_PUBLIC_API_URL=https://api.jouwdomein.nl
```

### Trading (standaard veilig)
```
TRADING_MODE=paper
LIVE_TRADING_ENABLED=false
REQUIRE_MANUAL_CONFIRMATION=true
KILL_SWITCH_ENABLED=false
```

### Database (automatisch geconfigureerd via docker-compose.prod.yml)
```
POSTGRES_DB=trading_os
POSTGRES_USER=trading_os
```

### API Keys (optioneel — systeem start ook zonder)
```
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
X_BEARER_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
NEWS_FEEDS=
CRYPTO_NEWS_FEEDS=
```

### Telegram koppelen

1. Open Telegram en stuur `/newbot` naar `@BotFather`.
2. Kies een naam en gebruikersnaam; bewaar de bot token als `TELEGRAM_BOT_TOKEN`.
3. Open je nieuwe bot en stuur zelf eerst een bericht, bijvoorbeeld `start`.
4. Open in de browser:
   ```text
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
   ```
5. Neem het nummer onder `message.chat.id` over als `TELEGRAM_CHAT_ID`.
6. Zet beide waarden in Coolify Environment Variables en redeploy `api` en `worker`.
7. Open na deployment de pagina **Alerts** en klik **Stuur testbericht**.

## Stap 3 — Domeinen instellen in Coolify

Coolify regelt automatisch SSL via Let's Encrypt.

| Service | Poort | Domein voorbeeld |
|---------|-------|-----------------|
| web | 3000 | dashboard.jouwdomein.nl |
| api | 8000 | api.jouwdomein.nl |

Stel in Coolify per service het domein in.

**Belangrijk:** Zet `NEXT_PUBLIC_API_URL=https://api.jouwdomein.nl` zodat de browser de API kan bereiken.

## Stap 4 — Eerste deployment

1. Klik **Deploy** in Coolify
2. Coolify bouwt alle images en start de containers
3. Na eerste start of na deze update, voer migrations uit via Coolify terminal:
   ```bash
   docker compose -f docker-compose.prod.yml exec api \
     python -m alembic -c app/migrations/alembic.ini upgrade head
   ```
   Of via Coolify's **Terminal** knop op de `api` service.
   De huidige head is `003_notifications`; deze bevat ook de eerdere outcome-migratie.

## Stap 5 — Verificatie

Bezoek je dashboard domein. De pagina moet laden en tonen:
- System status kaart
- Alpaca: "niet geconfigureerd" (totdat je keys invult)
- Anthropic: "niet geconfigureerd" (totdat je key invult)
- Telegram: "geconfigureerd" nadat de botwaarden zijn ingesteld; testbaar via **Alerts**

## Persistent volumes

`docker-compose.prod.yml` gebruikt named Docker volumes:
- `postgres_data` — database
- `redis_data` — cache
- `qdrant_data` — vector geheugen
- `memory_data` — markdown memory bestanden

Deze blijven bewaard bij herdeploys. Coolify beheert ze automatisch.

## Updates deployen

Bij elke push naar de `main` branch:
- Zet auto-deploy aan in Coolify (webhook)
- Of klik handmatig **Redeploy** in Coolify

## Veiligheidsnoten voor productie

- Stel nooit `LIVE_TRADING_ENABLED=true` in tenzij je weet wat je doet
- Gebruik een sterk `POSTGRES_PASSWORD` en `SECRET_KEY`
- Blokkeer poorten 5432, 6379, 6333 in je VPS firewall (alleen Docker intern nodig)
- Poorten 3000 en 8000 worden via Coolify's reverse proxy afgehandeld (geen directe expose nodig)
