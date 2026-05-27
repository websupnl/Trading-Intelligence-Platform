from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.audit import AuditLog

router = APIRouter(prefix="/api/audit")


@router.get("")
async def get_audit_logs(limit: int = Query(100, le=500), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit))
    items = result.scalars().all()
    return [{"id": i.id, "action": i.action, "actor": i.actor, "entity_type": i.entity_type,
             "entity_id": i.entity_id, "status": i.status, "message": i.message,
             "created_at": i.created_at}
            for i in items]
