# Trading OS — Codex: Full System Analysis & 100+ Autonomous Trades

Je bent een senior software engineer die werkt aan **Trading OS** — een volledig autonoom crypto/stock trading platform op productie VPS. Je taak: analyseer de codebase, fix alle verbindingsfouten, en bouw uitbreidingen voor massale autonome trading (doel: **100+ simultane posities, volledig autonoom, 24/7**).

---

## SYSTEEM ARCHITECTUUR

**Stack**: Python FastAPI + Celery + Next.js + PostgreSQL/TimescaleDB + Redis + Qdrant
**Broker**: Alpaca Markets (paper trading, NOOIT live geld)
**AI**: Claude claude-sonnet-4-6 (signaalanalyse bull/bear debate)

### Repository structuur
```
apps/api/app/
  services/
    alpaca_broker.py        ← CRYPTO_SYMBOLS (nu 17 coins), order execution
    market_data_service.py  ← Candle fetch: Alpaca v2 (stocks) + v1beta3 (crypto)
    signal_generator.py     ← AI bull/bear debate, scalp signals, cooldowns
    auto_trader.py          ← Autonome order executie, MAX_OPEN_POSITIONS=8
    position_monitor.py     ← SL/TP/MaxHold 24/7 monitoring
    risk_engine.py          ← Risk checks, circuit breaker
    technical_analysis.py   ← RSI, MACD, Bollinger Bands, ATR, candlestick patterns
    trade_tracker.py        ← P&L + Claude AI reflections + memory entries
  tasks/
    analysis_tasks.py       ← Celery: fetch_market_data, auto_trade, monitor_positions
    signal_tasks.py         ← Celery: generate_signals, generate_scalp_signals
  workers/
    celery_app.py           ← Beat schedule (timing van alle taken)
  api/
    signals.py              ← REST: paper-trade endpoint (gebruikt notional nu)
    trading.py              ← REST: trades, orders, portfolio
apps/web/app/               ← Next.js frontend
```

### Live infrastructuur commands
```bash
# DB
docker exec postgres-cs8ok4kcgwws4gck4cgkco48 psql -U trading_os -d trading_os

# Worker logs
docker logs worker-cs8ok4kcgwws4gck4cgkco48 --since 1h 2>&1

# API (correct IP is 10.0.3.7, NIET 10.0.3.6)
curl -s -H "X-Dashboard-Pin: 051234" http://10.0.3.7:8000/api/[endpoint]

# Redis runtime settings lezen
docker exec redis-cs8ok4kcgwws4gck4cgkco48 redis-cli MGET \
  "trading_os:runtime:trading_mode" \
  "trading_os:runtime:crypto_24_7_enabled" \
  "trading_os:runtime:require_manual_confirmation" \
  "trading_os:runtime:kill_switch_enabled" \
  "trading_os:runtime:position_size_pct"
```

---

## STAP 1: LIVE SYSTEEM ANALYSEREN

```sql
-- Bot health state
SELECT
  (SELECT COUNT(*) FROM trades WHERE status='open') open_trades,
  (SELECT COUNT(*) FROM trades WHERE stop_loss IS NULL AND status='open') zonder_sl,
  (SELECT COUNT(*) FROM signals WHERE status='skipped' AND created_at > NOW()-INTERVAL '1h') cooldown_skips,
  (SELECT COUNT(*) FROM signals WHERE created_at > NOW()-INTERVAL '1h') signals_1h,
  (SELECT ROUND(SUM(estimated_cost_usd)::numeric,4) FROM token_usage WHERE created_at > NOW()-INTERVAL '1h') ai_1h,
  (SELECT COUNT(*) FROM memory_entries) memory,
  (SELECT ROUND(SUM(pnl)::numeric,2) FROM trades WHERE status='closed') pnl;

-- AI kosten per uur (is scalp_signal te duur?)
SELECT DATE_TRUNC('hour', created_at) AS hr, call_type, COUNT(*) calls,
  ROUND(SUM(estimated_cost_usd)::numeric,3) cost
FROM token_usage WHERE created_at > NOW()-INTERVAL '6h'
GROUP BY hr, call_type ORDER BY hr DESC, cost DESC;

-- Welke assets worden gesignaleerd? (stocks nooit!)
SELECT asset, COUNT(*) total,
  SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped,
  SUM(CASE WHEN status LIKE '%traded%' THEN 1 ELSE 0 END) traded
FROM signals WHERE created_at > NOW()-INTERVAL '24h'
GROUP BY asset ORDER BY total DESC;
```

