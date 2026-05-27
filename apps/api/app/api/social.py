from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.social import SocialPost
from app.config import get_settings

router = APIRouter(prefix="/api/social")
settings = get_settings()


@router.get("/posts")
async def get_posts(limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SocialPost).order_by(desc(SocialPost.created_at)).limit(limit))
    items = result.scalars().all()
    return [{"id": i.id, "platform": i.platform, "author": i.author, "content": i.content[:500],
             "tickers": i.tickers, "sentiment": i.sentiment, "hype_score": i.hype_score,
             "score": i.score, "posted_at": i.posted_at}
            for i in items]


@router.post("/reddit/fetch")
async def fetch_reddit():
    if not settings.reddit_configured:
        return {"status": "not_configured", "message": "Reddit API keys ontbreken. Vul REDDIT_CLIENT_ID en REDDIT_CLIENT_SECRET in .env in."}
    return {"status": "not_implemented", "message": "Reddit fetch wordt getriggerd via worker"}


@router.post("/x/fetch")
async def fetch_x():
    if not settings.x_configured:
        return {"status": "not_configured", "message": "X Bearer token ontbreekt. Vul X_BEARER_TOKEN in .env in."}
    return {"status": "not_implemented", "message": "X fetch wordt getriggerd via worker"}
