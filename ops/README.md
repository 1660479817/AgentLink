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

脚本把仓库同步到 `~/knot/AgentLink`，再在目标机执行 `ops/scripts/deploy-macos.sh`：安装依赖、构建 WebUI、迁移数据库、用 LaunchAgent 启动 Postgres 与 Knot Backend，并按 [ops/openclaw](./openclaw/README.md) 同步数据评审员、需求评审员、数据匹配专家和管理员。

已在目标机上时：

```bash
cd ~/knot/AgentLink
./ops/scripts/deploy-macos.sh
```

## 检查

```bash
curl -s http://127.0.0.1:8080/api/health
```

## 系统复位

清空测试阶段写入的信息、对话、通知、积分流水和上传文件。用户和会话留下。平台积分回到 0，测试员回到 100，其他人回到 10。OpenClaw 的模型、密钥、飞书和员工不动。

```bash
cd ~/knot/AgentLink
./ops/scripts/reset-knot.sh --yes
```

浏览器打开 `http://192.168.3.91:8080/`。

## 环境

`ops/env/knot-platform.local.env` 只放在目标机，不进仓库。`BIND_HOST` 决定 Backend 监听地址。模型密钥留在 OpenClaw 的本机状态里。
