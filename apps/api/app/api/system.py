from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select, or_, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit import AuditLog
from app.models.memory import MemoryEntry
from app.models.notifications import Notification
from app.models.signals import Signal
from app.models.trades import Trade
from app.services.ai_guard import ai_pause_status, manual_pause_ai, resume_ai
from app.services.notifications import NotificationService

router = APIRouter(prefix="/api/system")


@router.get("/oracle/brief")
async def get_oracle_brief(db: AsyncSession = Depends(get_db)):
    """Haal de meest recente Oracle Morning Brief op."""
    import json
    result = await db.execute(
        select(MemoryEntry)
        .where(MemoryEntry.memory_type == "oracle_morning_brief")
        .order_by(desc(MemoryEntry.created_at))
        .limit(1)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        return {"brief": None, "message": "Nog geen morning brief beschikbaar"}
    try:
        data = json.loads(entry.content)
    except Exception:
        data = {"brief_text": entry.content}
    data["generated_at"] = entry.created_at.isoformat() if entry.created_at else None
    return {"brief": data}


@router.get("/oracle/history")
async def get_oracle_history(limit: int = Query(7, ge=1, le=30), db: AsyncSession = Depends(get_db)):
    """Haal Oracle brief geschiedenis op."""
    import json
    result = await db.execute(
        select(MemoryEntry)
        .where(MemoryEntry.memory_type.in_(["oracle_morning_brief", "oracle_eod_review"]))
        .order_by(desc(MemoryEntry.created_at))
        .limit(limit)
    )
    entries = result.scalars().all()
    out = []
    for e in entries:
        try:
            data = json.loads(e.content)
        except Exception:
            data = {}
        out.append({
            "id": e.id,
            "type": e.memory_type,
            "title": e.title,
            "mood": data.get("mood"),
            "regime": data.get("regime"),
            "risk_budget_pct": data.get("risk_budget_pct"),
            "dag_rating": data.get("dag_rating"),
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    return {"history": out}


@router.post("/oracle/brief/run")
async def run_oracle_brief_now():
    """Trigger een Oracle Morning Brief nu (handmatig)."""
    from app.services.oracle_brain import OracleBrainService
    from app.tasks.oracle_tasks import _write_oracle_md
    svc = OracleBrainService()
    brief = await svc.generate_morning_brief()
    if brief.get("error"):
        return {"status": "error", "message": brief["error"]}
    md = OracleBrainService.brief_to_markdown(brief, brief_type="morning")
    _write_oracle_md(md)
    return {"status": "ok", "mood": brief.get("mood"), "regime": brief.get("regime")}


@router.get("/ai-guard")
async def get_ai_guard():
    return ai_pause_status()


@router.post("/ai-guard/pause")
async def pause_ai_guard(
    minutes: int = Query(360, ge=1, le=1440),
    reason: str = Query("Handmatige AI stop door gebruiker"),
    db: AsyncSession = Depends(get_db),
):
    await manual_pause_ai("user", reason, minutes=minutes)
    guard = ai_pause_status()
    db.add(AuditLog(
        action="ai_provider_paused",
        actor="user",
        entity_type="ai_provider",
        entity_id="anthropic",
        details={"until": guard.get("until"), "minutes": minutes, "reason": reason},
        status="skipped",
        message=reason[:500],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    ))
    await db.commit()
    return {"status": "paused", "ai_guard": guard}


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


@router.get("/oracle/brief")
async def get_oracle_brief(db: AsyncSession = Depends(get_db)):
    """Haal de meest recente Oracle Morning Brief op."""
    import json
    result = await db.execute(
        select(MemoryEntry)
        .where(MemoryEntry.memory_type == "oracle_morning_brief")
        .order_by(desc(MemoryEntry.created_at))
        .limit(1)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        return {"brief": None, "message": "Nog geen morning brief beschikbaar"}
    try:
        data = json.loads(entry.content)
    except Exception:
        data = {"brief_text": entry.content}
    data["generated_at"] = entry.created_at.isoformat() if entry.created_at else None
    return {"brief": data}


@router.get("/oracle/history")
async def get_oracle_history(limit: int = Query(7, ge=1, le=30), db: AsyncSession = Depends(get_db)):
    """Haal Oracle brief geschiedenis op."""
    import json
    result = await db.execute(
        select(MemoryEntry)
        .where(MemoryEntry.memory_type.in_(["oracle_morning_brief", "oracle_eod_review"]))
        .order_by(desc(MemoryEntry.created_at))
        .limit(limit)
    )
    entries = result.scalars().all()
    out = []
    for e in entries:
        try:
            data = json.loads(e.content)
        except Exception:
            data = {}
        out.append({
            "id": e.id,
            "type": e.memory_type,
            "title": e.title,
            "mood": data.get("mood"),
            "regime": data.get("regime"),
            "risk_budget_pct": data.get("risk_budget_pct"),
            "dag_rating": data.get("dag_rating"),
            "created_at": e.created_at.isoformat() if e.created_at else None,
        })
    return {"history": out}


@router.post("/oracle/brief/run")
async def run_oracle_brief_now():
    """Trigger een Oracle Morning Brief nu (handmatig)."""
    import asyncio
    from app.services.oracle_brain import OracleBrainService
    svc = OracleBrainService()
    brief = await svc.generate_morning_brief()
    if brief.get("error"):
        return {"status": "error", "message": brief["error"]}
    from app.tasks.oracle_tasks import _write_oracle_md
    md = OracleBrainService.brief_to_markdown(brief, brief_type="morning")
    _write_oracle_md(md)
    return {"status": "ok", "mood": brief.get("mood"), "regime": brief.get("regime")}


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
