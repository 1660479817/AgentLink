# 部署与运维

本目录是**实例侧**的部署层：每台用 `knot-platform` 部署的 Knot 站点（WebUI + Backend + OpenClaw 配套）都从这里发布。

官方只支持两种部署方式：

| 方式 | 对外地址 | 配置 |
| --- | --- | --- |
| **local**（开发环境） | `http://127.0.0.1:<KNOT_PORT>/` | `KNOT_ENTRY_ENABLED=0`，`KNOT_DOMAIN=` 留空，Backend 只绑回环地址 |
| **xknot.si 二级子域**（公网） | `https://<标签>.xknot.si/` | `KNOT_ENTRY_ENABLED=1`，`KNOT_DOMAIN=<标签>.xknot.si`，走回源隧道 + 入口 nginx |

**独立域名部署、内网公开部署都不在官方范围内**，属于用户改造。`config.mjs check` 只接受
`xknot.si` 签发的二级子域，不接受自有域名、固定公网 IP 直连或局域网地址。

部署分三层：

- **实例主机**：跑 Knot Backend、PostgreSQL、WebUI。macOS 用 LaunchAgent，Linux 用 systemd。
- **公网入口（仅 xknot.si 方式）**：一台 Linux + nginx，只放 WebUI 和公开快照，`/api`、`/help` 经隧道回到实例主机。
- **配置**：`sites/<站点>/site.env` 一份；走 xknot.si 时再加一份 `entry.<标签>.xknot.si.env`。

部署分成三步，互相不掺：

1. **构建**（开发机）：`ops/scripts/build.sh` 产出 `knot-<版本>-<提交>-<平台>.tar.gz`；
2. **安装**（实例主机）：`deploy-site.sh` 解包、迁移、切换 `current`、重启、探活，不跑 `npm ci`，不跑 `vite build`；
3. **推送**（开发机一键）：`push-deploy.sh` = 构建 + 传输 + 远程安装 + 验收。

目标机上不需要源码，不需要 git，也不需要构建工具；只需要 Node.js 22+ 和一个数据库。

子域的申请、清单登记与验收要求见 [`xknot.si/docs/JOIN.md`](../../xknot.si/docs/JOIN.md)；伙伴侧接通流程见 [`xknot.si/docs/HANDOFF.md`](../../xknot.si/docs/HANDOFF.md)。

> 部署脚本里不再写死 IP、域名、目录或端口。代码、部署和配置分开：脚本在 `ops/`，每个站点一个目录 `sites/<站点>/`。模板见 [`sites/_template/site.env`](../sites/_template/site.env)，真实站点目录不进版本库。

## 1. 配置

一个站点一个目录，目录里最多四份配置。**部署与接入是两条独立的线**：

| 文件 | 管什么 | 谁写 | 部署读吗 |
| --- | --- | --- | --- |
| `sites/<站点>/site.env` | 站点拓扑：对外地址、端口、数据库、入口主机、隧道 | 运维 | 读 |
| `sites/<站点>/profile.json` | 自述区：名称、多语种介绍、logo、主理人、联系方式、标签、语种、地区、时区、社交链接 | 主理人在 `/admin` 编辑 | 不读，Backend 启动时读 |
| `sites/<站点>/entry.<标签>.xknot.si.env` | xknot.si 子域入口：域名、静态根、conf、证书、投放方式 | 运维 | 读 |
| `sites/<站点>/platform.env` | 实例主机运行时：SMTP、价格、存储、管理令牌，权限 `600` | `deploy-site.sh` 生成 | 读 |
| `sites/<站点>/xknot.env` | XKnot 接入：实例 id、中枢地址、签发日期与委托发信凭据，权限 `600` | 中枢签发，`join-xknot.sh` 写入 | 不读，只在运行时交给 Backend |

`entry.<标签>.xknot.si.env` 是叠加层：只写与 `site.env` 不同的项，没写的沿用。文件名必须等于里面的
`KNOT_DOMAIN`。local 方式不需要这个文件；xknot.si 方式有且只有一份。

`xknot.env` 可以不存在。没有它站点照样部署、登录、发帖、算积分，只是不接联邦；重新部署、换机器、回滚也都不动它。反过来，接入、换委托发信凭据不需要 `deploy-site.sh`，写完重启 Backend 就行。

先建目录：

```bash
node ops/scripts/config.mjs init <站点>
```

它从 `sites/_template/` 复制 `site.env` 与 `platform.env`，权限设为 `600`。已有站点直接改 `sites/<站点>/site.env`。

`sites/` 下除 `_template/` 外的内容都不进版本库：每个站点目录属于它自己的实例，开发者自己的实例（如 `bot01`）也不要提交或随发布包分发。

至少改这四项：

| 变量 | 说明 | 例子 |
| --- | --- | --- |
| `KNOT_PUBLIC_ORIGIN` | 对外访问地址，带协议。local 用 `http://127.0.0.1:<端口>`；xknot.si 用 `https://<标签>.xknot.si` | `http://127.0.0.1:8080` |
| `KNOT_ADMIN_EMAIL` | 本站管理员邮箱，部署时必填；这个邮箱登录后拥有平台管理权限 | `admin@example.com` |
| `KNOT_PORT` | Backend 监听端口 | `8080` |
| `KNOT_DB_MODE` | `local` 用本机 Homebrew Postgres；`external` 用 `KNOT_DATABASE_URL` | `local` |

`KNOT_PG_BIN` 默认是 Apple Silicon Homebrew 的 `/opt/homebrew/opt/postgresql@16/bin`；Intel 机器改成 `/usr/local/opt/postgresql@16/bin`。

站点身份不在 `site.env` 里。它是一份单独的档案 `sites/<站点>/profile.json`：名称、多语种介绍、logo、主理人、联系方式、标签、语种、地区、时区、社交链接。主理人在实例主机的 `/admin` → **XKnot** 栏里编辑并保存，不用重新部署，也不用改前端代码。字段与校验规则见 [`docs/PROFILE.md`](../docs/PROFILE.md)。

部署脚本把档案路径写进 `platform.env` 的 `KNOT_PROFILE_FILE`；WebUI 从 `GET /api/web/session` 的 `brand` 里读，中枢从公开的 `GET /api/federation/profile` 取回。

从 0.4 之前的版本迁移：`node ops/scripts/migrate-profile.mjs --site <站点>` 把旧的 `KNOT_SITE_*` 六项搬进 `profile.json`，再从 `site.env` 删掉。

