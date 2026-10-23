#!/usr/bin/env bash
# 把中枢的接口、控制台和站点配置同步到托管主机，并重启接口进程。
#
# 静态站（web/dist）由 deploy-hub.sh 负责，这里不碰它。
#
# 用法：
#   XKNOT_HUB_SSH=user@host ./ops/deploy-api.sh
#   XKNOT_HUB_SSH=user@host ./ops/deploy-api.sh --dry-run
#
# 可覆盖的变量：
#   XKNOT_HUB_SSH       必填，如 user@192.0.2.10
#   XKNOT_API_ROOT   接口与控制台的根目录，默认 /opt/xknot
#   XKNOT_WEB_ROOT   静态站根目录，默认 /var/www/xknot
#   XKNOT_SSH_KEY    私钥路径，默认 ~/.ssh/id_rsa
#   XKNOT_NGINX_CONF 远端 nginx 配置路径，默认 /etc/nginx/conf.d/xknot.si.conf
#   XKNOT_SERVICE    远端 systemd unit 名，默认 xknot-api
#
# 仓库里不写死任何主机。脚本按下面的顺序做事，任一步失败就停：
#   同步 → 备份并装配置 → nginx -t（不通过就回滚并退出）→ daemon-reload
#   → 重启接口 → reload nginx → 健康检查
set -euo pipefail

HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

: "${XKNOT_HUB_SSH:?set XKNOT_HUB_SSH=user@host}"
API_ROOT="${XKNOT_API_ROOT:-/opt/xknot}"
WEB_ROOT="${XKNOT_WEB_ROOT:-/var/www/xknot}"
SSH_KEY="${XKNOT_SSH_KEY:-$HOME/.ssh/id_rsa}"
NGINX_CONF="${XKNOT_NGINX_CONF:-/etc/nginx/conf.d/xknot.si.conf}"
SERVICE="${XKNOT_SERVICE:-xknot-api}"

SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

rsync_to() {
  local src="$1" dest="$2"
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "(dry-run) $src → $XKNOT_HUB_SSH:$dest"
    return
  fi
  rsync -az --itemize-changes \
    --exclude '*.test.mjs' \
    -e "ssh ${SSH_OPTS[*]}" \
    "$src" "$XKNOT_HUB_SSH:$dest"
}

if [[ "$DRY_RUN" != 1 && ! -f "$SSH_KEY" ]]; then
  echo "找不到私钥：$SSH_KEY" >&2
  exit 1
fi

echo "==> prepare $XKNOT_HUB_SSH:$API_ROOT"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) mkdir -p $API_ROOT/{server,admin,ops,docs,web/src/lib,var}"
else
    ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" \
    "mkdir -p '$API_ROOT/server' '$API_ROOT/admin' '$API_ROOT/ops' '$API_ROOT/docs' \
      '$API_ROOT/web/src/lib' '$API_ROOT/var' && chmod 700 '$API_ROOT/var'"
fi

# 接口运行时需要的东西：server/ 本身，以及 manifest.mjs 校验清单时用到的
# validate-instances.mjs、i18n.js、regions.js。缺一个，生成清单条目就会失败。
# 控制台的「编辑」还要读 validate-federation.mjs：漏了它，server/edit.mjs 一加载就报
# ERR_MODULE_NOT_FOUND，整个接口起不来。
echo "==> sync api"
rsync_to "$HUB/server/" "$API_ROOT/server/"
rsync_to "$HUB/admin/" "$API_ROOT/admin/"
rsync_to "$HUB/docs/" "$API_ROOT/docs/"
# 整个 ops/ 一起同步，不再一份份列举。
# 逐份列举漏过一个模块，接口就起不来：server/app.mjs import 的 subdomain.mjs
# 曾经不在名单里，部署后 ERR_MODULE_NOT_FOUND，进程一直重启，门户 502。
# 定时巡检（每 15 分钟）也直接在远端跑这里的文件，同样是一漏就整轮失败。
# 单测不进远端：那边没有跑测试的场景，留着只会让 /opt/xknot 越来越像仓库。
rsync_to "$HUB/ops/" "$API_ROOT/ops/"
rsync_to "$HUB/web/src/lib/i18n.js" "$API_ROOT/web/src/lib/"
rsync_to "$HUB/web/src/lib/regions.js" "$API_ROOT/web/src/lib/"

