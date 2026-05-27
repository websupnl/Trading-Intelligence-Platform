# Trading Intelligence Platform — TODO

> Bijgehouden voor Claude-sessies. Werk van boven naar beneden af.

---

## ✅ Gereed

### Infrastructuur & Deployment
- [x] FastAPI backend + Next.js frontend in Docker Compose (prod)
- [x] Coolify deployment via Traefik reverse proxy
- [x] Cloudflare DNS wildcard `*.onlinewerkplek.cloud → 82.180.155.249`
- [x] TimescaleDB (PostgreSQL), Redis, Qdrant volumes
- [x] Celery worker + beat scheduler
- [x] Alembic migraties (`001_initial`)
- [x] CORS via env var `CORS_ORIGINS` (geen hardcode meer)
- [x] `NEXT_PUBLIC_API_URL` als build-arg in web Dockerfile

### Data Ingestie
- [x] RSS ingestie met 28 ingebouwde feeds (Reuters, CNBC, Yahoo, Bloomberg, FT, CoinDesk, Reddit RSS, etc.)
- [x] Reddit scraper zonder API-key (publieke JSON endpoint)
- [x] Market data service (Alpaca OHLCV bars, DB dedup)

### AI Analyse Pipeline
- [x] Claude-powered batch nieuws + social sentiment analyse
- [x] Pure-Python technische analyse: RSI (Wilder), MACD (12/26/9), EMA-20, volume ratio
- [x] Multi-factor signal generator (sentiment + TA + social → Claude reasoning)
- [x] Rumour detector (cross-source, 72h expiry)
- [x] Auto paper trader (confidence ≥ 0.78, paper mode only)

### Celery Taken (7 scheduled jobs)
- [x] ingest-news: elke 15 min
- [x] fetch-reddit: elke 30 min
- [x] analyze-content (Claude): elke 5 min
- [x] detect-rumours: elke 30 min
- [x] fetch-market-data: elk uur
- [x] generate-signals: elke 15 min
- [x] auto-trade: elke 5 min

### UI
- [x] Dashboard (portfolio overzicht, status grid)
- [x] Nieuws pagina
- [x] Signalen pagina
- [x] Social pagina
- [x] Rumour Radar
- [x] Portfolio / Orders
- [x] AI War Room
- [x] Settings pagina (read-only weergave)
- [x] Floating chat panel (SSE streaming, Claude tool use)
- [x] Kill switch knop in UI

### Veiligheid
- [x] Kill switch (runtime + UI)
- [x] Paper mode guard in auto trader
- [x] Risk engine check vóór elke order
- [x] Audit log bij alle kritieke acties

---

## 🔴 Prioriteit 1 — Controle & Beheer (volgende sessie)

### 1. Levende instellingen in database
- [ ] `SystemSettings` tabel in DB (key/value, typed)
- [ ] Risk limieten opslaan: `max_position_size_usd`, `max_trades_per_day`, `max_open_positions`, `auto_trader_confidence_threshold`
- [ ] Module toggles opslaan: `auto_trader_enabled`, `news_ingestion_enabled`, `reddit_enabled`, `signal_generation_enabled`
- [ ] Settings API: `GET /api/settings/runtime` + `PATCH /api/settings/runtime`
- [ ] Settings pagina: bewerkbare velden + opslaan knop (geen redeploy nodig)

### 2. Signal review panel
- [ ] Tabel van pending signalen met: ticker, richting, confidence, reden, TA samenvatting
- [ ] Approve / Reject knoppen per signaal
- [ ] Status: `pending → approved/rejected → executed`
- [ ] Toggle: "volledig automatisch" vs "handmatige goedkeuring vereist"
- [ ] Backend: `PATCH /api/signals/{id}/approve` + `/reject`

### 3. Handmatige trade UI
- [ ] Buy/Sell form: symbol, qty, order type (market/limit), price
- [ ] Realtime prijs ophalen bij invullen symbol
- [ ] Order bevestiging modal
- [ ] Backend: `POST /api/trading/manual-order`
- [ ] Koppeling aan Alpaca broker service

### 4. Pipeline control panel
- [ ] Overzicht van alle 7 Celery taken: naam, laatste run, volgende run, status
- [ ] Per taak: "Nu triggeren" knop
- [ ] Per taak: pauzeren / hervatten toggle
- [ ] Backend: `GET /api/pipeline/status` + `POST /api/pipeline/{task}/trigger` + `POST /api/pipeline/{task}/toggle`
- [ ] Celery task status via Redis/result backend

