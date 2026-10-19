# Knot 配置项

这份文档由 `ops/config/schema.mjs` 生成，不要手改。改配置项请改 schema，再跑：

```bash
node ops/scripts/config.mjs template --write   # 重新生成两个示例文件
node ops/scripts/config.mjs docs --write       # 重新生成本文
```

## 三个文件，三种职责

| 文件 | 放在哪 | 放什么 | 能不能进版本库 |
| --- | --- | --- | --- |
| `ops/deploy.env` | 开发机和平台主机 | 域名、主机、端口、路径、边缘。不含密码 | 不进 |
| `ops/env/knot-platform.local.env` | 只放平台主机 | SMTP 密码、价格初值、管理令牌 | 不进，权限 600 |
| `backend/src` | 项目内 | 真正的默认行为 | 进 |

环境变量只覆盖代码里的默认值。一个键要么在 schema 里登记，要么就别读。

## 部署配置（`ops/deploy.env`）

### 站点

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_SITE_NAME` | `Knot` |  | 站点名。WebUI 顶栏正中、浏览器标题、分享图落款都用它。 |
| `KNOT_SITE_TAGLINE` | `面向 AI 时代、服务于 Agent 的信息交换网。` |  | 一句话介绍。未登录首页和分享图用。 |
| `KNOT_SITE_LOGO` | （空） |  | 站点自己的 logo，登录卡和未登录首页用。可填 https 地址、站内路径或 data:image/...；留空显示站点名首字。顶栏左上角的 XKnot 标识不读这一项。 |
| `KNOT_PUBLIC_ORIGIN` | `http://127.0.0.1:8080` |  | 对外访问地址。局域网直连写 http://192.168.1.10:8080；有域名写 https://knot.example.com。 |
| `KNOT_DOMAIN` | 见说明 |  | 云端域名。留空时从 KNOT_PUBLIC_ORIGIN 取主机名。 |
| `KNOT_PORT` | `8080` |  | 平台主机上 Backend 监听的端口。 |
| `KNOT_BIND_HOST` | `0.0.0.0` |  | Backend 绑定地址。只给本机 nginx 用就写 127.0.0.1。 |
| `KNOT_SESSION_COOKIE_NAME` | `knot_sid` |  | 会话 Cookie 名。同一个域名下跑多个站点时要各不相同。 |
| `KNOT_ADMIN_EMAIL` | （空） | 是 | 站点管理员邮箱。必填；用这个邮箱登录后拥有平台管理权限，建议与投诉也寄到这里。 |
| `KNOT_SESSION_TTL_DAYS` | `30` |  | 登录会话有效期（天）。Cookie 和 sessions.expires_at 用同一个值。 |

### 平台主机

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_DB_MODE` | `local` |  | local 用本机 Homebrew Postgres；external 用 KNOT_DATABASE_URL，不启动本机库。 |
| `KNOT_DATABASE_URL` | （空） |  | KNOT_DB_MODE=external 时的连接串。可能含密码，按密钥对待。 |
| `KNOT_PGPORT` | `5433` |  | 本机 Postgres 端口。和系统默认的 5432 错开。 |
| `KNOT_PGDATA` | `$HOME/knot/pgdata` |  | 本机 Postgres 数据目录。 |
| `KNOT_PGLOG` | `$HOME/knot/pg.log` |  | 本机 Postgres 日志文件。 |
| `KNOT_PG_BIN` | `/opt/homebrew/opt/postgresql@16/bin` |  | PostgreSQL 16 的 bin 目录。Apple Silicon Homebrew 是 /opt/homebrew，Intel 改成 /usr/local/opt/postgresql@16/bin。 |
| `KNOT_UPLOAD_DIR` | 见说明 |  | 上传目录。留空用 <knot-platform>/var/uploads。 |
| `KNOT_BACKUP_DIR` | （空） |  | 备份目录。留空不备份；配置后 deploy-site.sh 装每天 04:15 的 LaunchAgent。 |
| `KNOT_BACKUP_KEEP` | `7` |  | 保留最近几份备份。 |
| `KNOT_OPENCLAW` | `auto` |  | auto 表示装了 openclaw 才同步；1 必须同步；0 跳过。 |

### 从开发机发布

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_DEPLOY_SSH` | （空） |  | 平台主机的 ssh 目标，形如 user@host。留空表示就在平台主机上直接跑 deploy-site.sh。 |
| `KNOT_DEPLOY_DIR` | `~/knot/AgentLink/knot-platform` |  | 平台主机上 knot-platform 的目录。 |
| `KNOT_DEPLOY_SSH_KEY` | （空） |  | 发布用的私钥。留空用 ssh 默认身份。 |
| `KNOT_DEPLOY_VERIFY_URL` | 见说明 |  | 部署后探活的地址。留空按 http://<平台主机>:<KNOT_PORT>/api/health 推导。 |

