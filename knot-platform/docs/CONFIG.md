# Knot 配置项

这份文档由 `packages/knot-config/src/schema.mjs` 生成，不要手改。改配置项请改 schema，再跑：

```bash
node ops/scripts/config.mjs template --write           # sites/_template/site.env
node ops/scripts/config.mjs platform-template --write  # sites/_template/platform.env
node ops/scripts/config.mjs xknot-template --write     # sites/_template/xknot.env
node ops/scripts/config.mjs docs --write               # 重新生成本文
```

## 官方部署方式

只支持两种：**local**（开发环境，`KNOT_ENTRY_ENABLED=0`，只绑回环地址）和
**xknot.si 二级子域**（`KNOT_ENTRY_ENABLED=1`，`KNOT_DOMAIN=<标签>.xknot.si`）。
独立域名、内网公开、固定公网 IP 直连都不在官方范围内，属于用户改造。

## 三个边界

| 边界 | 位置 | 放什么 | 能不能进版本库 |
| --- | --- | --- | --- |
| 代码 | `backend/` `web/` `packages/` | 真正的默认行为 | 进 |
| 部署 | `ops/` | 脚本、模板、LaunchAgent、systemd unit。不写站点取值 | 进 |
| 配置 | `sites/<站点>/` | 站点档案、拓扑、密钥 | 不进（`sites/_template/` 除外） |

环境变量只覆盖代码里的默认值。一个键要么在 `packages/knot-config/src/schema.mjs` 里登记，要么就别读。
Backend 启动时按同一份登记表校验环境：值不合法直接退出，必填项缺失时管理功能不可用；文件在部署前严格校验未知键。

一个站点一个目录：

| 文件 | 放什么 | 谁写 |
| --- | --- | --- |
| `sites/<站点>/site.env` | 域名、主机、端口、路径、入口、隧道。不含密码 | 运维 |
| `sites/<站点>/profile.json` | 自述区：名称、多语种介绍、logo、主理人、联系方式、标签、语种、地区、时区、社交链接。不进版本库 | 主理人，在 `/admin` 的 XKnot 栏编辑 |
| `sites/<站点>/platform.env` | SMTP 密码、价格初值、管理令牌。权限 600 | 部署脚本 |
| `sites/<站点>/xknot.env` | 实例 id、中枢地址、签发日期与委托发信凭据。权限 600 | 中枢签发，`join-xknot.sh` 写入 |
| `sites/<站点>/entry.<标签>.xknot.si.env` | 接入 xknot.si 子域时的入口：域名、静态根、conf、证书。一个站点一份 | 运维 |
| `sites/<站点>/agents/` | Internal Personal Agent 的授权码，权限 700 | 脚本 |

**部署与接入是两条独立的线。** `deploy-site.sh` 只读 `site.env` 与 `platform.env`；
`xknot.env` 只在运行时交给 Backend，缺了它站点照样部署和运行，只是不接联邦。
反过来，重新部署、换机器、回滚都不会动接入凭据。

## 站点配置（`sites/<站点>/site.env`）

### 站点

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_PUBLIC_ORIGIN` | `http://127.0.0.1:8080` |  | 对外访问地址。local 部署写 http://127.0.0.1:<KNOT_PORT>；接入 xknot.si 子域后写中枢签发的 https://<标签>.xknot.si。 |
| `KNOT_DOMAIN` | （空） |  | xknot.si 签发的二级子域，形如 <标签>.xknot.si。local 部署留空；接子域时与入口文件名一致。 |
| `KNOT_HUB_ORIGIN` | `https://xknot.si` |  | 第一次接入时把申请提交到哪个中枢。默认联邦入口 xknot.si；本机联调可以指向 dev 中枢。 |
| `KNOT_PORT` | `8080` |  | 实例主机上 Backend 监听的端口。 |
| `KNOT_BIND_HOST` | `127.0.0.1` |  | Backend 绑定地址。local 与入口回源都只走本机，保持 127.0.0.1；要让同一内网的机器打开管理后台 /admin，站点把它设为 0.0.0.0。 |
| `KNOT_SESSION_COOKIE_NAME` | `knot_sid` |  | 会话 Cookie 名。同一个域名下跑多个站点时要各不相同。 |
| `KNOT_ADMIN_EMAIL` | （空） | 是 | 站点管理员邮箱。必填；用这个邮箱登录后拥有平台管理权限，建议与投诉也寄到这里。 |
| `KNOT_SESSION_TTL_DAYS` | `30` |  | 登录会话有效期（天）。Cookie 和 sessions.expires_at 用同一个值。 |