WebUI 顶栏左上角是固定的 `XKnot` 蝶翼标识（`public/logos/xknot-mark.svg`），所有站点一致。站点自己的名字在顶栏正中，站点 logo 用在登录卡和未登录首页。顶栏不设搜索按钮；点站点名打开主理人弹窗。

local 部署到这里就够了。要接入 xknot.si 子域，再填 `KNOT_ENTRY_ENABLED=1`、`KNOT_ENTRY_SSH`、`KNOT_DOMAIN` 和 `KNOT_PUBLIC_ORIGIN`；要从开发机发布，填 `KNOT_DEPLOY_SSH`。

### 1.1 全部站点参数与默认值

`sites/<站点>/site.env` 里的键，以及没写时脚本用的默认值（`ops/scripts/lib/site-config.sh`）。标「必填」的没有默认值，缺了部署直接停。实例主机自己的运行时键见 [`docs/CONFIG.md`](../docs/CONFIG.md)。

| 分组 | 变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 站点 | `KNOT_PUBLIC_ORIGIN` | `http://127.0.0.1:$KNOT_PORT` | 对外访问地址，带协议 |
| 站点 | `KNOT_DOMAIN` | 空（local） | xknot.si 签发的二级子域；与入口文件名一致 |
| 站点 | `KNOT_PORT` | `8080` | Backend 监听端口 |
| 站点 | `KNOT_BIND_HOST` | `127.0.0.1` | Backend 绑定地址；local 与入口回源都只走本机 |
| 站点 | `KNOT_SESSION_COOKIE_NAME` | `knot_sid` | 会话 Cookie 名 |
| 站点 | `KNOT_ADMIN_EMAIL` | **必填** | 管理员邮箱，该邮箱登录后有管理权限 |
| 实例主机 | `KNOT_DB_MODE` | `local` | `local` 启本机库；`external` 用 `KNOT_DATABASE_URL` |
| 实例主机 | `KNOT_DATABASE_URL` | 空（也读 `DATABASE_URL`） | 外部库连接串；`local` 且留空时由脚本拼 |
| 实例主机 | `KNOT_PGPORT` | `5433` | 本机 PostgreSQL 端口 |
| 实例主机 | `KNOT_PGDATA` | `$HOME/knot/pgdata` | 数据目录 |
| 实例主机 | `KNOT_PGLOG` | `$HOME/knot/pg.log` | 日志文件 |
| 实例主机 | `KNOT_PG_BIN` | `/opt/homebrew/opt/postgresql@16/bin` | Intel Homebrew 改 `/usr/local/opt/postgresql@16/bin` |
| 实例主机 | `KNOT_UPLOAD_DIR` | `<部署根>/var/uploads` | 上传目录，在发布包外，升级和回滚都不动 |
| 实例主机 | `KNOT_BACKUP_DIR` | 空（不备份） | 配置后装每天 04:15 的备份任务 |
| 实例主机 | `KNOT_BACKUP_KEEP` | `7` | 保留几份快照 |
| 实例主机 | `KNOT_BACKUP_SITES` | `1` | 备份是否收 `sites/<站点>/`：`platform.env` 和 `agents/` 里的密钥 |
| 实例主机 | `KNOT_BACKUP_OPENCLAW` | `auto` | `auto` 有 `~/.openclaw` 就收；`1` 必须；`0` 跳过 |
| 实例主机 | `KNOT_OPENCLAW` | `auto` | `auto` 装了才同步；`1` 必须；`0` 跳过 |
| 实例主机 | `KNOT_SYSTEMD_DIR` | `/etc/systemd/system` | Linux 上 systemd unit 的安装目录 |
| 实例主机 | `KNOT_SERVICE_USER` | `knot` | Linux 上跑 Backend 的系统账号 |
| 远程发布 | `KNOT_DEPLOY_SSH` | 空 | 空表示在实例主机本机跑 `deploy-site.sh` |
| 远程发布 | `KNOT_DEPLOY_DIR` | `~/knot/AgentLink/knot-platform` | 远端**部署根**：`sites/`、`releases/`、`current`、`var/` 都在这里 |
| 远程发布 | `KNOT_DEPLOY_SSH_KEY` | 空 | 空则用 ssh 默认密钥或 `ssh-agent` |
| 远程发布 | `KNOT_DEPLOY_VERIFY_URL` | `http://<实例主机>:<KNOT_PORT>/api/health` | 发布后验收地址 |
| 远程发布 | `KNOT_DEPLOY_KEEP` | `5` | 实例主机保留几个历史发布包；当前版本和回滚目标永远保留 |
| 远程发布 | `KNOT_ARTIFACT_DIR` | `<knot-platform>/artifacts` | 开发机上发布包的输出目录 |
| 入口 | `KNOT_ENTRY_ENABLED` | `0` | `1` 才推 WebUI 和 nginx 配置 |
| 入口 | `KNOT_ENTRY_SSH` | 空（开入口时必填） | `user@entry-host` |
| 入口 | `KNOT_ENTRY_SSH_KEY` | `$HOME/.ssh/id_rsa` | 开发机推页面用 |
| 入口 | `KNOT_ENTRY_PUSH_KEY` | `$HOME/.ssh/knot-entry-publish` | 实例主机推公开快照用 |
| 入口 | `KNOT_ENTRY_WEB_ROOT` | `/var/www/knot` | 这个 xknot.si 子域的 WebUI 目录 |
| 入口 | `KNOT_ENTRY_CONF` | `/etc/nginx/conf.d/knot.conf` | 这个 xknot.si 子域的 nginx 配置路径 |
| 入口 | `KNOT_ENTRY_WEB_OWNER` | `nginx:nginx` | WebUI 目录属主 |
| 入口 | `KNOT_ENTRY_CACHE_DIR` | `/var/cache/nginx/knot_uploads` | 上传缓存目录 |
| 入口 | `KNOT_ENTRY_CACHE_ZONE` | `knot_uploads` | 缓存 zone 名 |
| 入口 | `KNOT_ENTRY_CACHE_SIZE` | `2g` | 缓存上限 |
| 入口 | `KNOT_ENTRY_MAX_BODY` | `52m` | 请求体上限 |
| 入口 | `KNOT_ENTRY_PROXY_PORT` | `18080` | 入口回源端口 |
| 入口 | `KNOT_ENTRY_SSL` | `1` | `0` 时只监听 80 |
| 入口 | `KNOT_ENTRY_CERT` | 按入口自己的 `KNOT_DOMAIN` 推导 | 证书链 |
| 入口 | `KNOT_ENTRY_KEY` | 按入口自己的 `KNOT_DOMAIN` 推导 | 私钥 |
| 入口 | `KNOT_ENTRY_RELOAD_CMD` | `sudo systemctl reload nginx` | 非 systemd 机器改这里 |
| 入口 | `KNOT_ENTRY_SERVE` | `static` | `static` 页面从入口主机上的磁盘出；`proxy` 连首页也回源 |
| 隧道 | `KNOT_TUNNEL` | `0` | local 保持 `0`；xknot.si 方式设 `1` |
| 隧道 | `KNOT_TUNNEL_SSH` | `knot-tunnel@<KNOT_ENTRY_SSH 的主机>` | 隧道账号 |
| 隧道 | `KNOT_TUNNEL_KEY` | `$HOME/.ssh/knot-entry` | 隧道私钥，不进仓库 |
| 隧道 | `KNOT_TUNNEL_LOCAL_PORT` | `$KNOT_PORT` | 实例主机侧被转发的端口 |
| 隧道 | `KNOT_TUNNEL_REMOTE_PORT` | `$KNOT_ENTRY_PROXY_PORT` | 入口侧监听端口 |

