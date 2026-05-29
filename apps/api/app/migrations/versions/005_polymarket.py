"""Add Polymarket positions table

Revision ID: 005_polymarket
Revises: 004_token_usage
Create Date: 2026-05-29 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "005_polymarket"
down_revision: Union[str, None] = "004_token_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "polymarket_positions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("condition_id", sa.String(200), nullable=False, index=True),
        sa.Column("yes_token_id", sa.String(200), nullable=True),
        sa.Column("no_token_id", sa.String(200), nullable=True),
        sa.Column("market_question", sa.Text(), nullable=False),
        sa.Column("market_slug", sa.String(300), nullable=True),
        sa.Column("market_end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("shares", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("invested_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("current_price", sa.Float(), nullable=True),
        sa.Column("ai_probability", sa.Float(), nullable=True),
        sa.Column("market_probability", sa.Float(), nullable=True),
        sa.Column("edge", sa.Float(), nullable=True),
        sa.Column("mode", sa.String(10), nullable=False, server_default="paper"),
        sa.Column("status", sa.String(30), nullable=False, server_default="open", index=True),
        sa.Column("pnl", sa.Float(), nullable=True),
        sa.Column("pnl_pct", sa.Float(), nullable=True),
        sa.Column("ai_reasoning", sa.Text(), nullable=True),
        sa.Column("ai_analysis", sa.JSON(), nullable=True),
        sa.Column("broker_order_id", sa.String(200), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("polymarket_positions")
