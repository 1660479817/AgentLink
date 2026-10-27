# Knot Docker 部署（Linux）

上游官方部署形态是本机 Node + systemd/launchd，**整站 Docker 属于本仓库的 Linux 适配**。

本机请只选一条运行路径：**Docker Compose（推荐）或 systemd，不要同时开**。Docker 跑 `knot-app` 时务必：

```bash
sudo systemctl stop knot-backend
sudo systemctl disable knot-backend
```

## 组成

| 服务 | 说明 |
|------|------|
| `db` | Postgres 16，宿主机 `5433` |
| `app` | Knot Backend + WebUI；`network_mode/pid/ipc: host`，端口 `8080` |

OpenClaw Gateway 仍跑在宿主机。`app` 与宿主机共用 PID/IPC 命名空间，并挂载 `~/.npm-global`、`~/.openclaw`，否则终审 CLI 会因 SQLite 锁跨命名空间而 `agent_failed`。

## 启动

```bash
# 1) 把最新发布目录准备好（或沿用 ~/knot/site/current）
# 2) 停掉旧的 systemd 实例，避免抢 8080
sudo systemctl stop knot-backend
sudo systemctl disable knot-backend

# 3) 构建并启动
cd /home/perfxlab/AgentLink/knot-platform/docker
sudo docker compose up -d --build
```

## 常用命令

```bash
sudo docker compose ps
sudo docker compose logs -f app
sudo docker compose restart app
```

管理后台链接应指向局域网地址，例如 `http://192.168.3.22:8080/admin`（由 `KNOT_ADMIN_ORIGIN` 固定，并已修复 docker0 误选）。
