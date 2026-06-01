from dataclasses import dataclass, field
from typing import Optional


@dataclass
class StrategyConfig:
    name: str
    display_name: str
    description: str
    # Signal triggers
    min_news_impact: float = 5.0
    min_hype_score: float = 50.0
    min_ta_score: float = 0.3
    # Which signals are required (any combination)
    require_news: bool = False
    require_social: bool = False
    require_ta: bool = False
    # Risk parameters
    atr_multiplier_tp: float = 1.5
    atr_multiplier_sl: float = 1.0
    max_trades_per_day: int = 3
    max_hold_hours: int = 6
    # Assets (empty = all)
    asset_whitelist: list[str] = field(default_factory=list)
    # Scoring weights
    news_weight: float = 1.0
    social_weight: float = 1.0
    ta_weight: float = 1.0


STRATEGIES: dict[str, StrategyConfig] = {
    "NEWS_MOMENTUM": StrategyConfig(
        name="NEWS_MOMENTUM",
        display_name="Nieuws Momentum",
        description="Speelt in op high-impact nieuws. Zoekt naar assets met sterke positieve nieuwsstroom en bevestiging van TA.",
        min_news_impact=7.0,
        min_ta_score=0.2,
        require_news=True,
        atr_multiplier_tp=1.5,
        atr_multiplier_sl=1.0,
        max_trades_per_day=3,
        max_hold_hours=4,
        news_weight=2.0,
        social_weight=0.5,
        ta_weight=1.0,
    ),
    "HYPE_BREAKOUT": StrategyConfig(
        name="HYPE_BREAKOUT",
        display_name="Hype Breakout",
        description="Volgt social media momentum. Zoekt naar assets met exploderende hype én technische breakout boven EMA20.",
        min_hype_score=70.0,
        min_ta_score=0.25,
        require_social=True,
        atr_multiplier_tp=2.0,
        atr_multiplier_sl=1.0,
        max_trades_per_day=2,
        max_hold_hours=6,
        news_weight=0.5,
        social_weight=2.5,
        ta_weight=1.0,
    ),
    "TECHNICAL_SPIKE": StrategyConfig(
        name="TECHNICAL_SPIKE",
        display_name="Technische Spike",
        description="Puur technisch. Zoekt RSI oversold + MACD bullish crossover. Geen news nodig — prijs doet het werk.",
        min_ta_score=0.5,
        require_ta=True,
        atr_multiplier_tp=1.5,
        atr_multiplier_sl=0.75,
        max_trades_per_day=4,
        max_hold_hours=8,
        news_weight=0.3,
        social_weight=0.3,
        ta_weight=3.0,
    ),
}


def get_strategy(name: str) -> Optional[StrategyConfig]:
    return STRATEGIES.get(name)


def all_strategies() -> list[StrategyConfig]:
    return list(STRATEGIES.values())
