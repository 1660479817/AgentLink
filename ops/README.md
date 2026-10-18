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
