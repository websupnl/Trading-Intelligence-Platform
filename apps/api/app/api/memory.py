from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from datetime import datetime, timezone
from app.database import get_db
from app.models.rules import PendingRule, ActiveRule
from app.models.memory import MemoryEntry
from app.models.signals import Signal
from app.models.outcomes import SignalOutcome
from app.services.audit import AuditLogService

router = APIRouter(prefix="/api/memory")


@router.get("/search")
async def search_memory(q: str = Query(""), limit: int = 20, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MemoryEntry).where(
            MemoryEntry.title.ilike(f"%{q}%") if q else True  # type: ignore
        ).order_by(desc(MemoryEntry.created_at)).limit(limit)
    )
    items = result.scalars().all()
    return [{"id": i.id, "type": i.memory_type, "title": i.title, "content": i.content,
             "tags": i.tags, "related_symbols": i.related_symbols,
             "importance": i.importance, "status": i.status, "created_at": i.created_at}
            for i in items]


@router.get("/feedback")
async def get_ai_feedback(db: AsyncSession = Depends(get_db)):
    """Recent decision and learning feedback for the cockpit."""
    signals_result = await db.execute(select(Signal).order_by(desc(Signal.created_at)).limit(4))
    lessons_result = await db.execute(
        select(MemoryEntry).where(MemoryEntry.memory_type == "trade_lesson")
        .order_by(desc(MemoryEntry.created_at)).limit(3)
    )
    outcome_result = await db.execute(
        select(SignalOutcome).where(SignalOutcome.pnl_5d_pct.is_not(None))
        .order_by(desc(SignalOutcome.evaluated_at)).limit(3)
    )

    signals = [
        {
            "kind": "decision",
            "id": signal.id,
            "symbol": signal.asset,
            "title": f"{signal.direction.upper()} {signal.asset} - confidence {signal.confidence:.0%}",
            "message": signal.reason or "AI-signaal zonder aanvullende toelichting.",
            "created_at": signal.created_at,
            "status": signal.status,
        }
        for signal in signals_result.scalars().all()
    ]
    lessons = [
        {
            "kind": "lesson",
            "id": lesson.id,
            "symbol": (lesson.related_symbols or [None])[0],
            "title": lesson.title,
            "message": lesson.content,
            "created_at": lesson.created_at,
            "status": lesson.status,
        }
        for lesson in lessons_result.scalars().all()
    ]
    outcomes = [
        {
            "kind": "outcome",
            "id": outcome.id,
            "symbol": outcome.symbol,
            "title": f"{outcome.symbol} {outcome.direction.upper()} na 5 handelsdagen",
            "message": f"Resultaat {outcome.pnl_5d_pct:+.2f}%"
            + (f", versus SPY {outcome.excess_return_5d:+.2f}%" if outcome.excess_return_5d is not None else ""),
            "created_at": outcome.evaluated_at,
            "status": outcome.outcome_status,
        }
        for outcome in outcome_result.scalars().all()
    ]
    items = sorted(
        signals + lessons + outcomes,
        key=lambda item: item["created_at"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return {"items": items[:8], "refresh_seconds": 30}


@router.get("/pending-rules")
async def get_pending_rules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PendingRule).where(PendingRule.status == "pending").order_by(desc(PendingRule.created_at))
    )
    return [{"id": r.id, "title": r.title, "description": r.description, "rule_type": r.rule_type,
             "confidence": r.confidence, "proposed_by": r.proposed_by, "status": r.status,
             "created_at": r.created_at}
            for r in result.scalars().all()]


@router.get("/active-rules")
async def get_active_rules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ActiveRule).where(ActiveRule.status == "active").order_by(desc(ActiveRule.created_at))
    )
    return [{"id": r.id, "title": r.title, "description": r.description, "rule_type": r.rule_type,
             "approved_by": r.approved_by, "approved_at": r.approved_at, "status": r.status}
            for r in result.scalars().all()]


@router.post("/pending-rules/{rule_id}/approve")
async def approve_rule(rule_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PendingRule).where(PendingRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regel niet gevonden")

    now = datetime.now(timezone.utc)
    active = ActiveRule(
        pending_rule_id=rule.id,
        title=rule.title,
        description=rule.description,
        rule_type=rule.rule_type,
        approved_by="user",
        approved_at=now,
        status="active",
        created_at=now,
        updated_at=now,
    )
    rule.status = "approved"
    rule.reviewed_by = "user"
    rule.reviewed_at = now
    db.add(active)

    audit = AuditLogService(db)
    await audit.log("pending_rule_approved", entity_type="rule", entity_id=rule_id)
    await db.commit()
    return {"status": "approved"}


@router.post("/pending-rules/{rule_id}/reject")
async def reject_rule(rule_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PendingRule).where(PendingRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regel niet gevonden")

    now = datetime.now(timezone.utc)
    rule.status = "rejected"
    rule.reviewed_by = "user"
    rule.reviewed_at = now

    audit = AuditLogService(db)
    await audit.log("pending_rule_rejected", entity_type="rule", entity_id=rule_id)
    await db.commit()
    return {"status": "rejected"}