```bash
# Errors checken
docker logs worker-cs8ok4kcgwws4gck4cgkco48 --since 2h 2>&1 | \
  grep -E "ERROR|CRITICAL|Exception" | head -20

# Is de bot autonoom?
docker exec redis-cs8ok4kcgwws4gck4cgkco48 redis-cli GET \
  "trading_os:runtime:autonomous_crypto_session"
```

---

## STAP 2: BEKENDE BUGS TE FIXEN

### Bug 1 (KRITIEK): Bot handelt niet autonoom — crypto session expired
**Oorzaak**: `autonomous_crypto_session` heeft `stop_reason: "expired"`, `max_notional_per_trade: 0.0`
**Fix**:
```bash
docker exec redis-cs8ok4kcgwws4gck4cgkco48 redis-cli MSET \
  "trading_os:runtime:crypto_24_7_enabled" "true" \
  "trading_os:runtime:require_manual_confirmation" "false"
```
**Code fix** in `auto_trader.py`: zorg dat `crypto_24_7_enabled=true` altijd voorrang heeft op expired session.

### Bug 2 (HOOG): Position monitor mist trades met /USD symbool
**Locatie**: `position_monitor.py`, `monitor()` methode, regel ~35
```python
# KAPOT: Trade.symbol = "ETH/USD" maar CRYPTO_SYMBOLS = {"ETH"} → gemist
if crypto_only:
    query = query.where(Trade.symbol.in_(CRYPTO_SYMBOLS))

# FIX:
if crypto_only:
    from sqlalchemy import func
    query = query.where(
        func.split_part(Trade.symbol, '/', 1).in_(CRYPTO_SYMBOLS)
    )
```

### Bug 3 (HOOG): Stocks worden NOOIT geanalyseerd of getraded
**Bewijs**: 0 stock signals in alle tijden, 0 stock trades
**Oorzaken**:
1. `generate_signals` gebruikt `crypto_session_mode=True` altijd (ook als markt open is)
2. `auto_trade` zet `crypto_only = not market_open` — stocks geblokkeerd buiten uren
3. TA stale-check: stocks zonder verse nieuws worden geskipt
**Fix**: Zie Stap 3f — dedicated stock signal task

### Bug 4 (MEDIUM): Scalp signals kosten $27/dag
**Bewijs**: 47 scalp calls in 30 min, $0.56 = $27/dag op dit tempo
**Fix**: Pre-filter op TA score vóór AI call
```python
# In generate_scalp_signals(), vóór de AI call:
ta_15m = ta_analyze(candles_15m) if candles_15m else None
if not ta_15m or (ta_15m.score < 0.15 and not ta_15m.bb_squeeze):
    continue  # Geen setup → geen AI call nodig
```

### Bug 5 (MEDIUM): Trades zonder SL/TP (sync van Alpaca)
**Bewijs**: ~15 trades zonder stop_loss na container restart
**Fix** in `trade_tracker.py`, `sync_open_trades_from_orders()`:
```python
# Na aanmaken van trade, zoek bijpassend signal voor SL/TP:
signal = await db.execute(
    select(Signal).where(
        func.split_part(Signal.asset, '/', 1) == symbol.split("/")[0],
        Signal.status.in_(["pending", "paper_traded"]),
    ).order_by(Signal.created_at.desc()).limit(1)
)
s = signal.scalar_one_or_none()
if s and s.suggested_stop:
    trade.stop_loss = s.suggested_stop
    trade.take_profit = s.suggested_take_profit
```

### Bug 6 (LAAG): Qdrant vector DB leeg
**Check**: `curl -s http://10.0.3.3:6333/collections`
**Actie**: Controleer of het systeem Qdrant gebruikt; zo ja, initialiseer collections voor news embeddings.

---

## STAP 3: UITBREIDEN NAAR 100+ TRADES

### 3a. CRYPTO_SYMBOLS uitbreiden (alpaca_broker.py)
Alpaca paper heeft **73 tradeable crypto pairs**. Voeg toe (verifieer eerst via API):

