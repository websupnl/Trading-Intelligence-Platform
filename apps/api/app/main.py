import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.logging_config import setup_logging
from app.api import health, config, trading, risk, news, social, rumours, signals, memory, audit, settings as settings_router
from app.services.audit import AuditLogService
from app.database import AsyncSessionLocal

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Trading OS API gestart")
    async with AsyncSessionLocal() as db:
        audit = AuditLogService(db)
        await audit.log("app_startup", message="Trading OS API gestart")
    yield
    logger.info("Trading OS API gestopt")


app = FastAPI(
    title="Trading OS API",
    description="Trading Intelligence Platform - Lokaal draaiend systeem",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(config.router)
app.include_router(trading.router)
app.include_router(risk.router)
app.include_router(news.router)
app.include_router(social.router)
app.include_router(rumours.router)
app.include_router(signals.router)
app.include_router(memory.router)
app.include_router(audit.router)
app.include_router(settings_router.router)
