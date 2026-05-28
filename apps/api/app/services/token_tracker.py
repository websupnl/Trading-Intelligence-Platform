from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date

from app.models.token_usage import TokenUsage

# Cost per million tokens in USD
MODEL_COSTS: dict[str, dict[str, float]] = {
    "claude-sonnet-4-5": {"input": 3.00, "output": 15.00, "cache_read": 0.30, "cache_write": 3.75},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00, "cache_read": 0.30, "cache_write": 3.75},
    "claude-opus-4-7": {"input": 15.00, "output": 75.00, "cache_read": 1.50, "cache_write": 18.75},
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.00, "cache_read": 0.08, "cache_write": 1.00},
}
_DEFAULT_COSTS = {"input": 3.00, "output": 15.00, "cache_read": 0.30, "cache_write": 3.75}


def cost_from_usage(model: str, usage) -> float:
    costs = MODEL_COSTS.get(model, _DEFAULT_COSTS)
    inp = getattr(usage, "input_tokens", 0) or 0
    out = getattr(usage, "output_tokens", 0) or 0
    cr = getattr(usage, "cache_read_input_tokens", 0) or 0
    cc = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return (
        (inp / 1_000_000) * costs["input"]
        + (out / 1_000_000) * costs["output"]
        + (cr / 1_000_000) * costs["cache_read"]
        + (cc / 1_000_000) * costs["cache_write"]
    )


def usage_record(model: str, call_type: str, usage) -> TokenUsage:
    cost = cost_from_usage(model, usage)
    return TokenUsage(
        model=model,
        call_type=call_type,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_creation_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        estimated_cost_usd=cost,
    )


async def flush_usage(db: AsyncSession, records: list[TokenUsage]) -> None:
    for r in records:
        db.add(r)


async def get_usage_summary(db: AsyncSession) -> dict:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=6)

    total = await db.execute(
        select(
            func.sum(TokenUsage.estimated_cost_usd),
            func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens),
            func.count(TokenUsage.id),
        )
    )
    total_row = total.one()

    today = await db.execute(
        select(
            func.sum(TokenUsage.estimated_cost_usd),
            func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens),
            func.count(TokenUsage.id),
        ).where(TokenUsage.created_at >= today_start)
    )
    today_row = today.one()

    week = await db.execute(
        select(func.sum(TokenUsage.estimated_cost_usd)).where(TokenUsage.created_at >= week_start)
    )
    week_cost = week.scalar() or 0.0

    # Daily breakdown last 7 days
    daily_result = await db.execute(
        select(
            cast(TokenUsage.created_at, Date).label("date"),
            func.sum(TokenUsage.estimated_cost_usd).label("cost"),
            func.count(TokenUsage.id).label("calls"),
            func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens).label("tokens"),
        )
        .where(TokenUsage.created_at >= week_start)
        .group_by(cast(TokenUsage.created_at, Date))
        .order_by(cast(TokenUsage.created_at, Date).desc())
    )
    daily = [
        {"date": str(row.date), "cost": float(row.cost or 0), "calls": row.calls, "tokens": int(row.tokens or 0)}
        for row in daily_result.all()
    ]

    return {
        "total_cost": float(total_row[0] or 0),
        "total_tokens": int(total_row[1] or 0),
        "total_calls": int(total_row[2] or 0),
        "today_cost": float(today_row[0] or 0),
        "today_tokens": int(today_row[1] or 0),
        "today_calls": int(today_row[2] or 0),
        "week_cost": float(week_cost),
        "daily": daily,
    }