`KNOT_ENTRY_HOST`、`KNOT_TUNNEL_USER` 由上面几项推出来，不用手写。

### 1.2 实例主机的运行时参数

`deploy-site.sh` 把站点、数据库、目录、备份和入口推送项写进目标机的 `sites/<站点>/platform.env`，权限 `600`。邮件、价格、存储、智能体这些只属于这台机器的键，第一次部署时按 schema 里的默认值补进去，之后归运维，部署不会再改。

完整清单、默认值和必填条件见 [`docs/CONFIG.md`](../docs/CONFIG.md)。那份文档和三份模板文件都由 [`packages/knot-config/src/schema.mjs`](../packages/knot-config/src/schema.mjs) 生成，不要手改：

```bash
node ops/scripts/config.mjs template --write            # sites/_template/site.env
node ops/scripts/config.mjs platform-template --write   # sites/_template/platform.env
node ops/scripts/config.mjs xknot-template --write      # sites/_template/xknot.env
node ops/scripts/config.mjs docs --write                # docs/CONFIG.md
```

加一个配置项：先在 schema 里登记，代码从同一份登记表取默认值（`backend/src/config.js` 不再另写常量），最后重新生成。测试会检查 schema、模板文件、文档、代码默认值是否一致。

Backend 启动时会按同一份 schema 校验进程环境：**值不合法直接退出**；必填项缺失给警告（例如没有 `KNOT_ADMIN_EMAIL` 时站点能跑，但没有管理入口）。进程环境里还有部署脚本导出的 `KNOT_DEPLOY_ROOT` 这类脚本变量，所以运行时不对未登记键逐条报警，改由 `checkSite` / `checkPlatform` / `checkJoin` 在部署时校验三份文件。所以部署后如果服务起不来，先看 `var/log/knot-platform.err.log` 里的「配置错误」。

`KNOT_ADMIN_TOKEN`、`KNOT_AGENT_ENV_DIR`、`KNOT_DISCOVER_PUSH_CMD`、`KNOT_ENTRY_PUSH_KEY` 由部署脚本或 `ensure-openclaw.sh` 写入，不用手填。价格类键只在还没有价格表时生效；精算师写入 `economy_policy` 后以库里的为准。

### 1.3 接入 XKnot（与部署分开）

接入只写 `sites/<站点>/xknot.env`，来源是中枢签发的接入件。部署脚本不生成、不改写这份文件；`push-deploy.sh` 也不会把它推到目标机——它属于那台机器。

```bash
# 拿到接入件后（一次领取的明文，别存进聊天记录或版本库）
./ops/scripts/join-xknot.sh --site <站点> --payload ~/xknot-access.env
cat ~/xknot-access.env | ./ops/scripts/join-xknot.sh --site <站点> --payload -

./ops/scripts/join-xknot.sh --site <站点> --status    # 看实例 id、中枢、凭据（打码）、权限
./ops/scripts/join-xknot.sh --site <站点> --remove    # 解除接入，文件删掉
```

接入件就是一份 env 文件，键名由联邦契约规定（`xknot.si/docs/FEDERATION.md` 第 7.4 节），
`xknot.env` 只是本实现存放它的位置：

```bash
XKNOT_INSTANCE_ID=wang
XKNOT_HUB_ORIGIN=https://xknot.si
XKNOT_HUB_RELAY_TOKEN=xkr_wang_...
XKNOT_HUB_ISSUED_AT=2026-10-20
```

规则：

- 写了文件就要有 `XKNOT_INSTANCE_ID`，否则不知道这份接入属于谁。
- 委托发信只要有 `XKNOT_HUB_RELAY_TOKEN` 就能用：发信地址按 `XKNOT_HUB_ORIGIN` 推导。写了 `XKNOT_HUB_RELAY_URL` 却没有凭据会被拒绝，也不会拿旧文件里的凭据来凑。
- 部署键、实例运行时键混进来直接报错，不会悄悄写到别处。
- 写入后重启 Backend 才生效：launchd 用 `launchctl kickstart -k gui/$(id -u)/com.knot.platform`，systemd 用 `sudo systemctl restart knot-backend`。
- `0.3` 之前委托发信凭据写在 `platform.env`。`deploy-site.sh` 下次生成时会把它迁到 `xknot.env` 再从 `platform.env` 删掉，并打一行警告。

`XKNOT_INSTANCE_ID` 也决定 `/api/health` 里的 `instance` 字段，中枢拿它与清单 id 核对。
接入只是本地这一半：清单与名册由中枢登记，域名、证书、隧道账号和端口见 [`xknot.si/docs/HANDOFF.md`](../../xknot.si/docs/HANDOFF.md)。

## 2. 拓扑

官方只保留两种拓扑。

### 2.1 local（开发环境）

```text
浏览器 → http://127.0.0.1:<KNOT_PORT>/
            ├── /       WebUI（Backend serve web/dist）
            └── /api/*  Knot Backend

Knot Backend → 127.0.0.1:<KNOT_PGPORT>       （PostgreSQL）
Knot Backend → 127.0.0.1:18789               （OpenClaw Gateway，可选）
```

- `KNOT_ENTRY_ENABLED=0`
- `KNOT_DOMAIN=` 留空
- `KNOT_TUNNEL=0`
- `KNOT_BIND_HOST=127.0.0.1`
- `KNOT_PUBLIC_ORIGIN=http://127.0.0.1:<KNOT_PORT>`
- 不推入口主机，不建隧道，页面和接口都只在这台机器上。

### 2.2 xknot.si 二级子域

