import logging
from datetime import datetime, timezone
from typing import Optional, Any
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit import AuditLog

logger = logging.getLogger(__name__)


class AuditLogService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def log(
        self,
        action: str,
        actor: str = "system",
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        details: Optional[dict] = None,
        status: str = "success",
        message: Optional[str] = None,
    ) -> AuditLog:
        # Strip secrets from details
        safe_details = self._sanitize(details) if details else None

        entry = AuditLog(
            action=action,
            actor=actor,
            entity_type=entity_type,
            entity_id=entity_id,
            details=safe_details,
            status=status,
            message=message,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(entry)
        try:
            await self.db.commit()
            await self.db.refresh(entry)
        except Exception as e:
            logger.error(f"Failed to write audit log: {e}")
            await self.db.rollback()
        return entry

    def _sanitize(self, data: Any) -> Any:
        if isinstance(data, dict):
            secret_keys = {"api_key", "secret_key", "password", "token", "bearer", "secret"}
            return {
                k: "[REDACTED]" if any(s in k.lower() for s in secret_keys) else self._sanitize(v)
                for k, v in data.items()
            }
        if isinstance(data, list):
            return [self._sanitize(i) for i in data]
        return data