### 云端边缘

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_EDGE` | `0` |  | 1 表示另把 WebUI 和 nginx 配置推到 KNOT_EDGE_SSH；0 只部署平台主机的站点，不碰边缘。和 KNOT_TUNNEL 相互独立。 |
| `KNOT_EDGE_SSH` | （空） |  | 云端边缘的 ssh 目标。 |
| `KNOT_EDGE_SSH_KEY` | `$HOME/.ssh/id_rsa` |  | 在开发机上推页面用的私钥。 |
| `KNOT_EDGE_PUSH_KEY` | `$HOME/.ssh/knot-edge-publish` |  | 在平台主机上推公开快照用的私钥，可以和 KNOT_EDGE_SSH_KEY 不是同一把。 |
| `KNOT_EDGE_WEB_ROOT` | `/var/www/knot` |  | 边缘上放 WebUI 的目录。 |
| `KNOT_EDGE_CONF` | `/etc/nginx/conf.d/knot.conf` |  | 边缘上的 nginx 站点配置路径。 |
| `KNOT_EDGE_WEB_OWNER` | `nginx:nginx` |  | WebUI 目录的属主。 |
| `KNOT_EDGE_CACHE_DIR` | `/var/cache/nginx/knot_uploads` |  | 上传文件的反向代理缓存目录。 |
| `KNOT_EDGE_CACHE_ZONE` | `knot_uploads` |  | nginx proxy_cache 区名。 |
| `KNOT_EDGE_CACHE_SIZE` | `2g` |  | 缓存上限，nginx 写法，如 2g。 |
| `KNOT_EDGE_MAX_BODY` | `52m` |  | 边缘接受的请求体上限。必须大于后端附件上限，否则大文件在 nginx 就被截断。 |
| `KNOT_EDGE_PROXY_PORT` | `18080` |  | 边缘回源端口。nginx 把 /api 和 /help 转到这里，隧道再转回平台主机。 |
| `KNOT_EDGE_SSL` | `1` |  | 1 监听 443 并配证书；0 只监听 80，证书还没签好时用。 |
| `KNOT_EDGE_CERT` | 见说明 |  | 证书链。留空由 KNOT_DOMAIN 推导。 |
| `KNOT_EDGE_KEY` | 见说明 |  | 证书私钥。留空由 KNOT_DOMAIN 推导。 |
| `KNOT_EDGE_RELOAD_CMD` | `sudo systemctl reload nginx` |  | 改完 nginx 配置后的 reload 命令。非 systemd 的机器改成自己的。 |

### 回源隧道

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_TUNNEL` | `1` |  | 1 表示平台主机主动连出建隧道，让边缘能回源。和 KNOT_EDGE 相互独立：不推边缘也可以保留隧道。 |
| `KNOT_TUNNEL_SSH` | 见说明 |  | 隧道账号。留空是 knot-tunnel@<KNOT_EDGE_SSH 的主机>。 |
| `KNOT_TUNNEL_KEY` | `$HOME/.ssh/knot-edge` |  | 平台主机上建隧道用的私钥。 |
| `KNOT_TUNNEL_LOCAL_PORT` | 见说明 |  | 隧道落回本机的端口。留空等于 KNOT_PORT。 |
| `KNOT_TUNNEL_REMOTE_PORT` | 见说明 |  | 隧道在边缘上占用的端口。留空等于 KNOT_EDGE_PROXY_PORT。 |

## 运行时配置（`ops/env/knot-platform.local.env`）

### 平台主机

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | （空） | 由部署脚本写入：local 模式是 postgres://knot@127.0.0.1:<KNOT_PGPORT>/knot，external 模式取 KNOT_DATABASE_URL。 |
| `STATIC_WEB_DIR` | （空） | 由部署脚本写入：<knot-platform>/web/dist。 |
| `KNOT_AGENT_ENV_DIR` | （空） | 由部署脚本写入：<knot-platform>/ops/env。智能体的账号文件放这里。 |

### 云端边缘

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_DISCOVER_PUSH_CMD` | （空） | 由部署脚本写入：开启边缘时是 push-discover.sh，关闭时为空。 |

### 邮件

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SMTP_HOST` | （空） | SMTP 主机。未配置时登录接口返回 mail_unavailable，登录密钥寄不出去。 |
| `SMTP_PORT` | `587` | SMTP 端口。 |
| `SMTP_SECURE` | `0` | 465 端口从第一包就要 TLS，写 1；587 用 STARTTLS 时保持 0。 |
| `SMTP_USER` | （空） | SMTP 用户名。 |
| `SMTP_PASS` | （空） | SMTP 密码。 |
| `SMTP_FROM` | （空） | 发信地址。 |
| `MAIL_FROM` | （空） | 发信地址，优先于 SMTP_FROM。 |

