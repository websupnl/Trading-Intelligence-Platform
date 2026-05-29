import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from app.logging_config import setup_logging
from app.api import health, config, trading, risk, news, social, rumours, signals, memory, audit, outcomes, notifications
from app.api import settings as settings_router, chat, pipeline, stream, ai_usage, system, crypto_session, polymarket
from app.services.audit import AuditLogService
from app.services.settings_store import hydrate_runtime_settings
from app.database import AsyncSessionLocal
from app.config import get_settings

setup_logging()
logger = logging.getLogger(__name__)

# PIN auth — read from env, disabled if not set
_PIN_CODE = os.environ.get("DASHBOARD_PIN", "")
_PIN_ENABLED = bool(_PIN_CODE)

# Paths that bypass PIN (health check for monitoring)
_PIN_BYPASS_PATHS = {"/health", "/api/health", "/"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Trading OS API gestart")
    async with AsyncSessionLocal() as db:
        await hydrate_runtime_settings(db)
        audit_svc = AuditLogService(db)
        await audit_svc.log("app_startup", message="Trading OS API gestart")
    yield
    logger.info("Trading OS API gestopt")


app = FastAPI(
    title="Trading OS API",
    description="Trading Intelligence Platform",
    version="1.1.0",
    lifespan=lifespan,
)

# ─── PIN Auth Middleware ───────────────────────────────────────────────────────

if _PIN_ENABLED:
    @app.middleware("http")
    async def pin_auth_middleware(request: Request, call_next):
        if request.url.path in _PIN_BYPASS_PATHS:
            return await call_next(request)

        # Allow OPTIONS (CORS preflight)
        if request.method == "OPTIONS":
            return await call_next(request)

        # Check PIN header or query param
        pin = (
            request.headers.get("X-Dashboard-Pin", "")
            or request.query_params.get("pin", "")
        )
        if pin != _PIN_CODE:
            return Response(
                content='{"detail":"Unauthorized - PIN vereist"}',
                status_code=401,
                media_type="application/json",
                headers={"WWW-Authenticate": "PIN"},
            )
        return await call_next(request)

# ─── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────────────────────────

app.include_router(health.router)
app.include_router(config.router)
app.include_router(trading.router)
app.include_router(risk.router)
app.include_router(news.router)
app.include_router(social.router)
app.include_router(rumours.router)
app.include_router(signals.router)
app.include_router(outcomes.router)
app.include_router(notifications.router)
app.include_router(memory.router)
app.include_router(audit.router)
app.include_router(settings_router.router)
app.include_router(chat.router)
app.include_router(pipeline.router)
app.include_router(stream.router)
app.include_router(ai_usage.router)
app.include_router(system.router)
app.include_router(crypto_session.router)
app.include_router(polymarket.router)
