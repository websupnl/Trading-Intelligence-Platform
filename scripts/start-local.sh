#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo "=================================================="
echo "  Trading OS - Local Startup"
echo "=================================================="
echo ""

# Step 1: Check Docker
log_info "Checking Docker..."
if ! command -v docker &>/dev/null; then
    log_error "Docker niet gevonden."
    echo ""
    echo "  Installeer Docker Desktop: https://www.docker.com/products/docker-desktop"
    echo ""
    exit 1
fi
log_success "Docker gevonden: $(docker --version)"

# Step 2: Check Docker Compose
log_info "Checking Docker Compose..."
if ! docker compose version &>/dev/null 2>&1; then
    log_error "Docker Compose plugin niet gevonden."
    echo "  Update Docker Desktop naar de nieuwste versie."
    exit 1
fi
log_success "Docker Compose gevonden"

# Step 3: Check .env
log_info "Checking .env configuratie..."
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        log_warning ".env niet gevonden, kopieer van .env.example..."
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        log_success ".env aangemaakt vanuit .env.example"
    else
        log_error ".env.example niet gevonden. Controleer project bestanden."
        exit 1
    fi
fi
log_success ".env gevonden"

# Check voor lege API keys
MISSING_KEYS=()
source "$ENV_FILE" 2>/dev/null || true

[ -z "${ALPACA_API_KEY:-}" ] && MISSING_KEYS+=("ALPACA_API_KEY (paper trading)")
[ -z "${ANTHROPIC_API_KEY:-}" ] && MISSING_KEYS+=("ANTHROPIC_API_KEY (AI analyse)")

if [ ${#MISSING_KEYS[@]} -gt 0 ]; then
    echo ""
    log_warning "De volgende API keys zijn nog niet ingevuld in .env:"
    for key in "${MISSING_KEYS[@]}"; do
        echo "  - $key"
    done
    echo ""
    echo "  Het systeem start, maar modules met ontbrekende keys worden uitgeschakeld."
    echo "  Vul .env in en herstart om alle functies te activeren."
    echo ""
fi

# Step 4: Create memory directories
log_info "Memory directories aanmaken..."
for dir in raw trades lessons pending-rules active-rules rejected-rules sources strategies reflections daily weekly; do
    mkdir -p "$PROJECT_ROOT/memory/$dir"
done
log_success "Memory directories klaar"

# Step 5: Build images
log_info "Docker images bouwen (dit kan even duren bij eerste keer)..."
cd "$PROJECT_ROOT"
docker compose build --parallel
log_success "Docker images gebouwd"

# Step 6: Start containers
log_info "Containers starten..."
docker compose up -d
log_success "Containers gestart"

# Step 7: Wait for services
log_info "Wachten op services..."
sleep 10

# Step 8: Run migrations
log_info "Database migrations uitvoeren..."
MAX_TRIES=30
TRIES=0
until docker compose exec -T api python -m alembic -c app/migrations/alembic.ini upgrade head 2>/dev/null; do
    TRIES=$((TRIES + 1))
    if [ $TRIES -ge $MAX_TRIES ]; then
        log_error "Database migrations mislukt na $MAX_TRIES pogingen."
        echo "  Bekijk logs: docker compose logs api"
        exit 1
    fi
    log_warning "Wachten op database... ($TRIES/$MAX_TRIES)"
    sleep 5
done
log_success "Database migrations uitgevoerd"

# Step 9: Backend health check
log_info "Backend health check..."
MAX_TRIES=20
TRIES=0
until curl -sf http://localhost:8000/health > /dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ $TRIES -ge $MAX_TRIES ]; then
        log_error "Backend niet bereikbaar na $MAX_TRIES pogingen."
        echo "  Bekijk logs: docker compose logs api"
        exit 1
    fi
    log_warning "Wachten op backend... ($TRIES/$MAX_TRIES)"
    sleep 5
done
log_success "Backend bereikbaar op http://localhost:8000"

# Step 10: Frontend health check
log_info "Frontend health check..."
MAX_TRIES=20
TRIES=0
until curl -sf http://localhost:3000 > /dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ $TRIES -ge $MAX_TRIES ]; then
        log_warning "Frontend nog niet bereikbaar. Controleer: docker compose logs web"
    fi
    log_warning "Wachten op frontend... ($TRIES/$MAX_TRIES)"
    sleep 5
done
log_success "Frontend bereikbaar op http://localhost:3000"

echo ""
echo "=================================================="
echo -e "${GREEN}  Trading OS draait!${NC}"
echo "=================================================="
echo ""
echo "  Dashboard:     http://localhost:3000"
echo "  API:           http://localhost:8000"
echo "  API Docs:      http://localhost:8000/docs"
echo ""
echo "  Logs:          docker compose logs -f"
echo "  Stoppen:       ./stop-local.sh"
echo "  Resetten:      ./reset-local.sh"
echo ""

# Open browser indien mogelijk
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:3000 2>/dev/null &
elif command -v open &>/dev/null; then
    open http://localhost:3000 2>/dev/null &
fi
