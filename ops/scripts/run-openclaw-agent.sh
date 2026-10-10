#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${KNOT_AGENT_ENV:-$KNOT_HOME/ops/env/openclaw-agent.local.env}"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
cd "$KNOT_HOME/apps/openclaw-agent"
exec node src/index.js
