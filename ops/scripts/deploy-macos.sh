#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$KNOT_HOME"

chmod +x ops/scripts/run-knot-platform.sh ops/scripts/run-openclaw-agent.sh

mkdir -p "$KNOT_HOME/var/uploads" "$KNOT_HOME/var/log"

if [[ -n "${KNOT_DATABASE_URL:-}" ]]; then
  echo "==> using KNOT_DATABASE_URL"
elif /opt/homebrew/opt/postgresql@16/bin/pg_isready -h 127.0.0.1 -p 5433 >/dev/null 2>&1; then
  echo "==> postgres already on 5433"
else
  echo "==> ensure local postgres (~/knot/pgdata)"
  "$KNOT_HOME/ops/scripts/ensure-knot-postgres.sh"
  export KNOT_DATABASE_URL="postgres://knot@127.0.0.1:5433/knot"
fi

echo "==> npm ci"
npm ci

echo "==> build web"
npm run build -w web

if [[ -z "${KNOT_DATABASE_URL:-}" ]] && docker info >/dev/null 2>&1; then
  echo "==> postgres (docker)"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
  export KNOT_DATABASE_URL="${KNOT_DATABASE_URL:-postgres://knot:knot@127.0.0.1:5433/knot}"
fi
export DATABASE_URL="${KNOT_DATABASE_URL:-postgres://knot@127.0.0.1:5433/knot}"

echo "==> migrate"
for _ in $(seq 1 20); do
  if npm run migrate; then
    break
  fi
  sleep 2
done

ENV_FILE="$KNOT_HOME/ops/env/knot-platform.local.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
PORT=8080
BIND_HOST=0.0.0.0
DATABASE_URL=${DATABASE_URL}
SESSION_COOKIE_NAME=knot_sid
UPLOAD_DIR=$KNOT_HOME/var/uploads
PUBLIC_WEB_ORIGIN=http://192.168.3.91:8080
STATIC_WEB_DIR=$KNOT_HOME/apps/web/dist
EOF
fi

AGENT_ENV="$KNOT_HOME/ops/env/openclaw-agent.local.env"
if [[ ! -f "$AGENT_ENV" ]]; then
  cp "$KNOT_HOME/ops/env/openclaw-agent.env.example" "$AGENT_ENV"
fi

LAUNCH_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

install_plist() {
  local src="$1"
  local label="$2"
  local dest="$LAUNCH_DIR/${label}.plist"
  sed "s|__KNOT_HOME__|$KNOT_HOME|g" "$src" >"$dest"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$dest"
  launchctl kickstart -k "$DOMAIN/$label" || true
}

install_plist "$KNOT_HOME/ops/launchd/com.knot.postgres.plist" "com.knot.postgres"
install_plist "$KNOT_HOME/ops/launchd/com.knot.platform.plist" "com.knot.platform"

if grep -qE '^KNOT_AGENT_TOKEN=knt_[A-Za-z0-9_-]{20,}' "$AGENT_ENV" 2>/dev/null \
  && grep -qE '^KNOT_AGENT_EMAIL=.+@.+' "$AGENT_ENV" 2>/dev/null; then
  install_plist "$KNOT_HOME/ops/launchd/com.knot.openclaw-agent.plist" "com.knot.openclaw-agent"
else
  echo "skip openclaw-agent launchd (set token in $AGENT_ENV first)"
  launchctl bootout "$DOMAIN/com.knot.openclaw-agent" 2>/dev/null || true
fi

sleep 2
curl -sf "http://127.0.0.1:8080/api/health" && echo
echo "OK: http://192.168.3.91:8080/"
