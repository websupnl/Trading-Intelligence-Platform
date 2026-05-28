from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.token_tracker import get_usage_summary

router = APIRouter(prefix="/api/ai")


@router.get("/usage")
async def get_ai_usage(db: AsyncSession = Depends(get_db)):
    """Token usage and estimated API cost overview."""
    return await get_usage_summary(db)
