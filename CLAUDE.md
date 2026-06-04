# Trading Intelligence Platform — AI Context

Dit bestand wordt automatisch gelezen door Claude Code. Lees het volledig voor je begint.

## Doel van het project

Autonome trading bot die de eerste **+€1000 winst** op een **€1000 startkapitaal** moet maken.
Assets: crypto (BTC/ETH/SOL), aandelen (NVDA/TSLA/META etc.), meme coins (DOGE/AVAX/LINK etc.), geruchten.
Alles draait op **paper trading** — echte handel pas als `LIVE_TRADING_ENABLED=true` in Coolify.

De gebruiker (info@websup.nl) wil maximale autonomie: AI beslist alles, bot draait 24/7 zonder menselijke interventie. Gevoel van "er werkt een tweede ik fulltime voor mij".

---

## Stack

| Laag | Tech |
|------|------|
| API | FastAPI + SQLAlchemy async + PostgreSQL |
| Taken | Celery + Redis (Beat scheduler) |
| AI signalen | Claude claude-sonnet-4-6 |
| AI nieuws/social analyse | claude-haiku-4-5-20251001 |
| US stocks + crypto fallback | Alpaca Markets API |
| NL crypto (EUR pairs) | Bitvavo via CCXT |
| Frontend | Next.js 14 App Router + Tailwind |
| Hosting | Coolify — env vars beheerd via Coolify UI, NOOIT in code |

---

## Repo structuur

```
apps/
  api/                          FastAPI backend
    app/
      api/                      Route handlers
        gok.py                  /api/gok/* endpoints
        trading.py              /api/trading/*
        signals.py              /api/signals/*
        social.py               /api/social/* (Reddit + X.com fetch)
        settings.py             /api/settings/*
        (etc.)
      services/                 Core business logic
        auto_trader.py          Signalen → orders, broker routing
        position_monitor.py     SL/TP bewaking, trailing stop, batch price fetch
        signal_generator.py     AI signaal generatie, candle freshness check
        market_data_service.py  Alpaca + Bitvavo prijzen, candles, batch fetch
        risk_engine.py          Risk checks, correlatie clusters
        gok_session.py          Gok sessie: scan + execute (auto-execute bij score >= 0.75)
        market_regime.py        Bull/bear/ranging detectie → Redis 1h TTL
        asset_universe.py       CRYPTO_CORE, CRYPTO_SPECULATIVE, STOCKS_FOCUS
        asset_profile.py        Per-tier risk parameters (confidence, sizing, max hold)
        ccxt_broker.py          Bitvavo broker (EUR pairs)
        alpaca_broker.py        Alpaca broker (USD pairs)
        budget_manager.py       AI kosten vs trading P&L ROI tracking
        trade_tracker.py        Trade reflecties + Redis pattern win-rate stats
        notifications.py        Telegram notificaties (zie TELEGRAM_EVENT_TYPES)
        runtime_state.py        Redis runtime settings (kill switch etc.)
        rss_service.py          Nieuws ingestie: Alpaca News → CryptoPanic → CoinGecko → RSS
        news_analyzer.py        Claude-haiku analyse: sentiment, impact, gok_opportunity flag
        telegram_monitor_service.py  Scrape publieke Telegram kanalen (t.me/s/)
        x_monitor_service.py    X/Twitter via bearer token (legacy, gratis tier ~nutteloos)
  xscraper/                     LOSSE service: X via Playwright + GraphQL intercept
    scraper.py                  Cookie-auth, intercept SearchTimeline/UserTweets → social_posts
    Dockerfile                  Op officiële Playwright-image (Chromium preinstalled)
      models/                   SQLAlchemy ORM modellen
      tasks/                    Celery tasks (signal, news, analysis, social, telegram)
      workers/celery_app.py     Beat schedule
      config.py                 Settings via env vars
      main.py                   FastAPI app + routers + PIN middleware
  web/                          Next.js frontend
    app/
      page.tsx                  Dashboard (hoofdscherm)
      posities/page.tsx         Open posities + trade history + orders
      signals/page.tsx          Signalen + bull vs bear debate
      gok/page.tsx              Gok sessie UI
      feed/page.tsx             Nieuws + social + geruchten unified
      ai/page.tsx               AI lessen + regels + memory zoeken
      live/page.tsx             Live trading terminal (SSE)
      settings/page.tsx         Instellingen
      (12 andere pages redirecten naar bovenstaande)
    components/layout/Sidebar.tsx   Nav: 8 items
    lib/api.ts                  API client (alle endpoints)
    hooks/useApi.ts             Data fetching hook → returns { data, loading, error, reload }
    lib/utils.ts                fmtUSD, fmtPrice, fmtPct, fmtDate, cleanSym, cn
```

---

## Architectuur: 3 trading sub-systemen

