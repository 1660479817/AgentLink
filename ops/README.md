# 192.168.3.91 部署

目标机：`ssh zenwang_bot01@192.168.3.91`（macOS + Homebrew）。

```text
浏览器 → https://knot.zenheart.net/                 （云端边缘）
            ├── /                 Knot WebUI（/var/www/knot）
            ├── /discover.json    公开快照，文件在云端，缺失时回落隧道
            ├── /media/previews/  旧拼图目录，现在清空，不再写入
            ├── /api/*            ──隧道──→ bot01
            └── /help             ──隧道──→ bot01
浏览器 → http://192.168.3.91:8080/                  （bot01，局域网直连）
            ├── /       Knot WebUI（apps/web/dist）
            └── /api/*  Knot Backend
Knot Backend → 127.0.0.1:5433 (PostgreSQL)
Knot Backend → 127.0.0.1:18789 (OpenClaw Gateway，只监听本机)
Knot Backend → 公开快照 → 云端 /var/www/knot
Personal Agent → /api/agent/*
```

## 安装与更新

在开发机：

```bash
./ops/scripts/push-deploy-91.sh
```

脚本把仓库同步到 `~/knot/AgentLink`，再在目标机执行 `ops/scripts/deploy-macos.sh`：安装依赖、构建 WebUI、迁移数据库、用 LaunchAgent 启动 Postgres 与 Knot Backend，把 `KNOT_DISCOVER_PUSH_CMD` 和 `KNOT_EDGE_SSH_KEY` 补进环境文件，并按 [ops/openclaw](./openclaw/README.md) 同步数据评审员、管理员、精算师和 `internal_agent/` 里的 Internal Personal Agent。

已在目标机上时：

```bash
cd ~/knot/AgentLink
./ops/scripts/deploy-macos.sh
```

## 检查

在开发机跑单测。覆盖平台、WebUI 和 `ops/` 下的工具，不需要数据库，不连网。

```bash
npm test              # 全部
npm test -w web       # 只跑 WebUI
npm test -w knot-platform
```

```bash
curl -s http://127.0.0.1:8080/api/health
```

在开发机上跑端到端。它用测试员会话提交一条不公开的记录，再在 bot01 的管理员的工作区用 `admin` 列出并删除。`E2E_COOKIE` 是测试员的 `knot_sid`。

```bash
E2E_COOKIE='knot_sid=…' npm run e2e
```

## 存储、巡检与备份

文件在 `UPLOAD_DIR`（bot01 上是 `~/knot/AgentLink/var/uploads`），库只记 `uploads` 行。每人上传上限由 `KNOT_UPLOAD_QUOTA_BYTES` 决定，`0` 表示不限，未配置时 1 GiB。

目录分三层：`blobs/` 是原件，`derived/` 是可重建的卡片图、下载包、转写和分享图，`tmp/` 是刚收到还没入库的文件。路径由 `apps/knot-platform/src/storage.js` 统一决定。

巡检只读，不删文件：

```bash
cd ~/knot/AgentLink
./ops/scripts/audit-knot-storage.sh
```

它报告目录占用、`size` 为零或缺少摘要的行、没有引用的行、库里与磁盘对不上的文件，以及 `previews/` 这类不再写入的历史目录。

回收默认只报告，`--apply` 才删；宽限期由 `KNOT_GC_GRACE_HOURS` 决定，缺省 24 小时：

```bash
cd ~/knot/AgentLink
node apps/knot-platform/scripts/gc-uploads.mjs
node apps/knot-platform/scripts/gc-uploads.mjs --apply
node apps/knot-platform/scripts/gc-uploads.mjs --apply --previews
```

它只删没有引用的 `uploads` 行和对应文件、没有库记录的 blobs 文件、主体已不存在的派生件，以及超期的 `tmp/` 半截文件。`board/` 不碰。

旧布局迁移（幂等；`deploy-macos.sh` 已自动执行）：

```bash
node apps/knot-platform/scripts/migrate-storage-layout.mjs
node apps/knot-platform/scripts/migrate-storage-layout.mjs --apply
```

旧行回填（先只报告，再加 `--apply`）：

```bash
set -a; source ops/env/knot-platform.local.env; set +a
node apps/knot-platform/scripts/backfill-uploads.mjs
node apps/knot-platform/scripts/backfill-uploads.mjs --apply
```

备份：

```bash
cd ~/knot/AgentLink
./ops/scripts/backup-knot.sh
```

