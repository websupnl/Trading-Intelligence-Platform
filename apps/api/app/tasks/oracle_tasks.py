import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.oracle_tasks.oracle_morning_brief")
def oracle_morning_brief():
    """Oracle Morning Brief — dagelijks 06:01 UTC. Genereert dagplan en schrijft oracle.md."""
    from app.services.oracle_brain import OracleBrainService
    from app.services.ai_guard import check_daily_budget
    try:
        has_budget = asyncio.run(check_daily_budget())
        if not has_budget:
            logger.warning("Oracle Morning Brief overgeslagen: dagbudget bereikt")
            return {"status": "skipped", "reason": "budget"}

        svc = OracleBrainService()
        brief = asyncio.run(svc.generate_morning_brief())

        if brief.get("error"):
            logger.error(f"Oracle Morning Brief fout: {brief['error']}")
            return {"status": "error", "message": brief["error"]}

        md = OracleBrainService.brief_to_markdown(brief, brief_type="morning")
        _write_oracle_md(md)

        return {
            "status": "ok",
            "mood": brief.get("mood"),
            "regime": brief.get("regime"),
            "risk_budget_pct": brief.get("risk_budget_pct"),
        }
    except Exception as e:
        logger.error(f"Oracle Morning Brief taak fout: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.oracle_tasks.oracle_eod_review")
def oracle_eod_review():
    """Oracle EOD Review — dagelijks 22:00 UTC. Evalueert dag en schrijft lessen."""
    from app.services.oracle_brain import OracleBrainService
    from app.services.ai_guard import check_daily_budget
    try:
        has_budget = asyncio.run(check_daily_budget())
        if not has_budget:
            logger.warning("Oracle EOD Review overgeslagen: dagbudget bereikt")
            return {"status": "skipped", "reason": "budget"}

        svc = OracleBrainService()
        review = asyncio.run(svc.generate_eod_review())

        if review.get("error"):
            logger.error(f"Oracle EOD Review fout: {review['error']}")
            return {"status": "error", "message": review["error"]}

        md = OracleBrainService.brief_to_markdown(review, brief_type="eod")
        _append_eod_to_oracle_md(md)

        return {
            "status": "ok",
            "dag_rating": review.get("dag_rating"),
            "pnl_today": review.get("pnl_today"),
        }
    except Exception as e:
        logger.error(f"Oracle EOD Review taak fout: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


def _write_oracle_md(content: str):
    """Schrijft /root/oracle.md — werkt zowel in container als op host."""
    paths = ["/root/oracle.md", "/tmp/oracle.md"]
    for path in paths:
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            logger.info(f"oracle.md geschreven naar {path}")
            return
        except OSError:
            continue
    logger.warning("Kon oracle.md niet schrijven naar /root/ of /tmp/")


def _append_eod_to_oracle_md(content: str):
    """Voegt EOD review toe aan bestaande oracle.md."""
    paths = ["/root/oracle.md", "/tmp/oracle.md"]
    for path in paths:
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write("\n\n---\n\n")
                f.write(content)
            logger.info(f"EOD review toegevoegd aan {path}")
            return
        except OSError:
            continue
    logger.warning("Kon EOD review niet toevoegen aan oracle.md")
