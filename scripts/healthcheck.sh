#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

check() {
    local name="$1" url="$2"
    if curl -sf "$url" > /dev/null 2>&1; then
        echo -e "  ${GREEN}[OK]${NC} $name"
    else
        echo -e "  ${RED}[DOWN]${NC} $name ($url)"
    fi
}

echo ""
echo "=== Trading OS Health Check ==="
echo ""
cd "$PROJECT_ROOT"

echo "Services:"
check "Backend API"   "http://localhost:8000/health"
check "Frontend"      "http://localhost:3000"
check "Qdrant"        "http://localhost:6333/healthz"
check "PostgreSQL"    "http://localhost:5432" 2>/dev/null || true

echo ""
echo "Docker containers:"
docker compose ps 2>/dev/null || echo "  Docker Compose niet bereikbaar"
echo ""
