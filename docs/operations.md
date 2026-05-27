# Operations

## Dagelijkse werking

Na `start-local.bat` draait het systeem volledig automatisch.

### Geplande taken (automatisch)
| Taak | Frequentie |
|------|-----------|
| Nieuws ingestie (RSS) | Elke 15 minuten |
| Marktdata ophalen (dagbars) | Elk uur |
| Signal outcomes evalueren | Elk uur |

### Handmatige acties via dashboard
- Nieuws handmatig inlezen (knop op /news pagina)
- Reddit ophalen (knop op /social, vereist keys)
- X/Twitter ophalen (knop op /social, vereist keys)
- Signal paper traden of afwijzen (/signals)
- Signal outcomes handmatig evalueren (/performance)
- Pending rule goedkeuren of afwijzen (/memory)
- Kill switch aan/uitzetten (/settings)

## Logs bekijken

```bash
# Alle services tegelijk
docker compose logs -f

# Specifieke service
docker compose logs -f api
docker compose logs -f web
docker compose logs -f worker
docker compose logs -f scheduler
docker compose logs -f postgres
```

## Health checks

```bash
# Via script
./scripts/healthcheck.sh

# Handmatig
curl http://localhost:8000/health
curl http://localhost:8000/api/config/status
curl http://localhost:8000/api/status
```

## Container management

```bash
# Status bekijken
docker compose ps

# Service herstarten
docker compose restart api
docker compose restart web

# Stoppen
docker compose stop

# Stoppen + verwijderen (volumes intact)
docker compose down

# Stoppen + verwijderen inclusief volumes
docker compose down -v
```

## Database migrations

```bash
# Huidige staat
docker compose exec api python -m alembic -c app/migrations/alembic.ini current

# Upgrade naar laatste versie
docker compose exec api python -m alembic -c app/migrations/alembic.ini upgrade head

# Nieuwe migration aanmaken (na model wijziging)
docker compose exec api python -m alembic -c app/migrations/alembic.ini revision --autogenerate -m "beschrijving"

# Downgrade
docker compose exec api python -m alembic -c app/migrations/alembic.ini downgrade -1
```

## Problemen oplossen

### API start niet op
```bash
docker compose logs api
# Veelvoorkomend: database nog niet klaar → wacht en herstart
docker compose restart api
```

### Worker verbindt niet met Redis
```bash
docker compose logs worker
docker compose exec redis redis-cli ping
# Verwacht: PONG
```

### Migrations falen
```bash
docker compose logs api | grep -i alembic
# Zorg dat postgres healthy is:
docker compose ps postgres
```

### Frontend 502 Bad Gateway
De API container is nog niet klaar. Wacht even en ververs de pagina.

### Port conflict
```bash
# Windows — welke service gebruikt poort 8000?
netstat -ano | findstr :8000
# Linux/macOS
lsof -i :8000
```

### Docker out of disk space
```bash
docker system prune -f
docker volume prune -f  # LET OP: verwijdert ongebruikte volumes
```
