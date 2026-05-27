# Risk Engine

## Overzicht

De Risk Engine wordt aangeroepen bij **elke** order. Er is geen manier om hem te omzeilen.

## Checks (volgorde)

### 1. Kill Switch
- Conditie: `KILL_SWITCH_ENABLED=true`
- Actie: **Alle orders geblokkeerd**
- Activeerbaar via dashboard of .env

### 2. Live Trading Lock
- Conditie: `LIVE_TRADING_ENABLED=false` + mode=live
- Actie: Order geblokkeerd
- Standaard: altijd actief

### 3. Trading Mode
- Conditie: `TRADING_MODE=paper` + mode=live
- Actie: Order geblokkeerd

### 4. Max Positiegrootte
- Limiet: $10,000 per order
- Overschrijding: geblokkeerd, `blocked_by_rule: max_position_size`

### 5. Confidence
- < 50%: Order geblokkeerd
- 50%–70%: Handmatige bevestiging vereist
- ≥ 70%: Automatisch (tenzij manual confirmation aan)

### 6. Manual Confirmation
- Als `REQUIRE_MANUAL_CONFIRMATION=true`: altijd handmatige stap
- Standaard: aan

### 7. Stop Loss Waarschuwing
- Geen stop loss opgegeven: waarschuwing (niet blokkerend)

## Output Schema

```json
{
  "approved": false,
  "required_manual_approval": false,
  "reasons": ["Kill switch is actief - alle orders geblokkeerd"],
  "warnings": [],
  "max_position_size": 10000.0,
  "blocked_by_rule": "kill_switch"
}
```

## Blocked By Rule waarden

| Waarde | Oorzaak |
|--------|---------|
| `kill_switch` | Kill switch actief |
| `live_trading_disabled` | Live trading uit |
| `paper_mode_only` | Paper mode, live order |
| `max_position_size` | Order te groot |
| `low_confidence` | Confidence < 50% |

## Audit logging

Elke risk check wordt gelogd in `risk_events` tabel en `audit_logs`.
Ook geblokkeerde orders worden volledig gelogd (zonder secrets).

## Veiligheidsprincipe

> Bij twijfel: NO TRADE

Het systeem geeft bij onzekerheid altijd de voorkeur aan **niet handelen** boven handelen.
