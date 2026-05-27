# Trading Intelligence Platform — CHANGELOG

> **Conventie:** elke sessie voegt een blok toe bovenaan. Formaat: `## [datum] Samenvatting`.
> Doel: volgende LLM weet wat er al gedaan is zonder de hele codebase te lezen.

---

## [2026-05-27] Sessie 4 - Light Theme, Asset Labels, Safety Foundation

### Nieuw
- Licht "research desk" thema met groene accenten voor dashboard en Live Session.
- Centrale `AssetLabel` UI-component met volledige namen voor veelgebruikte instrumenten.
- `GET /api/trading/asset/{symbol}` voor dynamische Alpaca-assetnamen.
- Volledige Market Intelligence OS roadmap in `docs/market-intelligence-roadmap.md`.

### Veiligheid en fixes
- Kill switch en runtime safety controls via Redis gedeeld tussen API en Celery worker.
- Kill switch meldt een fout wanneer bevestiging door de worker niet kan worden gegarandeerd.
- Runtime safety controls worden permanent opgeslagen in `settings` en bij API-start naar Redis hersteld.
- Handmatige confirmation wordt nu afgedwongen voor paper-orders en signal-orders.
- Auto trader voert signalen met vereiste handmatige goedkeuring niet automatisch uit.
- Handmatige, signal-, auto- en noodorders worden centraal als lokale `Order` vastgelegd.
- Posities sluiten gebruikt een exit-only Alpaca liquidatieflow, inclusief shortposities.
- Signal API retourneert War Room analysevelden; chat signaltool gebruikt het juiste datamodel.
- Live Session behandelt `buy` correct als long en gebruikt de bestaande quote response.

### Outcome Engine
- Nieuwe migratie `002_signal_outcomes.py` en API `/api/outcomes/*` voor meetbare signaaluitkomsten.
- Dagelijkse shadow-evaluatie op 1 en 5 handelsdagen met MFE/MAE en optionele SPY-overperformance.
- Nieuwe pagina `/performance` met gerealiseerde trade-P&L naast hit rate, gemiddelde shadow-outcome en per-asset resultaten.
- Dashboard toont automation-status, performance-snapshot en een iedere 30 seconden ververste AI-feedbackfeed.
- Memory API levert de opgeslagen lesinhoud terug, zodat AI-reflecties daadwerkelijk uitklapbaar zijn.
- Celery en pipeline voeren outcome-evaluatie ieder uur uit; marktdata verzamelt hiervoor recente signaalassets en SPY.

### Telegram Alerts
- Nieuwe migratie `003_notifications.py`, notificatieservice en API `/api/notifications/*`.
- Telegram is optioneel configureerbaar via `TELEGRAM_BOT_TOKEN` en `TELEGRAM_CHAT_ID`; afleverfouten blokkeren trading niet.
- Alerts worden aangemaakt voor kill switch, signalen, order/liquidatie, hoog-impact nieuws, AI trade-lessen en eerste complete 5d-outcome.
- Nieuwe pagina `/notifications` met afleverhistorie en testberichtknop; status is zichtbaar in Settings en Systeemstatus.

## [2026-05-27] Sessie 3 — Live Session, Build Fix, Mobile

### Nieuw
- **Live Session pagina** (`/live`) — Bloomberg Terminal-stijl real-time trading interface
  - `apps/web/app/live/page.tsx` — SSE-driven full-screen trading UI
  - `apps/web/components/live/CandlestickChart.tsx` — TradingView Lightweight Charts v4 met EMA-20, volume bars, signal markers
  - `apps/web/hooks/useSSE.ts` — SSE hook met exponentiële reconnect backoff
  - Live candlestick grafiek per symbool (AAPL/NVDA/TSLA tabs)
  - AI Activiteit feed (real-time stroom van wat de AI doet)
  - Pending signals met approve/reject direct in de pagina
  - Quick Trade panel (buy/sell, live quote, totaalberekening)
  - Portfolio samenvatting in header (equity + dag P&L)

- **SSE stream backend** (`apps/api/app/api/stream.py`) — al gecommit in vorige sessie
  - `GET /api/stream/session?symbols=AAPL,NVDA,TSLA` — Server-Sent Events
  - Event types: `chart_data`, `price`, `signals`, `new_signal`, `activity_batch`, `portfolio`, `heartbeat`, `error`
  - `GET /api/stream/candles/{symbol}` — OHLCV data voor chart

### Fixes
- **Build fix:** `npm install` faalde in Docker (geen lock file) → `package-lock.json` aangemaakt, Dockerfile geüpdatet naar `npm ci --legacy-peer-deps`
- **TypeScript:** `Button` component onClick type verbreed naar `MouseEvent` zodat `e.stopPropagation()` werkt
- **lightweight-charts v4 API:** `addSeries(CandlestickSeries)` → `addCandlestickSeries()` (v5 API was verkeerd)

### Configuratie
- `apps/api/app/main.py` — stream router geregistreerd
- `apps/web/components/layout/Sidebar.tsx` — Live Session link toegevoegd (desktop + mobiel)
- `apps/web/package.json` — `lightweight-charts ^4.2.0` toegevoegd

---

## [2026-05-27] Sessie 2 — Handmatige Controls, AI Transparantie, P&L, PIN Auth, Mobile

