# Autonomous Crypto Session

Doel: een expliciete away-mode voor momenten waarop de US markt dicht is en de app crypto-only autonoom mag paper-traden.

## Huidige werking

- Pagina: `/crypto-session`.
- API:
  - `GET /api/crypto-session/status`
  - `POST /api/crypto-session/start`
  - `POST /api/crypto-session/stop`
- Starten zet een runtime sessie met duur, max notional per trade en max aantal trades.
- Starten triggert direct marktdata, signaalgeneratie en auto-trade.
- Autonome uitvoering is alleen toegestaan wanneer `market_session.crypto_only=true`.
- De auto-trader wacht buiten US markturen op een expliciete crypto-sessie.
- In sessie-mode mag paper crypto auto-trading door handmatige confirmation heen, maar risk rejection blijft hard.

## Ultra Check Prompt

Gebruik deze prompt voor de volgende iteratie:

```text
Audit en verbeter de Trading Intelligence Platform als een geldgerichte autonomous crypto trading control room.

Scope:
- Design: maak duidelijk waar de gebruiker is, wat de app nu doet, wat op de achtergrond draait, wat geblokkeerd is, en waarom.
- Logica: controleer of alle state klopt tussen frontend, API, scheduler, risk engine, broker en audit log.
- AI brein: beoordeel of signalen genoeg context hebben: regime, liquiditeit, volatility, momentum, nieuws, social hype, memory, eerdere outcomes.
- Geld-potentie: onderscheid edge discovery, paper execution, risk-adjusted performance en live readiness. Geen winstclaims, wel meetbare hypotheses.
- Crypto: behandel crypto als 24/7 markt met sessies, lagere latency, spread/slippage, exchange/broker beperkingen, volatility caps en session budgets.

Vragen die beantwoord moeten worden:
1. Kan een gebruiker binnen 10 seconden zien of de bot kijkt, denkt, wacht, handelt of geblokkeerd is?
2. Kan een gebruiker veilig een crypto-only away session starten en stoppen?
3. Wordt autonomie expliciet begrensd door duur, max trades, max notional, kill switch, daily loss en paper/live mode?
4. Is duidelijk of AI alleen analyseert of ook execution mag triggeren?
5. Is elke order herleidbaar naar sessie, signaal, risk result, model output en marktdata?
6. Welke onderdelen zijn monitor-only, paper-ready, live-ready of nog gevaarlijk/onvolledig?
7. Welke metrics bewijzen dat dit geld kan verdienen: expectancy, win rate, average R, max drawdown, slippage, fees, per-asset edge, per-session edge?

Output:
- Top 10 concrete verbeterpunten, geordend op impact.
- Bugs/onlogische flows met file-level verwijzingen.
- Nieuwe UX views/components die nodig zijn.
- Backend/risk wijzigingen die nodig zijn voor echte autonomie.
- Testplan voor autonomous crypto sessions.
- Een korte implementatievolgorde voor de volgende 1-2 uur werk.
```

## Belangrijkste Volgende Verbeteringen

1. Sessie-ID opslaan op `Trade`, `Order` en `AuditLog.details`, zodat elke trade aan een away-session hangt.
2. Crypto-sessie stopregels uitbreiden met max session loss, max open crypto exposure en cooldown na broker error.
3. Signaalgenerator crypto-specifiek maken met 5m/15m/1h data naast 1D candles.
4. Live session feed uitbreiden met sessie-events: started, waiting, analyzing, risk rejected, submitted, closed, expired.
5. Performance splitsen per sessie, asset, timeframe en AI prompt/modelversie.
