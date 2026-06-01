"""Gok systeem tabellen

Revision ID: 005_gok_tables
Revises: 004_token_usage
Create Date: 2026-06-01 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "005_gok_tables"
down_revision: Union[str, None] = "004_token_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gok_strategies",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("active", sa.Boolean(), default=True),
        sa.Column("total_trades", sa.Integer(), default=0),
        sa.Column("wins", sa.Integer(), default=0),
        sa.Column("total_pnl", sa.Float(), default=0.0),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_gok_strategies_name", "gok_strategies", ["name"])

    op.create_table(
        "gok_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("strategy_name", sa.String(50), nullable=False),
        sa.Column("budget_eur", sa.Float(), nullable=False),
        sa.Column("mode", sa.String(10), default="paper"),
        sa.Column("status", sa.String(20), default="open"),
        sa.Column("outcome", sa.String(20), nullable=True),
        sa.Column("total_pnl", sa.Float(), nullable=True),
        sa.Column("total_pnl_pct", sa.Float(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_gok_sessions_strategy", "gok_sessions", ["strategy_name"])

    op.create_table(
        "gok_positions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), nullable=True),
        sa.Column("strategy_name", sa.String(50), nullable=False),
        sa.Column("asset", sa.String(20), nullable=False),
        sa.Column("side", sa.String(10), default="buy"),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("current_price", sa.Float(), nullable=True),
        sa.Column("take_profit", sa.Float(), nullable=True),
        sa.Column("stop_loss", sa.Float(), nullable=True),
        sa.Column("atr", sa.Float(), nullable=True),
        sa.Column("budget_eur", sa.Float(), nullable=False),
        sa.Column("pnl", sa.Float(), nullable=True),
        sa.Column("pnl_pct", sa.Float(), nullable=True),
        sa.Column("mode", sa.String(10), default="paper"),
        sa.Column("status", sa.String(20), default="open"),
        sa.Column("closed_reason", sa.String(50), nullable=True),
        sa.Column("opportunity_data", sa.JSON(), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("broker_order_id", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_gok_positions_asset", "gok_positions", ["asset"])
    op.create_index("ix_gok_positions_status", "gok_positions", ["status"])
    op.create_index("ix_gok_positions_session", "gok_positions", ["session_id"])

    op.create_table(
        "gok_score_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), nullable=True),
        sa.Column("position_id", sa.String(), nullable=True),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("points", sa.Integer(), default=0),
        sa.Column("streak_count", sa.Integer(), default=0),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_gok_score_events_session", "gok_score_events", ["session_id"])


def downgrade() -> None:
    op.drop_table("gok_score_events")
    op.drop_table("gok_positions")
    op.drop_table("gok_sessions")
    op.drop_table("gok_strategies")