### Nieuw
- **Bull/Bear debate** in `signal_generator.py` — 3 Claude calls: bull agent → bear agent → finale beslissing. Resultaat in `signal.ai_analysis`
- **Trade Tracker** (`services/trade_tracker.py`) — synct Alpaca orders naar Trade tabel, berekent P&L, schrijft Claude reflectie, maakt MemoryEntry aan
- **Pipeline control panel** (`/pipeline`) — alle 8 Celery taken, handmatig triggeren, schedules zichtbaar
- **PIN beveiliging** — `DASHBOARD_PIN` env var, FastAPI middleware (`X-Dashboard-Pin` header), PinGate React component
- **Mobile UI** — bottom navigation bar, hamburger menu in TopBar, responsive grids
- **Runtime settings** — `PATCH /api/settings/runtime` voor live/manual toggles zonder restart (lru_cache bug gefixed via `object.__setattr__`)
- **Close position knoppen** — per positie en "Sluit Alles" noodknop
- **AI War Room** — echte Bull/Bear debate scores uit `signal.ai_analysis`, ScoreBar component
- **Audit pagina** — filter tabs, detail uitklap, AI-beslissingen gelogd
- **Memory pagina** — trade lessen, pending rules, zoekfunctie
- **Performance stats** — win rate, P&L grafiek, profit factor

### Backend endpoints (nieuw)
- `GET /api/trading/quote/{symbol}` — live koers
- `POST /api/trading/close-position/{symbol}` — sluit positie
- `POST /api/trading/close-all` — sluit alle posities
- `GET /api/trading/trades` — trade geschiedenis
- `GET /api/trading/performance` — statistieken
- `POST /api/trading/sync-trades` — sync Alpaca orders
- `GET /api/pipeline/status` — Celery task status
- `POST /api/pipeline/trigger/{key}` — task triggeren
- `GET /api/stream/session` — SSE live stream (nieuw in sessie 3)

### Fixes
- lru_cache bug: kill switch / trading mode wissel werkt nu via `object.__setattr__`
- Auto trader logt nu elke beslissing naar AuditLog
- Trade records worden nu aangemaakt na elke order

---

## [2026-05-26] Sessie 1 — Initiële Platform Opzet

### Infrastructuur
- FastAPI backend + Next.js 14 frontend in Docker Compose
- TimescaleDB (PostgreSQL), Redis, Qdrant, Celery worker + beat
- Alembic migraties (`001_initial`)
- Coolify deployment via Traefik reverse proxy
- Cloudflare DNS wildcard `*.onlinewerkplek.cloud → 82.180.155.249`

### Data Ingestie (Celery taken)
- RSS ingestie — 28 ingebouwde feeds (Reuters, CNBC, Yahoo, Bloomberg, FT, CoinDesk, Reddit RSS)
- Reddit scraper (publieke JSON endpoint, geen API-key)
- Alpaca OHLCV bars (daily candles, elke 15 min)

### AI Pipeline
- Claude sentiment analyse op nieuws + social posts
- Pure-Python TA: RSI (Wilder), MACD (12/26/9), EMA-20, volume ratio
- Signal generator (sentiment + TA + social → Claude reasoning)
- Rumour detector (cross-source, 72h expiry)
- Auto paper trader (confidence ≥ 0.78, alleen paper mode)

### UI Pagina's
- Dashboard, Nieuws, Signalen, Social, Rumour Radar, Portfolio/Orders, AI War Room (placeholder), Settings (read-only)
- Floating chat panel (SSE streaming, Claude tool use)
- Kill switch knop

---

## Architectuur Overzicht

```
Docker Compose services:
  postgres     — TimescaleDB (port 5432)
  redis        — Cache + Celery broker (port 6379)
  qdrant       — Vector DB voor memory (port 6333)
  api          — FastAPI (port 8000)
  worker       — Celery worker (4 concurrency)
  scheduler    — Celery beat
  web          — Next.js (port 3000)

API: https://wo0kc480k480gosww0s8wgw8.onlinewerkplek.cloud
Web: https://n08w4cgkko4kcwwsockckkg0.onlinewerkplek.cloud
```

## Vereiste env vars (Coolify)

```
CORS_ORIGINS=https://n08w4cgkko4kcwwsockckkg0.onlinewerkplek.cloud
NEXT_PUBLIC_API_URL=https://wo0kc480k480gosww0s8wgw8.onlinewerkplek.cloud
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ANTHROPIC_ENABLE_WEB_SEARCH=true
DASHBOARD_PIN=<jouw PIN>
MEMORY_DIR=/app/memory
REQUIRE_MANUAL_CONFIRMATION=true
LIVE_TRADING_ENABLED=false
TELEGRAM_BOT_TOKEN=<optioneel>
TELEGRAM_CHAT_ID=<optioneel>
```

## Bekende beperkingen / TODO

- Runtime safety settings zijn inmiddels persistent in `settings` en gedeeld via Redis
- Watchlist beheer UI nog niet gebouwd
- Telegram notificaties zijn inmiddels gebouwd; credentials moeten nog per deployment ingesteld worden
- Backtesting module nog niet gebouwd
- Alembic migratie voor Watchlist is nodig zodra die module wordt gebouwd
- Reddit scraper kan rate-limited worden — retry logica ontbreekt
