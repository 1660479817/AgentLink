#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KNOT_HOME="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
ENV_FILE="$KNOT_PLATFORM_ENV"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE。先跑 ./ops/scripts/deploy-site.sh --site $KNOT_SITE。" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
if [[ -z "${KNOT_AGENT_ENV_DIR:-}" ]]; then
  export KNOT_AGENT_ENV_DIR="$KNOT_SITE_DIR/agents"
fi
cd "$KNOT_HOME/backend"
exec node src/index.js
