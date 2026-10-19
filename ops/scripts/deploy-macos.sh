#!/usr/bin/env bash
# 兼容入口。部署逻辑已移到 deploy-site.sh，配置来自 ops/deploy.env。
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/deploy-site.sh" "$@"
