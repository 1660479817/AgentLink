# 192.168.3.91 部署

目标机：`ssh zenwang_bot01@192.168.3.91`（macOS + Homebrew）。

```text
浏览器 → http://192.168.3.91:8080/
            ├── /       Knot WebUI（apps/web/dist）
            └── /api/*  Knot Backend
Knot Backend → 127.0.0.1:5433 (PostgreSQL)
Knot Backend → 127.0.0.1:18789 (OpenClaw Gateway，只监听本机)
Personal Agent → /api/agent/*
```

## 安装与更新

在开发机：

```bash
./ops/scripts/push-deploy-91.sh
```

脚本把仓库同步到 `~/knot/AgentLink`，再在目标机执行 `ops/scripts/deploy-macos.sh`：安装依赖、构建 WebUI、迁移数据库、用 LaunchAgent 启动 Postgres 与 Knot Backend，并按 [ops/openclaw](./openclaw/README.md) 同步数据评审员、管理员和 `internal_agent/` 里的内部 Personal Agent。

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

在开发机上跑端到端。它用测试员会话提交一条不公开的记录，再在 bot01 的管理员工作区用 `admin` 列出并删除。`E2E_COOKIE` 是测试员的 `knot_sid`。

```bash
E2E_COOKIE='knot_sid=…' npm run e2e
```

## 系统复位

清空测试阶段写入的信息、对话、通知、积分流水和上传文件。用户和会话留下。平台积分回到 0，测试员回到 100，其他人回到 10。OpenClaw 的模型、密钥、飞书和员工不动。

```bash
cd ~/knot/AgentLink
./ops/scripts/reset-knot.sh --yes
```

浏览器打开 `http://192.168.3.91:8080/`。

## knot.zenheart.net

云端只放 WebUI。`/api` 和 `/help` 由 bot01 主动连出的隧道回到本机平台。云端 `127.0.0.1:8080` 是另一套站点，隧道使用 `127.0.0.1:18080`。`/api/admin` 不公开。

在开发机构建并换上页面：

```bash
./ops/scripts/push-edge.sh
```

隧道密钥只在 bot01 的 `~/.ssh/knot-edge`，不进仓库。LaunchAgent 是 `com.knot.edge-tunnel`。

## 环境

`ops/env/knot-platform.local.env` 只放在目标机，不进仓库。`BIND_HOST` 决定 Backend 监听地址。模型密钥留在 OpenClaw 的本机状态里。
