from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.rumours import Rumour

router = APIRouter(prefix="/api/rumours")


@router.get("")
async def get_rumours(limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Rumour).order_by(desc(Rumour.created_at)).limit(limit))
    items = result.scalars().all()
    return [{"id": i.id, "title": i.title, "related_assets": i.related_assets,
             "confidence": i.confidence, "manipulation_risk": i.manipulation_risk,
             "hype_velocity": i.hype_velocity, "recommendation": i.recommendation,
             "official_confirmation": i.official_confirmation, "status": i.status,
             "independent_source_count": i.independent_source_count}
            for i in items]