```text
浏览器 → https://<标签>.xknot.si/
            ├── /                 WebUI（KNOT_ENTRY_WEB_ROOT）
            ├── /discover.json    公开快照，缺失时回落隧道
            ├── /api/*            ──隧道──→ 实例主机
            └── /help             ──隧道──→ 实例主机

Knot Backend → 127.0.0.1:<KNOT_PGPORT>       （PostgreSQL）
Knot Backend → 127.0.0.1:18789               （OpenClaw Gateway，可选，只监听本机）
Knot Backend → 公开快照 → 入口主机 WebUI 目录
```

- `KNOT_ENTRY_ENABLED=1`
- `KNOT_DOMAIN=<标签>.xknot.si`
- `KNOT_PUBLIC_ORIGIN=https://<标签>.xknot.si`
- `KNOT_TUNNEL=1`
- `KNOT_BIND_HOST=127.0.0.1`
- 入口主机只放 WebUI 与公开快照；Backend、Postgres 和上传目录仍在实例主机，只有一份。

隧道由实例主机主动连出，入口的 `127.0.0.1:<KNOT_ENTRY_PROXY_PORT>` 转到实例主机的
`127.0.0.1:<KNOT_TUNNEL_LOCAL_PORT>`。入口主机与实例主机恰好同机时可以把 `KNOT_TUNNEL=0`
并把 `KNOT_ENTRY_PROXY_PORT` 设成 `KNOT_PORT`，但这仍是 xknot.si 子域方式，不是独立域名部署。

### 2.3 不在官方范围

独立域名、固定公网 IP 直连、局域网对外、一个实例挂多个域名、Docker Compose 整站——这些都不是
官方部署方式。用户要这么做，属于用户改造范围；改出来的配置与脚本也不受 `config.mjs check` 支持。

## 3. 实例主机

### 3.1 目标机要求

| 项 | 要求 |
| --- | --- |
| Node.js | 22+。发布包自带生产依赖，但运行时仍要有 `node`。 |
| 数据库 | macOS：Homebrew `postgresql@16`（`KNOT_DB_MODE=local`）。或任意 PostgreSQL 16（`KNOT_DB_MODE=external` + `KNOT_DATABASE_URL`）。 |
| 服务管理 | macOS 用 launchd；Linux 用 systemd。 |
| 不需要 | git、npm 构建工具、vite、源码目录。目标机不跑 `npm ci`，不跑 `vite build`。 |

### 3.2 目录布局

部署根是 `KNOT_DEPLOY_DIR`（默认 `~/knot/AgentLink/knot-platform`）：

```text
<部署根>/
├── sites/<站点>/          配置：site.env、platform.env、agents/。升级不动
├── releases/
│   ├── knot-0.2.0-abc1234/    代码。一个发布包一份
│   └── knot-0.1.9-def5678/
├── current -> releases/knot-0.2.0-abc1234
├── var/
│   ├── uploads/           数据。升级和回滚都不动
│   ├── log/
│   └── run/backend.pid    没有服务管理器时（--runtime none）记 Backend 进程
└── deployed.json          当前版本、上一个版本
```

`current` 是唯一的切换点：回滚只改这个符号链接再重启。`sites/` 和 `var/` 在发布包外面，所以换版本不会碰配置和数据。日志、上传目录、`STATIC_WEB_DIR` 都写成经 `current` 的稳定路径。

### 3.3 构建（开发机）

```bash
./ops/scripts/build.sh
```

产出在 `artifacts/`：

```text
knot-<版本>-<提交>[-dirty]-<平台>.tar.gz
knot-<版本>-<提交>[-dirty]-<平台>.tar.gz.sha256
```

包里是 `backend/`、`packages/`、`web/dist/`、`help.md`、`ops/`、生产依赖的 `node_modules/` 和 `BUILD.json`；不含 `sites/`、`var/`、`.git`，也不含 `*.test.js` / `*.test.mjs`。`BUILD.json` 记版本、提交、构建时间、平台，`/api/health` 会把它报出来（`release`、`commit`、`builtAt`）。

| 参数 | 作用 |
| --- | --- |
| `--skip-test` | 跳过单测（不推荐） |
| `--skip-install` | 复用现有 `node_modules`，不跑 `npm ci` |
| `--no-modules` | 不带 `node_modules`，目标机自己装生产依赖 |
| `--out <目录>` | 换个输出目录（默认 `KNOT_ARTIFACT_DIR`） |

平台标签是 `darwin-arm64`、`linux-x64` 这样的组合。原生模块（`sharp`）不能跨平台，所以发布包只装到同平台的机器上；部署时会校验，确实要混用时加 `--allow-platform-mismatch`。工作区有未提交改动时，包名带 `-dirty`。

### 3.4 本地发布（开发者默认）

目标就是这台机器时，`KNOT_DEPLOY_SSH` 留空。`push-deploy.sh` 会在本地把整条链走完：构建 → 校验 → 解包 → 装服务 → 探活，不 ssh、不 scp。

```bash
# 第一次：从模板建站点目录，改端口、管理员邮箱和 KNOT_PG_BIN
node ops/scripts/config.mjs init local
$EDITOR sites/local/site.env
node ops/scripts/config.mjs check --site local

# 之后每次
./ops/scripts/push-deploy.sh --site local
```

`KNOT_DEPLOY_SSH` 为空时，部署根是仓库本身（`sites/` 在那里），所以 `releases/`、`current`、`deployed.json`、`var/` 都落在 `knot-platform/` 下，都不进版本库。`sites/local/` 也一样只在本地。

本机默认装成 launchd 服务（开机自启、挂了自动拉起），和线上一致。但这样 `npm run dev:platform` 会因为端口被占而失败；改代码用开发模式时先停掉它，或者干脆装成不常驻：

```bash
./ops/scripts/push-deploy.sh --site local --runtime none   # 后台起，pid 写 var/run/backend.pid
launchctl bootout gui/$(id -u)/com.knot.platform           # 装成 launchd 后想停掉
```

`--runtime none` 手动重启时要带上站点名，部署根下有多个站点时它选不出来：

```bash
KNOT_SITE=local ./current/ops/scripts/run-knot-platform.sh
```

一台开发机上同时有 `sites/local` 和 `sites/bot01` 时，所有脚本都要显式带 `--site`；只有一个站点时才自动选中。端口按机器现状挑，`8080`、`5433` 这类常用口很容易被别的项目占着：

```bash
lsof -nP -iTCP:8081 -sTCP:LISTEN      # 空就是没占
```

