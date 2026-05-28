"""
Reset trading data for a clean test run.

Clears: trades, signals, orders, positions, audit_logs, notifications,
        risk_events, signal_outcomes, ai_agent_runs, strategy_performance, token_usage
Keeps:  news_items, candles, social_posts, memory_entries, settings, rumours,
        narratives, assets, source_credibility, pending_rules, active_rules

Usage (from the api container or with correct DATABASE_URL):
  python scripts/reset_trading_data.py

Or via docker:
  docker compose exec api python scripts/reset_trading_data.py
"""

import asyncio
import sys
from sqlalchemy import text
from app.database import AsyncSessionLocal

CLEAR_TABLES = [
    "signal_outcomes",
    "orders",
    "trades",
    "signals",
    "positions",
    "notifications",
    "risk_events",
    "audit_logs",
    "ai_agent_runs",
    "strategy_performance",
    "token_usage",
]

KEEP_TABLES = [
    "news_items", "candles", "social_posts", "memory_entries",
    "settings", "rumours", "narratives", "assets",
    "source_credibility", "pending_rules", "active_rules",
]


async def reset():
    print("=== Trading Data Reset ===")
    print()
    print(f"Wissen: {', '.join(CLEAR_TABLES)}")
    print(f"Bewaren: {', '.join(KEEP_TABLES)}")
    print()

    confirm = input("Doorgaan? (typ 'ja' om te bevestigen): ").strip().lower()
    if confirm != "ja":
        print("Afgebroken.")
        sys.exit(0)

    async with AsyncSessionLocal() as db:
        for table in CLEAR_TABLES:
            try:
                result = await db.execute(text(f"DELETE FROM {table}"))
                print(f"  ✅ {table}: {result.rowcount} rijen verwijderd")
            except Exception as e:
                print(f"  ⚠️  {table}: {e}")

        # Reset sequences so IDs start from 1
        for table in CLEAR_TABLES:
            try:
                await db.execute(text(f"ALTER SEQUENCE IF EXISTS {table}_id_seq RESTART WITH 1"))
            except Exception:
                pass  # Not all tables use integer sequences

        await db.commit()

    print()
    print("✅ Reset klaar. Herstart de bot om met een schone lei te beginnen.")
    print()
    print("Volgende stappen:")
    print("  1. Reset je Alpaca paper account via https://app.alpaca.markets (Account → Reset)")
    print("  2. Update ALPACA_API_KEY en ALPACA_SECRET_KEY in .env als je nieuwe keys hebt")
    print("  3. Herstart containers: docker compose restart api celery-worker celery-beat")


if __name__ == "__main__":
    asyncio.run(reset())
