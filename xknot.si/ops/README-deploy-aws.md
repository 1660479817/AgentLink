# xknot.si 中枢部署

面向算力助理 / 运维：在公网主机上托管**联盟门户**的静态站与申请接口。

这是联盟门户自己的部署。用 `knot-platform` 部署的伙伴站点不在这里，也不由这套脚本管理；两台若是同一台机器，只说明共用主机，不构成依赖。

## 主机

仓库里不写死主机。下面的值只是当前实例，改动时以 `ops/deploy.env` 那台为准，或直接覆盖环境变量。

```bash
EDGE=ec2-user@16.162.24.182
```

| 项 | 值 |
|----|----|
| 区域 | `ap-east-1` |
| 实例 | `i-0efad2ed59a4d023c` |
| 公网 | `16.162.24.182`（随 EIP / 重建变化） |
| SSH | `ssh -i ~/.ssh/id_rsa $EDGE` |
| 同机其它站点 | 可能还有实例侧的站点（`../..` 的 `ops/` 管那一侧）。各站 nginx 配置独立，改 conf 前务必 `nginx -t` |

## 路径

| 路径 | 用途 |
|------|------|
| `/var/www/xknot` | 门户静态（`web/dist`） |
| `/opt/xknot/server` | 接口源码 `server/index.mjs` |
| `/opt/xknot/admin` | 审核台静态 |
| `/opt/xknot/docs` | 本项目文档（systemd 的 `Documentation=`） |
| `/opt/xknot/ops/validate-instances.mjs` | 清单校验（`manifest.mjs` 依赖） |
| `/opt/xknot/web/src/lib/{i18n,regions}.js` | 校验依赖 |
| `/opt/xknot/var` | SQLite / session-secret（`0600`，勿入仓） |
| `/etc/nginx/conf.d/xknot.si.conf` | 门户 + `/api` `/admin` 反代 |
| `/etc/nginx/conf.d/root.xknot.si.conf` | `root.xknot.si` 的 301 |
| `/etc/systemd/system/xknot-api.service` | 接口常驻 |

## 环境变量（systemd）

见 unit `ops/xknot-api.service`：

| 变量 | 生产值 |
|------|--------|
| `XKNOT_API_HOST` | `127.0.0.1` |
| `XKNOT_API_PORT` | `5181` |
| `XKNOT_DATA_DIR` | `/opt/xknot/var` |
| `XKNOT_TRUST_PROXY` | `1` |
| `XKNOT_SECURE_COOKIE` | 有 HTTPS 时 `1`（当前 unit 已置 `1`）；只在 HTTP 阶段临时关掉 |

接口只监听回环；nginx 反代 `/api/`、`/admin/`。

## 构建与部署

```bash
cd xknot.si

# 静态站
./ops/build-hub.sh                 # 或 --offline
XKNOT_EDGE=$EDGE XKNOT_SSH_KEY=~/.ssh/id_rsa ./ops/deploy-hub.sh

# 接口、审核台与配置
XKNOT_EDGE=$EDGE XKNOT_SSH_KEY=~/.ssh/id_rsa ./ops/deploy-api.sh
```

`deploy-hub.sh` 已 `--exclude .well-known`，避免冲掉 ACME 挑战目录。`deploy-api.sh` 同步 `server/`、`admin/`、`docs/` 与清单校验依赖，安装 nginx 配置与 systemd unit，`nginx -t` 通过后重启接口并 reload nginx，最后在回环上验证 `/api/health`。两者互不覆盖。

先看会做什么，不连远端：

```bash
XKNOT_EDGE=$EDGE ./ops/deploy-hub.sh --dry-run
XKNOT_EDGE=$EDGE ./ops/deploy-api.sh --dry-run
```

## nginx 现状

- `xknot.si` / `www.xknot.si`：443 提供门户，`/` 302 到 `/en/`；80 只留 ACME 并 301 到 HTTPS。
- `/api/`、`/admin/` 反代到 `127.0.0.1:5181`；`/assets/` 长缓存，`/data/hub.json` 用 `no-cache`。
- `root.xknot.si`：只做 ACME 与到 `wang.xknot.si` 的 301，不反代接口。
- 证书由 Certbot 管理，不动 `ssl_certificate` 那几行。

## 证书

```bash
# 1) 确认 A/AAAA 已指向本机，HTTP ACME 可通
curl -sI -H 'Host: xknot.si' http://16.162.24.182/.well-known/acme-challenge/ping

# 2) 签证书（webroot）
sudo certbot certonly --webroot -w /var/www/xknot -d xknot.si -d www.xknot.si

# 3) reload 并确认 Secure Cookie 已开
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl show xknot-api -p Environment   # 应含 XKNOT_SECURE_COOKIE=1
```

`root.xknot.si` 的证书单独签发，不复用 `xknot.si` 的。

## 验收

```bash
curl -sI -H 'Host: xknot.si' https://16.162.24.182/            # 302 → /en/
curl -sI -H 'Host: xknot.si' https://16.162.24.182/en/         # 200
curl -sI -H 'Host: xknot.si' https://16.162.24.182/data/hub.json  # 200，no-cache
curl -s  -H 'Host: xknot.si' https://16.162.24.182/api/health  # {"ok":true,...}
curl -sI -H 'Host: xknot.si' https://16.162.24.182/admin/      # 200
curl -sI -H 'Host: xknot.si' https://16.162.24.182/api/admin/applications  # 401

# 回归：同机其它站点不得受影响，按各项目自己的地址检查
```

## instances.json 备注

清单里的示范入口 `root` 与旗舰实例 `wang` 目前都指向 `https://wang.xknot.si`。门户可以先上线；探测结果是构建时采样，不影响静态站与申请接口。

## 实例侧

实例怎么部署、边缘与隧道怎么配，不在本文范围。用 `knot-platform` 部署的站点见仓库根的 `ops/`：`ops/edge/README.md`（隧道与边缘）、`ops/edge/subdomain-fixed-ip.md`（固定 IP 直连）。那边的主机与密钥由各自的 `ops/deploy.env` 给出。

## 禁止

- 未切 NS 前不要对 xknot.si 跑 certbot
- 不要改 Dynadot / 不要动 Route53 `zenheart` 区
- 不要 terminate 实例；不要停同机其它站点的服务