### 1. Stocks (lang) — `STOCKS_FOCUS`
NVDA, TSLA, META, MSFT, AMD, COIN, PLTR, ASML, SPY, QQQ, AAPL, AMZN, GOOGL, CRWD, HOOD, MSTR
- Confidence drempel: **0.65**
- Positie: **30% van equity** (max $3000)
- Max hold: **120 uur**
- Alleen tijdens markturen (niet weekend)

### 2. Crypto core (continu) — `CRYPTO_CORE`
BTC, ETH, SOL, LTC, BCH
- Confidence drempel: **0.60**
- Positie: **25% van equity** (max $3000)
- Max hold: **48 uur**
- 24/7 actief

### 3. Speculatief — `CRYPTO_SPECULATIVE`
DOGE, AVAX, LINK, AAVE, UNI, ALGO, BAT, CRV, MKR, SUSHI, YFI, XTZ
- Confidence drempel: **0.72**
- Positie: **12% van equity** (max $1200)
- Max hold: **12 uur**

### 4. Gok sessie (apart) — de opportunity-finder
- Max **2 per dag**, max **1 tegelijk**
- TP: **+15%**, SL: **-5%**, max hold: **4 uur**
- AI scant nieuws + social + TA momentum, scoort op conviction (news+social+TA)
- Mode: `gok` in Trade tabel

> **Micro/scalp-trading is verwijderd.** Bij €1000 startkapitaal eet spread+slippage
> de marges op (break-even tot negatief). Filosofie: weinig high-conviction kansen i.p.v.
> veel microtrades. Verwijderd: `micro_trader.py`, `generate_scalp_signals`, de
> `micro_trading_enabled` toggle en de scalp-beat-tasks.

---

## Broker routing

```python
def _broker_for(symbol):
    if prefers_bitvavo(symbol) and ccxt._configured:
        return ccxt  # Bitvavo EUR pairs
    return alpaca    # Alpaca USD pairs
```

`prefers_bitvavo()` = crypto die op Bitvavo beschikbaar is.
Alpaca als fallback als Bitvavo niet geconfigureerd.

---

## Kritieke configuratie (via Coolify env vars)

| Var | Default | Betekenis |
|-----|---------|-----------|
| `LIVE_TRADING_ENABLED` | `false` | Pas op: echte handel! |
| `DASHBOARD_PIN` | — | PIN voor dashboard toegang |
| `ALPACA_API_KEY` | — | Alpaca credentials |
| `ALPACA_SECRET_KEY` | — | Alpaca credentials |
| `ALPACA_BASE_URL` | paper URL | Paper vs live |
| `BITVAVO_API_KEY` | — | Bitvavo (optioneel) |
| `BITVAVO_API_SECRET` | — | Bitvavo (optioneel) |
| `ANTHROPIC_API_KEY` | — | Claude AI |
| `DATABASE_URL` | — | PostgreSQL |
| `REDIS_URL` | — | Redis |
| `TELEGRAM_BOT_TOKEN` | — | Bot token voor notificaties (optioneel) |
| `TELEGRAM_CHAT_ID` | — | Chat ID voor Telegram meldingen |
| `TELEGRAM_MONITOR_CHANNELS` | — | Publieke kanalen monitoren: `trading,stockbot,futures,interest` |
| `X_BEARER_TOKEN` | — | X/Twitter bearer token (developer.twitter.com — gratis) |
| `CRYPTOPANIC_API_KEY` | — | CryptoPanic (optioneel — paid tier, gratis vervangen door CoinGecko) |
| `AI_DAILY_BUDGET_USD` | 10.0 | Max AI kosten per dag |

**NOOIT** `.env` committen. Alle vars via Coolify UI.

---

## Wat recent is gedaan (laatste twee sessies)

### Sessie 1 — Platform fundament
- `ASML` toegevoegd aan `STOCK_SYMBOLS` in `asset_profile.py`
- Gok sessie API: `GET /api/gok/status`, `GET /api/gok/scan`, `POST /api/gok/execute`
- `GokSessionService`: AI-free opportunity scanner (nieuws + social + TA)
- `CCXTBroker`: Bitvavo integratie via CCXT
- `MicroTraderService`: 3 rule-based setups (BOUNCE/BREAKOUT/SQUEEZE)
- `MarketRegimeService`: bull/bear/ranging met Redis cache
- Batch price fetch in `position_monitor.py` (voorkomt Alpaca rate limiting)
- Trailing stop altijd `max()` — SL gaat nooit terug
- Event-driven signalen na nieuws ingest (15 min cooldown)
- Candle freshness check + weekend stock filter + correlatie clusters
- **Frontend**: 18 pagina's → 6 schermen (Dashboard/Posities/Signalen/Gok/Feed/AI)

### Sessie 2 — Nieuws, Telegram, X.com, pipeline gaps
- `rss_service.py` volledig herschreven:
  - Prioriteit: Alpaca News API → CryptoPanic (optioneel) → CoinGecko trending (gratis) → 35+ RSS feeds
  - Google News RSS per watchlist ticker (dynamisch, gratis)
  - Reddit `top/.rss?t=day` (betere kwaliteit dan gewone feed)
  - Items >12u oud worden overgeslagen
