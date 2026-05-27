#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Trading OS stoppen..."
cd "$PROJECT_ROOT"
docker compose stop
echo "Containers gestopt. Volumes en memory intact."
