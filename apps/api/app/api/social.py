from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.social import SocialPost

router = APIRouter(prefix="/api/social")


@router.get("/posts")
async def get_posts(limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SocialPost).order_by(desc(SocialPost.posted_at)).limit(limit))
    items = result.scalars().all()
    return [{"id": i.id, "platform": i.platform, "author": i.author, "content": i.content[:500],
             "subreddit": i.subreddit, "tickers": i.tickers, "sentiment": i.sentiment,
             "hype_score": i.hype_score, "score": i.score, "num_comments": i.num_comments,
             "posted_at": i.posted_at, "url": i.url}
            for i in items]


@router.post("/reddit/fetch")
async def fetch_reddit():
    from app.services.reddit_service import RedditScraperService
    svc = RedditScraperService()
    try:
        count = await svc.fetch_all()
        return {"status": "ok", "fetched": count}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/x/fetch")
async def fetch_x():
    return {"status": "not_configured", "message": "X/Twitter integratie vereist X_BEARER_TOKEN"}
