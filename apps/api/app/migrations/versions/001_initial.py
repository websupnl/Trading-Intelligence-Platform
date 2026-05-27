"""Initial schema

Revision ID: 001_initial
Revises:
Create Date: 2025-01-01 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("asset_class", sa.String(50), default="us_equity"),
        sa.Column("exchange", sa.String(50), nullable=True),
        sa.Column("tradable", sa.Boolean(), default=True),
        sa.Column("shortable", sa.Boolean(), default=False),
        sa.Column("marginable", sa.Boolean(), default=False),
        sa.Column("fractionable", sa.Boolean(), default=False),
        sa.Column("min_order_size", sa.Float(), nullable=True),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_assets_symbol", "assets", ["symbol"])

    op.create_table(
        "candles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("timeframe", sa.String(10), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", sa.Float(), nullable=False),
        sa.Column("high", sa.Float(), nullable=False),
        sa.Column("low", sa.Float(), nullable=False),
        sa.Column("close", sa.Float(), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False),
        sa.Column("vwap", sa.Float(), nullable=True),
        sa.Column("trade_count", sa.BigInteger(), nullable=True),
        sa.Column("source", sa.String(50), default="alpaca"),
        sa.UniqueConstraint("symbol", "timeframe", "timestamp", name="uq_candles_symbol_tf_ts"),
    )
    op.create_index("ix_candles_symbol", "candles", ["symbol"])
    op.create_index("ix_candles_timestamp", "candles", ["timestamp"])

    op.create_table(
        "news_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(1000), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("url", sa.String(2000), nullable=True, unique=True),
        sa.Column("source", sa.String(255), nullable=False),
        sa.Column("source_type", sa.String(50), default="rss"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tickers", sa.JSON(), default=list),
        sa.Column("sentiment", sa.String(20), nullable=True),
        sa.Column("sentiment_score", sa.Float(), nullable=True),
        sa.Column("impact_score", sa.Float(), nullable=True),
        sa.Column("ai_analyzed", sa.Boolean(), default=False),
        sa.Column("ai_analysis", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(20), default="new"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "social_posts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("url", sa.String(2000), nullable=True),
        sa.Column("subreddit", sa.String(100), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tickers", sa.JSON(), default=list),
        sa.Column("score", sa.BigInteger(), nullable=True),
        sa.Column("num_comments", sa.BigInteger(), nullable=True),
        sa.Column("sentiment", sa.String(20), nullable=True),
        sa.Column("sentiment_score", sa.Float(), nullable=True),
        sa.Column("hype_score", sa.Float(), nullable=True),
        sa.Column("ai_analyzed", sa.Boolean(), default=False),
        sa.Column("ai_analysis", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "rumours",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("related_assets", sa.JSON(), default=list),
        sa.Column("source_news_ids", sa.JSON(), default=list),
        sa.Column("source_post_ids", sa.JSON(), default=list),
        sa.Column("independent_source_count", sa.Integer(), default=0),
        sa.Column("confidence", sa.Float(), default=0.0),
        sa.Column("manipulation_risk", sa.Float(), default=0.0),
        sa.Column("hype_velocity", sa.Float(), default=0.0),
        sa.Column("official_confirmation", sa.Boolean(), default=False),
        sa.Column("recommendation", sa.String(50), default="watch"),
        sa.Column("ai_analysis", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "narratives",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("narrative_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("strength", sa.Float(), default=0.0),
        sa.Column("momentum", sa.Float(), default=0.0),
        sa.Column("affected_assets", sa.JSON(), default=list),
        sa.Column("supporting_news_ids", sa.JSON(), default=list),
        sa.Column("evidence_count", sa.Integer(), default=0),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "signals",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("asset", sa.String(20), nullable=False),
        sa.Column("direction", sa.String(10), nullable=False),
        sa.Column("timeframe", sa.String(20), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), default=0.0),
        sa.Column("invalidation_level", sa.Float(), nullable=True),
        sa.Column("suggested_entry", sa.Float(), nullable=True),
        sa.Column("suggested_stop", sa.Float(), nullable=True),
        sa.Column("suggested_take_profit", sa.Float(), nullable=True),
        sa.Column("risk_reward", sa.Float(), nullable=True),
        sa.Column("status", sa.String(20), default="pending"),
        sa.Column("risk_check_result", sa.JSON(), nullable=True),
        sa.Column("ai_analysis", sa.JSON(), nullable=True),
        sa.Column("source_rumour_id", sa.String(), nullable=True),
        sa.Column("source_narrative_id", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "trades",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("signal_id", sa.String(), nullable=True),
        sa.Column("order_id", sa.String(), nullable=True),
        sa.Column("alpaca_order_id", sa.String(), nullable=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=True),
        sa.Column("exit_price", sa.Float(), nullable=True),
        sa.Column("stop_loss", sa.Float(), nullable=True),
        sa.Column("take_profit", sa.Float(), nullable=True),
        sa.Column("pnl", sa.Float(), nullable=True),
        sa.Column("pnl_pct", sa.Float(), nullable=True),
        sa.Column("mode", sa.String(10), default="paper"),
        sa.Column("status", sa.String(20), default="open"),
        sa.Column("entry_reason", sa.Text(), nullable=True),
        sa.Column("exit_reason", sa.Text(), nullable=True),
        sa.Column("ai_reflection", sa.JSON(), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("memory_file_path", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "orders",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("alpaca_order_id", sa.String(255), nullable=True, unique=True),
        sa.Column("signal_id", sa.String(), nullable=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("order_type", sa.String(20), default="market"),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("notional", sa.Float(), nullable=True),
        sa.Column("limit_price", sa.Float(), nullable=True),
        sa.Column("stop_price", sa.Float(), nullable=True),
        sa.Column("filled_price", sa.Float(), nullable=True),
        sa.Column("filled_qty", sa.Float(), nullable=True),
        sa.Column("mode", sa.String(10), default="paper"),
        sa.Column("status", sa.String(30), default="pending"),
        sa.Column("risk_check_result", sa.JSON(), nullable=True),
        sa.Column("alpaca_response", sa.JSON(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "positions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("avg_entry_price", sa.Float(), nullable=False),
        sa.Column("current_price", sa.Float(), nullable=True),
        sa.Column("market_value", sa.Float(), nullable=True),
        sa.Column("unrealized_pnl", sa.Float(), nullable=True),
        sa.Column("unrealized_pnl_pct", sa.Float(), nullable=True),
        sa.Column("side", sa.String(10), default="long"),
        sa.Column("mode", sa.String(10), default="paper"),
        sa.Column("status", sa.String(20), default="open"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "risk_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("symbol", sa.String(20), nullable=True),
        sa.Column("side", sa.String(10), nullable=True),
        sa.Column("quantity", sa.Float(), nullable=True),
        sa.Column("notional", sa.Float(), nullable=True),
        sa.Column("approved", sa.Boolean(), default=False),
        sa.Column("reasons", sa.JSON(), default=list),
        sa.Column("warnings", sa.JSON(), default=list),
        sa.Column("blocked_by_rule", sa.String(255), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("actor", sa.String(100), default="system"),
        sa.Column("entity_type", sa.String(50), nullable=True),
        sa.Column("entity_id", sa.String(255), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(20), default="success"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])

    op.create_table(
        "ai_agent_runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("agent_name", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("input_summary", sa.Text(), nullable=True),
        sa.Column("output", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("tokens_used", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), default="success"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=True),
        sa.Column("entity_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "memory_entries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("memory_type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("tags", sa.JSON(), default=list),
        sa.Column("related_symbols", sa.JSON(), default=list),
        sa.Column("importance", sa.Float(), default=0.5),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("qdrant_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "source_credibility",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("source_name", sa.String(255), nullable=False, unique=True),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("credibility_score", sa.Float(), default=0.5),
        sa.Column("accuracy_score", sa.Float(), default=0.5),
        sa.Column("total_signals", sa.Integer(), default=0),
        sa.Column("correct_signals", sa.Integer(), default=0),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "strategy_performance",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("strategy_name", sa.String(255), nullable=False),
        sa.Column("total_trades", sa.Integer(), default=0),
        sa.Column("winning_trades", sa.Integer(), default=0),
        sa.Column("losing_trades", sa.Integer(), default=0),
        sa.Column("win_rate", sa.Float(), nullable=True),
        sa.Column("avg_pnl", sa.Float(), nullable=True),
        sa.Column("total_pnl", sa.Float(), default=0.0),
        sa.Column("avg_rr", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "settings",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("value_type", sa.String(20), default="string"),
        sa.Column("is_secret", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "pending_rules",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("rule_type", sa.String(50), nullable=False),
        sa.Column("proposed_by", sa.String(100), default="ai"),
        sa.Column("confidence", sa.Float(), default=0.5),
        sa.Column("supporting_evidence", sa.JSON(), default=list),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("status", sa.String(20), default="pending"),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.String(100), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "active_rules",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("pending_rule_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("rule_type", sa.String(50), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("approved_by", sa.String(100), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    for table in ["active_rules", "pending_rules", "settings", "strategy_performance",
                  "source_credibility", "memory_entries", "ai_agent_runs", "audit_logs",
                  "risk_events", "positions", "orders", "trades", "signals", "narratives",
                  "rumours", "social_posts", "news_items", "candles", "assets"]:
        op.drop_table(table)