`npm run dev:platform` + `npm run dev:web` 是另一条路：源码热更新，不装服务、不切 `current`，适合改代码；`push-deploy.sh --site local` 装的是发布包，和线上跑的是同一份东西，适合验发布和回滚。

本机实例没有 SMTP，邮件登录会返回 `mail_unavailable`。要用本机站点就得直接造一个会话：

```bash
./ops/scripts/local-login.sh --site local           # 默认是 KNOT_ADMIN_EMAIL 那个管理员
./ops/scripts/local-login.sh --site local --email someone@example.com
./ops/scripts/local-login.sh --site local --url     # 只打印带 cookie 的地址
```

它把用户和会话直接写进本机库，不用等邮件，可重复执行。脚本只认对外地址是回环地址的站点；`KNOT_PUBLIC_ORIGIN` 是公网地址时直接拒绝——能凭空造管理员会话的门不该留在公网上。开发机要发真邮件，就在 `sites/local/platform.env` 里配 `SMTP_*`。

### 3.5 远程发布（推荐）

```bash
# sites/<站点>/site.env 里写 KNOT_DEPLOY_SSH=user@platform-host
./ops/scripts/push-deploy.sh --site <站点>
```

它做四件事：本地构建 → 校验 checksum → 把 tar.gz 和 `site.env`（走 xknot.si 时连同入口文件）传到部署根 → 在目标机解包并运行 `deploy-site.sh` → 按 `KNOT_DEPLOY_VERIFY_URL` 验收。`--entry` 会在装完后接着推 xknot.si 子域入口；`--no-build` 复用最近一次产物；`--dry-run` 只检查不动目标机。

**不再同步源码。** 目标机的 `releases/` 里只有解包后的发布包，`sites/` 只收 `site.env`（以及 xknot.si 入口文件），`platform.env` 原地保留。

### 3.6 直接在实例主机上安装

```bash
mkdir -p ~/knot/knot-platform/.incoming
tar -xzf knot-0.2.0-abc1234-darwin-arm64.tar.gz -C ~/knot/knot-platform/.incoming
KNOT_DEPLOY_ROOT=~/knot/knot-platform \
  ~/knot/knot-platform/.incoming/knot-0.2.0-abc1234/ops/scripts/deploy-site.sh --site <站点>
```

`deploy-site.sh` 也可以直接吃 tar.gz：

```bash
./ops/scripts/deploy-site.sh --site <站点> --artifact <tar.gz>
```

在目标机上首次使用前，先把 `sites/<站点>/site.env` 放好（可以从 `sites/_template/` 复制）。

### 3.7 安装时做什么

1. 校验发布包：`BUILD.json`、checksum、平台、Node 版本；
2. 校验 `sites/<站点>/site.env`（类型、必填、跨键矛盾）；
3. 解到 `releases/<发布包名>/`，原子替换；
4. 按 `KNOT_DB_MODE` 启动本机 Postgres（或使用外部 `KNOT_DATABASE_URL`）；
5. 停 Backend，跑迁移（带 checksum 校验，历史迁移被改过会停下），搬迁旧上传目录；
6. 切换 `current`，把站点取值写进 `sites/<站点>/platform.env`；
7. 装服务：`com.knot.postgres`、`com.knot.platform`、`com.knot.gc`，配置了 `KNOT_BACKUP_DIR` 时装 `com.knot.backup`，开启入口和隧道时装 `com.knot.entry-tunnel`（Linux 对应 systemd unit 与 timer）；`--runtime none` 时改用独立会话在后台起 Backend（见 3.9.1），pid 写 `var/run/backend.pid`；
8. `KNOT_OPENCLAW` 为 `auto` 时，只有已安装 `openclaw` 才同步智能体；
9. 探活 `http://127.0.0.1:<KNOT_PORT>/api/health`，并核对正在运行的 `release`（老版本没有这个字段时比 `version`）；
10. 清理旧发布包（保留 `KNOT_DEPLOY_KEEP` 个，当前版本和上一个版本不动），写 `deployed.json`。

迁移失败时不会切换 `current`，并把旧版本拉回来；探活失败会自动把 `current` 指回上一个版本（`--no-auto-rollback` 可关掉）。**数据库迁移不回滚**，回滚后必要时用 `migrate.js --status` 看差多少。

### 3.8 回滚

```bash
./ops/scripts/rollback.sh --site <站点> --list      # 看已安装的版本
./ops/scripts/rollback.sh --site <站点>             # 回到上一个版本
./ops/scripts/rollback.sh --site <站点> --to knot-0.1.9-def5678
```

它只改 `current`、重启、探活。迁移是向前的：新版本执行过的迁移不会撤销，旧代码可能读不懂新表。回滚前先看一眼 `migrate.js --status`。用 `--runtime none` 装的站点没有服务管理器，回滚脚本看到 `var/run/backend.pid` 就按同一套方式停旧起新（同样另起会话）。

### 3.9 Linux + systemd

`deploy-site.sh` 会按 `uname` 选运行时。Linux 上要求 `KNOT_DB_MODE=external`（不要用 macOS 的 Homebrew 分支），并安装：

- `knot-backend.service`（`EnvironmentFile=<部署根>/sites/<站点>/platform.env`）
- `knot-backup.service` / `.timer`（配置了 `KNOT_BACKUP_DIR` 时）
- `knot-gc.service` / `.timer`（每月出回收报告）

unit 模板在 [`ops/systemd/`](./systemd/)，安装到 `KNOT_SYSTEMD_DIR`（默认 `/etc/systemd/system`），`User`/`Group` 取 `KNOT_SERVICE_USER`。需要 `sudo systemctl` 权限。

一个站点一台机器是默认假设：unit 名不带站点后缀，和 launchd 的 label 一致。

`node` 要在 systemd 的默认 `PATH` 里（`/usr/local/bin` 或 `/usr/bin`）。装在 nvm 下的 node 不会被找到，装之前先 `ln -s "$(command -v node)" /usr/local/bin/node`，或者改 unit 的 `ExecStart`。

### 3.9.1 没有服务管理器（`--runtime none`）

容器、CI 冒烟、临时机器上没有 launchd/systemd 时：

```bash
./ops/scripts/deploy-site.sh --site <站点> --runtime none
```

它仍然解包、迁移、切 `current`、写 `platform.env`，然后在后台起 Backend，pid 记在 `<部署根>/var/run/backend.pid`，日志追加到 `<部署根>/var/log/knot-platform.log`。启动环境是干净的（`env -i`），只认 `platform.env`，不继承部署脚本导出的 site 键。进程随机器重启不会自己回来，生产环境请用 launchd 或 systemd。