### 实例主机

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_DB_MODE` | `local` |  | local 用本机 Homebrew Postgres；external 用 KNOT_DATABASE_URL，不启动本机库。 |
| `KNOT_DATABASE_URL` | （空） |  | KNOT_DB_MODE=external 时的连接串。可能含密码，按密钥对待。 |
| `KNOT_PGPORT` | `5433` |  | 本机 Postgres 端口。和系统默认的 5432 错开。 |
| `KNOT_PGDATA` | `$HOME/knot/pgdata` |  | 本机 Postgres 数据目录。 |
| `KNOT_PGLOG` | `$HOME/knot/pg.log` |  | 本机 Postgres 日志文件。 |
| `KNOT_PG_BIN` | `/opt/homebrew/opt/postgresql@16/bin` |  | PostgreSQL 16 的 bin 目录。Apple Silicon Homebrew 是 /opt/homebrew，Intel 改成 /usr/local/opt/postgresql@16/bin。 |
| `KNOT_UPLOAD_DIR` | 见说明 |  | 上传目录。留空用 <部署根目录>/var/uploads；放在发布包外，升级和回滚都不动它。 |
| `KNOT_BACKUP_DIR` | （空） |  | 备份目录。留空不备份；配置后 deploy-site.sh 装每天 04:15 的备份任务（launchd 或 systemd timer）。 |
| `KNOT_BACKUP_KEEP` | `7` |  | 保留最近几份备份。 |
| `KNOT_BACKUP_SITES` | `1` |  | 1 表示备份也收 sites/<站点>/：platform.env（SMTP 密码、管理令牌）、agents/（智能体凭据）。只备份数据库的话，换台机器邮件登录和智能体就都没了。 |
| `KNOT_BACKUP_OPENCLAW` | `auto` |  | OpenClaw 状态目录的备份。auto 表示 $HOME/.openclaw 存在就收；1 必须收；0 跳过。只收配置、凭据和 agent 工作区，不含 cache/browser/npm。 |
| `KNOT_OPENCLAW` | `auto` |  | auto 表示装了 openclaw 才同步；1 必须同步；0 跳过。 |
| `KNOT_SYSTEMD_DIR` | `/etc/systemd/system` |  | Linux 实例主机上 systemd unit 的安装目录。 |
| `KNOT_SERVICE_USER` | `knot` |  | Linux 实例主机上跑 Knot Backend 的系统账号。需对该读的目录有权限。 |

### 从开发机发布

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_DEPLOY_SSH` | （空） |  | 实例主机的 ssh 目标，形如 user@host。留空表示就在实例主机上直接跑 deploy-site.sh（local）。 |
| `KNOT_DEPLOY_DIR` | `~/knot/AgentLink/knot-platform` |  | 实例主机上的部署根目录。sites/、releases/、current、var/ 都在这里，代码在 releases/<版本> 下。 |
| `KNOT_DEPLOY_SSH_KEY` | （空） |  | 发布用的私钥。留空用 ssh 默认身份。 |
| `KNOT_DEPLOY_VERIFY_URL` | 见说明 |  | 部署后探活的地址。留空按 http://<实例主机>:<KNOT_PORT>/api/health 推导。 |
| `KNOT_DEPLOY_KEEP` | `5` |  | 实例主机上保留几个历史发布包。当前版本和回滚目标永远保留，多的按时间清掉。 |
| `KNOT_ARTIFACT_DIR` | 见说明 |  | 开发机上构建产物（发布包和校验和）的输出目录。留空用 <knot-platform>/artifacts。 |

