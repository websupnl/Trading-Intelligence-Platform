"""Oracle regime states

Revision ID: 006_regime_states
Revises: 005_gok_tables
Create Date: 2026-06-01 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006_regime_states"
down_revision: Union[str, None] = "005_gok_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regime_states",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("regime", sa.String(40), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, default=0.0),
        sa.Column("vix", sa.Float(), nullable=True),
        sa.Column("spy_vs_ema50", sa.Float(), nullable=True),
        sa.Column("spy_vs_ema200", sa.Float(), nullable=True),
        sa.Column("btc_dominance", sa.Float(), nullable=True),
        sa.Column("dollar_trend", sa.String(20), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_regime_states_regime", "regime_states", ["regime"])
    op.create_index("ix_regime_states_computed_at", "regime_states", ["computed_at"])


def downgrade() -> None:
    op.drop_index("ix_regime_states_computed_at", table_name="regime_states")
    op.drop_index("ix_regime_states_regime", table_name="regime_states")
    op.drop_table("regime_states")
