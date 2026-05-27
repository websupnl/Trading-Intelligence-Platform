# Memory Systeem

## Overzicht

Het memory systeem slaat trading kennis op als Markdown bestanden én in de database.
Dit zorgt voor een auditeerbaar, leesbaar en handmatig bewerkbaar geheugen.

## Bestandsstructuur

```
memory/
  trades/           # Per-trade journals
  pending-rules/    # Door AI voorgestelde regels (wachten op goedkeuring)
  active-rules/     # Door gebruiker goedgekeurde regels
  rejected-rules/   # Door gebruiker afgewezen regels
  reflections/      # Algemene reflecties
  daily/            # Dagelijkse samenvattingen
  weekly/           # Wekelijkse samenvattingen
  sources/          # Bron geloofwaardigheid notities
  strategies/       # Strategie beschrijvingen en lessen
  lessons/          # Algemene lessen
  raw/              # Ruwe AI output
```

## Bestandsnaamconventies

| Type | Pad | Voorbeeld |
|------|-----|-----------|
| Trade journal | `trades/YYYY-MM-DD-SYMBOL-RICHTING.md` | `trades/2025-01-15-AAPL-buy.md` |
| Pending rule | `pending-rules/YYYY-MM-DD-titel.md` | `pending-rules/2025-01-15-geen-earnings.md` |
| Active rule | `active-rules/YYYY-MM-DD-titel.md` | `active-rules/2025-01-15-geen-earnings.md` |
| Rejected rule | `rejected-rules/YYYY-MM-DD-titel.md` | `rejected-rules/2025-01-15-te-agressief.md` |
| Daily summary | `daily/YYYY-MM-DD.md` | `daily/2025-01-15.md` |
| Weekly summary | `weekly/YYYY-WW.md` | `weekly/2025-03.md` |

## Rule Approval Flow

```
AI agent analyseert trade/patroon
    ↓
Stelt regel voor via create_pending_rule tool
    ↓
Backend schrijft bestand naar memory/pending-rules/
Backend slaat op in pending_rules tabel
    ↓
Dashboard /memory toont pending rule aan gebruiker
    ↓
Gebruiker keurt goed                Gebruiker wijst af
    ↓                                   ↓
Bestand → active-rules/         Bestand → rejected-rules/
Database → active_rules         Database status = rejected
Audit log: rule_approved        Audit log: rule_rejected
```

## Wat AI MAG

- Trade journal aanmaken na een trade
- Dagelijkse reflectie schrijven
- Wekelijkse samenvatting schrijven
- Pending rule voorstellen (ter beoordeling)
- Source credibility update voorstellen
- Memory doorzoeken via search_memory tool

## Wat AI NIET MAG

- Active rules direct aanpassen of verwijderen
- Bestaande logs stil overschrijven
- Regels activeren zonder menselijke goedkeuring
- Secrets of API keys opslaan in memory

## Database synchronisatie

Alle memory bestanden worden ook geïndexeerd in de `memory_entries` tabel.
Dit maakt snel zoeken mogelijk via `/api/memory/search`.

Vector embeddings worden opgeslagen in Qdrant voor semantisch zoeken
(vereist Anthropic of OpenAI key voor embeddings).
