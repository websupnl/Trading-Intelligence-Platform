# Trading Intelligence Platform — TODO

> Bijgehouden voor Claude-sessies. Werk van boven naar beneden af.
> Volledige doorontwikkeling naar het Market Intelligence OS staat in `docs/market-intelligence-roadmap.md`.

---

## ✅ Gereed

### Infrastructuur & Deployment
- [x] FastAPI backend + Next.js frontend in Docker Compose (prod)
- [x] Coolify deployment via Traefik reverse proxy
- [x] Cloudflare DNS wildcard `*.onlinewerkplek.cloud → 82.180.155.249`
- [x] TimescaleDB (PostgreSQL), Redis, Qdrant volumes
- [x] Celery worker + beat scheduler
- [x] Alembic migraties (`001_initial`, `002_signal_outcomes`)
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
- [x] evaluate-signal-outcomes: elk uur

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
- [x] Performance pagina met signal-outcomes en SPY-vergelijking

### Veiligheid
- [x] Kill switch (runtime + UI)
- [x] Paper mode guard in auto trader
- [x] Risk engine check vóór elke order
- [x] Audit log bij alle kritieke acties

---

## ✅ Prioriteit 1 — Controle & Beheer (GEDAAN in sessie 2)

### 1. Runtime Settings ✅
- [x] `PATCH /api/settings/runtime` — live toggles voor `require_manual_confirmation`, `live_trading_enabled`
- [x] Settings pagina: toggle switches voor kill switch, live trading, handmatige bevestiging
- [x] lru_cache bug gefixed via runtime overrides
- [x] Runtime safety settings permanent opslaan in bestaande `settings`-tabel en herstellen naar Redis

### 2. Signal review panel ✅
- [x] Bull/Bear debate per signaal (3-stap Claude debat)
- [x] Filter tabs: pending / getraded / afgewezen
- [x] Approve / Reject knoppen per signaal
- [x] AI reasoning zichtbaar per signaal (uitklappen)

### 3. Pipeline control panel ✅
- [x] `GET /api/pipeline/status` — alle 8 taken met schedule info
- [x] `POST /api/pipeline/trigger/{key}` — handmatig triggeren
- [x] Nieuwe Pipeline pagina in frontend met snelstart knoppen
- [x] Pipeline link in sidebar

### 4. Trade tracker & P&L ✅
- [x] `TradeTrackerService` — sync Alpaca orders naar Trade tabel
- [x] P&L berekening per gesloten trade
- [x] AI reflectie na elke gesloten trade
- [x] MemoryEntry aanmaken met trade les
- [x] Performance stats: win rate, avg P&L, profit factor, P&L grafiek

### 5. Close position knoppen ✅
- [x] "Sluit" knop per open positie
- [x] "Sluit Alles" noodknop
- [x] `POST /api/trading/close-position/{symbol}`
- [x] `POST /api/trading/close-all`

### 6. PIN beveiliging ✅
- [x] `DASHBOARD_PIN` env var
- [x] Middleware in FastAPI (X-Dashboard-Pin header)
- [x] PinGate component in frontend
- [x] Uitloggen knop in sidebar

### 7. Mobile friendly ✅
- [x] Mobile bottom navigation bar
- [x] Hamburger menu in TopBar
- [x] Responsive grid layouts (md: breakpoints)
- [x] Touch-friendly tap targets

### 8. AI War Room ✅
- [x] Bull/Bear debate zichtbaar per signaal
- [x] Score bars voor bull vs bear
- [x] TA indicators, prijsniveaus, risico's
- [x] Genereer Signalen knop

### 9. Audit logging uitgebreid ✅
- [x] Auto-trader logt elke beslissing
- [x] Signal generator logt elk gegenereerd signaal
- [x] Trade tracker logt sync + reflecties
- [x] Audit pagina met filter tabs + detail uitklap

### 10. Memory pagina ✅
- [x] Trade lessen tab (uit MemoryEntry)
- [x] Uitklap met les, confidence assessment, regelvoorstel
- [x] Zoekfunctie

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
- [x] Signal Performance pagina met 1d/5d shadow-outcomes, MFE/MAE en SPY-benchmark
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

- [x] Kill switch runtime state gedeeld via Redis en duurzaam opgeslagen in database
- [ ] `ALPACA_BASE_URL` moet zonder `/v2` zijn in Coolify env vars
- [ ] `CORS_ORIGINS` instellen in Coolify: `https://n08w4cgkko4kcwwsockckkg0.onlinewerkplek.cloud`
- [ ] `ANTHROPIC_ENABLE_WEB_SEARCH=true` instellen in Coolify voor web search in chat
- [ ] Na eerste deploy: `POST /api/news/trigger-pipeline` uitvoeren om data te seeden
- [ ] Alembic migratie toevoegen voor Watchlist na implementatie
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
