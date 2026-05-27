# Anthropic Claude Integratie

## Configuratie

```env
ANTHROPIC_API_KEY=jouw_key
ANTHROPIC_MODEL=claude-sonnet-4-5
ANTHROPIC_ENABLE_PROMPT_CACHING=true
ANTHROPIC_MAX_TOKENS=4096
ANTHROPIC_ENABLE_WEB_SEARCH=false
ANTHROPIC_ENABLE_WEB_FETCH=false
```

## Architectuurprincipe: AI als adviseur

Claude wordt altijd gebruikt als **adviseur**, nooit als uitvoerder.

```
Gebruiker/Systeem → Backend → Claude (analyse) → Structured JSON
                                    ↓
                             Backend valideert
                                    ↓
                      Backend voert actie uit (NIET Claude)
```

## Tool Use Architectuur

Claude mag tools aanvragen. De backend beslist of en hoe deze worden uitgevoerd.

### Tools die Claude MAY aanroepen
| Tool | Beschrijving |
|------|-------------|
| `get_recent_news` | Recente nieuwsitems ophalen |
| `get_social_mentions` | Social media vermeldingen |
| `get_market_context` | Marktcontext opvragen |
| `get_active_rules` | Actieve trading regels lezen |
| `search_memory` | Memory doorzoeken |
| `run_risk_check` | Risk check uitvoeren (informatief) |
| `create_pending_rule` | Nieuwe regel **voorstellen** (pending) |
| `write_trade_reflection` | Trade reflectie schrijven |

### Tools die Claude NOOIT krijgt
| Tool | Reden |
|------|-------|
| `submit_order` | Orders zijn menselijke beslissingen |
| `modify_active_rules` | Regels vereisen menselijke goedkeuring |
| `access_secrets` | API keys zijn niet voor Claude |
| `enable_live_trading` | Live trading vereist expliciete menselijke actie |

## Structured Outputs

Alle AI-outputs worden gevalideerd via Pydantic schemas:

```python
class NewsAnalysisResult(BaseModel):
    sentiment: str          # positive / negative / neutral
    sentiment_score: float  # 0.0 – 1.0
    impact_score: float     # 0.0 – 1.0
    affected_tickers: list[str]
    key_themes: list[str]
    confidence: float

class SignalDecision(BaseModel):
    direction: str          # buy / sell / hold
    confidence: float
    reason: str
    invalidation_level: Optional[float]
    risk_reward: Optional[float]

class PendingRuleProposal(BaseModel):
    title: str
    description: str
    rule_type: str
    confidence: float
    supporting_evidence: list[str]
```

## Prompt Caching

Prompt caching is standaard ingeschakeld (`ANTHROPIC_ENABLE_PROMPT_CACHING=true`).
Dit reduceert kosten bij herhaalde analyses met dezelfde systeemcontext.

## Status zonder API key

Als `ANTHROPIC_API_KEY` leeg is:
- `/api/config/status` toont `anthropic.configured: false`
- Dashboard toont "Anthropic: API key ontbreekt"
- AI agents geven `not_configured` status terug
- Geen nepdata, geen fake analyses

## Veiligheidsprincipe

> AI analyses zijn ondersteuning, geen garantie.
> Het systeem mag nooit winst beloven.
> Claude mag nooit direct live orders uitvoeren.