### 公网入口

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_ENTRY_ENABLED` | `0` |  | 1 表示接入 xknot.si 子域，把 WebUI 和 nginx 配置推到 KNOT_ENTRY_SSH；0 是 local 部署，不碰入口主机。 |
| `KNOT_ENTRY_SSH` | （空） |  | 入口主机的 ssh 目标。 |
| `KNOT_ENTRY_SSH_KEY` | `$HOME/.ssh/id_rsa` |  | 在开发机上推页面用的私钥。 |
| `KNOT_ENTRY_PUSH_KEY` | `$HOME/.ssh/knot-entry-publish` |  | 在实例主机上推公开快照用的私钥，可以和 KNOT_ENTRY_SSH_KEY 不是同一把。 |
| `KNOT_ENTRY_WEB_ROOT` | `/var/www/knot` |  | 入口主机上放 WebUI 的目录。 |
| `KNOT_ENTRY_CONF` | `/etc/nginx/conf.d/knot.conf` |  | 入口主机上的 nginx 站点配置路径。 |
| `KNOT_ENTRY_WEB_OWNER` | `nginx:nginx` |  | WebUI 目录的属主。 |
| `KNOT_ENTRY_CACHE_DIR` | `/var/cache/nginx/knot_uploads` |  | 上传文件的反向代理缓存目录。 |
| `KNOT_ENTRY_CACHE_ZONE` | `knot_uploads` |  | nginx proxy_cache 区名。 |
| `KNOT_ENTRY_CACHE_SIZE` | `2g` |  | 缓存上限，nginx 写法，如 2g。 |
| `KNOT_ENTRY_MAX_BODY` | `52m` |  | 入口主机接受的请求体上限。必须大于后端附件上限，否则大文件在 nginx 就被截断。 |
| `KNOT_ENTRY_PROXY_PORT` | `18080` |  | 入口回源端口。nginx 把 /api 和 /help 转到这里，隧道再转回实例主机。 |
| `KNOT_ENTRY_SSL` | `1` |  | 1 监听 443 并配证书；0 只监听 80，证书还没签好时用。 |
| `KNOT_ENTRY_CERT` | 见说明 |  | 证书链。留空由 KNOT_DOMAIN 推导。 |
| `KNOT_ENTRY_KEY` | 见说明 |  | 证书私钥。留空由 KNOT_DOMAIN 推导。 |
| `KNOT_ENTRY_RELOAD_CMD` | `sudo systemctl reload nginx` |  | 改完 nginx 配置后的 reload 命令。非 systemd 的机器改成自己的。 |

### 回源隧道

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KNOT_TUNNEL` | `0` |  | 1 表示实例主机主动连出建隧道，让 xknot.si 子域入口能回源；local 部署保持 0。 |
| `KNOT_TUNNEL_SSH` | 见说明 |  | 隧道账号。留空是 knot-tunnel@<KNOT_ENTRY_SSH 的主机>。 |
| `KNOT_TUNNEL_KEY` | `$HOME/.ssh/knot-entry` |  | 实例主机上建隧道用的私钥。 |
| `KNOT_TUNNEL_LOCAL_PORT` | 见说明 |  | 隧道落回本机的端口。留空等于 KNOT_PORT。 |
| `KNOT_TUNNEL_REMOTE_PORT` | 见说明 |  | 隧道在入口主机上占用的端口。留空等于 KNOT_ENTRY_PROXY_PORT。 |

## 实例运行时配置（`sites/<站点>/platform.env`）

