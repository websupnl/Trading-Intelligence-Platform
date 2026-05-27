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
- Runtime safety-instellingen worden duurzaam in de database opgeslagen en bij startup naar Redis hersteld.
- Uitschakelen van de kill switch faalt gesloten wanneer workerbevestiging via Redis ontbreekt.
- Expliciete bevestiging voor paper-orders wanneer risk rules dit vereisen.
- Auto-trader voert geen signaal uit waarvoor handmatige bevestiging vereist is.
- Orders uit handmatige, signal-, auto- en noodflows worden lokaal geregistreerd voor auditability.
- Exit-only noodflows gebruiken Alpaca position liquidation en ondersteunen long- en shortposities.

Nog vereist om fase 0 af te ronden:

- Integratie- en endpointtests voor kill switch, bevestiging en order lifecycle.
- Endpointtests voor de exit-only noodflow en lokale orderregistratie.
- Documentatie opschonen zodat gedrag en claims gelijklopen.

Exitcriterium:

- Geen order kan risk policy of vereiste approval omzeilen.
- Safety controls werken gelijk in webproces en workerproces.
- Kritieke flows hebben geautomatiseerde tests.

## Fase 1 - Outcome En Performance Engine

Doel: bewijs opbouwen welke signalen werkelijk waarde toevoegen.

Status: eerste dagelijkse shadow-outcome lus geleverd op 2026-05-27.

Geleverd:

- `signal_outcomes` migratie en model voor dagelijkse signaaluitkomsten.
- Automatische worker-evaluatie en handmatige API-trigger.
- Signed returns na 1 en 5 handelsdagen voor long- en shortsignalen.
- MFE/MAE over de eerste vijf volgende dagelijkse bars.
- SPY-benchmark en excess return wanneer benchmarkbars beschikbaar zijn.
- Performance-scherm met sample size, hit rate en outcome-overzicht per asset.
- Performance-scherm scheidt gerealiseerde trade-P&L van niet-uitgevoerde shadow-signaalresultaten.
- Dashboardfeed met recente AI-beslissingen, trade-lessen en gemeten outcomes; zichtbaar ververst iedere 30 seconden.
- Shadow scoring geldt voor gegenereerde signalen, onafhankelijk van uitvoering.

Nog te bouwen:

- Intraday bars en forward return op 1 uur.
- Slippage, fees en drawdown per signaal/trade.
- Strategy registry en performance per strategie, timeframe, asset en marktregime.
- Performance dashboard met expectancy, profit factor, Sharpe/Sortino en sample size.

Exitcriterium:

- Elk gegenereerd signaal krijgt automatisch een objectieve outcome.
- Dashboard kan aantonen welke strategieën na kosten positieve expectancy hebben.

## Fase 1B - Intraday / Micro Trading Candidate

Status: gepland, niet geactiveerd. Deze module blijft `shadow` of `paper` totdat de
resultaten na kosten aantoonbaar positief zijn.

Te bouwen:

- 1m/5m/15m bars, quotes, spread en volume/liquidity snapshots met point-in-time opslag.
- Micro-signal outcomes op 5m, 15m, 1u en einde-dag, inclusief fees en conservatieve slippage.
- Hard maximum op notional, orders per uur, dagverlies, open exposure en gelijktijdige posities.
- Spread-, liquiditeits-, news-event-, stale-data- en markturenfilters voor iedere order.
- Micro Strategy Lab met minimum sample size, walk-forward evaluatie en paper-only scoreboard.
- Separaat dashboard voor bruto P&L, kosten, netto P&L, drawdown en reject-redenen.

Gate voor automatische paper-uitvoering:

- Minimaal 250 shadow outcomes per strategie en marktregime.
- Positieve netto expectancy na fees en slippage, met benchmarkvergelijking.
- Max drawdown en verlieslimieten zijn geconfigureerd en getest.
- Kill switch, data-staleness stop en auditregistratie zijn end-to-end getest.

Live uitvoering blijft buiten scope totdat de gebruiker deze na aantoonbaar paper-bewijs
expliciet activeert.

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
