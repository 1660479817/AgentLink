#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${KNOT_ENV:-$KNOT_HOME/ops/env/knot-platform.local.env}"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
if [[ -z "${KNOT_AGENT_ENV_DIR:-}" ]]; then
  export KNOT_AGENT_ENV_DIR="$KNOT_HOME/ops/env"
fi
cd "$KNOT_HOME/backend"
exec node src/index.js
