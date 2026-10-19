# 部署与运维

Knot 的部署分两层，两层都从同一份配置读取取值：

- **平台主机**：跑 Knot Backend、PostgreSQL、WebUI，用 macOS 的 LaunchAgent 常驻。
- **云端边缘（可选）**：一台 Linux + nginx，只放 WebUI 和公开快照，`/api`、`/help` 经隧道回到平台主机。

没有域名也能部署：只跑平台主机，局域网直接访问 `http://<主机>:<端口>/`。需要公网域名时再加边缘。

> 部署脚本里不再写死 IP、域名、目录或端口。所有站点取值集中在 **`ops/deploy.env`**，模板见 [`deploy.env.example`](./deploy.env.example)。`ops/deploy.env` 不进版本库。

## 1. 配置

```bash
cp ops/deploy.env.example ops/deploy.env
```

至少改这四项：

| 变量 | 说明 | 例子 |
| --- | --- | --- |
| `KNOT_PUBLIC_ORIGIN` | 对外访问地址，带协议 | `http://192.168.1.10:8080` 或 `https://knot.example.com` |
| `KNOT_ADMIN_EMAIL` | 本站管理员邮箱，部署时必填；这个邮箱登录后拥有平台管理权限 | `admin@example.com` |
| `KNOT_PORT` | Backend 监听端口 | `8080` |
| `KNOT_DB_MODE` | `local` 用本机 Homebrew Postgres；`external` 用 `KNOT_DATABASE_URL` | `local` |

`KNOT_PG_BIN` 默认是 Apple Silicon Homebrew 的 `/opt/homebrew/opt/postgresql@16/bin`；Intel 机器改成 `/usr/local/opt/postgresql@16/bin`。

站点身份单独两项，各自站点不一样：

| 变量 | 说明 | 例子 |
| --- | --- | --- |
| `KNOT_SITE_NAME` | 站点名。显示在 WebUI 顶栏正中、浏览器标题和分享图落款；过长时顶栏省略 | `海风情报站` |
| `KNOT_SITE_TAGLINE` | 一句话介绍，用在未登录首页和分享图 | `只收值得交换的信息。` |
| `KNOT_SITE_LOGO` | 站点自己的 logo，用在登录卡和未登录首页；可留空。`XKnot` 那个方形标识固定在代码里，不受它影响 | `https://example.com/logo.png` 或 `/logo.png` |

部署脚本把它们写进 `ops/env/knot-platform.local.env`，WebUI 从 `GET /api/web/session` 的 `brand` 里读。改了名字或 logo 重新部署一次即可，不用改前端代码。

WebUI 顶栏左上角是固定的 `XKnot` 方形标识，所有站点一致，不读 `KNOT_SITE_NAME` / `KNOT_SITE_LOGO`。站点自己的名字在顶栏正中，站点 logo 用在登录卡和未登录首页。

局域网部署到这里就够了。要加云端边缘，再填 `KNOT_EDGE`、`KNOT_EDGE_SSH`、`KNOT_DOMAIN` 和边缘路径；要从开发机发布，填 `KNOT_DEPLOY_SSH`。

### 1.1 全部部署参数与默认值

`ops/deploy.env` 里的键，以及没写时脚本用的默认值（`ops/scripts/lib/deploy-config.sh`）。标「必填」的没有默认值，缺了部署直接停。