这个后台进程是**另起一个会话**的（Linux 走 `setsid`，macOS 没有 `setsid`，用 `perl` 的 `fork` + `POSIX::setsid`），不是只套一层 `nohup`。区别在于收尾方式：`nohup` 只挡 `SIGHUP`，而部署脚本被 CI、后台 shell 或终端复用器收掉时，收到的是发给整个**进程组**的 `SIGTERM`/`SIGKILL`，同组的孩子一样会跟着消失——现象是「部署报成功，过一会儿进程没了」。新会话换了会话和进程组，pid 文件里记的是 Backend 本身的 pid，不是启动器的 pid。

### 3.10 多站点

一个站点一个目录，用 `--site` 选择；不写时，只有 `sites/` 下恰好一个站点才会自动选中。

```bash
node ops/scripts/config.mjs sites             # 列出站点与 platform.env 状态
./ops/scripts/push-deploy.sh --site local     # 这台机器（local）
./ops/scripts/push-deploy.sh --site wang      # 一台 xknot.si 实例
```

仓库自带的只有 `sites/_template/` 的模板；真实站点目录属于各自的实例，只留在本机，`.gitignore` 会忽略 `sites/` 下除模板以外的全部内容。发布时不会整目录同步 `sites/`，只把选中的 `site.env`（走 xknot.si 时连同入口文件）拷到目标机同路径，再运行目标机上的 `deploy-site.sh`。目标机已有的 `platform.env` 不会被覆盖，邮件和价格键仍归运维。发布包也不带 `sites/`。

## 4. xknot.si 子域入口

入口只需要 nginx。一个实例最多接一个签发子域：`<标签>.xknot.si`。先把该子域解析到入口主机，
再按 [`entry/README.md`](./entry/README.md) 准备证书、隧道账号和静态根。要点：

1. **配置**。`sites/<站点>/site.env` 写实例与隧道；`sites/<站点>/entry.<标签>.xknot.si.env` 只写这个子域不同的项：

   ```bash
   # site.env
   KNOT_ENTRY_ENABLED=1
   KNOT_ENTRY_SSH=ec2-user@<入口主机>
   KNOT_PUBLIC_ORIGIN=https://<标签>.xknot.si
   KNOT_DOMAIN=<标签>.xknot.si
   KNOT_TUNNEL=1
   KNOT_TUNNEL_SSH=knot-tunnel-<id>@<入口主机>
   KNOT_TUNNEL_KEY=$HOME/.ssh/knot-entry
   KNOT_ENTRY_PROXY_PORT=18080
   ```

   ```bash
   # entry.<标签>.xknot.si.env
   KNOT_DOMAIN=<标签>.xknot.si
   KNOT_ENTRY_WEB_ROOT=/var/www/<id>
   KNOT_ENTRY_CONF=/etc/nginx/conf.d/<标签>.xknot.si.conf
   KNOT_ENTRY_SERVE=static
   ```

   入口用户需要对 `mkdir`、`rsync`、`cp`、`nginx -t` 和 reload 免密 sudo。非 systemd 的机器改 `KNOT_ENTRY_RELOAD_CMD`。

2. **发布**。在持有入口私钥的机器上：

   ```bash
   ./ops/scripts/push-entry.sh --site <站点>
   ```

   `push-entry.sh` 只处理这一个 `entry.<标签>.xknot.si.env`：渲染 [`entry/site.conf.template`](./entry/site.conf.template)、按 `KNOT_ENTRY_SERVE` 同步 `web/dist`、装配置、`nginx -t` 后 reload。`--no-build` 跳过重新构建。仓库里不带任何具体域名的 conf——入口由站点配置生成。

3. **证书**。入口配置引用的证书必须已经存在。webroot 与 `KNOT_ENTRY_WEB_ROOT` 一致：

   ```bash
   sudo mkdir -p /var/www/<id>
   sudo certbot certonly --webroot -w /var/www/<id> -d <标签>.xknot.si
   ```

   证书还没就绪时，先把 `KNOT_ENTRY_SSL=0`，入口只监听 80。

`KNOT_ENTRY_SERVE` 决定首页从入口主机上的磁盘出（`static`）还是也走隧道（`proxy`），总览见
[`entry/README.md`](./entry/README.md)。子域怎么申请、清单怎么登记见 [`JOIN.md`](../../xknot.si/docs/JOIN.md)。

**同机每个子域要有独立的隧道账号和回环端口**，不能共用（`Match` 首条匹配生效，`PermitListen` 只允许一个端口）。账号与端口分配见 [`xknot.si/federation.json`](../../xknot.si/federation.json) 的 `entry` 段；签发交接流程见 [`xknot.si/docs/HANDOFF.md`](../../xknot.si/docs/HANDOFF.md)。

实例主机开启 `KNOT_ENTRY_ENABLED=1` 后，`deploy-site.sh` 会装 `com.knot.entry-tunnel`，并由 Backend 在公开内容变化后调用 `push-discover.sh` 推送 `/discover.json`。推页面用的 `KNOT_ENTRY_SSH_KEY` 和实例主机推快照用的 `KNOT_ENTRY_PUSH_KEY` 可以不是同一把。手动补推：

```bash
./ops/scripts/push-discover.sh <board 目录>
```

`/discover.json` 在 `KNOT_ENTRY_WEB_ROOT`。入口有就先给这一份，缺失时 `try_files` 回落到隧道，所以隧道断开时 `/discover` 仍可读。图片地址指向实例主机上的展示图。

`/api/web/uploads/` 在入口按 `$uri` 缓存 1 天。能不能进这份共享缓存，由后端的 `Cache-Control` 决定：未登录也能读的公开图片给 `public`，只有当事人能读的给 `private`（nginx 不缓存），生成失败回退原件给 `no-store`。下架后最迟 1 天生效；要立刻生效，在入口清 `KNOT_ENTRY_CACHE_DIR` 并 reload nginx。

### 4.1 管理后台（内网）

实例主机上另有供人类管理员用的静态页面，路径 `/admin`。它和 `/api/admin` 一样只给实例主机自己（回环地址）与同一内网的机器打开，公网地址返回 404；入口 nginx 配置会把 `/admin` 与 `/api/admin` 直接 404。页面不需要构建，发布包里带着 `admin/`。

站点 `KNOT_BIND_HOST` 为 `0.0.0.0` 时（如 bot01），同一局域网的机器直接打开 `http://<实例主机>:<KNOT_PORT>/admin`。只绑回环地址时，从开发机经 SSH 转发到实例主机的回环端口：