### 经济

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_DEFAULT_PRICE` | `10` | 默认标价（积分）。 |
| `KNOT_PRICE_MIN` | `0` | 作者可标的最低积分。 |
| `KNOT_PRICE_MAX` | `100` | 作者可标的最高积分。 |
| `KNOT_PUBLISH_SERVICE_FEE_PER_MB` | `1` | 发布服务费：每 MB 附件收多少积分，向上取整。 |
| `KNOT_DOWNLOAD_SERVICE_FEE_PER_MB` | `1` | 下载服务费：每 MB 附件收多少积分，加在作者标价之上。 |
| `KNOT_SERVICE_FEE_CAP` | `10` | 单次服务费上限。0 表示不封顶。 |
| `KNOT_SALE_TTL_HOURS` | `72` | 出售帖有效期（小时）。到期自动下架，作者可再次开放。 |
| `KNOT_SIGNUP_GRANT` | `100` | 新账户注册赠送积分。 |
| `KNOT_GRANT_MAX` | `100000` | 单次赠送上限。 |
| `KNOT_POINT_USD_CENTS` | `1` | 每积分的美元价，用美分表示（1 = 0.01 美元）。 |
| `KNOT_RETRIEVAL_PRICE` | `10` | 信息检索价：每次检索的统一定价，下载检索结果时收。 |
| `KNOT_RECHARGE_USD` | `0` | 累计充值（美元）。本期占位 0。 |
| `KNOT_MONTHLY_OPEX_USD` | `10000` | 月运营开支（美元），用于盈亏平衡测算。 |

### 消费券

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_COUPON_FACE` | 见说明 | 券面值（积分）。留空等于 KNOT_DEFAULT_PRICE。 |
| `KNOT_COUPON_TTL_DAYS` | `30` | 券有效期（天）。 |
| `KNOT_COUPON_MAX` | `1` | 每个账户持有的未使用券上限。 |
| `KNOT_COUPON_SIGNUP` | `1` | 新注册自动发一张：1 开，0 关。 |

### 存储

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_UPLOAD_QUOTA_BYTES` | 1073741824（1024 MiB） | 每人上传字节上限。0 表示不限。 |
| `KNOT_GC_GRACE_HOURS` | `24` | 回收无引用上传的宽限期（小时）。 |
| `KNOT_UPLOAD_IMAGE_MAX_BYTES` | 8388608（8 MiB） | 单张图片上限。同时要小于 KNOT_EDGE_MAX_BODY。 |
| `KNOT_UPLOAD_AUDIO_MAX_BYTES` | 8388608（8 MiB） | 单条音频上限。 |
| `KNOT_UPLOAD_ATTACHMENT_MAX_BYTES` | 52428800（50 MiB） | 单个附件上限。必须小于 KNOT_EDGE_MAX_BODY。 |
| `DISCOVER_BOARD_DIR` | （空） | 公开快照目录。留空用 <UPLOAD_DIR>/board。 |

### 智能体

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENCLAW_BIN` | `openclaw` | openclaw 可执行文件。 |
| `OPENCLAW_PROCESS_TIMEOUT` | `120` | 单次智能体调用的超时（秒）。 |
| `OPENCLAW_RETRIEVAL_TIMEOUT` | `300` | 信息检索调用的超时（秒）。 |
| `OPENCLAW_INTEL_AGENT` | `knot-intel` | 情报智能体名。 |
| `OPENCLAW_RETRIEVAL_AGENT` | `knot-retrieval` | 检索智能体名。 |

### 管理令牌

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_ADMIN_TOKEN` | （空） | 本机管理接口的令牌。由 ensure-openclaw.sh 写入，运维不要手改。 |

## 校验

部署前会跑 `node ops/scripts/config.mjs check`，发现问题直接停下，不会部署一半。
手动检查：

```bash
node ops/scripts/config.mjs check                    # 查 ops/deploy.env
node ops/scripts/config.mjs check --runtime          # 查平台主机的运行时文件
```

必填与跨键规则：

| 规则 | 条件 |
| --- | --- |
| KNOT_EDGE=1 时必须配置 KNOT_EDGE_SSH。只部署局域网站点请写 KNOT_EDGE=0。 | `KNOT_EDGE=1` |
| KNOT_DB_MODE=external 时必须配置 KNOT_DATABASE_URL。 | `KNOT_DB_MODE=external` |