| 分组 | 变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 站点 | `KNOT_SITE_NAME` | `Knot` | 顶栏正中、浏览器标题、分享图落款 |
| 站点 | `KNOT_SITE_TAGLINE` | `面向 AI 时代、服务于 Agent 的信息交换网。` | 未登录首页与分享图 |
| 站点 | `KNOT_SITE_LOGO` | 空 | 登录卡与未登录首页的站点 logo；空则用站名首字 |
| 站点 | `KNOT_PUBLIC_ORIGIN` | `http://127.0.0.1:$KNOT_PORT` | 对外访问地址，带协议 |
| 站点 | `KNOT_DOMAIN` | 从 `KNOT_PUBLIC_ORIGIN` 取主机名 | 云端域名，也用于拼证书路径 |
| 站点 | `KNOT_PORT` | `8080` | Backend 监听端口 |
| 站点 | `KNOT_BIND_HOST` | `0.0.0.0` | Backend 绑定地址 |
| 站点 | `KNOT_SESSION_COOKIE_NAME` | `knot_sid` | 会话 Cookie 名 |
| 站点 | `KNOT_ADMIN_EMAIL` | **必填** | 管理员邮箱，该邮箱登录后有管理权限 |
| 平台主机 | `KNOT_DB_MODE` | `local` | `local` 启本机库；`external` 用 `KNOT_DATABASE_URL` |
| 平台主机 | `KNOT_DATABASE_URL` | 空（也读 `DATABASE_URL`） | 外部库连接串；`local` 且留空时由脚本拼 |
| 平台主机 | `KNOT_PGPORT` | `5433` | 本机 PostgreSQL 端口 |
| 平台主机 | `KNOT_PGDATA` | `$HOME/knot/pgdata` | 数据目录 |
| 平台主机 | `KNOT_PGLOG` | `$HOME/knot/pg.log` | 日志文件 |
| 平台主机 | `KNOT_PG_BIN` | `/opt/homebrew/opt/postgresql@16/bin` | Intel Homebrew 改 `/usr/local/opt/postgresql@16/bin` |
| 平台主机 | `KNOT_UPLOAD_DIR` | `<仓库>/var/uploads` | 上传目录 |
| 平台主机 | `KNOT_BACKUP_DIR` | 空（不备份） | 配置后装每天 04:15 的备份 LaunchAgent |
| 平台主机 | `KNOT_BACKUP_KEEP` | `7` | 保留几份快照 |
| 平台主机 | `KNOT_OPENCLAW` | `auto` | `auto` 装了才同步；`1` 必须；`0` 跳过 |
| 远程发布 | `KNOT_DEPLOY_SSH` | 空 | 空表示在平台主机本机跑 `deploy-site.sh` |
| 远程发布 | `KNOT_DEPLOY_DIR` | `~/knot/AgentLink` | 远端仓库目录，`~` 按目标机 home 展开 |
| 远程发布 | `KNOT_DEPLOY_SSH_KEY` | 空 | 空则用 ssh 默认密钥或 `ssh-agent` |
| 远程发布 | `KNOT_DEPLOY_VERIFY_URL` | `http://<平台主机>:<KNOT_PORT>/api/health` | 发布后验收地址 |
| 边缘 | `KNOT_EDGE` | `0` | `1` 才推 WebUI 和 nginx 配置 |
| 边缘 | `KNOT_EDGE_SSH` | 空（开边缘时必填） | `user@edge-host` |
| 边缘 | `KNOT_EDGE_SSH_KEY` | `$HOME/.ssh/id_rsa` | 开发机推页面用 |
| 边缘 | `KNOT_EDGE_PUSH_KEY` | `$HOME/.ssh/knot-edge-publish` | 平台主机推公开快照用 |
| 边缘 | `KNOT_EDGE_WEB_ROOT` | `/var/www/knot` | WebUI 目录 |
| 边缘 | `KNOT_EDGE_CONF` | `/etc/nginx/conf.d/knot.conf` | nginx 站点配置路径 |
| 边缘 | `KNOT_EDGE_WEB_OWNER` | `nginx:nginx` | WebUI 目录属主 |
| 边缘 | `KNOT_EDGE_CACHE_DIR` | `/var/cache/nginx/knot_uploads` | 上传缓存目录 |
| 边缘 | `KNOT_EDGE_CACHE_ZONE` | `knot_uploads` | 缓存 zone 名 |
| 边缘 | `KNOT_EDGE_CACHE_SIZE` | `2g` | 缓存上限 |
| 边缘 | `KNOT_EDGE_MAX_BODY` | `52m` | 请求体上限 |
| 边缘 | `KNOT_EDGE_PROXY_PORT` | `18080` | 边缘回源端口 |
| 边缘 | `KNOT_EDGE_SSL` | `1` | `0` 时只监听 80 |
| 边缘 | `KNOT_EDGE_CERT` | `/etc/letsencrypt/live/$KNOT_DOMAIN/fullchain.pem` | 证书 |
| 边缘 | `KNOT_EDGE_KEY` | `/etc/letsencrypt/live/$KNOT_DOMAIN/privkey.pem` | 私钥 |
| 边缘 | `KNOT_EDGE_RELOAD_CMD` | `sudo systemctl reload nginx` | 非 systemd 机器改这里 |
| 隧道 | `KNOT_TUNNEL` | `1` | 边缘和平台同机时设 `0` |
| 隧道 | `KNOT_TUNNEL_SSH` | `knot-tunnel@<KNOT_EDGE_SSH 的主机>` | 隧道账号 |
| 隧道 | `KNOT_TUNNEL_KEY` | `$HOME/.ssh/knot-edge` | 隧道私钥，不进仓库 |
| 隧道 | `KNOT_TUNNEL_LOCAL_PORT` | `$KNOT_PORT` | 平台侧被转发的端口 |
| 隧道 | `KNOT_TUNNEL_REMOTE_PORT` | `$KNOT_EDGE_PROXY_PORT` | 边缘侧监听端口 |

