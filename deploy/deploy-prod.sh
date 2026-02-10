#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$ROOT_DIR/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy .env.prod.example to .env.prod and fill required values."
  exit 1
fi

echo "Using compose file: $COMPOSE_FILE"
echo "Using env file: $ENV_FILE"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo
echo "Deployment complete."
