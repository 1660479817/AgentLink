# 192.168.3.91 同机部署（Phase 0）

目标机：`ssh zenwang_bot01@192.168.3.91`（**macOS + Homebrew**，不是 Linux systemd）  
同机进程：**knot-platform**（:8080 同时提供 Web 静态 + API）· **PostgreSQL**（`~/knot/pgdata` :5433 或 Docker）· **openclaw-agent**（LaunchAgent）

```text
浏览器 → nginx :80 (192.168.3.91)
            ├── /          → apps/web/dist
            ├── /api/*     → 127.0.0.1:8080
            └── /uploads/* → 127.0.0.1:8080
openclaw-agent → 127.0.0.1:8080/api/agent/*
knot-platform  → 127.0.0.1:5433 (Postgres)
```

API 与 Agent **不**对局域网单独暴露端口；仅 nginx 80（内网访问）。

---

## 1. 前置条件（在 192.168.3.91 上）

| 组件 | 建议 |
|------|------|
| Node.js | 20 LTS+（`node -v`） |
| npm | 随 Node |
| Docker | 跑 Postgres 16 |
| nginx | 反代 + 静态站 |
| git | 拉仓库 |

本机首次 SSH（在你开发机上）：

```bash
ssh-keyscan -H 192.168.3.91 >> ~/.ssh/known_hosts
ssh zenwang_bot01@192.168.3.91
```

---

## 2. 目录约定

```bash
mkdir -p ~/knot
cd ~/knot
git clone https://github.com/manwjh/AgentLink.git
cd AgentLink
```

若 nginx 配置里的 `root` 路径不同，改 `ops/nginx/knot.conf` 中的 `root` 与 `server_name`。

---

## 3. 一次性安装

```bash
cd ~/knot/AgentLink
npm ci
chmod +x ops/scripts/*.sh

# 环境变量（systemd 读取 /etc/knot/*.env）
./ops/scripts/install-systemd.sh
sudo nano /etc/knot/knot-platform.env    # SMTP、UPLOAD_DIR、PUBLIC_WEB_ORIGIN
sudo nano /etc/knot/openclaw-agent.env   # 登录后在 Web 签发 token 再填

# 上传目录（与 knot-platform.env 中 UPLOAD_DIR 一致）
sudo mkdir -p /var/knot/uploads
sudo chown zenwang_bot01:zenwang_bot01 /var/knot/uploads

# nginx
sudo cp ops/nginx/knot.conf /etc/nginx/sites-available/knot
sudo ln -sf /etc/nginx/sites-available/knot /etc/nginx/sites-enabled/
# 如与 default 冲突，可 sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. 发布 / 更新

**macOS（192.168.3.91 当前环境）：**

```bash
cd ~/knot/AgentLink
git pull   # 或开发机 rsync
./ops/scripts/deploy-macos.sh
# 访问 http://192.168.3.91:8080/
```

**Linux + nginx：**

```bash
git pull
./ops/scripts/deploy.sh
```

`deploy.sh` 会：`npm ci` · 构建 Web · 启动 Postgres · 迁移 · 重启 `knot-platform` / `openclaw-agent`（若已 enable systemd）。

---

## 5. 服务管理

```bash
sudo systemctl start knot-postgres
sudo systemctl start knot-platform openclaw-agent
sudo systemctl status knot-platform openclaw-agent

journalctl -u knot-platform -f
journalctl -u openclaw-agent -f
```

健康检查：

```bash
curl -s http://127.0.0.1:8080/api/health
curl -I http://192.168.3.91/
```

---

## 6. openclaw-agent 与现有 OpenClaw

Phase 0 仓库内 `apps/openclaw-agent` 轮询 API，视觉解读支持 **OpenAI / Ollama / stub**（`INTERPRET_MODE`）。  
若该机已有 OpenClaw 技能栈：

1. 仍用 Web 签发 `KNOT_AGENT_TOKEN`，API 基址 `http://127.0.0.1:8080`。
2. 可将 systemd 的 `ExecStart` 换成你的 OpenClaw 入口，或并行跑本 worker 直到技能接好同一套 Agent API。
3. 技能需实现：`GET /api/agent/ingest-jobs`、`POST /api/agent/cards`（Header：`Authorization: Bearer`、`X-Knot-Email`）。

---

## 7. 验收（内网浏览器）

1. 打开 `http://192.168.3.91/` → 邮箱验证码登录（SMTP 或临时看 `journalctl -u knot-platform`  dev 打码）。
2. 「Agent」页签发 token → 写入 `/etc/knot/openclaw-agent.env` → `sudo systemctl restart openclaw-agent`。
3. 上传图片 → job `pending` → agent 处理 → Web 卡片列表出现新卡片。

---

## 8. 安全与后续

- 修改 Docker 默认密码：同时改 `docker-compose.yml` 与 `DATABASE_URL`。
- 仅内网使用时保持 `BIND_HOST=127.0.0.1`。
- 上 HTTPS 时：`PUBLIC_WEB_ORIGIN` 改为 `https://...`，nginx 配 TLS，Cookie 可考虑 `Secure`（需改 session 中间件，Phase 1）。

---

## 9. 从开发机同步（可选）

未走 git 时可 rsync（排除 node_modules）：

```bash
# 推荐：同步 + 构建 + 迁移 + 重启 LaunchAgent
./ops/scripts/push-deploy-91.sh
# 若未配 SSH 公钥：
# DEPLOY_SSH_PASS='你的密码' ./ops/scripts/push-deploy-91.sh
```
