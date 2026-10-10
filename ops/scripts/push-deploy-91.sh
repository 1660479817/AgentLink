#!/usr/bin/env bash
# 从开发机同步到 192.168.3.91 并执行 deploy-macos.sh
# 用法：
#   ./ops/scripts/push-deploy-91.sh                    # 需已配置 SSH 公钥
#   DEPLOY_SSH_PASS='…' ./ops/scripts/push-deploy-91.sh  # 密码（需 sshpass）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE="${DEPLOY_REMOTE:-zenwang_bot01@192.168.3.91}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-~/knot/AgentLink}"

SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
PASS="${DEPLOY_SSH_PASS:-${E2E_SSH_PASS:-${SSHPASS:-}}}"
if [[ -n "$PASS" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "需要 sshpass：brew install sshpass" >&2
    exit 1
  fi
  export SSHPASS="$PASS"
  SSH_OPTS="$SSH_OPTS -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1"
  RSYNC_E="sshpass -e ssh $SSH_OPTS"
  RUN_SSH=(sshpass -e ssh $SSH_OPTS)
else
  RSYNC_E="ssh $SSH_OPTS"
  RUN_SSH=(ssh $SSH_OPTS)
fi

echo "==> rsync → $REMOTE:$REMOTE_DIR"
rsync -avz --delete \
  --exclude node_modules \
  --exclude var \
  --exclude .git \
  --exclude 'ops/env/*.local.env' \
  -e "$RSYNC_E" \
  "$ROOT/" "$REMOTE:$REMOTE_DIR/"

echo "==> remote deploy-macos.sh"
"${RUN_SSH[@]}" "$REMOTE" "cd $REMOTE_DIR && chmod +x ops/scripts/*.sh && ./ops/scripts/deploy-macos.sh"

echo "==> verify"
curl -sf "http://192.168.3.91:8080/api/health"
echo
curl -sf -o /dev/null -w "web %{http_code}\n" "http://192.168.3.91:8080/"
echo "OK: http://192.168.3.91:8080/"