```python
CRYPTO_SYMBOLS = {
    # Reeds aanwezig (17)
    "BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "LTC", "BCH",
    "UNI", "AAVE", "CRV", "BAT", "ALGO", "XTZ", "MKR", "SUSHI", "YFI",
    # Layer 1 toevoegen
    "ADA", "DOT", "NEAR", "ATOM",
    # DeFi
    "GRT", "LDO", "COMP", "BAL",
    # Layer 2
    "MATIC", "ARB",
    # Memecoins (hoog volume)
    "SHIB", "PEPE",
    # Nieuwe altcoins
    "RENDER", "FIL",
}
# Verificatie per symbol:
# curl "https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=SYMBOL/USD&timeframe=1Day&limit=1" \
#   -H "APCA-API-KEY-ID: $KEY" -H "APCA-API-SECRET-KEY: $SECRET" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('bars') else 'NO DATA')"
```

### 3b. DEFAULT_WATCHLIST stocks uitbreiden (signal_generator.py)
```python
DEFAULT_WATCHLIST: set[str] = {
    # Crypto subset
    "BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "LTC", "AAVE", "UNI",
    # Broad market ETFs
    "SPY", "QQQ", "IWM", "DIA", "VTI",
    # Sector ETFs
    "XLK", "XLF", "XLE", "XLV", "GLD", "SLV",
    # Mega cap tech
    "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA",
    # High-momentum
    "AMD", "COIN", "PLTR", "MSTR", "CRWD", "HOOD", "AFRM", "SOFI",
}
```

### 3c. Micro-positie modus (auto_trader.py)
```python
MAX_OPEN_POSITIONS = 100   # was 8
MIN_NOTIONAL = 10.0        # was 50.0
MAX_AUTO_NOTIONAL = 100.0  # was 500.0
# position_size_pct via Redis: 1% (= $10 per trade bij $1000 account → 100 trades)
```

### 3d. Signal generator throughput (signal_generator.py)
```python
# Hogere limiet per run
limit = 50 if crypto_session_mode else 100  # was 8/15

# Kortere cooldowns
# _recent_signal_exists: hours=3 (was 6)
# _recent_scalp_exists: minutes=30 (was 60)

# Parallelle AI calls (5 tegelijk)
import asyncio
batches = [assets[i:i+5] for i in range(0, len(assets), 5)]
for batch in batches:
    results = await asyncio.gather(*[self._analyze_one(a, ...) for a in batch])
```

### 3e. Snellere scheduling (celery_app.py)
```python
"fetch-market-data-every-5min":    {"schedule": 300.0},   # was 900s
"generate-signals-every-5min":     {"schedule": 300.0},   # was 600s
"generate-scalp-signals-every-2min": {"schedule": 120.0}, # was 300s
"monitor-positions-every-30sec":   {"schedule": 30.0},    # was 60s
```

### 3f. Dedicated stock signal task (signal_tasks.py) — NIEUW
```python
@celery_app.task(name="app.tasks.signal_tasks.generate_stock_signals")
def generate_stock_signals():
    """Stocks ALLEEN tijdens US markturen (14:30–21:00 UTC)."""
    from app.tasks.analysis_tasks import _us_market_open
    if not _us_market_open():
        return {"status": "skipped", "reason": "market_closed"}
    svc = SignalGeneratorService()
    count = asyncio.run(svc.generate_stock_signals())
    return {"status": "ok", "signals_generated": count}

# In celery_app.py beat_schedule:
"generate-stock-signals-market-hours": {
    "task": "app.tasks.signal_tasks.generate_stock_signals",
    "schedule": crontab(minute="*/10", hour="14-21"),
}
```

---

## STAP 4: CRYPTO vs STOCKS ARCHITECTUURVERSCHILLEN

| Aspect | Crypto | Aandelen |
|--------|--------|----------|
| Alpaca data endpoint | `v1beta3/crypto/us/bars` | `v2/stocks/bars` |
| Symbool DB-format | `BTC` (zonder /USD) | `AAPL` |
| Symbool Alpaca-format | `BTC/USD` | `AAPL` |
| Timeframes beschikbaar | `1Day`, `4Hour`, `15Min` | `1Day` alleen |
| Trading uren | 24/7 | 09:30–16:00 ET |
| Signal cooldown | 3u swing, 30min scalp | 24u |
| Position sizing | $10–100 | $20–100 |
| Max hold | 24u swing, 8u scalp | 5 dagen |
| is_crypto() check | `base in CRYPTO_SYMBOLS` | False |

