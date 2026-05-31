"""
AI Budget Manager — tracks daily AI spend vs trading P&L.

The AI is allowed to spend money on calls as long as the expected return justifies it.
A €10 AI call that enables a €60 trade is excellent ROI.
A €5 AI call with no resulting trades is waste.

Daily budget can be configured via AI_DAILY_BUDGET_USD (0 = unlimited).
"""

import logging
from datetime import datetime, timezone
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.token_usage import TokenUsage
from app.models.trades import Trade
from app.config import get_settings

logger = logging.getLogger(__name__)


async def get_daily_budget_status(db: AsyncSession) -> dict:
    """Return today's AI spend, trading P&L, and ROI on AI investment."""
    settings = get_settings()
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    # AI spend today
    ai_result = await db.execute(
        select(
            func.sum(TokenUsage.estimated_cost_usd),
            func.count(TokenUsage.id),
        ).where(TokenUsage.created_at >= today)
    )
    ai_row = ai_result.one()
    ai_spend_usd = float(ai_row[0] or 0)
    ai_calls = int(ai_row[1] or 0)

    # Trading P&L today
    pnl_result = await db.execute(
        select(func.sum(Trade.pnl)).where(
            Trade.status == "closed",
            Trade.pnl.isnot(None),
            Trade.closed_at >= today,
        )
    )
    trading_pnl = float(pnl_result.scalar() or 0)

    # ROI on AI spend (how many € of P&L per $ of AI cost)
    roi = (trading_pnl / ai_spend_usd) if ai_spend_usd > 0 else None

    daily_budget = settings.ai_daily_budget_usd
    budget_remaining = max(0, daily_budget - ai_spend_usd) if daily_budget > 0 else None
    over_budget = (daily_budget > 0 and ai_spend_usd >= daily_budget)

    return {
        "ai_spend_usd": round(ai_spend_usd, 4),
        "ai_calls_today": ai_calls,
        "trading_pnl_eur": round(trading_pnl, 2),
        "roi_pnl_per_ai_dollar": round(roi, 2) if roi is not None else None,
        "daily_budget_usd": daily_budget if daily_budget > 0 else None,
        "budget_remaining_usd": round(budget_remaining, 4) if budget_remaining is not None else None,
        "over_budget": over_budget,
    }


async def is_over_budget(db: AsyncSession) -> bool:
    """Return True if daily AI budget is configured and exceeded."""
    settings = get_settings()
    if settings.ai_daily_budget_usd <= 0:
        return False
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.sum(TokenUsage.estimated_cost_usd)).where(TokenUsage.created_at >= today)
    )
    spent = float(result.scalar() or 0)
    if spent >= settings.ai_daily_budget_usd:
        logger.warning(f"AI dagbudget bereikt: ${spent:.4f} / ${settings.ai_daily_budget_usd:.2f}")
        return True
    return False
