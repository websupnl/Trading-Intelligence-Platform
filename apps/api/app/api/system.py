from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select, or_, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit import AuditLog
from app.models.notifications import Notification
from app.models.signals import Signal
from app.models.trades import Trade
from app.services.ai_guard import ai_pause_status, resume_ai
from app.services.notifications import NotificationService

router = APIRouter(prefix="/api/system")


@router.get("/ai-guard")
async def get_ai_guard():
    return ai_pause_status()


@router.post("/ai-guard/resume")
async def resume_ai_guard(db: AsyncSession = Depends(get_db)):
    resume_ai()
    db.add(AuditLog(
        action="ai_provider_resumed",
        actor="user",
        entity_type="ai_provider",
        entity_id="anthropic",
        status="success",
        message="AI provider pause handmatig opgeheven",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    ))
    await db.commit()
    await NotificationService(db).send(
        "ai_provider_resumed",
        "Trading OS - AI analyse hervat",
        "De Anthropic pauze is handmatig opgeheven. De volgende scheduler-run probeert opnieuw AI-analyse.",
        severity="warning",
        entity_type="ai_provider",
        entity_id="anthropic",
    )
    return {"status": "resumed", "ai_guard": ai_pause_status()}


@router.get("/errors")
async def get_errors(limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AuditLog)
        .where(or_(AuditLog.status.in_(["error", "rejected", "skipped"]), AuditLog.action.ilike("%error%")))
        .order_by(desc(AuditLog.created_at))
        .limit(limit)
    )
    return [
        {
            "id": item.id,
            "action": item.action,
            "actor": item.actor,
            "status": item.status,
            "message": item.message,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "details": item.details,
            "created_at": item.created_at,
        }
        for item in result.scalars().all()
    ]


@router.get("/activity")
async def get_activity(limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    audits = await db.execute(select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit))
    notifications = await db.execute(select(Notification).order_by(desc(Notification.created_at)).limit(limit))
    events = []
    for item in audits.scalars().all():
        events.append({"kind": "audit", "type": item.action, "severity": item.status, "title": item.action, "message": item.message, "created_at": item.created_at})
    for item in notifications.scalars().all():
        events.append({"kind": "notification", "type": item.event_type, "severity": item.severity, "title": item.title, "message": item.message, "created_at": item.created_at})
    events.sort(key=lambda x: x["created_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return events[:limit]


_RESET_TABLES = [
    "signal_outcomes", "orders", "trades", "signals", "positions",
    "notifications", "risk_events", "audit_logs", "ai_agent_runs",
    "strategy_performance", "token_usage",
]


@router.post("/reset-trade-data")
async def reset_trade_data(db: AsyncSession = Depends(get_db)):
    """Wis alle trade/signal data voor een schone teststart. Bewaart news, candles, memory."""
    deleted = {}
    for table in _RESET_TABLES:
        try:
            result = await db.execute(text(f"DELETE FROM {table}"))
            deleted[table] = result.rowcount
        except Exception as e:
            deleted[table] = f"error: {e}"
    for table in _RESET_TABLES:
        try:
            await db.execute(text(f"ALTER SEQUENCE IF EXISTS {table}_id_seq RESTART WITH 1"))
        except Exception:
            pass
    await db.commit()
    db.add(AuditLog(
        action="trade_data_reset",
        actor="user",
        entity_type="system",
        status="success",
        message="Trade data gewist voor schone teststart",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    ))
    await db.commit()
    return {"status": "ok", "deleted": deleted}


@router.get("/summary")
async def get_system_summary(db: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    signal_counts = await db.execute(select(Signal.status, func.count()).group_by(Signal.status))
    trade_counts = await db.execute(select(Trade.status, func.count()).group_by(Trade.status))
    error_count = await db.execute(select(func.count()).where(AuditLog.created_at >= since, AuditLog.status == "error"))
    last_error = await db.execute(select(AuditLog).where(AuditLog.status == "error").order_by(desc(AuditLog.created_at)).limit(1))
    return {
        "ai_guard": ai_pause_status(),
        "signals": {status: count for status, count in signal_counts.all()},
        "trades": {status: count for status, count in trade_counts.all()},
        "errors_24h": error_count.scalar() or 0,
        "last_error": (lambda e: None if not e else {"action": e.action, "message": e.message, "created_at": e.created_at})(last_error.scalar_one_or_none()),
    }
