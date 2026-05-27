# Architectuur

## Overzicht

Trading OS bestaat uit meerdere Docker containers die samenwerken als één lokaal systeem.

```
┌───────────────────────────────────────────────┐
│              Browser / Dashboard               │
│              Next.js  :3000                    │
└────────────────────┬──────────────────────────┘
                     │ HTTP (NEXT_PUBLIC_API_URL)
┌────────────────────▼──────────────────────────┐
│           FastAPI Backend  :8000               │
│  ┌─────────┐ ┌─────────┐ ┌──────┐ ┌────────┐ │
│  │ Trading │ │  Risk   │ │ News │ │   AI   │ │
│  │   API   │ │ Engine  │ │  Svc │ │ Agents │ │
│  └────┬────┘ └─────────┘ └──┬───┘ └───┬────┘ │
└───────┼──────────────────────┼─────────┼──────┘
        │                      │         │
┌───────▼──────┐  ┌────────────▼──┐  ┌──▼──────────┐
│  Alpaca API  │  │  PostgreSQL   │  │  Anthropic  │
│  paper mode  │  │  TimescaleDB  │  │  Claude API │
└──────────────┘  └───────┬───────┘  └─────────────┘
                          │
             ┌────────────┴────────────┐
             │                         │
    ┌────────▼────────┐    ┌───────────▼────────┐
    │  Redis  :6379   │    │   Qdrant  :6333    │
    │  Celery broker  │    │  Vector memory     │
    └────────┬────────┘    └────────────────────┘
             │
    ┌────────▼────────┐
    │  Celery Worker  │
    │  + Scheduler    │
    └─────────────────┘
```

## Services

| Service | Image | Poort | Rol |
|---------|-------|-------|-----|
| api | apps/api/Dockerfile | 8000 | FastAPI backend |
| web | apps/web/Dockerfile | 3000 | Next.js frontend |
| postgres | timescale/timescaledb | 5432 | Primaire database |
| redis | redis:7-alpine | 6379 | Cache + Celery broker |
| qdrant | qdrant/qdrant | 6333 | Vector geheugen |
| worker | apps/api/Dockerfile | — | Celery background worker |
| scheduler | apps/api/Dockerfile | — | Celery Beat scheduler |

## Dataflow

### Nieuws ingestie
1. Celery Beat triggert `ingest_news` elke 15 minuten
2. RSSFeedService haalt geconfigureerde feeds op
3. Items worden gededupliceerd op URL hash
4. Tickers worden gedetecteerd via regex
5. Opgeslagen in `news_items` tabel
6. Beschikbaar via `/api/news`

### Order lifecycle
```
Signal → Risk Check → [Kill switch?] → [Live lock?] → [Positiegrootte?]
       → [Confidence?] → [Manual approval?] → Alpaca paper API → Audit log
```

Elke stap waarbij een check faalt → order geblokkeerd + reden gelogd.

### AI analyse flow
1. Trigger via dashboard of automatisch na nieuws ingestie
2. Backend roept Anthropic aan met Pydantic output schema
3. Claude analyseert en geeft structured JSON terug
4. Backend valideert schema strict
5. Resultaat opgeslagen in database
6. **AI mag nooit direct orders uitvoeren**

### Memory flow
1. AI agent analyseert trade of patroon
2. Stelt regel voor via `create_pending_rule` tool
3. Regel staat als `pending` in database + markdown bestand
4. Dashboard toont pending rules aan gebruiker
5. Gebruiker keurt goed → `active_rules`
6. Gebruiker wijst af → `rejected_rules`
7. Audit log bij elke stap

## Beveiliging

- API keys alleen in backend (via environment variables)
- Frontend toont alleen `configured: true/false`
- Secrets worden nooit gelogd (AuditLogService sanitiseert automatisch)
- CORS gelimiteerd tot `localhost:3000`
- Kill switch kan alle orders in één klik blokkeren
