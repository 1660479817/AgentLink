#!/usr/bin/env bash
# 兼容入口。新入口是 push-deploy.sh，目标主机来自 ops/deploy.env。
# 旧变量 DEPLOY_REMOTE / DEPLOY_REMOTE_DIR 仍可用，会被映射过去。
set -euo pipefail

if [[ -z "${KNOT_DEPLOY_SSH:-}" && -n "${DEPLOY_REMOTE:-}" ]]; then
  export KNOT_DEPLOY_SSH="$DEPLOY_REMOTE"
fi
if [[ -z "${KNOT_DEPLOY_DIR:-}" && -n "${DEPLOY_REMOTE_DIR:-}" ]]; then
  export KNOT_DEPLOY_DIR="$DEPLOY_REMOTE_DIR"
fi

exec "$(cd "$(dirname "$0")" && pwd)/push-deploy.sh" "$@"
