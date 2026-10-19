# xknot.si 部署到新加坡 EC2（HTTP 先行）

面向算力助理 / 运维：在 **ap-southeast-1** 边缘机上托管中枢静态站 + 申请接口。  
**DNS 尚未切到 Route53、暂不签 Let’s Encrypt。** 证书与 `wang` 边缘另任务。

## 主机

| 项 | 值 |
|----|----|
| 实例 | `i-0c876685a64c75538` |
| 公网 | `54.169.33.64`（会随 EIP/重建变化，以当前为准） |
| SSH | `ssh -i ~/.ssh/suanli-sg-probe.pem ec2-user@54.169.33.64` |
| 同机已有 | `zenheart.net` / `knot.zenheart.net`（nginx + LE）——改 conf 前务必 `nginx -t`，勿停这两站 |

## 路径

| 路径 | 用途 |
|------|------|
| `/var/www/xknot` | 门户静态（`web/dist`） |
| `/opt/xknot/server` | 接口源码 `server/index.mjs` |
| `/opt/xknot/admin` | 审核台静态 |
| `/opt/xknot/ops/validate-instances.mjs` | 清单校验（`manifest.mjs` 依赖） |
| `/opt/xknot/web/src/lib/{i18n,regions}.js` | 校验依赖 |
| `/opt/xknot/var` | SQLite / session-secret（`0600`，勿入仓） |
| `/etc/nginx/conf.d/xknot.si.conf` | HTTP 门户 + `/api` `/admin` 反代 |
| `/etc/systemd/system/xknot-api.service` | 接口常驻 |

## 环境变量（systemd）

见 unit `ops/xknot-api.service`：

| 变量 | 生产值 |
|------|--------|
| `XKNOT_API_HOST` | `127.0.0.1` |
| `XKNOT_API_PORT` | `5181` |
| `XKNOT_DATA_DIR` | `/opt/xknot/var` |
| `XKNOT_TRUST_PROXY` | `1` |
| `XKNOT_SECURE_COOKIE` | HTTP 阶段**不要**开；有 HTTPS 后再置 `1` |

接口只监听回环；nginx 反代 `/api/`、`/admin/`。

## 本机构建与同步

```bash
cd xknot.si
./ops/build-hub.sh                 # 或 --offline
XKNOT_EDGE=ec2-user@54.169.33.64 \
XKNOT_SSH_KEY=$HOME/.ssh/suanli-sg-probe.pem \
XKNOT_TARGET=/var/www/xknot \
  ./ops/deploy-hub.sh
```

`deploy-hub.sh` 已 `--exclude .well-known`，避免冲掉 ACME 挑战目录。

接口、审核台与配置（首次或代码变更）：

```bash
cd xknot.si
XKNOT_EDGE=ec2-user@54.169.33.64 \
XKNOT_SSH_KEY=$HOME/.ssh/suanli-sg-probe.pem \
  ./ops/deploy-api.sh

# 只看会做什么，不连远端
XKNOT_EDGE=ec2-user@54.169.33.64 ./ops/deploy-api.sh --dry-run
```

`deploy-api.sh` 依次同步 `server/`、`admin/`、`docs/`、清单校验依赖，安装 nginx 配置与 systemd unit，`nginx -t` 通过后重启接口并 reload nginx，最后在本机回环上验证 `/api/health`。静态站不在它的范围内，仍由 `deploy-hub.sh` 负责。

等价的手工步骤（脚本不可用时）：

