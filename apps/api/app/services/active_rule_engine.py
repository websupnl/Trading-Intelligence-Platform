from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.rules import ActiveRule
from app.schemas.risk import RiskCheckRequest
from app.services.alpaca_broker import is_crypto


BLOCK_TYPES = {"block", "risk_block", "risk_filter", "symbol_block", "avoid", "skip"}
WARNING_TYPES = {"warning", "manual_review", "size_limit", "caution"}


@dataclass
class RuleDecision:
    approved: bool
    required_manual: bool
    reasons: list[str]
    warnings: list[str]
    blocked_by_rule: str | None = None


def _rule_text(rule: ActiveRule) -> str:
    return f"{rule.title or ''} {rule.description or ''}".upper()


def _matches_request(rule: ActiveRule, req: RiskCheckRequest) -> bool:
    text = _rule_text(rule)
    symbol = req.symbol.upper()
    if symbol in text:
        return True
    if is_crypto(symbol) and any(token in text for token in ["CRYPTO", "BTC", "BITCOIN"]):
        return True
    return any(token in text for token in ["ALL ASSETS", "ALLE ASSETS", "ALLE SYMBOLEN", "ANY SYMBOL"])


def _blocks(rule: ActiveRule) -> bool:
    text = _rule_text(rule)
    rule_type = (rule.rule_type or "").lower()
    return rule_type in BLOCK_TYPES or any(token in text for token in ["SKIP", "BLOCK", "NIET TRADEN", "VERMIJD"])


def _warns(rule: ActiveRule) -> bool:
    rule_type = (rule.rule_type or "").lower()
    return rule_type in WARNING_TYPES


async def evaluate_active_rules(req: RiskCheckRequest) -> RuleDecision:
    reasons: list[str] = []
    warnings: list[str] = []
    blocked_by_rule = None
    required_manual = False

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ActiveRule).where(ActiveRule.status == "active").order_by(ActiveRule.created_at.desc())
        )
        rules = result.scalars().all()

    for rule in rules:
        if not _matches_request(rule, req):
            continue

        label = f"{rule.title}: {rule.description[:180]}"
        if _blocks(rule):
            reasons.append(f"Actieve leerregel blokkeert trade: {label}")
            blocked_by_rule = rule.id
        elif _warns(rule):
            warnings.append(f"Actieve leerregel vraagt extra aandacht: {label}")
            required_manual = True

    return RuleDecision(
        approved=blocked_by_rule is None,
        required_manual=required_manual,
        reasons=reasons,
        warnings=warnings,
        blocked_by_rule=blocked_by_rule,
    )