`KNOT_EDGE_HOST`、`KNOT_TUNNEL_USER` 由上面几项推出来，不用手写。

### 1.2 运行时参数

`deploy-site.sh` 把站点、数据库、目录、备份和边缘推送项写进目标机的 `ops/env/knot-platform.local.env`，权限 `600`。邮件、价格、存储、智能体这些只属于这台机器的键，第一次部署时按 schema 里的默认值补进去，之后归运维，部署不会再改。

完整清单、默认值和必填条件见 [`docs/CONFIG.md`](../docs/CONFIG.md)。那份文档和两个 `.example` 文件都由 [`config/schema.mjs`](./config/schema.mjs) 生成，不要手改：

```bash
node ops/scripts/config.mjs template --write        # ops/deploy.env.example
node ops/scripts/config.mjs runtime-template --write # ops/env/knot-platform.env.example
node ops/scripts/config.mjs docs --write            # docs/CONFIG.md
```

加一个配置项：先在 `schema.mjs` 登记，再在代码里读 `process.env` 并给同一个默认值，最后重新生成。测试会检查 schema、示例文件、文档、代码默认值是否一致。

`KNOT_ADMIN_TOKEN`、`KNOT_AGENT_ENV_DIR`、`KNOT_DISCOVER_PUSH_CMD`、`KNOT_EDGE_PUSH_KEY` 由部署脚本或 `ensure-openclaw.sh` 写入，不用手填。价格类键只在还没有价格表时生效；精算师写入 `economy_policy` 后以库里的为准。

## 2. 拓扑

```text
浏览器 → https://<KNOT_DOMAIN>/                    （云端边缘，可选）
            ├── /                 WebUI（KNOT_EDGE_WEB_ROOT）
            ├── /discover.json    公开快照，缺失时回落隧道
            ├── /media/previews/  旧拼图目录，不再写入
            ├── /api/*            ──隧道──→ 平台主机
            └── /help             ──隧道──→ 平台主机

浏览器 → http://<平台主机>:<KNOT_PORT>/            （局域网直连）
            ├── /       WebUI（knot-platform/web/dist）
            └── /api/*  Knot Backend

Knot Backend → 127.0.0.1:<KNOT_PGPORT>       （PostgreSQL）
Knot Backend → 127.0.0.1:18789               （OpenClaw Gateway，可选，只监听本机）
Knot Backend → 公开快照 → 云端 WebUI 目录
Personal Agent → /api/agent/*
```

隧道由平台主机主动连出，边缘的 `127.0.0.1:<KNOT_EDGE_PROXY_PORT>` 转到平台主机的 `127.0.0.1:<KNOT_TUNNEL_LOCAL_PORT>`。边缘和平台在同一台机器时把 `KNOT_TUNNEL=0`，并把 `KNOT_EDGE_PROXY_PORT` 设成 `KNOT_PORT`。

## 3. 平台主机

目标机需要 macOS、Homebrew、Node.js 22+ 和 `postgresql@16`。脚本默认用 `/opt/homebrew/opt/postgresql@16/bin`（Intel Homebrew 用 `KNOT_PG_BIN` 指到 `/usr/local/opt/postgresql@16/bin`），不需要 `brew services`。

已在目标机上：

```bash
cd <仓库目录>
cp ops/deploy.env.example ops/deploy.env   # 第一次
./ops/scripts/deploy-site.sh
```

它依次做：

