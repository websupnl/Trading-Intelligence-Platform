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
        settings.py             /api/settings/*
        (etc.)
      services/                 Core business logic
        auto_trader.py          Signalen → orders, broker routing
        position_monitor.py     SL/TP bewaking, trailing stop, batch price fetch
        signal_generator.py     AI signaal generatie, candle freshness check
        market_data_service.py  Alpaca + Bitvavo prijzen, candles, batch fetch
        risk_engine.py          Risk checks, correlatie clusters
        gok_session.py          Gok sessie: scan + execute
        micro_trader.py         Rule-based scalper (BOUNCE/BREAKOUT/SQUEEZE)
        market_regime.py        Bull/bear/ranging detectie → Redis 1h TTL
        asset_universe.py       CRYPTO_CORE, CRYPTO_SPECULATIVE, STOCKS_FOCUS
        asset_profile.py        Per-tier risk parameters (confidence, sizing, max hold)
        ccxt_broker.py          Bitvavo broker (EUR pairs)
        alpaca_broker.py        Alpaca broker (USD pairs)
        budget_manager.py       AI kosten vs trading P&L ROI tracking
        trade_tracker.py        Trade reflecties + Redis pattern win-rate stats
        notifications.py        Telegram notificaties
        runtime_state.py        Redis runtime settings (kill switch etc.)
      models/                   SQLAlchemy ORM modellen
      tasks/                    Celery tasks (signal, news, analysis)
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

### 4. Gok sessie (apart)
- Max **2 per dag**, max **1 tegelijk**
- TP: **+15%**, SL: **-5%**, max hold: **4 uur**
- AI scant nieuws + social + TA momentum
- Mode: `gok` in Trade tabel

### 5. Micro trading (rule-based, geen AI)
- Assets: BTC, ETH, SOL, DOGE, AVAX, LINK
- 3 setups: BOUNCE (RSI<38), BREAKOUT (EMA20 + volume), SQUEEZE (BB)
- Max **4 tegelijk**, max daily loss **3%**
- Elke **20 sec** cycle, monitor elke **10 sec**
- Toggle via UI (Settings → Micro Trading)

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
| `TELEGRAM_BOT_TOKEN` | — | Notificaties (optioneel) |
| `AI_DAILY_BUDGET_USD` | 10.0 | Max AI kosten per dag |

**NOOIT** `.env` committen. Alle vars via Coolify UI.

---

## Wat recent is gedaan (laatste sessie)

### Backend fixes
- `ASML` toegevoegd aan `STOCK_SYMBOLS` in `asset_profile.py`
- Gok sessie API gebouwd: `GET /api/gok/status`, `GET /api/gok/scan`, `POST /api/gok/execute`
- `GokSessionService` in `gok_session.py`: AI-free opportunity scanner (nieuws + social + TA)
- `CCXTBroker` in `ccxt_broker.py`: Bitvavo integratie via CCXT
- `MicroTraderService` in `micro_trader.py`: 3 rule-based setups
- `MarketRegimeService` in `market_regime.py`: bull/bear/ranging met Redis cache
- `BudgetManager` in `budget_manager.py`: AI ROI tracking
- Batch price fetch in `position_monitor.py` (voorkomt Alpaca rate limiting)
- Trailing stop gebruikt altijd `max()` — SL gaat nooit terug
- Event-driven signalen na nieuws ingest (15 min cooldown)
- Candle freshness check: crypto >30 min oud → skip, stocks >90 min → skip
- Correlatie clusters in `risk_engine.py` (max 2 posities per cluster)
- `ccxt>=4.4.0` toegevoegd aan `pyproject.toml`

### Frontend rebuild (volledig herschreven)
- **18 pagina's → 6 schermen** (zie structuur hierboven)
- Sidebar: 18 nav-items → 8
- Dashboard: portfolio hero, bot status, kill switch toggle, gok button, live log
- `/posities`: open + gesloten trades + paper order form
- `/signals`: pending/traded/rejected/debate + regime badge + genereer knoppen
- `/gok`: AI scan (met TP/SL preview) → bevestigen → execute
- `/feed`: nieuws + social + geruchten unified feed
- `/ai`: trade lessen + regel approval + memory zoeken
- 12 oude routes redirecten naar nieuwe equivalenten

---

## Bekende openstaande punten

- **Frontend testen**: UI is gebouwd maar niet getest in browser (geen dev server in deze sessie). Check of alle API calls werken, useApi `reload` correct wordt aangeroepen, etc.
- **Bitvavo live test**: CCXTBroker is gebouwd maar niet live getest. Test met kleine order als Bitvavo geconfigureerd is.
- **Micro trader**: Gebouwd, maar verifieer in logs na 1 uur draaien dat `mode=micro` trades verschijnen.
- **Market regime Redis key**: `REGIME_KEY = "trading_os:market_regime"` — verifieer dat Celery Beat dit elk uur refresht.
- **Frontend `/live` pagina**: Niet herbouwd, werkt nog op de oude manier. Eventueel nog opschonen.

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
