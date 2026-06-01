import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import select, func
from app.database import AsyncSessionLocal
from app.config import get_settings
from app.models.gok import GokPosition, GokSession, GokScoreEvent
from app.gok.schemas import ExecuteRequest, GokPositionOut, GokStatsOut
from app.gok.risk import calculate_quantity, validate_gok_trade, MAX_DAILY_GOK_TRADES
from app.gok.strategies import get_strategy
from app.gok.ws_manager import gok_ws_manager

logger = logging.getLogger(__name__)


class GokEngine:
    def __init__(self):
        self.settings = get_settings()

    async def get_open_positions_count(self) -> int:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(func.count(GokPosition.id)).where(GokPosition.status == "open")
            )
            return result.scalar() or 0

    async def get_daily_trades_count(self) -> int:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(func.count(GokPosition.id)).where(
                    GokPosition.opened_at >= today_start
                )
            )
            return result.scalar() or 0

    async def execute(self, req: ExecuteRequest) -> GokPositionOut:
        """Voer een gok trade uit (paper of live)."""
        strategy = get_strategy(req.strategy)
        if not strategy:
            raise ValueError(f"Onbekende strategie: {req.strategy}")

        open_count = await self.get_open_positions_count()
        daily_count = await self.get_daily_trades_count()

        ok, reason = validate_gok_trade(
            budget_eur=req.budget_eur,
            entry_price=req.entry_price,
            stop_loss=req.stop_loss,
            open_positions=open_count,
            daily_trades=daily_count,
            max_daily_trades=strategy.max_trades_per_day,
            kill_switch=self.settings.kill_switch_enabled,
        )
        if not ok:
            raise ValueError(f"Trade geweigerd: {reason}")

        mode = await self._get_gok_mode()
        quantity = calculate_quantity(req.budget_eur, req.entry_price)

        # Maak sessie aan
        session = GokSession(
            strategy_name=req.strategy,
            budget_eur=req.budget_eur,
            mode=mode,
            status="open",
            started_at=datetime.now(timezone.utc),
        )

        # Maak positie aan
        position = GokPosition(
            strategy_name=req.strategy,
            asset=req.asset,
            side="buy",
            quantity=quantity,
            entry_price=req.entry_price,
            current_price=req.entry_price,
            take_profit=req.take_profit,
            stop_loss=req.stop_loss,
            atr=req.atr,
            budget_eur=req.budget_eur,
            pnl=0.0,
            pnl_pct=0.0,
            mode=mode,
            status="open",
            opportunity_data=req.opportunity_data,
            opened_at=datetime.now(timezone.utc),
        )

        async with AsyncSessionLocal() as db:
            db.add(session)
            await db.flush()
            position.session_id = session.id
            db.add(position)
            await db.commit()
            await db.refresh(position)

        logger.info(f"Gok trade uitgevoerd: {req.asset} {mode} €{req.budget_eur} strategie={req.strategy}")

        pos_out = GokPositionOut(
            id=position.id,
            session_id=position.session_id,
            strategy_name=position.strategy_name,
            asset=position.asset,
            side=position.side,
            quantity=position.quantity,
            entry_price=position.entry_price,
            current_price=position.current_price,
            take_profit=position.take_profit,
            stop_loss=position.stop_loss,
            budget_eur=position.budget_eur,
            pnl=position.pnl,
            pnl_pct=position.pnl_pct,
            mode=position.mode,
            status=position.status,
            closed_reason=position.closed_reason,
            opened_at=position.opened_at,
            closed_at=position.closed_at,
        )

        # Broadcast naar WS
        await gok_ws_manager.broadcast("position_opened", {
            "position_id": position.id,
            "asset": req.asset,
            "strategy": req.strategy,
            "entry_price": req.entry_price,
            "take_profit": req.take_profit,
            "stop_loss": req.stop_loss,
            "budget_eur": req.budget_eur,
            "mode": mode,
        })

        return pos_out

    async def close_position(self, position_id: str, reason: str = "manual") -> Optional[GokPositionOut]:
        """Sluit een open gok positie."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(GokPosition).where(
                    GokPosition.id == position_id,
                    GokPosition.status == "open",
                ).limit(1)
            )
            position = result.scalar_one_or_none()
            if not position:
                return None

            # Haal huidige prijs op
            from app.services.market_data_service import MarketDataService
            mds = MarketDataService()
            current_price = await mds.get_latest_price(position.asset) or position.entry_price

            pnl = (current_price - position.entry_price) * position.quantity
            pnl_pct = (current_price - position.entry_price) / position.entry_price * 100

            position.status = "closed"
            position.closed_reason = reason
            position.current_price = current_price
            position.pnl = round(pnl, 4)
            position.pnl_pct = round(pnl_pct, 4)
            position.closed_at = datetime.now(timezone.utc)

            # Update sessie
            if position.session_id:
                session_result = await db.execute(
                    select(GokSession).where(GokSession.id == position.session_id).limit(1)
                )
                session = session_result.scalar_one_or_none()
                if session:
                    session.status = "closed"
                    session.outcome = "win" if pnl > 0 else "loss"
                    session.total_pnl = round(pnl, 4)
                    session.total_pnl_pct = round(pnl_pct, 4)
                    session.ended_at = datetime.now(timezone.utc)

            # Score event
            await self._record_score(db, position, pnl)
            await db.commit()
            await db.refresh(position)

            pos_out = GokPositionOut(
                id=position.id,
                session_id=position.session_id,
                strategy_name=position.strategy_name,
                asset=position.asset,
                side=position.side,
                quantity=position.quantity,
                entry_price=position.entry_price,
                current_price=position.current_price,
                take_profit=position.take_profit,
                stop_loss=position.stop_loss,
                budget_eur=position.budget_eur,
                pnl=position.pnl,
                pnl_pct=position.pnl_pct,
                mode=position.mode,
                status=position.status,
                closed_reason=position.closed_reason,
                opened_at=position.opened_at,
                closed_at=position.closed_at,
            )

        await gok_ws_manager.broadcast("position_closed", {
            "position_id": position_id,
            "asset": pos_out.asset,
            "reason": reason,
            "pnl": pos_out.pnl,
            "pnl_pct": pos_out.pnl_pct,
        })

        return pos_out

    async def get_stats(self) -> GokStatsOut:
        async with AsyncSessionLocal() as db:
            all_result = await db.execute(
                select(GokPosition).where(GokPosition.status == "closed")
                .order_by(GokPosition.closed_at.desc())
            )
            closed = all_result.scalars().all()

            open_result = await db.execute(
                select(func.count(GokPosition.id)).where(GokPosition.status == "open")
            )
            open_count = open_result.scalar() or 0

        wins = [p for p in closed if (p.pnl or 0) > 0]
        losses = [p for p in closed if (p.pnl or 0) <= 0]
        total = len(closed)
        win_rate = len(wins) / total if total > 0 else 0.0
        total_pnl = sum(p.pnl or 0 for p in closed)
        best = max((p.pnl or 0 for p in closed), default=0.0)
        worst = min((p.pnl or 0 for p in closed), default=0.0)

        # Streak berekening
        streak = 0
        for p in closed:
            if (p.pnl or 0) > 0:
                streak += 1
            else:
                break

        # Dagelijkse score
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            score_result = await db.execute(
                select(func.sum(GokScoreEvent.points)).where(
                    GokScoreEvent.created_at >= today_start
                )
            )
            daily_score = score_result.scalar() or 0

        return GokStatsOut(
            total_trades=total,
            wins=len(wins),
            losses=len(losses),
            win_rate=round(win_rate, 4),
            total_pnl=round(total_pnl, 4),
            best_trade_pnl=round(best, 4),
            worst_trade_pnl=round(worst, 4),
            current_streak=streak,
            daily_score=int(daily_score),
            open_positions=open_count,
        )

    async def _get_gok_mode(self) -> str:
        """Bepaal of gok in paper of live modus draait."""
        async with AsyncSessionLocal() as db:
            from app.models.settings import Setting
            result = await db.execute(
                select(Setting).where(Setting.key == "gok_mode").limit(1)
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value == "live" and self.settings.live_trading_enabled:
                return "live"
        return "paper"

    async def _record_score(self, db, position: GokPosition, pnl: float):
        """Sla gamificatie score event op."""
        event_type = "trade_win" if pnl > 0 else "trade_loss"
        base_points = 100 if pnl > 0 else -20

        event = GokScoreEvent(
            session_id=position.session_id,
            position_id=position.id,
            event_type=event_type,
            points=base_points,
            details={"pnl": round(pnl, 4), "asset": position.asset, "strategy": position.strategy_name},
            recorded_at=datetime.now(timezone.utc),
        )
        db.add(event)
