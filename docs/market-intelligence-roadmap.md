# Market Intelligence OS Roadmap

## Doel

Trading Intelligence Platform groeit door tot een persoonlijk, risk-first marktintelligentiesysteem:
het verzamelt bewijs, vormt hypotheses, test deze in paper trading, meet uitkomsten en gebruikt
die meetlus om volgende beslissingen aantoonbaar beter te maken.

Live trading is geen doel op zichzelf. Het wordt pas overwogen wanneer paper-resultaten,
risicolimieten en auditability aantoonbaar stabiel zijn.

## Ontwerpprincipes

1. Iedere order gaat door een afdwingbare decision firewall.
2. AI adviseert; meetbare uitkomsten bepalen of een idee waarde heeft.
3. Bronnen, claims, signalen, orders en outcomes blijven traceerbaar gekoppeld.
4. Nieuwe regels worden voorgesteld en beoordeeld voordat zij beslissingen blokkeren of toestaan.
5. Performance wordt beoordeeld na transactiekosten, slippage en benchmark.

## Fase 0 - Betrouwbare Cockpit

Status: in uitvoering, kernreparaties gestart op 2026-05-27.

Geleverd:

- Licht dashboardthema met groene accentkleur.
- Volledige assetnaamlabels in de zichtbare trading-, research- en liveviews.
- Alpaca asset metadata-endpoint voor dynamische naamresolutie.
- Signal API levert AI debate-data en take-profitniveau terug aan de UI.
- Chat signal lookup gebruikt het werkelijke `Signal.asset`-contract.
- Kill switch wordt via Redis zichtbaar voor API en workerprocessen.
- Expliciete bevestiging voor paper-orders wanneer risk rules dit vereisen.
- Auto-trader voert geen signaal uit waarvoor handmatige bevestiging vereist is.

Nog vereist om fase 0 af te ronden:

- Integratie- en endpointtests voor kill switch, bevestiging en order lifecycle.
- Eén centrale order service voor handmatige orders, signal-orders en auto-orders.
- Exit-only noodflow expliciet vastleggen en testen voor `close-position` en `close-all`.
- Runtime settings permanent en auditbaar opslaan in database.
- Documentatie opschonen zodat gedrag en claims gelijklopen.

Exitcriterium:

- Geen order kan risk policy of vereiste approval omzeilen.
- Safety controls werken gelijk in webproces en workerproces.
- Kritieke flows hebben geautomatiseerde tests.

## Fase 1 - Outcome En Performance Engine

Doel: bewijs opbouwen welke signalen werkelijk waarde toevoegen.

Te bouwen:

- `signal_outcomes` met forward returns op 1 uur, 1 dag en 5 dagen.
- MFE/MAE, slippage, fees, benchmarkrendement en drawdown per signaal/trade.
- Strategy registry en performance per strategie, timeframe, asset en marktregime.
- Performance dashboard met expectancy, profit factor, Sharpe/Sortino en sample size.
- Shadow portfolio: alle signalen evalueren, ook signalen die niet uitgevoerd zijn.

Exitcriterium:

- Elk gegenereerd signaal krijgt automatisch een objectieve outcome.
- Dashboard kan aantonen welke strategieën na kosten positieve expectancy hebben.

## Fase 2 - Evidence, Sources En Narratives

Doel: niet alleen sentiment meten, maar weten waarom een signaal geloofwaardig is.

Te bouwen:

- Evidence graph voor claims, bronnen, duplicaten, onafhankelijke bevestiging en assets.
- Source credibility scoring op basis van latere outcome, eventtype en horizon.
- Official confirmation monitoring voor filings, company releases en regulatory events.
- Narrative engine met sterkte, momentum, assetkoppeling en regimecontext.
- Manipulation detector met coordinated-post-, velocity- en price-before-news-signalen.

Exitcriterium:

- Ieder rumour/signaal toont de bewijsroute en betrouwbaarheid van de bronnen.
- Low-credibility of high-manipulation setups worden automatisch beperkt tot watch/shadow.

## Fase 3 - Research Lab En Opportunity Radar

Doel: vroege kansen onderzoeken voordat zij trades worden.

Te bouwen:

- Watchlists en universes per markt/strategie.
- Multi-timeframe data en technical confluence.
- Eventkalenders: earnings, macro releases, filings en corporate actions.
- Backtesting en replay met point-in-time datasets zonder look-ahead bias.
- Opportunity radar voor mention acceleration, abnormal volume en cross-source emergence.
- Alerting via dashboard en optioneel Telegram.

Exitcriterium:

- Strategieen kunnen reproducibly worden getest per regime en asset universe.
- De gebruiker ontvangt evidence-first alerts voordat een tradebesluit nodig is.

## Fase 4 - Memory En Trading Psychology

Doel: het systeem leert van resultaten en beschermt tegen herhaalde menselijke fouten.

Te bouwen:

- Qdrant indexing en semantisch memory search daadwerkelijk aansluiten.
- Daily/weekly reviews en proposed rules vanuit voldoende steekproeven.
- Active rules afdwingen in de risk/signal pipeline.
- Behaviour events: overrides, timing, verliesreeksen, rule breaks en cooldowns.
- Psychology guard met waarschuwingen voor chase/revenge/overtrading patronen.

Exitcriterium:

- Nieuwe lessen zijn traceerbaar naar bewijs en approval.
- Risk firewall gebruikt goedgekeurde regels en kan gedragspatronen blokkeren.

## Fase 5 - Investment Committee En Gecontroleerde Uitvoering

Doel: een volledige decision cockpit met optionele uitvoering onder harde grenzen.

Te bouwen:

- Committee decision object: Research, Bull, Bear, Macro, Rumour, Quant, Risk en Memory.
- Portfolio-aware sizing met correlatie-, sector-, liquidity- en open-risklimieten.
- Staged execution: observe, shadow, paper, limited-live candidate.
- Live candidate gate op sample size, drawdown, audit completeness en expliciete approval.
- Automatic halt bij data-qualityproblemen, verlieslimieten of afwijkend gedrag.

Exitcriterium:

- Geen livefunctie zonder meetbaar bewijs, expliciete gebruikerstoestemming en shutdownpad.

## Prioriteitsvolgorde

| Volgorde | Werkpakket | Waarom eerst |
|---|---|---|
| 1 | Safety en API-contracten | Beschermt geld en voorkomt misleidende UI |
| 2 | Outcome engine | Zonder waarheid achteraf bestaat geen leervermogen |
| 3 | Sources/evidence/narratives | Verbetert de kwaliteit van hypotheses |
| 4 | Backtest/replay/radar | Onderzoekt edge zonder kapitaalrisico |
| 5 | Memory/psychology | Verbetert discipline op bewezen data |
| 6 | Committee/execution | Alleen nuttig nadat eerdere lagen betrouwbaar zijn |

## Definitie Van Succes

Het systeem is geslaagd wanneer het niet alleen kansen toont, maar per beslissing kan beantwoorden:

- Welk bewijs leidde hiertoe?
- Welke bron was doorslaggevend en hoe betrouwbaar is die gebleken?
- In welk regime werkt deze strategie?
- Wat was de verwachte en gerealiseerde opbrengst na kosten?
- Welk risico werd genomen en welke regel beschermde tegen een slechte trade?

