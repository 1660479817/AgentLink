#!/usr/bin/env bash
# 把中枢的接口、审核台和站点配置同步到托管主机，并重启接口进程。
#
# 静态站（web/dist）由 deploy-hub.sh 负责，这里不碰它。
#
# 用法：
#   XKNOT_EDGE=user@host ./ops/deploy-api.sh
#   XKNOT_EDGE=user@host ./ops/deploy-api.sh --dry-run
#
# 可覆盖的变量：
#   XKNOT_EDGE       必填，如 user@192.0.2.10
#   XKNOT_API_ROOT   接口与审核台的根目录，默认 /opt/xknot
#   XKNOT_WEB_ROOT   静态站根目录，默认 /var/www/xknot
#   XKNOT_SSH_KEY    私钥路径，默认 ~/.ssh/id_rsa
#   XKNOT_NGINX_CONF 远端 nginx 配置路径，默认 /etc/nginx/conf.d/xknot.si.conf
#   XKNOT_SERVICE    远端 systemd unit 名，默认 xknot-api
#
# 仓库里不写死任何主机。脚本按下面的顺序做事，任一步失败就停：
#   同步 → 装配置 → nginx -t → daemon-reload → 重启接口 → reload nginx → 健康检查
set -euo pipefail

HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

: "${XKNOT_EDGE:?set XKNOT_EDGE=user@host}"
API_ROOT="${XKNOT_API_ROOT:-/opt/xknot}"
WEB_ROOT="${XKNOT_WEB_ROOT:-/var/www/xknot}"
SSH_KEY="${XKNOT_SSH_KEY:-$HOME/.ssh/id_rsa}"
NGINX_CONF="${XKNOT_NGINX_CONF:-/etc/nginx/conf.d/xknot.si.conf}"
SERVICE="${XKNOT_SERVICE:-xknot-api}"

SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

rsync_to() {
  local src="$1" dest="$2"
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "(dry-run) $src → $XKNOT_EDGE:$dest"
    return
  fi
  rsync -az --itemize-changes \
    -e "ssh ${SSH_OPTS[*]}" \
    "$src" "$XKNOT_EDGE:$dest"
}

if [[ "$DRY_RUN" != 1 && ! -f "$SSH_KEY" ]]; then
  echo "找不到私钥：$SSH_KEY" >&2
  exit 1
fi

echo "==> prepare $XKNOT_EDGE:$API_ROOT"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) mkdir -p $API_ROOT/{server,admin,ops,docs,web/src/lib,var}"
else
    ssh "${SSH_OPTS[@]}" "$XKNOT_EDGE" \
    "mkdir -p '$API_ROOT/server' '$API_ROOT/admin' '$API_ROOT/ops' '$API_ROOT/docs' \
      '$API_ROOT/web/src/lib' '$API_ROOT/var' && chmod 700 '$API_ROOT/var'"
fi

# 接口运行时需要的东西：server/ 本身，以及 manifest.mjs 校验清单时用到的
# validate-instances.mjs、i18n.js、regions.js。缺一个，审核通过后生成条目就会失败。
echo "==> sync api"
rsync_to "$HUB/server/" "$API_ROOT/server/"
rsync_to "$HUB/admin/" "$API_ROOT/admin/"
rsync_to "$HUB/docs/" "$API_ROOT/docs/"
rsync_to "$HUB/ops/validate-instances.mjs" "$API_ROOT/ops/"
rsync_to "$HUB/web/src/lib/i18n.js" "$API_ROOT/web/src/lib/"
rsync_to "$HUB/web/src/lib/regions.js" "$API_ROOT/web/src/lib/"
# 委托发信要按清单判断实例是否在册、是否 active；漏了这份文件，新实例会被 403。
rsync_to "$HUB/instances.json" "$API_ROOT/instances.json"

echo "==> stage config"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) copy ops/xknot.si.conf, ops/xknot-api.service → /tmp"
else
  scp -q "${SSH_OPTS[@]}" \
    "$HUB/ops/xknot.si.conf" \
    "$HUB/ops/xknot-api.service" \
    "$XKNOT_EDGE:/tmp/"
fi

echo "==> install config"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) install conf + unit, nginx -t, restart $SERVICE, reload nginx"
else
  ssh "${SSH_OPTS[@]}" "$XKNOT_EDGE" "
    set -e
    sudo install -m 644 /tmp/xknot.si.conf '$NGINX_CONF'
    sudo install -m 644 /tmp/xknot-api.service '/etc/systemd/system/$SERVICE.service'
    sudo nginx -t
    sudo systemctl daemon-reload
    sudo systemctl enable '$SERVICE'
    sudo systemctl restart '$SERVICE'
    sudo systemctl reload nginx
  "
fi

echo "==> verify"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) curl $XKNOT_EDGE/api/health"
else
  for _ in $(seq 1 15); do
    if ssh "${SSH_OPTS[@]}" "$XKNOT_EDGE" "curl -sf http://127.0.0.1:5181/api/health >/dev/null"; then
      curl -sf "https://xknot.si/api/health" >/dev/null 2>&1 \
        && echo "OK: https://xknot.si/api/health" \
        || echo "OK: 接口已起；公网地址这次没连上，检查 DNS 与证书。"
      exit 0
    fi
    sleep 1
  done
  echo "接口没有起来：看 systemctl status $SERVICE 与 journalctl -u $SERVICE" >&2
  exit 1
fi
