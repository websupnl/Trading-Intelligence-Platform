# Alpaca Integratie

## Configuratie

```env
ALPACA_API_KEY=jouw_key
ALPACA_SECRET_KEY=jouw_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets
```

Haal keys op bij: https://alpaca.markets/ (gratis account voor paper trading)

## Paper Trading (standaard)

Alle orders gaan naar de Alpaca paper trading API.
Echte orders worden nooit geplaatst tenzij expliciet geconfigureerd.

## Gebruikte endpoints

| Functie | Method | Endpoint |
|---------|--------|----------|
| Account info | GET | /v2/account |
| Open posities | GET | /v2/positions |
| Orders | GET | /v2/orders?status=open |
| Order plaatsen | POST | /v2/orders |
| Order annuleren | DELETE | /v2/orders/{id} |
| Portfolio history | GET | /v2/account/portfolio/history |
| Market klok | GET | /v2/clock |

## Order plaatsen flow

```
POST /api/trading/orders/paper
    ↓
Risk Engine check (altijd)
    ↓
[Kill switch? → 422]
[Live trading disabled? → 422]
[Positie te groot? → 422]
[Lage confidence? → 422]
[Manual approval vereist? → 200 requires_manual_approval]
    ↓
POST https://paper-api.alpaca.markets/v2/orders
    ↓
Audit log
    ↓
Response naar frontend
```

## Foutafhandeling

### Keys ontbreken
- HTTP 503 terug
- Body: `{"status": "not_configured", "message": "Alpaca API keys niet geconfigureerd..."}`
- Frontend toont: "Alpaca niet geconfigureerd"
- Geen fake data

### API fout
- HTTP 502 terug
- Body: `{"status": "api_error", "message": "<alpaca foutmelding>"}`

## Live Trading Lock

Live trading is **hard geblokkeerd** tenzij alle drie tegelijk:
1. `LIVE_TRADING_ENABLED=true` in .env
2. `TRADING_MODE=live` in .env
3. Risk engine keurt order goed

De architectuur staat live trading voor, maar de standaardconfiguratie blokkeert het volledig.