### 站点

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_SITE` | （空） | 由部署脚本写入：站点目录名（sites/<站点>）。实例主机上的脚本靠它找到这份配置。 |

### 实例主机

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | （空） | 由部署脚本写入：local 模式是 postgres://knot@127.0.0.1:<KNOT_PGPORT>/knot，external 模式取 KNOT_DATABASE_URL。 |
| `STATIC_WEB_DIR` | （空） | 由部署脚本写入：<knot-platform>/web/dist。 |
| `KNOT_AGENT_ENV_DIR` | （空） | 由部署脚本写入：<knot-platform>/sites/<站点>/agents。智能体的账号文件放这里。 |
| `KNOT_PROFILE_FILE` | （空） | 由部署脚本写入：<knot-platform>/sites/<站点>/profile.json。站点档案（自述区）在这里，主理人在 /admin 里编辑。 |

### 公网入口

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KNOT_DISCOVER_PUSH_CMD` | （空） | 由部署脚本写入：开启入口时是 push-discover.sh，关闭时为空。 |

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
| `KNOT_SALE_TTL_HOURS` | `72` | 出售帖有效期（小时）。出售帖 = 有可下载附件且有标价的 post/fastpost；零价附件帖不算出售帖，不过期。到期自动下架，作者可再次开放。 |
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
| `KNOT_UPLOAD_IMAGE_MAX_BYTES` | 8388608（8 MiB） | 单张图片上限。同时要小于 KNOT_ENTRY_MAX_BODY。 |
| `KNOT_UPLOAD_AUDIO_MAX_BYTES` | 8388608（8 MiB） | 单条音频上限。 |
| `KNOT_UPLOAD_ATTACHMENT_MAX_BYTES` | 52428800（50 MiB） | 单个附件上限。必须小于 KNOT_ENTRY_MAX_BODY。 |
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
| `KNOT_ADMIN_TOKEN` | （空） | 内网管理接口 /api/admin 和管理后台 /admin 的令牌。由 ensure-openclaw.sh 写入，运维不要手改。 |

## XKnot 接入配置（`sites/<站点>/xknot.env`）

只放中枢签发的东西，不参与部署推导。文件可以不存在。

键名与语义是联邦契约，见 `xknot.si/docs/FEDERATION.md` 第 7.4 节；`xknot.env` 这个文件名与位置
是本实现的约定，换个实现只要读同样这几个键即可。

```bash
./ops/scripts/join-xknot.sh --payload ~/xknot-access.env   # 写入并校验
./ops/scripts/join-xknot.sh --status                       # 看当前接入状态
node ops/scripts/config.mjs check --xknot --site <站点>     # 只校验这一个文件
```

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `XKNOT_INSTANCE_ID` | （空） | 是 | 中枢清单里的实例 id（小写字母、数字、短横线）。会写进 /api/health 的 instance，供中枢核对身份。 |
| `XKNOT_HUB_ORIGIN` | `https://xknot.si` |  | 接入的中枢地址。委托发信地址由它推导。 |
| `XKNOT_HUB_RELAY_URL` | （空） |  | 委托发信的完整地址。留空时按 XKNOT_HUB_ORIGIN 推导，只在换入口时手写。 |
| `XKNOT_HUB_RELAY_TOKEN` | （空） |  | 中枢签发的委托发信凭据。只存在于 xknot.env；不进邮件、不进版本库、不进发布包。 |
| `XKNOT_ISSUED_URL` | （空） |  | 中枢签发的对外地址。签发区的一部分，与清单里的 url 一致；节点只读。 |
| `XKNOT_ISSUED_AT` | （空） |  | 签发日期（YYYY-MM-DD）。签发区的一部分，对外报作 since。 |
| `XKNOT_TIER` | （空） |  | 中枢签发的层级。签发区的一部分；留空时对外不报这一项。 |
| `XKNOT_STATUS` | （空） |  | 中枢签发的状态。签发区的一部分；留空时对外不报这一项。 |

## 校验

部署前会跑 `node ops/scripts/config.mjs check`，发现问题直接停下，不会部署一半。
手动检查：

```bash
node ops/scripts/config.mjs check --site <站点>              # 查 site.env
node ops/scripts/config.mjs check --platform --site <站点>   # 查实例主机的 platform.env
node ops/scripts/config.mjs check --xknot --site <站点>      # 查接入用的 xknot.env
node ops/scripts/config.mjs sites                            # 列出已有站点
```

必填与跨键规则：

| 规则 | 条件 |
| --- | --- |
| KNOT_ENTRY_ENABLED=1 时必须配置 KNOT_ENTRY_SSH。local 部署请写 KNOT_ENTRY_ENABLED=0。 | `KNOT_ENTRY_ENABLED=1` |
| KNOT_DB_MODE=external 时必须配置 KNOT_DATABASE_URL。 | `KNOT_DB_MODE=external` |
| 接入 xknot.si 子域时必须设 KNOT_TUNNEL=1，由实例主机主动连出回源隧道。 | `KNOT_ENTRY_ENABLED=1` |
| 接入 xknot.si 子域时 KNOT_PUBLIC_ORIGIN 必须走 https://。 | `KNOT_ENTRY_ENABLED=1` |