```bash
ssh -L 8081:127.0.0.1:8080 <KNOT_DEPLOY_SSH>
```

浏览器打开 `http://127.0.0.1:8081/admin`（或局域网里直接打开 `http://<实例主机>:<KNOT_PORT>/admin`），粘贴实例主机 `sites/<站点>/platform.env` 里的 `KNOT_ADMIN_TOKEN`（或管理员工作区的 `.admin-token`）进入。令牌只存在这个标签页的 `sessionStorage`，关掉标签页即清除。

页面分五栏：

- **概览**：发行、流通、平台三个数，读痕迹与检索次数，站点开关摘要，今日巡查条数。
- **内容**：按账户、正文片段和时间窗查帖；删除并写原因（作者收到通知）；处理巡查队列并记下本轮巡查。
- **用户**：发放积分、警告、禁言与解除、改等级、更新权益、签发 Internal Personal Agent 账户。
- **站点**：站内浏览、公开快照、注册方式三个开关；邀请码签发与停用；右侧赞助位的增删改和排序；价格表提议与写入。
- **XKnot**：上半是**自述区**，主理人在这里写站点名（简中、繁中、EN）、一句话介绍、详细介绍、主理人、联系方式、logo、标签、语种、地区、时区与社交链接，点「保存档案」写入 `sites/<站点>/profile.json`；校验不过逐条显示在表单下面，一个字节都不写。下半是**签发区**与接入件：实例 id、中枢、签发地址与日期、档位、状态、打码后的委托发信凭据、文件路径与权限，以及进程里正在用的同一组值和状态信号。接入件与进程不一致时列出「变更未生效」，提示重启 Backend；并说明中枢会在 `/api/health` 里读到什么、是否带 `instance`、是不是 https。

XKnot 栏读本机的 `/api/admin/profile` 与 `/api/admin/federation`，和其他栏一样受内网地址与 `KNOT_ADMIN_TOKEN` 保护；凭据只返回前后各一小段。档案字段与接口见 [`docs/PROFILE.md`](../docs/PROFILE.md)。

删帖、停用邀请码、删除赞助条目和应用价格提议前会再确认一次。管理操作仍写进 `admin_actions`，与智能体经 `/api/admin` 做的操作同账。

## 5. 检查

在开发机跑单测。覆盖平台、WebUI 和 `ops/` 下的工具，不需要数据库，不连网。

```bash
npm test                                # Backend、WebUI、packages 与 ops 工具
npm test -w web                         # 只跑 WebUI
npm test -w knot-platform               # 只跑 Backend
```

部署前后量访问速度，用同一套数字对比两种投放（本机、入口静态、入口反代）：

```bash
./ops/scripts/speed-check.sh --runs 9 \
  http://127.0.0.1:8080/ https://wang.xknot.si/ https://wang.xknot.si/api/health
```

每个地址打 N 次，去掉第一次（连接与 TLS 还没复用），报 `ttfb` 与 `total` 的中位数。默认不走系统代理，免得本机代理把数字算进去；要测代理链路加 `--proxy`。

部署前也可以只查配置，不连数据库：

```bash
node ops/scripts/config.mjs sites                         # 看本机有哪些站点
node ops/scripts/config.mjs check --site bot01            # 查 sites/bot01/site.env
node ops/scripts/config.mjs check --platform --site bot01 # 查实例主机的 platform.env
node ops/scripts/config.mjs show --for entry --site bot01  # 看入口那台机器需要哪些值
```

`deploy-site.sh` 和 `push-deploy.sh` 都会先跑 `check`；类型错、缺必填、跨键矛盾会在动数据库和 LaunchAgent 之前停下。

只想检查发布包和站点配置、不动目标机：

```bash
./ops/scripts/push-deploy.sh --site bot01 --dry-run
./ops/scripts/deploy-site.sh --site bot01 --dry-run --artifact artifacts/knot-…tar.gz
node backend/scripts/migrate.js --status      # 迁移执行到哪一步
node ops/scripts/config.mjs check --platform --site bot01
```

`/api/health` 会带上正在运行的版本和提交，发布脚本用它核对：

```bash
curl -s http://127.0.0.1:<KNOT_PORT>/api/health
```

端到端用测试员会话提交一条不公开的记录，再在管理员工作区用 `admin` 列出并删除。Cookie 用测试员规则里的那一条，`BASE` 取 `KNOT_PUBLIC_ORIGIN`：

```bash
BASE=<KNOT_PUBLIC_ORIGIN>
COOKIE='knot_sid=…'

curl -s "$BASE/api/health"
curl -s -H "Cookie: $COOKIE" "$BASE/api/web/session"

# 提交一条不公开的记录，记下返回的 kMeta.id
curl -s -X POST "$BASE/api/web/intel" \
  -H "Cookie: $COOKIE" -H 'Content-Type: application/json' \
  -d '{"body":"端到端测试，用完即删。","public":false}'

# 在实例主机（KNOT_DEPLOY_SSH）的管理员工作区里列出并删除
ssh <KNOT_DEPLOY_SSH> '~/.openclaw/workspace-knot-admin/skills/knot-admin/admin posts --user <测试员 id> --q 端到端测试'
ssh <KNOT_DEPLOY_SSH> '~/.openclaw/workspace-knot-admin/skills/knot-admin/admin remove --id <id> --reason "端到端测试，用完即删。"'

# 作者侧确认已撤下
curl -s -H "Cookie: $COOKIE" "$BASE/api/web/submissions"
```

管理员 `posts` 里这条应是 `removed`、`submissions` 里同一条 `verdict` 也是 `removed`，且信息流里不再出现，就算通过。

## 6. 存储、巡检与备份

文件在 `UPLOAD_DIR`（部署脚本会写绝对路径），库只记 `uploads` 行。每人上传上限由 `KNOT_UPLOAD_QUOTA_BYTES` 决定，`0` 表示不限，未配置时 1 GiB。

目录分三层：`blobs/` 是原件，`derived/` 是可重建的卡片图、下载包、转写和分享图，`tmp/` 是刚收到还没入库的文件。路径由 `backend/src/storage.js` 统一决定。

巡检只读，不删文件：

```bash
cd <部署根>/current
./ops/scripts/audit-knot-storage.sh
```

它报告目录占用、`size` 为零或缺少摘要的行、没有引用的行、库里与磁盘对不上的文件，以及 `previews/` 这类不再写入的历史目录。

回收默认只报告，`--apply` 才删；宽限期由 `KNOT_GC_GRACE_HOURS` 决定，缺省 24 小时：

