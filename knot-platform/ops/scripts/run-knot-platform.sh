#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
ENV_FILE="$KNOT_PLATFORM_ENV"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 ${ENV_FILE}。先跑 ./ops/scripts/deploy-site.sh --site ${KNOT_SITE}。" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
# 接入文件是可选的另一份：中枢签发的东西不进 platform.env。
# 不存在就是没接入联邦，不影响启动。
if [[ -f "$KNOT_XKNOT_ENV" ]]; then
  # shellcheck source=/dev/null
  source "$KNOT_XKNOT_ENV"
fi
set +a
if [[ -z "${KNOT_AGENT_ENV_DIR:-}" ]]; then
  export KNOT_AGENT_ENV_DIR="$KNOT_SITE_DIR/agents"
fi
# launchd 给的软限是 256；每个 HTTP 连接一个 fd，并发一过两百就是 EMFILE。
# shellcheck source=lib/fd-limit.sh
source "$SCRIPT_DIR/lib/fd-limit.sh"
knot_raise_fd_limit
cd "$KNOT_APP_DIR/backend"
# KNOT_NODE_BIN 由部署脚本写进 platform.env。launchd 不跑登录 shell，PATH 里常常
# 只有 /usr/bin:/bin:/usr/sbin:/sbin：brew 装在 /opt/homebrew，nvm/volta 装在 home 下，
# 都找不到。老版本的 platform.env 没有这个键时退回 PATH 里的 node。
exec "${KNOT_NODE_BIN:-node}" src/index.js