# 两份人工维护的配置：清单与名册。仓库是权威副本，同步会用仓库内容覆盖远端，
# 所以先把远端现存的各存一份到 var/config-backup/，在中枢主机上手改过的内容还能捞回来。
echo "==> backup remote config"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) cp instances.json / federation.json → $API_ROOT/var/config-backup/<stamp>/"
else
  ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "
    set -e
    stamp=\$(date -u +%Y%m%dT%H%M%SZ)
    dir='$API_ROOT/var/config-backup/'\$stamp
    mkdir -p \"\$dir\"
    for f in instances.json federation.json; do
      [ -f '$API_ROOT/'\$f ] && cp -a '$API_ROOT/'\$f \"\$dir/\$f\"
    done
    # 只留最近 20 份，别让备份把磁盘堆满。
    ls -1dt '$API_ROOT/var/config-backup/'*/ 2>/dev/null | tail -n +21 | xargs -r rm -rf
    echo \"backup: \$dir\"
  "
fi

# 委托发信要按清单判断实例是否在册、是否 active；漏了这份文件，新实例会被 403。
rsync_to "$HUB/instances.json" "$API_ROOT/instances.json"
# 总览里每个账号的配置与「编辑」都读这份名册；缺了它，配置一律显示「未进名册」。
rsync_to "$HUB/federation.json" "$API_ROOT/federation.json"
# `npm run admin` 读的是这份文件；缺了它，运维只能在仓库目录里跑 node。
rsync_to "$HUB/package.json" "$API_ROOT/package.json"

echo "==> stage config"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) copy ops/xknot.si.conf, ops/xknot-api.service, ops/xknot-provision.service, ops/xknot-health.{service,timer}, ops/xknot-traffic.{service,timer} → /tmp"
else
  scp -q "${SSH_OPTS[@]}" \
    "$HUB/ops/xknot.si.conf" \
    "$HUB/ops/xknot-api.service" \
    "$HUB/ops/xknot-provision.service" \
    "$HUB/ops/xknot-health.service" \
    "$HUB/ops/xknot-health.timer" \
    "$HUB/ops/xknot-traffic.service" \
    "$HUB/ops/xknot-traffic.timer" \
    "$XKNOT_HUB_SSH:/tmp/"
fi

echo "==> entry host config"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) create $API_ROOT/var/provision.env from XKNOT_ENTRY_HOST if missing"
elif [[ -n "${XKNOT_ENTRY_HOST:-}" ]]; then
  ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "
    set -e
    if [ ! -f '$API_ROOT/var/provision.env' ]; then
      printf 'XKNOT_ENTRY_HOST=%s\n' '$XKNOT_ENTRY_HOST' | sudo tee '$API_ROOT/var/provision.env' >/dev/null
      sudo chmod 600 '$API_ROOT/var/provision.env'
      echo 'wrote: $API_ROOT/var/provision.env'
    fi
  "
else
  echo "skip: 没给 XKNOT_ENTRY_HOST；自动接通会以「未配置」停在原地"
fi