1. 按 `KNOT_DB_MODE` 启动本机 Postgres（或使用外部 `KNOT_DATABASE_URL`）；
2. 在 `knot-platform/` 跑 `npm ci`、构建 WebUI；
3. 停 Backend，跑迁移，搬迁旧上传目录；
4. 把站点取值写进 `ops/env/knot-platform.local.env`；
5. 安装 `com.knot.postgres`、`com.knot.platform`、`com.knot.gc`，配置了 `KNOT_BACKUP_DIR` 时装 `com.knot.backup`，开启边缘和隧道时装 `com.knot.edge-tunnel`；
6. `KNOT_OPENCLAW` 为 `auto` 时，只有已安装 `openclaw` 才同步智能体；为 `1` 时强制同步；为 `0` 时跳过；
7. 探一次 `http://127.0.0.1:<KNOT_PORT>/api/health`。

从开发机发布：

```bash
# ops/deploy.env 里写 KNOT_DEPLOY_SSH=user@platform-host
./ops/scripts/push-deploy.sh
```

它把仓库同步到 `KNOT_DEPLOY_DIR`（默认 `~/knot/AgentLink`），在目标机执行 `deploy-site.sh`，再按 `KNOT_DEPLOY_VERIFY_URL` 或 `http://<主机>:<端口>/api/health` 验收。`push-deploy.sh --edge` 会在部署后接着推边缘。

### 3.1 多站点与纯本地部署

有第二个站点，或者只想在平台主机上跑、不碰云端时，用 profile。一个 profile 就是一份完整的部署配置，放在 `ops/profiles/<名字>.local.env`，不进版本库：

```bash
./ops/scripts/push-deploy.sh --profile local        # 纯本地：不推边缘、不建隧道
./ops/scripts/push-deploy.sh --profile wang         # 另一个站点
./ops/scripts/push-deploy.sh                        # 默认 ops/deploy.env
```

profile 会单独拷到目标机的同路径（权限 `600`），只影响这一次部署，不覆盖 `ops/env/knot-platform.local.env` 里运维改过的邮件和价格键。配置里 `KNOT_EDGE=0` 时，`--edge` 会直接报错，避免以为在测本地、实际改了云端。

`ops/profiles/local.local.env` 是现在的纯本地样例：`KNOT_PUBLIC_ORIGIN=http://192.168.3.91:8080`、`KNOT_EDGE=0`、`KNOT_TUNNEL=0`。切回带云端的部署，用默认 profile 重跑一次即可。

旧入口 `deploy-macos.sh`、`push-deploy-91.sh` 仍在，但只是转发到新脚本。

## 4. 云端边缘（可选）

边缘只需要 nginx。先把域名解析到边缘主机，再在边缘上准备：

1. **证书**。边缘配置引用的证书必须已经存在。用 Certbot 的 webroot 方式，Web 根目录与 `KNOT_EDGE_WEB_ROOT` 一致：

   ```bash
   sudo mkdir -p /var/www/knot
   sudo certbot certonly --webroot -w /var/www/knot -d knot.example.com
   ```

   证书还没就绪时，先把 `KNOT_EDGE_SSL=0`，边缘只监听 80。

2. **回源隧道账号**。边缘和平台不在同一台机器时，在边缘建 `knot-tunnel` 账号，把渲染后的 [`sshd-tunnel.conf.template`](./edge/sshd-tunnel.conf.template) 放进 sshd 配置，并把公钥写进该账号的 `authorized_keys`。私钥放在平台主机的 `KNOT_TUNNEL_KEY`（默认 `~/.ssh/knot-edge`），不进仓库。渲染示例：

   ```bash
   KNOT_TUNNEL_USER=knot-tunnel KNOT_EDGE_PROXY_PORT=18080 \
     node ops/scripts/render-config.mjs ops/edge/sshd-tunnel.conf.template /tmp/sshd-tunnel.conf
   ```

3. **配置**。在 `ops/deploy.env` 里：

   ```bash
   KNOT_EDGE=1
   KNOT_EDGE_SSH=ec2-user@edge-host
   KNOT_EDGE_WEB_ROOT=/var/www/knot
   KNOT_EDGE_CONF=/etc/nginx/conf.d/knot.conf
   KNOT_EDGE_WEB_OWNER=nginx:nginx
   KNOT_EDGE_PROXY_PORT=18080
   KNOT_TUNNEL=1
   ```

   边缘用户需要对 `mkdir`、`rsync`、`cp`、`nginx -t` 和 reload 免密 sudo。非 systemd 的机器改 `KNOT_EDGE_RELOAD_CMD`。

