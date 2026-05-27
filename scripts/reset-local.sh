#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${RED}=================================================="
echo "  Trading OS - RESET"
echo -e "==================================================${NC}"
echo ""
echo -e "${YELLOW}WAARSCHUWING: Dit verwijdert alle containers en database data!${NC}"
echo ""
read -p "Typ 'RESET' om te bevestigen: " confirm
if [ "$confirm" != "RESET" ]; then
    echo "Reset geannuleerd."
    exit 0
fi

cd "$PROJECT_ROOT"
echo "Containers stoppen..."
docker compose down

echo ""
read -p "Verwijder ook database volumes? (j/n): " remove_volumes
if [ "$remove_volumes" = "j" ] || [ "$remove_volumes" = "J" ]; then
    echo "Volumes verwijderen..."
    docker compose down -v
    echo "Volumes verwijderd."
fi

echo ""
read -p "Wis ook memory bestanden? (j/n): " wipe_memory
if [ "$wipe_memory" = "j" ] || [ "$wipe_memory" = "J" ]; then
    echo "Memory wissen..."
    find "$PROJECT_ROOT/memory" -name "*.md" -delete 2>/dev/null || true
    echo "Memory gewist."
fi

echo ""
echo "Reset voltooid. Start opnieuw met: ./start-local.sh"
