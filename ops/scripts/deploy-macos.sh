#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$KNOT_HOME"

chmod +x ops/scripts/run-knot-platform.sh

mkdir -p "$KNOT_HOME/var/log"

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

ENV_FILE="$KNOT_HOME/ops/env/knot-platform.local.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi
export DATABASE_URL="${DATABASE_URL:-${KNOT_DATABASE_URL:-postgres://knot@127.0.0.1:5433/knot}}"

UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"
echo "==> stop Knot Backend before migrate"
launchctl bootout "$DOMAIN/com.knot.platform" 2>/dev/null || true

echo "==> migrate"
migrated=0
for _ in $(seq 1 20); do
  if npm run migrate; then
    migrated=1
    break
  fi
  sleep 2
done
if [[ "$migrated" != 1 ]]; then
  echo "migrate failed" >&2
  exit 1
fi

echo "==> move uploads into blobs/ and derived/"
node apps/knot-platform/scripts/migrate-storage-layout.mjs --apply

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
PORT=8080
BIND_HOST=0.0.0.0
DATABASE_URL=${DATABASE_URL}
SESSION_COOKIE_NAME=knot_sid
PUBLIC_WEB_ORIGIN=http://192.168.3.91:8080
STATIC_WEB_DIR=$KNOT_HOME/apps/web/dist
EOF
fi
if ! grep -q '^STATIC_WEB_DIR=' "$ENV_FILE"; then
  echo "STATIC_WEB_DIR=$KNOT_HOME/apps/web/dist" >>"$ENV_FILE"
fi
if ! grep -q '^KNOT_DISCOVER_PUSH_CMD=' "$ENV_FILE"; then
  echo "KNOT_DISCOVER_PUSH_CMD=$KNOT_HOME/ops/scripts/push-discover.sh" >>"$ENV_FILE"
fi
if ! grep -q '^KNOT_EDGE_SSH_KEY=' "$ENV_FILE"; then
  echo "KNOT_EDGE_SSH_KEY=$HOME/.ssh/knot-edge-publish" >>"$ENV_FILE"
fi

LAUNCH_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"
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

chmod +x "$KNOT_HOME/ops/scripts/backup-knot.sh" "$KNOT_HOME/ops/scripts/audit-knot-storage.sh" "$KNOT_HOME/ops/scripts/gc-knot-storage.sh"
if [[ -n "${KNOT_BACKUP_DIR:-}" ]]; then
  install_plist "$KNOT_HOME/ops/launchd/com.knot.backup.plist" "com.knot.backup"
else
  echo "==> KNOT_BACKUP_DIR 未配置，不装备份 LaunchAgent"
  launchctl bootout "$DOMAIN/com.knot.backup" 2>/dev/null || true
fi

# 每月 1 日 04:45 只出回收报告，不删。要真删得人工加 --apply。
install_plist "$KNOT_HOME/ops/launchd/com.knot.gc.plist" "com.knot.gc"

sleep 2
curl -sf "http://127.0.0.1:8080/api/health" && echo

echo "==> openclaw"
chmod +x "$KNOT_HOME/ops/scripts/ensure-openclaw.sh"
OPENCLAW_ENABLE_PROCESS=1 "$KNOT_HOME/ops/scripts/ensure-openclaw.sh"

curl -sf "http://127.0.0.1:8080/api/health" && echo
echo "OK: http://192.168.3.91:8080/"