```bash
node backend/scripts/gc-uploads.mjs
node backend/scripts/gc-uploads.mjs --apply
node backend/scripts/gc-uploads.mjs --apply --previews
```

它只删没有引用的 `uploads` 行和对应文件、没有库记录的 blobs 文件、主体已不存在的派生件，以及超期的 `tmp/` 半截文件。`board/` 不碰。

旧布局迁移（幂等；`deploy-site.sh` 已自动执行）：

```bash
node backend/scripts/migrate-storage-layout.mjs
node backend/scripts/migrate-storage-layout.mjs --apply
```

旧行回填（先只报告，再加 `--apply`）：

```bash
set -a; source <部署根>/sites/bot01/platform.env; set +a
node backend/scripts/backfill-uploads.mjs
node backend/scripts/backfill-uploads.mjs --apply
```

备份：

```bash
./ops/scripts/backup-knot.sh                 # 数据库 + 上传 + 站点配置 + OpenClaw 状态
./ops/scripts/backup-knot.sh --config-only   # 只收配置和智能体状态，不碰数据库
```

目标目录是环境文件里的 `KNOT_BACKUP_DIR`。留空表示不备份，脚本会直接退出；`KNOT_BACKUP_KEEP` 是保留份数（缺省 7）。每次写一份权限 `700` 的 `knot-<时间>/`，并用 `latest` 符号链接指向最近一份。同一秒内跑两次会加 `-1`、`-2` 后缀，不会覆盖上一份。

一份快照里有这些：

| 路径 | 内容 | 开关 |
| --- | --- | --- |
| `knot.dump` | `pg_dump -Fc`，可直接 `pg_restore` | 总是收；`--config-only` 除外 |
| `uploads/` | 只收 `blobs/`、`derived/extracts/` 和 `board/`。卡片图、下载包、分享图、`tmp/` 和旧的 `previews/` 都能重新生成 | 同上 |
| `sites/` | `sites/<站点>/` 整个目录：`site.env`、`platform.env`、`agents/`。**SMTP 密码、管理令牌、智能体凭据都在这里** | `KNOT_BACKUP_SITES`（缺省 1） |
| `openclaw/` | `openclaw.json`、`config-journal-fingerprint.key`、`credentials/`、`agents/<名字>/`（skill、AGENTS.md、记忆库 sqlite 与 `-wal`）。`cache/`、`browser/`、`npm/`、`logs/` 能重建，不收 | `KNOT_BACKUP_OPENCLAW`（缺省 `auto`：目录存在就收；`1` 必须收；`0` 跳过） |
| `manifest.txt` | 各部分文件数、字节数、dump 的 sha256、`sites_status` / `openclaw_status` | — |

`platform.env` 和凭据沿用源文件的 `600`，目录沿用 `700`；快照根目录本身是 `700`。没变的文件用硬链接复用，所以加了 `sites/` 和 `agents/` 之后每天的增量仍然很小。

`deploy-site.sh` 只在 `KNOT_BACKUP_DIR` 非空时安装备份任务（macOS 是 LaunchAgent `com.knot.backup`，Linux 是 `knot-backup.timer`），每天 04:15 执行一次；清空配置后重新部署会把它卸掉。另装每月 1 日 04:45 的 `gc-knot-storage.sh`（macOS `com.knot.gc` / Linux `knot-gc.timer`），只写报告到 `var/log/knot-gc.log`，不删文件；要真删得人工执行 `--apply`。

`KNOT_BACKUP_DIR` 默认在同一块盘上。这只防误删和改坏，不防整机或整盘丢失；要防后者，把 `KNOT_BACKUP_DIR` 指到外挂盘或另一台机器，或者定期把 `latest/` 同步出去。

恢复：先 `launchctl bootout gui/$(id -u)/com.knot.platform` 停 Backend，`pg_restore -d "$DATABASE_URL" --clean --if-exists knot.dump`，再把快照里的 `uploads/` 同步回 `UPLOAD_DIR`，最后重新启动 Backend。

换机器或重装时，配置也要一起放回去，否则库恢复了邮件登录和智能体仍然不可用：

```bash
# 1. 先把快照里的站点目录放回部署根，权限按 700/600
rsync -a --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= <备份目录>/latest/sites/ "$KNOT_DEPLOY_ROOT/sites/"
# 2. OpenClaw 状态放回原处，再跑一次同步
rsync -a <备份目录>/latest/openclaw/ "$HOME/.openclaw/"
./ops/scripts/ensure-openclaw.sh
# 3. 再按上面的步骤恢复数据库和上传目录，最后启动 Backend
```

不碰生产库的演练（重建一个临时库，对完行数就删）：

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb -h 127.0.0.1 -p <KNOT_PGPORT> -U knot knot_restore_drill
pg_restore -h 127.0.0.1 -p <KNOT_PGPORT> -U knot -d knot_restore_drill --no-owner <备份目录>/latest/knot.dump
psql -h 127.0.0.1 -p <KNOT_PGPORT> -U knot -d knot_restore_drill -Atc "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM uploads), (SELECT count(*) FROM intel)"
dropdb -h 127.0.0.1 -p <KNOT_PGPORT> -U knot knot_restore_drill
```

`--config-only` 适合在升级或改配置之前留一份：几秒钟，不占多少空间，回滚配置时不用翻历史。

## 7. 系统复位

清空测试阶段写入的信息、对话、通知、积分流水和上传文件。用户和会话留下。平台积分回到 0，测试员回到 100，其他人回到 10。OpenClaw 的模型、密钥、飞书和智能体不动。

```bash
./ops/scripts/reset-knot.sh --yes
```

## 8. 运行环境文件

`sites/<站点>/platform.env` 只在目标机，不进仓库，权限 `600`。它保存运行时设置：数据库地址、邮件、价格、上传配额、备份目录、OpenClaw 智能体名。站点拓扑（域名、主机、入口、端口）在 `sites/<站点>/site.env`，不要在运行时文件里再写一份。写它的唯一入口是 `config.mjs env`；手工改也可以，下一次部署只会覆盖部署相关的键。

`sites/<站点>/xknot.env` 同样只在目标机、权限 `600`，只装中枢签发的接入项。Backend 启动时先读 `platform.env`，再读它（存在才读）：

- launchd：`run-knot-platform.sh` 里 source 两份文件；
- systemd：`knot-backend.service` 有两个 `EnvironmentFile`，第二个带 `-`，文件不存在不报错；
- `--runtime none`：同样走 `run-knot-platform.sh`。

`BIND_HOST` 决定 Backend 监听地址。模型密钥留在 OpenClaw 的本机状态里。
