#!/usr/bin/env sh
set -eu

# Verify the one-command local demo compose contract.
#
# Checks that:
#   - .env exists (secrets are never committed).
#   - compose.dev.yaml is valid and exposes exactly postgres, backend, frontend.
#   - the backend runs with the demo profile.
#   - the frontend publishes port 8088.
#   - production compose.yaml and the production Nginx files are unchanged
#     (both unstaged and staged changes are rejected).

test -f .env

# Reject any unstaged or staged change to the production compose file or the
# production Nginx configuration. These files must stay byte-for-byte identical
# to HEAD; the local demo must never silently drift from production.
git diff --quiet -- compose.yaml infrastructure/nginx
git diff --cached --quiet -- compose.yaml infrastructure/nginx

# The service list must be exactly postgres, backend, frontend. Compare the
# sorted actual list against the sorted expected list so that an extra or a
# missing service fails the check.
actual="$(docker compose --env-file .env -f compose.dev.yaml config --services | sort)"
expected="$(printf '%s\n' postgres backend frontend | sort)"
if test "$actual" != "$expected"; then
  printf 'expected services: %s\n' "$expected"
  printf 'actual services:   %s\n' "$actual"
  exit 1
fi

docker compose --env-file .env -f compose.dev.yaml config |
  grep -F 'SPRING_PROFILES_ACTIVE: demo'

docker compose --env-file .env -f compose.dev.yaml config |
  grep -F 'published: "8088"'