### Kritieke symbool inconsistentie (fix overal)
```python
# DB bevat: "ETH" EN "ETH/USD" (inconsistent door verschillende codepaden)
# Fix: normaliseer altijd bij vergelijking

# Helper functie toevoegen in alpaca_broker.py:
def symbol_base(symbol: str) -> str:
    """Strip /USD suffix: 'ETH/USD' → 'ETH', 'AAPL' → 'AAPL'"""
    return symbol.upper().split("/")[0]

# Gebruik overal:
func.split_part(Trade.symbol, '/', 1).in_(CRYPTO_SYMBOLS)  # SQL
symbol_base(trade.symbol) in CRYPTO_SYMBOLS                 # Python
```

---

## STAP 5: KOSTEN MANAGEMENT

**Budget**: max $5/dag totaal AI kosten

| Call type | Nu | Doel |
|-----------|-----|------|
| Scalp signals | $27/dag (te hoog!) | < $2/dag |
| Swing signals | ~$2/dag | < $2/dag |
| News analyse | ~$1/dag | < $1/dag |
| **Totaal** | **~$30/dag** | **< $5/dag** |

### Two-stage AI pre-filter (kosten halveren)
```python
# Stage 1: Haiku pre-screening (goedkoop, snel)
# Stage 2: Sonnet alleen als Haiku score >= 0.45

async def _haiku_prescreen(self, client, asset, ta_summary) -> float:
    """Goedkope Haiku check: is er een setup? Retourneert score 0-1."""
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=50,
        messages=[{"role": "user", "content":
            f"Asset: {asset}\nTA: {ta_summary}\n"
            f"Is er een bullish setup? Geef alleen een getal 0.0-1.0."
        }]
    )
    # parse float uit response
    return score

# In generate_signals / generate_scalp_signals:
pre_score = await self._haiku_prescreen(haiku_client, asset, ta_summary)
if pre_score < 0.45:
    await self._save_skipped_signal(asset, {"reason": f"haiku_pre:{pre_score:.2f}"}, ta_result, price)
    continue  # Sla Sonnet call over
```

---

## STAP 6: VERIFICATIE

Na alle wijzigingen:

```bash
# Redis autonomie instellen
docker exec redis-cs8ok4kcgwws4gck4cgkco48 redis-cli MSET \
  "trading_os:runtime:crypto_24_7_enabled" "true" \
  "trading_os:runtime:require_manual_confirmation" "false" \
  "trading_os:runtime:position_size_pct" "0.01"

# Na 30 minuten checken
docker exec postgres-cs8ok4kcgwws4gck4cgkco48 psql -U trading_os -d trading_os -tAc "
SELECT
  (SELECT COUNT(*) FROM trades WHERE status='open') open_trades,
  (SELECT COUNT(DISTINCT symbol) FROM candles WHERE timeframe='1Day') assets,
  (SELECT COUNT(*) FROM signals WHERE created_at > NOW()-INTERVAL '30min') signals_30min,
  (SELECT ROUND(SUM(estimated_cost_usd)::numeric,3) FROM token_usage WHERE created_at > NOW()-INTERVAL '1h') ai_1h,
  (SELECT COUNT(*) FROM memory_entries) memory"
```

### Succescriteria
| Metric | Nu | Doel |
|--------|-----|------|
| Open trades | 16 | 50+ |
| Crypto assets | 17 | 35+ |
| Stock trades | 0 | 10+ |
| Signals/uur | ~5 | 20+ |
| AI kosten/dag | ~$30 | < $5 |
| Memory entries | 0 | 10+ |
| Trades met SL | ~25% | 100% |

---

## HARDE CONSTRAINTS

1. **PAPER TRADING ONLY** — `trading_mode = "paper"` altijd
2. **Long-only** — geen short selling
3. **Stop-loss verplicht** — altijd `suggested_stop` in signals
4. **Max drawdown** — circuit breaker bij -5% dag verlies
5. **Alpaca rate limits** — max 200 API calls/min
6. **AI budget** — max $1/uur totaal
7. **Geen XRP** — slechte prijsdata van Alpaca (entry $14 ipv $1.34)