- `news_analyzer.py` AI prompts verbeterd:
  - Volledige stock ticker mapping (NVDA/TSLA/META/MSFT/AMD/COIN/PLTR/ASML/AAPL/AMZN/GOOGL/SPY/QQQ)
  - ETF & macro context (Fed/CPI/PCE → SPY+QQQ impact regels)
  - `gok_opportunity` boolean in JSON output (meme coin + catalyst + hype)
  - `listing` als nieuw event_type
- **NIEUW `telegram_monitor_service.py`**: scrape publieke Telegram kanalen (t.me/s/)
  - Geen user-credentials nodig — werkt op publieke kanalen
  - Triggert signal generatie na nieuwe items (10 min cooldown)
- **NIEUW `x_monitor_service.py`**: hoog-engagement X tweets over watchlist
  - Bearer token via `X_BEARER_TOKEN` env var
  - Elke 30 min via Celery Beat
- **BUG FIX**: `high_impact_news` notificaties werden NOOIT naar Telegram gestuurd
  - `severity="warning"` zat niet in whitelist — nu gefixed
- **`gok_opportunity=true`** reageert nu:
  - Telegram alert `🎰 Gok kans gedetecteerd`
  - Auto-triggert `run_gok_scan` Celery task
  - Score >= 0.75 → auto-execute (geen bevestiging nodig)
- **`run_gok_scan`** Celery task toegevoegd aan `analysis_tasks.py`
- `notifications.py` TELEGRAM_EVENT_TYPES uitgebreid:
  `high_impact_news`, `gok_opportunity_detected`, `signal_generated`, `gok_executed`, `position_opened`

### Volledige autonome pipeline (huidig)
```
INBOUND (elke 15-30 min):
  Telegram kanalen → NewsItem → AI analyse (2min) → gok alert / breaking alert
  X.com tweets     → SocialPost → AI analyse → signaal context
  RSS + CoinGecko  → NewsItem → AI analyse → signaal trigger
  Reddit           → SocialPost → AI analyse

AI ANALYSE REAGEERT:
  impact >= 8 + high urgency  →  📰 Telegram "Breaking: BTC..."
  gok_opportunity = true      →  🎰 Telegram + auto gok scan
    score >= 0.75             →  auto-execute gok (geen bevestiging)

SIGNALEN (event-driven + elke 10 min via Celery):
  Nieuws/Telegram trigger → generate_signals → auto_trade

POSITIES:
  Trade uitgevoerd   →  📈 Telegram "DOGE LONG @ $0.12 | TP $0.14"
  Positie gesloten   →  ✅ Telegram "+8.2% | $82 winst"

DAGELIJKS 21:30 UTC → P&L samenvatting via Telegram
```

---

## Bekende openstaande punten

- **Frontend niet live getest**: UI is gebouwd maar niet in browser geverifieerd. Check of useApi `reload` correct werkt na actions.
- **Bitvavo**: CCXTBroker gebouwd maar niet live getest. Test met kleine order als geconfigureerd.
- **X.com rate limit**: gratis tier = 10 req/15min. Bij problemen zie logs voor `X API rate limit bereikt`.
- **Telegram kanaal scraping**: t.me/s/ HTML structuur kan wijzigen. Als kanalen leeg blijven check `telegram_monitor_service.py` regex.
- **Memory → signal generator**: Trade lessen worden opgeslagen in Qdrant maar worden nog niet actief gelezen door de signal generator voor context. Dit is een open verbetering.
- **Frontend `/live` pagina**: Niet herbouwd, werkt nog op de oude manier.

---

## Ontwikkelregels (BELANGRIJK)

1. **Geen `.env` committen** — Coolify beheert alle secrets
2. **Nooit `git push --force` naar main**
3. **Branch**: altijd werken op een feature branch, PR aanmaken
4. **Paper trading default**: `LIVE_TRADING_ENABLED=false` is de veilige default
5. **Positie sizing**: niet aanraken zonder overleg — te kleine posities = geen winst
6. **Kill switch**: respecteer altijd `get_runtime_value("kill_switch_enabled", ...)`
7. **Batch price fetch**: gebruik altijd `get_latest_prices_batch()` bij meerdere posities — nooit losse calls in een loop
8. **Broker routing**: gebruik altijd `_broker_for(symbol)` — niet hardcoded Alpaca of Bitvavo

---

## Hoe een nieuwe sessie te starten

1. Lees dit bestand volledig
2. Check `git log --oneline -10` voor recente commits
3. Check open PRs: `mcp__github__list_pull_requests`
4. Als de gebruiker een specifiek probleem meldt: lees het relevante bestand eerst, dan pas wijzigen
5. Werk altijd op branch `claude/ssh-root-access-q9Lx7` of een nieuwe feature branch