目标目录是环境文件里的 `KNOT_BACKUP_DIR`。留空表示不备份，脚本会直接退出；`KNOT_BACKUP_KEEP` 是保留份数（缺省 7）。bot01 现在放在 `~/knot/backups`，和外接盘相比只是「改坏了能回滚」，不是容灾；运维接管时换成另一块盘或另一台机器。每次写一份 `knot-<时间>/`，里面有 `knot.dump`、`uploads/` 和 `manifest.txt`，并用 `latest` 符号链接指向最近一份。`uploads/` 只收 `blobs/`、`derived/extracts/` 和 `board/`；卡片图、下载包、分享图、`tmp/` 和旧的 `previews/` 都能重新生成，不进快照。没变的文件用硬链接复用，不重复占空间。

`deploy-macos.sh` 只在 `KNOT_BACKUP_DIR` 非空时安装 LaunchAgent `com.knot.backup`，每天 04:15 执行一次；清空配置后重新部署会把该 LaunchAgent 卸掉。另装 `com.knot.gc`，每月 1 日 04:45 跑一次 `gc-knot-storage.sh`，只写报告到 `var/log/knot-gc.log`，不删文件；要真删得人工执行 `--apply`。

恢复：先 `launchctl bootout gui/$(id -u)/com.knot.platform` 停 Backend，`pg_restore -d "$DATABASE_URL" --clean --if-exists knot.dump`，再把快照里的 `uploads/` 同步回 `UPLOAD_DIR`，最后重新启动 Backend。

不碰生产库的演练（重建一个临时库，对完行数就删）：

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb -h 127.0.0.1 -p 5433 -U knot knot_restore_drill
pg_restore -h 127.0.0.1 -p 5433 -U knot -d knot_restore_drill --no-owner ~/knot/backups/latest/knot.dump
psql -h 127.0.0.1 -p 5433 -U knot -d knot_restore_drill -Atc "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM uploads), (SELECT count(*) FROM intel)"
dropdb -h 127.0.0.1 -p 5433 -U knot knot_restore_drill
```

## 系统复位

清空测试阶段写入的信息、对话、通知、积分流水和上传文件。用户和会话留下。平台积分回到 0，测试员回到 100，其他人回到 10。OpenClaw 的模型、密钥、飞书和智能体不动。

```bash
cd ~/knot/AgentLink
./ops/scripts/reset-knot.sh --yes
```

浏览器打开 `http://192.168.3.91:8080/`。

## knot.zenheart.net

云端放 WebUI 和发现页的公开快照。`/api` 和 `/help` 由 bot01 主动连出的隧道回到本机平台。云端 `127.0.0.1:8080` 是另一套站点，隧道使用 `127.0.0.1:18080`。`/api/admin` 不公开。

`/discover.json` 在 `root /var/www/knot`。云端有就先给这一份，缺失时 `try_files` 回落到隧道。这样隧道断开时 `/discover` 仍能看到公开信息。图片地址指向平台上的展示图。`/media/previews/` 不再写入，推送时清掉旧拼图。配置在 `ops/edge/knot.zenheart.net.conf`。

`/api/web/uploads/` 在边缘按 `$uri` 缓存 1 天。能不能进这份共享缓存，由后端的 `Cache-Control` 决定：未登录也能读的公开图片给 `public`，只有当事人能读的给 `private`（nginx 不缓存），生成失败回退原件给 `no-store`。所以关掉站内浏览之后，已经缓存过的公开图片仍可能再分发最多 1 天；要立刻生效，在云端清 `knot_uploads` 缓存目录并 reload nginx。同理，删帖后的图片最长也要等 1 天。

在开发机构建并换上页面：

```bash
./ops/scripts/push-edge.sh
```

它同步 `apps/web/dist`、安装 nginx 配置，并用 `--exclude /discover.json --exclude /media/` 跳过快照，不会把快照删掉。

快照由平台自动推送：公开内容变化后 Backend 写下 `DISCOVER_BOARD_DIR`，再执行 `KNOT_DISCOVER_PUSH_CMD`，缺省是 `ops/scripts/push-discover.sh`。脚本 `rsync` 到云端 `/tmp`，再 `sudo cp` 进 `/var/www/knot` 并 `chown nginx:nginx`。也可以手动补推：

```bash
./ops/scripts/push-discover.sh <board 目录>
```

隧道密钥只在 bot01 的 `~/.ssh/knot-edge`，不进仓库。LaunchAgent 是 `com.knot.edge-tunnel`。推页面和推快照用另一把密钥，bot01 上由 `deploy-macos.sh` 写进环境文件的 `KNOT_EDGE_SSH_KEY`（缺省 `~/.ssh/knot-edge-publish`）。

## 环境

`ops/env/knot-platform.local.env` 只放在目标机，不进仓库。`BIND_HOST` 决定 Backend 监听地址。模型密钥留在 OpenClaw 的本机状态里。