4. **发布**。在持有边缘私钥的机器上：

   ```bash
   ./ops/scripts/push-edge.sh
   ```

   它渲染 [`edge/site.conf.template`](./edge/site.conf.template)、同步 `knot-platform/web/dist`、装配置、`nginx -t` 后 reload。`--no-build` 跳过重新构建。`ops/edge/knot.zenheart.net.conf` 是作者站点的生成样例，实际以模板为准。

平台主机开启 `KNOT_EDGE=1` 后，`deploy-site.sh` 会装 `com.knot.edge-tunnel`，并由 Backend 在公开内容变化后调用 `push-discover.sh` 推送 `/discover.json`。推页面用的 `KNOT_EDGE_SSH_KEY` 和平台主机推快照用的 `KNOT_EDGE_PUSH_KEY` 可以不是同一把。手动补推：

```bash
./ops/scripts/push-discover.sh <board 目录>
```

`/discover.json` 在 `KNOT_EDGE_WEB_ROOT`。边缘有就先给这一份，缺失时 `try_files` 回落到隧道，所以隧道断开时 `/discover` 仍可读。图片地址指向平台上的展示图。`/media/previews/` 不再写入，推送时清掉旧拼图。

`/api/web/uploads/` 在边缘按 `$uri` 缓存 1 天。能不能进这份共享缓存，由后端的 `Cache-Control` 决定：未登录也能读的公开图片给 `public`，只有当事人能读的给 `private`（nginx 不缓存），生成失败回退原件给 `no-store`。下架后最迟 1 天生效；要立刻生效，在边缘清 `KNOT_EDGE_CACHE_DIR` 并 reload nginx。

## 5. 检查

在开发机跑单测。覆盖平台、WebUI 和 `ops/` 下的工具，不需要数据库，不连网。中枢门户是另一个项目，测试单独跑。

```bash
npm test                                            # 平台与 ops 工具
npm --prefix knot-platform test -w web              # 只跑 WebUI
npm --prefix knot-platform test -w knot-platform    # 只跑 Backend
npm --prefix xknot.si test                          # 中枢门户
npm run test:all                                    # 两边一起跑
```

部署前也可以只查配置，不连数据库：

```bash
node ops/scripts/config.mjs check                    # 查 ops/deploy.env
node ops/scripts/config.mjs check --runtime          # 查平台主机的运行时文件
node ops/scripts/config.mjs show --for edge          # 看边缘那台机器需要哪些值
```

`deploy-site.sh` 和 `push-deploy.sh` 都会先跑 `check`；类型错、缺必填、跨键矛盾会在动数据库和 LaunchAgent 之前停下。

```bash
curl -s http://127.0.0.1:<KNOT_PORT>/api/health
```

端到端用测试员会话提交一条不公开的记录，再在管理员工作区用 `admin` 列出并删除：

```bash
E2E_COOKIE='knot_sid=…' npm run e2e
```

`E2E_BASE` 默认取 `ops/deploy.env` 的 `KNOT_PUBLIC_ORIGIN`，`E2E_SSH` 默认取 `KNOT_DEPLOY_SSH`；也可以显式覆盖。

## 6. 存储、巡检与备份

文件在 `UPLOAD_DIR`（部署脚本会写绝对路径），库只记 `uploads` 行。每人上传上限由 `KNOT_UPLOAD_QUOTA_BYTES` 决定，`0` 表示不限，未配置时 1 GiB。

目录分三层：`blobs/` 是原件，`derived/` 是可重建的卡片图、下载包、转写和分享图，`tmp/` 是刚收到还没入库的文件。路径由 `knot-platform/backend/src/storage.js` 统一决定。

巡检只读，不删文件：

```bash
cd <仓库目录>
./ops/scripts/audit-knot-storage.sh
```

它报告目录占用、`size` 为零或缺少摘要的行、没有引用的行、库里与磁盘对不上的文件，以及 `previews/` 这类不再写入的历史目录。

回收默认只报告，`--apply` 才删；宽限期由 `KNOT_GC_GRACE_HOURS` 决定，缺省 24 小时：

```bash
node knot-platform/backend/scripts/gc-uploads.mjs
node knot-platform/backend/scripts/gc-uploads.mjs --apply
node knot-platform/backend/scripts/gc-uploads.mjs --apply --previews
```

它只删没有引用的 `uploads` 行和对应文件、没有库记录的 blobs 文件、主体已不存在的派生件，以及超期的 `tmp/` 半截文件。`board/` 不碰。