echo "==> install config"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) backup + install conf (rollback on nginx -t failure), units (api + provision + health.{service,timer} + traffic.{service,timer}), restart $SERVICE, reload nginx"
else
  ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "
    set -e
    # unit 先装，nginx 配置最后装：unit 文件不参与 nginx -t，而 conf 校验失败时
    # 必须停在 daemon-reload 之前，别让主机上的服务被换掉。
    sudo install -m 644 /tmp/xknot-api.service '/etc/systemd/system/$SERVICE.service'
    sudo install -m 644 /tmp/xknot-provision.service /etc/systemd/system/xknot-provision.service
    sudo install -m 644 /tmp/xknot-health.service /etc/systemd/system/xknot-health.service
    sudo install -m 644 /tmp/xknot-health.timer /etc/systemd/system/xknot-health.timer
    sudo install -m 644 /tmp/xknot-traffic.service /etc/systemd/system/xknot-traffic.service
    sudo install -m 644 /tmp/xknot-traffic.timer /etc/systemd/system/xknot-traffic.timer

    # nginx 配置：备份 → 落盘 → nginx -t → 不通过就回滚。
    # 先覆盖再校验的话，校验失败时坏文件已经躺在 conf.d 里，脚本就此退出、不回滚；
    # 此后任何一次 reload（certbot 续期、别的子域部署）都会因整棵配置树不合法而失败，
    # 受影响的就不止这个站点了。
    # 备份名不以 .conf 结尾，nginx 的 conf.d/*.conf 不会把它当配置读进来。
    stamp=\$(date -u +%Y%m%dT%H%M%SZ)
    bak=\"$NGINX_CONF.bak-\"\$stamp
    had_conf=0
    if [ -f '$NGINX_CONF' ]; then
      # 用 install 而不是 cp -a：cp -a 会把原文件的修改时间一起带过去，
      # 下面按时间裁备份时，几份备份时间相同，留下的就不是最近的那几份。
      sudo install -m 644 '$NGINX_CONF' \"\$bak\"
      had_conf=1
    fi
    sudo install -m 644 /tmp/xknot.si.conf '$NGINX_CONF'
    if ! sudo nginx -t; then
      if [ \"\$had_conf\" = 1 ]; then
        sudo cp -a \"\$bak\" '$NGINX_CONF'
        echo \"回滚：nginx -t 未通过，'$NGINX_CONF' 已恢复，副本在 \$bak\" >&2
      else
        # 原本没有这份配置：留着坏文件同样会让下一次 reload 失败。
        sudo rm -f '$NGINX_CONF'
        echo \"回滚：nginx -t 未通过，原本没有 '${NGINX_CONF}'，新装的那份已移除\" >&2
      fi
      exit 1
    fi
    # 备份只留最近 10 份，别让每次部署都多一个文件堆在 conf.d 里。
    ls -1dt '$NGINX_CONF'.bak-* 2>/dev/null | tail -n +11 | sudo xargs -r rm -f || true

    sudo systemctl daemon-reload
    sudo systemctl enable '$SERVICE'
    sudo systemctl restart '$SERVICE'
    # 自动接通：没配 provision.env 时只打日志，不会碰主机。
    sudo systemctl enable xknot-provision
    sudo systemctl restart xknot-provision
    # timer 只 enable，不立刻补跑：部署时刚探过，马上再跑一次会把同一状态重复写一遍。
    sudo systemctl enable xknot-health.timer
    sudo systemctl start xknot-health.timer
    # 流量聚合读入口 nginx 的日志；入口还没装 knot-log.conf 时它会安静跳过。
    sudo systemctl enable xknot-traffic.timer
    sudo systemctl start xknot-traffic.timer
    sudo systemctl reload nginx
  "
fi

echo "==> verify"
if [[ "$DRY_RUN" == 1 ]]; then
  echo "(dry-run) curl $XKNOT_HUB_SSH/api/health; check xknot-health.timer"
else
  for _ in $(seq 1 15); do
    if ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "curl -sf http://127.0.0.1:5181/api/health >/dev/null"; then
      curl -sf "https://xknot.si/api/health" >/dev/null 2>&1 \
        && echo "OK: https://xknot.si/api/health" \
        || echo "OK: 接口已起；公网地址这次没连上，检查 DNS 与证书。"
      ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "systemctl is-enabled xknot-health.timer" >/dev/null 2>&1 \
        && echo "OK: xknot-health.timer 已启用（每 15 分钟）" \
        || echo "WARN: xknot-health.timer 未启用，连续断连提醒与隐藏不会发生。"
      ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "systemctl is-enabled xknot-traffic.timer" >/dev/null 2>&1 \
        && echo "OK: xknot-traffic.timer 已启用（每小时）" \
        || echo "WARN: xknot-traffic.timer 未启用，控制台不会出现入口流量。"
      ssh "${SSH_OPTS[@]}" "$XKNOT_HUB_SSH" "systemctl is-active --quiet xknot-provision" \
        && echo "OK: xknot-provision 在跑（自动接通）" \
        || echo "WARN: xknot-provision 没起来，签发了也不会自动接通。看 journalctl -u xknot-provision。"
      exit 0
    fi
    sleep 1
  done
  echo "接口没有起来：看 systemctl status $SERVICE 与 journalctl -u $SERVICE" >&2
  exit 1
fi