```bash
KEY=$HOME/.ssh/suanli-sg-probe.pem
EDGE=ec2-user@54.169.33.64
rsync -az -e "ssh -i $KEY" server/ "$EDGE:/opt/xknot/server/"
rsync -az -e "ssh -i $KEY" admin/ "$EDGE:/opt/xknot/admin/"
rsync -az -e "ssh -i $KEY" docs/ "$EDGE:/opt/xknot/docs/"
rsync -az -e "ssh -i $KEY" ops/validate-instances.mjs "$EDGE:/opt/xknot/ops/"
rsync -az -e "ssh -i $KEY" web/src/lib/i18n.js web/src/lib/regions.js \
  "$EDGE:/opt/xknot/web/src/lib/"
scp -i "$KEY" ops/xknot.si.conf ops/root.xknot.si.conf ops/xknot-api.service "$EDGE:/tmp/"
ssh -i "$KEY" "$EDGE" '
  sudo cp /tmp/xknot.si.conf /etc/nginx/conf.d/xknot.si.conf
  sudo cp /tmp/root.xknot.si.conf /etc/nginx/conf.d/root.xknot.si.conf
  sudo cp /tmp/xknot-api.service /etc/systemd/system/xknot-api.service
  sudo nginx -t && sudo systemctl daemon-reload
  sudo systemctl enable --now xknot-api
  sudo systemctl reload nginx
'
```

## nginx 现状（HTTP only）

- `listen 80`；`server_name xknot.si www.xknot.si`
- 业务在 80 上直接提供（`/` → `/en/`），**不** 301 到 HTTPS（尚无证）
- `/.well-known/acme-challenge/` 预留
- 443 的 ssl server 块在 `ops/xknot.si.conf` 里注释草稿；有证后再启用

## 证书（NS 切到 Route53 之后）

**现在不要跑。** 草稿：

```bash
# 1) 确认公网 A/AAAA 已指向本机，HTTP ACME 可通
curl -sI -H 'Host: xknot.si' http://54.169.33.64/.well-known/acme-challenge/ping

# 2) 签证书（webroot）
sudo certbot certonly --webroot -w /var/www/xknot \
  -d xknot.si -d www.xknot.si

# 3) 启用 ops/xknot.si.conf 中 HTTPS server 块；
#    把 80 的业务 location 收成 ACME + return 301 https://$host$request_uri;
sudo nginx -t && sudo systemctl reload nginx

# 4) systemd 打开 Secure Cookie
sudo systemctl edit xknot-api   # 或改 unit：Environment=XKNOT_SECURE_COOKIE=1
sudo systemctl restart xknot-api
```

`root.xknot.si` 跳转见 `ops/root.xknot.si.conf`，可同机另装；本笔记未强制安装。

## 验收 curl（Host 头）

```bash
curl -sI -H 'Host: xknot.si' http://54.169.33.64/
# 期望 302 Location: http://xknot.si/en/  （有证改 HTTPS 后为 https）

curl -sI -H 'Host: xknot.si' http://54.169.33.64/en/          # 200
curl -sI -H 'Host: xknot.si' http://54.169.33.64/data/hub.json # 200
curl -sI -H 'Host: xknot.si' http://54.169.33.64/admin/        # 200
curl -sI -H 'Host: xknot.si' http://54.169.33.64/api/admin/applications  # 401

# 回归：同机既有站不得挂
curl -skI --resolve knot.zenheart.net:443:54.169.33.64 https://knot.zenheart.net/   # 200
curl -skI --resolve zenheart.net:443:54.169.33.64 https://zenheart.net/             # 200
```

## instances.json 备注

清单里的示范实例 `root` 与旗舰实例 `wang` 目前都指向 `https://wang.xknot.si`。中枢门户可以先上线；探测结果为构建时采样，不影响静态站与申请接口。

## 实例侧脚本与主机

实例侧的隧道与边缘脚本（Knot 平台仓库的 `ops/scripts/run-edge-tunnel.sh`、`ops/scripts/push-edge.sh`、`ops/scripts/push-discover.sh`）都以 `ops/deploy.env` 里的 `KNOT_EDGE_SSH` / `KNOT_EDGE_HOST` 为准，仓库里没有默认主机；未配置时脚本直接报错。中枢自己的部署见 `ops/deploy-hub.sh` 与 `ops/deploy-api.sh`，也不写死主机。

隧道用户 `knot-tunnel@` 需在边缘机另行开通后再用隧道。

## 禁止

- 未切 NS 前不要对 xknot / wang 跑 certbot
- 不要改 Dynadot / 不要动 Route53 `zenheart` 区
- 不要 terminate 实例；不要停同机其它站点（zenheart 等）的服务