旧布局迁移（幂等；`deploy-site.sh` 已自动执行）：

```bash
node knot-platform/backend/scripts/migrate-storage-layout.mjs
node knot-platform/backend/scripts/migrate-storage-layout.mjs --apply
```

旧行回填（先只报告，再加 `--apply`）：

```bash
set -a; source ops/env/knot-platform.local.env; set +a
node knot-platform/backend/scripts/backfill-uploads.mjs
node knot-platform/backend/scripts/backfill-uploads.mjs --apply
```

备份：

```bash
./ops/scripts/backup-knot.sh
```

目标目录是环境文件里的 `KNOT_BACKUP_DIR`。留空表示不备份，脚本会直接退出；`KNOT_BACKUP_KEEP` 是保留份数（缺省 7）。每次写一份 `knot-<时间>/`，里面有 `knot.dump`、`uploads/` 和 `manifest.txt`，并用 `latest` 符号链接指向最近一份。`uploads/` 只收 `blobs/`、`derived/extracts/` 和 `board/`；卡片图、下载包、分享图、`tmp/` 和旧的 `previews/` 都能重新生成，不进快照。没变的文件用硬链接复用，不重复占空间。

`deploy-site.sh` 只在 `KNOT_BACKUP_DIR` 非空时安装 LaunchAgent `com.knot.backup`，每天 04:15 执行一次；清空配置后重新部署会把该 LaunchAgent 卸掉。另装 `com.knot.gc`，每月 1 日 04:45 跑一次 `gc-knot-storage.sh`，只写报告到 `var/log/knot-gc.log`，不删文件；要真删得人工执行 `--apply`。

恢复：先 `launchctl bootout gui/$(id -u)/com.knot.platform` 停 Backend，`pg_restore -d "$DATABASE_URL" --clean --if-exists knot.dump`，再把快照里的 `uploads/` 同步回 `UPLOAD_DIR`，最后重新启动 Backend。

不碰生产库的演练（重建一个临时库，对完行数就删）：

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb -h 127.0.0.1 -p <KNOT_PGPORT> -U knot knot_restore_drill
pg_restore -h 127.0.0.1 -p <KNOT_PGPORT> -U knot -d knot_restore_drill --no-owner <备份目录>/latest/knot.dump
psql -h 127.0.0.1 -p <KNOT_PGPORT> -U knot -d knot_restore_drill -Atc "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM uploads), (SELECT count(*) FROM intel)"
dropdb -h 127.0.0.1 -p <KNOT_PGPORT> -U knot knot_restore_drill
```

## 7. 系统复位

清空测试阶段写入的信息、对话、通知、积分流水和上传文件。用户和会话留下。平台积分回到 0，测试员回到 100，其他人回到 10。OpenClaw 的模型、密钥、飞书和智能体不动。

```bash
./ops/scripts/reset-knot.sh --yes
```

## 8. 运行环境文件

`ops/env/knot-platform.local.env` 只在目标机，不进仓库，权限 `600`。它保存运行时设置：数据库地址、邮件、价格、上传配额、备份目录、OpenClaw 智能体名。站点拓扑（域名、主机、边缘、端口）在 `ops/deploy.env`，不要在运行时文件里再写一份。写它的唯一入口是 `config.mjs env`；手工改也可以，下一次部署只会覆盖部署相关的键。

`BIND_HOST` 决定 Backend 监听地址。模型密钥留在 OpenClaw 的本机状态里。

## 9. 作者当前的部署（示例）

这一节只是现有站点的一份备忘，不参与默认值。

| 项 | 值 |
| --- | --- |
| 平台主机 | `zenwang_bot01@192.168.3.91`（macOS + Homebrew） |
| 局域网地址 | `http://192.168.3.91:8080` |
| 云端域名 | `https://knot.zenheart.net` |
| 边缘主机 | `ec2-user@16.162.24.182`（ap-east-1） |
| 边缘 Web 根 | `/var/www/knot` |
| 回源端口 | `18080` |
| 隧道账号 | `knot-tunnel@16.162.24.182` |

对应配置写在这台机器的 `ops/deploy.env` 里，不写进仓库。云端配置样例是 [`edge/knot.zenheart.net.conf`](./edge/knot.zenheart.net.conf)，由同一份模板生成。