---

## 🟡 Prioriteit 2 — Functionaliteit

### 5. Watchlist beheer
- [ ] Tickers toevoegen/verwijderen die actief gemonitord worden
- [ ] `Watchlist` tabel in DB
- [ ] Market data + signalen gefilterd op watchlist
- [ ] UI: watchlist pagina met toevoeg/verwijder knoppen
- [ ] Backend: `GET/POST/DELETE /api/watchlist`

### 6. Notificaties
- [ ] Telegram bot integratie (optioneel, via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`)
- [ ] Triggers: nieuw signaal gegenereerd, order uitgevoerd, kill switch geactiveerd, hoge-impact nieuws
- [ ] Notificatie service in backend
- [ ] Notificatie log in UI (bell icon in TopBar)

### 7. Performance tracking
- [ ] `StrategyPerformance` tabel vullen na elke gesloten positie
- [ ] Win rate, avg P&L, avg R:R per strategie berekenen
- [ ] Performance pagina in UI met statistieken en grafiek
- [ ] Vergelijk auto-trader prestaties per tijdsperiode

### 8. Positie management vanuit UI
- [ ] "Sluit positie" knop per open positie (market sell)
- [ ] "Sluit alles" noodknop naast kill switch
- [ ] Backend: `POST /api/trading/close-position/{symbol}`

---

## 🟢 Prioriteit 3 — Verbetering

### 9. Backtesting
- [ ] Historische candles laden (Alpaca free tier: 2 jaar)
- [ ] TA + signaallogica terugspelen op historische data
- [ ] Backtest rapport: trades, P&L curve, drawdown, Sharpe
- [ ] Vergelijk met buy-and-hold benchmark

### 10. Multi-timeframe analyse
- [ ] Huidige TA op 1D candles
- [ ] Toevoegen: 1H, 4H confluence
- [ ] Signaal alleen genereren als ≥ 2 timeframes aligned zijn

### 11. Betere Claude prompts
- [ ] System prompt met portfolio context (huidige posities, cash, dag P&L)
- [ ] Signaal generator prompt verbeteren met sector rotatie context
- [ ] Rumour detector: onderscheid hype vs. fundamenteel nieuws verbeteren

### 12. Flower (Celery monitor)
- [ ] Flower container toevoegen aan docker-compose.prod.yml
- [ ] Beveiligd achter Traefik (basic auth)
- [ ] Real-time taak monitoring, retry statistieken

---

## 🔧 Bekende issues / technische schuld

- [ ] Kill switch runtime change werkt niet (lru_cache probleem) — settings moeten uit DB komen (opgelost door punt 1)
- [ ] `ALPACA_BASE_URL` moet zonder `/v2` zijn in Coolify env vars
- [ ] `CORS_ORIGINS` instellen in Coolify: `https://n08w4cgkko4kcwwsockckkg0.onlinewerkplek.cloud`
- [ ] `ANTHROPIC_ENABLE_WEB_SEARCH=true` instellen in Coolify voor web search in chat
- [ ] Na eerste deploy: `POST /api/news/trigger-pipeline` uitvoeren om data te seeden
- [ ] Alembic migratie toevoegen voor nieuwe tabellen (SystemSettings, Watchlist) na punt 1+5
- [ ] Reddit JSON scraper kan rate-limited worden — fallback of retry logica toevoegen
- [ ] `social_tasks.py` mist nog Celery task registratie check

---

## 📋 Deploystatus

| Service | URL |
|---|---|
| Web (frontend) | `https://n08w4cgkko4kcwwsockckkg0.onlinewerkplek.cloud` |
| API (backend) | `https://wo0kc480k480gosww0s8wgw8.onlinewerkplek.cloud` |
| Coolify dashboard | via Cloudflare tunnel |

**Vereiste env vars in Coolify (api service):**
```
CORS_ORIGINS=https://n08w4cgkko4kcwwsockckkg0.onlinewerkplek.cloud
ANTHROPIC_ENABLE_WEB_SEARCH=true
ALPACA_BASE_URL=https://paper-api.alpaca.markets
NEXT_PUBLIC_API_URL=https://wo0kc480k480gosww0s8wgw8.onlinewerkplek.cloud
```
