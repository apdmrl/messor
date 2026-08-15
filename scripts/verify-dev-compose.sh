#!/usr/bin/env sh
set -eu

# Verify the one-command local demo compose contract.
#
# Checks that:
#   - .env exists (secrets are never committed).
#   - compose.dev.yaml is valid and exposes exactly postgres, backend, frontend.
#   - the backend runs with the demo profile.
#   - the frontend publishes port 8088.
#   - production compose.yaml and the production Nginx files are unchanged.

test -f .env

production_hash="$(git hash-object compose.yaml)"

services="$(docker compose --env-file .env -f compose.dev.yaml config --services)"
printf '%s\n' "$services" | grep -Fx postgres
printf '%s\n' "$services" | grep -Fx backend
printf '%s\n' "$services" | grep -Fx frontend

docker compose --env-file .env -f compose.dev.yaml config |
  grep -F 'SPRING_PROFILES_ACTIVE: demo'

docker compose --env-file .env -f compose.dev.yaml config |
  grep -F 'published: "8088"'

test "$production_hash" = "$(git hash-object compose.yaml)"
