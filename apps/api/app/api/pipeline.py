"""
Pipeline control API: monitor and trigger Celery tasks.
"""
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.audit import AuditLogService

router = APIRouter(prefix="/api/pipeline")
logger = logging.getLogger(__name__)

# Task registry: task name → human label + schedule info
TASK_REGISTRY = {
    "ingest_news": {
        "name": "app.tasks.news_tasks.ingest_news",
        "label": "Nieuws Ingestie",
        "description": "Haalt RSS feeds op (Reuters, CNBC, Bloomberg, etc.)",
        "schedule_sec": 900,
        "schedule_label": "Elke 15 min",
        "category": "data",
    },
    "fetch_reddit": {
        "name": "app.tasks.social_tasks.fetch_reddit",
        "label": "Reddit Scraper",
        "description": "Haalt posts van r/wallstreetbets, stocks, investing op",
        "schedule_sec": 1800,
        "schedule_label": "Elke 30 min",
        "category": "data",
    },
    "analyze_content": {
        "name": "app.tasks.analysis_tasks.analyze_news",
        "label": "AI Analyse (Claude)",
        "description": "Analyseert nieuws en social posts met Claude op sentiment, tickers, impact",
        "schedule_sec": 300,
        "schedule_label": "Elke 5 min",
        "category": "ai",
    },
    "detect_rumours": {
        "name": "app.tasks.analysis_tasks.detect_rumours",
        "label": "Rumour Detector",
        "description": "Detecteert geruchten via cross-source patroonherkenning",
        "schedule_sec": 1800,
        "schedule_label": "Elke 30 min",
        "category": "ai",
    },
    "fetch_market_data": {
        "name": "app.tasks.analysis_tasks.fetch_market_data",
        "label": "Marktdata (OHLCV)",
        "description": "Haalt dagelijkse OHLCV bars op via Alpaca voor TA",
        "schedule_sec": 3600,
        "schedule_label": "Elk uur",
        "category": "data",
    },
    "generate_signals": {
        "name": "app.tasks.signal_tasks.generate_signals",
        "label": "Signaal Generator",
        "description": "Genereert trading signalen via multi-factor AI analyse",
        "schedule_sec": 900,
        "schedule_label": "Elke 15 min",
        "category": "trading",
    },
    "auto_trade": {
        "name": "app.tasks.analysis_tasks.auto_trade",
        "label": "Auto Trader",
        "description": "Voert automatisch hoge-confidence signalen uit (paper mode)",
        "schedule_sec": 300,
        "schedule_label": "Elke 5 min",
        "category": "trading",
    },
    "sync_closed_trades": {
        "name": "app.tasks.analysis_tasks.sync_closed_trades",
        "label": "Trade Sync & Leren",
        "description": "Synchroniseert gesloten posities, berekent P&L, schrijft AI lessen",
        "schedule_sec": 300,
        "schedule_label": "Elke 5 min",
        "category": "trading",
    },
}


@router.get("/status")
async def get_pipeline_status():
    """Return status of all scheduled tasks from Celery."""
    try:
        from app.workers.celery_app import celery_app
        inspector = celery_app.control.inspect(timeout=2.0)
        active = inspector.active() or {}
        scheduled = inspector.scheduled() or {}
        reserved = inspector.reserved() or {}

        # Flatten running tasks
        running_tasks = set()
        for worker_tasks in active.values():
            for t in worker_tasks:
                running_tasks.add(t.get("name", ""))

        tasks = []
        for key, info in TASK_REGISTRY.items():
            is_running = info["name"] in running_tasks
            tasks.append({
                "key": key,
                "name": info["name"],
                "label": info["label"],
                "description": info["description"],
                "schedule_sec": info["schedule_sec"],
                "schedule_label": info["schedule_label"],
                "category": info["category"],
                "is_running": is_running,
                "status": "running" if is_running else "idle",
            })

        return {
            "tasks": tasks,
            "worker_online": len(active) > 0,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"Pipeline status fout (Celery niet bereikbaar?): {e}")
        # Return static info without live status
        return {
            "tasks": [
                {**{"key": k, **v, "is_running": False, "status": "unknown"}}
                for k, v in TASK_REGISTRY.items()
            ],
            "worker_online": False,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "error": "Celery worker niet bereikbaar",
        }


@router.post("/trigger/{task_key}")
async def trigger_task(task_key: str, db: AsyncSession = Depends(get_db)):
    """Manually trigger a Celery task by key."""
    if task_key not in TASK_REGISTRY:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Taak '{task_key}' niet gevonden")

    task_info = TASK_REGISTRY[task_key]
    audit = AuditLogService(db)

    try:
        from app.workers.celery_app import celery_app
        result = celery_app.send_task(task_info["name"])
        await audit.log(
            "pipeline_task_triggered",
            actor="user",
            entity_type="task",
            entity_id=task_key,
            details={"task_name": task_info["name"], "task_id": result.id},
        )
        return {
            "status": "triggered",
            "task_key": task_key,
            "label": task_info["label"],
            "task_id": result.id,
            "message": f"'{task_info['label']}' is gestart",
        }
    except Exception as e:
        await audit.log(
            "pipeline_task_trigger_failed",
            actor="user",
            entity_type="task",
            entity_id=task_key,
            status="error",
            message=str(e),
        )
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Taak starten mislukt: {e}")


@router.post("/trigger-all-data")
async def trigger_full_pipeline(db: AsyncSession = Depends(get_db)):
    """Trigger the full data collection pipeline in order."""
    audit = AuditLogService(db)
    from app.workers.celery_app import celery_app

    triggered = []
    tasks = ["ingest_news", "fetch_reddit", "fetch_market_data"]
    for key in tasks:
        try:
            info = TASK_REGISTRY[key]
            result = celery_app.send_task(info["name"])
            triggered.append({"key": key, "label": info["label"], "task_id": result.id})
        except Exception as e:
            logger.error(f"Pipeline trigger fout {key}: {e}")

    await audit.log(
        "full_pipeline_triggered",
        actor="user",
        details={"triggered_tasks": [t["key"] for t in triggered]},
    )
    return {"status": "triggered", "tasks": triggered}
