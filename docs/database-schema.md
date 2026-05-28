# Database Schema

## Tabellen overzicht

| Tabel | Omschrijving |
|-------|-------------|
| assets | Handelbare instrumenten |
| candles | OHLCV kaarsendata |
| news_items | Nieuwsitems uit RSS feeds |
| social_posts | Posts van Reddit/X |
| rumours | Gedetecteerde geruchten |
| narratives | Marktnarratives |
| signals | Trading signals |
| signal_outcomes | Objectieve 1- en 5-daagse signaaluitkomsten |
| trades | Uitgevoerde trades |
| orders | Orders (paper + live) |
| positions | Open posities |
| risk_events | Risk check log |
| audit_logs | Systeemgebeurtenissen |
| ai_agent_runs | AI agent uitvoeringen |
| memory_entries | Memory systeem index |
| source_credibility | Bron geloofwaardigheid |
| strategy_performance | Strategie performance |
| settings | Systeeminstellingen |
| pending_rules | Wachtende regels |
| active_rules | Actieve regels |
| notifications | Telegram-alerts en afleverstatus |

## Sleutelvelden

### Alle tijdstempeltabellen
- `created_at` — aanmaakdatum (UTC)
- `updated_at` — laatste wijziging (UTC)

### Alle ID-velden
- UUID strings (geen auto-increment integers)

### Statusvelden
- `status` — huidige staat van het record

### Confidence velden
- Float tussen 0.0 en 1.0

## signals tabel (kernentiteit)

```
id              UUID
asset           string(20)    # symbool bijv. AAPL
direction       string(10)    # buy / sell
timeframe       string(20)    # 1D, 4H, etc.
reason          text          # uitleg
confidence      float         # 0.0 - 1.0
invalidation_level  float     # prijsniveau waarop signal ongeldig is
suggested_entry float
suggested_stop  float
suggested_take_profit float
risk_reward     float
status          string(20)    # pending / paper_traded / rejected / expired
risk_check_result   JSON      # resultaat van risk engine
ai_analysis     JSON          # AI analyse output
source_rumour_id    string    # FK naar rumours
source_narrative_id string    # FK naar narratives
expires_at      datetime
```

## audit_logs tabel

Alle acties worden gelogd. Secrets worden automatisch verwijderd door AuditLogService.

```
id          UUID
action      string(100)   # bijv. order_submitted, kill_switch_enabled
actor       string(100)   # system / user / ai_agent
entity_type string(50)    # order / signal / rule / etc.
entity_id   string(255)
details     JSON          # gesanitiseerde details (geen secrets)
status      string(20)    # success / error / rejected
message     text
ip_address  string(50)
```

## signal_outcomes tabel

De outcome engine evalueert elk signaal als shadow decision, ongeacht of er een order is
uitgevoerd. De eerste implementatie gebruikt dagelijkse bars; 1-uursmetingen vereisen
nog intraday historische data.

```
signal_id            string        # uniek signaal
symbol               string(20)
direction            string(10)    # buy / sell
signal_created_at    datetime
entry_price          float
entry_source         string(40)
return_1d            float         # onderliggende prijsbeweging in procenten
return_5d            float
pnl_1d_pct           float         # direction-adjusted outcome
pnl_5d_pct           float
mfe_pct              float         # maximum favourable excursion
mae_pct              float         # maximum adverse excursion
benchmark_return_5d  float         # SPY indien beschikbaar
excess_return_5d     float
outcome_status       string(20)    # pending / partial / complete
evaluated_at         datetime
```

## pending_rules tabel

```
id                  UUID
title               string(500)
description         text
rule_type           string(50)   # risk / entry / exit / filter
proposed_by         string(100)  # ai / user
confidence          float
supporting_evidence JSON
file_path           string(500)  # pad naar markdown bestand
status              string(20)   # pending / approved / rejected
review_notes        text
reviewed_by         string(100)
reviewed_at         datetime
```

## Migraties

Migraties staan in `apps/api/app/migrations/versions/`.
Migraties:
- `001_initial.py` - maakt de basisschema-tabellen aan.
- `002_signal_outcomes.py` - voegt objectieve signaaluitkomsten toe.
- `003_notifications.py` - voegt Telegram-notificatielog en afleverstatus toe.
- `004_token_usage.py` - voegt AI-tokengebruik en kostenregistratie toe.

Nieuwe migratie aanmaken:
```bash
docker compose exec api python -m alembic -c app/migrations/alembic.ini revision --autogenerate -m "beschrijving"
```
