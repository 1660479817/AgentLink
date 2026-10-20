# zjj.xknot.si：从静态占位到接通

[`zjj.xknot.si.conf`](./zjj.xknot.si.conf) 的配套 runbook，把 [HANDOFF.md](../../../xknot.si/docs/HANDOFF.md) 的交付单落成命令。

| 项 | 值 |
|----|----|
| 子域 | `zjj.xknot.si` |
| 实例 `id` | `zjj` |
| 连通方式 | 边缘 + SSH 反向隧道（动态 IP） |
| 边缘主机 | `54.169.33.64`（`ec2-user`） |
| 隧道账号 | `knot-tunnel-zjj` |
| 专属端口 | `18081`（`18080` 已被 `wang` 占用） |
| 边缘静态根 | `/var/www/zjj` |
| 实例本机端口 | `8080` |

**起点**：DNS、证书、静态占位页已完成。`/api/health` 返回 `200 text/html`（SPA 兜底），运行状态会被判 `bad_payload`。

**终点**：`https://zjj.xknot.si/api/health` 返回 `{"ok":true,…}`，清单探测为 `up`。

---

## 1. 执行顺序

```text
A 伙伴：本机自测通过，发公钥
B 工作人员：分端口 → 建账号 → 装公钥 → sshd Match
C 伙伴：起隧道；工作人员在边缘确认 18081 有监听
D 工作人员：补 /api 反代 → nginx -t → reload
E 工作人员：healthUrl 填回 → 重跑探测 → up
```

顺序颠倒会多出两个窗口：先改 nginx 会有一段 `/api` 502；先改清单会让门户先挂一个中断的实例。A→E 没有这两个窗口。

---

## 2. 伙伴：A 段

### A1 本机自测

```bash
curl -s http://127.0.0.1:8080/api/health
# 期望 {"ok":true,"service":"…","version":"…"}
```

不过就不要往下做。隧道会把一个不健康的后端原样暴露到公网。

### A2 生成密钥，只发公钥

```bash
ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-zjj -N '' -C 'zjj@edge-tunnel'
chmod 600 ~/.ssh/knot-edge-zjj
ssh-keygen -lf ~/.ssh/knot-edge-zjj.pub    # SHA256 指纹，记下来
cat ~/.ssh/knot-edge-zjj.pub               # 整段交给工作人员
```

私钥不出这台机器。工作人员不需要、也不接收。

### A3 写 `site.env`

```bash
KNOT_DOMAIN=zjj.xknot.si
KNOT_PUBLIC_ORIGIN=https://zjj.xknot.si

# 只为让 deploy-site.sh 装隧道常驻服务；不要跑 push-edge.sh。
KNOT_EDGE=1
KNOT_EDGE_SSH=ec2-user@54.169.33.64
KNOT_EDGE_PROXY_PORT=18081

KNOT_TUNNEL=1
KNOT_TUNNEL_SSH=knot-tunnel-zjj@54.169.33.64
KNOT_TUNNEL_KEY=$HOME/.ssh/knot-edge-zjj
KNOT_TUNNEL_REMOTE_PORT=18081
KNOT_TUNNEL_LOCAL_PORT=8080
```

---

## 3. 工作人员：B 段

### B0 前置检查

```bash
# PermitListen 需要 OpenSSH 7.8 及以上
ssh -V
# 端口未被占用
sudo ss -lntp | grep -E ':1808[0-9]\b' || echo 'free'
# 账号不存在
id -u knot-tunnel-zjj >/dev/null 2>&1 && echo 'EXISTS' || echo 'absent'
```

### B1 建账号

```bash
sudo useradd -r -m -d /home/knot-tunnel-zjj -s /bin/bash knot-tunnel-zjj
sudo install -d -m 700 -o knot-tunnel-zjj -g knot-tunnel-zjj /home/knot-tunnel-zjj/.ssh
```

登录 shell 必须是 `/bin/bash`。`ForceCommand` 经登录 shell 执行，设成 `nologin` 会让会话立刻退出，隧道随之断开。禁止登录靠 `PermitTTY no` + `PermitOpen none`，不靠换 shell。

### B2 装公钥

```bash
sudo install -m 600 -o knot-tunnel-zjj -g knot-tunnel-zjj \
  /tmp/zjj-tunnel.pub /home/knot-tunnel-zjj/.ssh/authorized_keys
sudo ssh-keygen -lf /home/knot-tunnel-zjj/.ssh/authorized_keys
```

指纹要与伙伴在 A2 报的一致。

### B3 sshd Match

写入 `/etc/ssh/sshd_config.d/knot-tunnel-zjj.conf`：

```text
Match User knot-tunnel-zjj
    AllowTcpForwarding remote
    PermitListen 127.0.0.1:18081
    PermitOpen none
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    GatewayPorts no
    ClientAliveInterval 30
    ClientAliveCountMax 3
    ForceCommand /usr/bin/sleep infinity
```

边缘上有本仓库时可以直接渲染：

```bash
cd knot-platform
KNOT_TUNNEL_USER=knot-tunnel-zjj KNOT_EDGE_PROXY_PORT=18081 \
  node ops/scripts/render-config.mjs ops/edge/sshd-tunnel.conf.template /tmp/sshd-tunnel-zjj.conf
```

启用并核对生效值：

```bash
sudo sshd -t
sudo systemctl reload sshd
sudo sshd -T -C user=knot-tunnel-zjj,host=zjj.xknot.si,addr=203.0.113.9 \
  | grep -E '^(permitlisten|permitopen|permittty|gatewayports|forcecommand|allowtcpforwarding) '
```

期望：`permitlisten 127.0.0.1:18081`、`permitopen none`、`permittty no`、`gatewayports no`。

> 同机 `wang` 使用 `knot-tunnel` + `18080`。**两段 Match 不能复用同一个 `User`**：首条匹配生效，第二段永远不执行。zjj 必须是独立账号、独立端口。

---

## 4. 伙伴：C 段

### C1 手动起隧道

```bash
./ops/scripts/run-edge-tunnel.sh
```

或直接看连接过程：

```bash
ssh -N -i ~/.ssh/knot-edge-zjj -o ExitOnForwardFailure=yes -v \
  -R 127.0.0.1:18081:127.0.0.1:8080 knot-tunnel-zjj@54.169.33.64
```

停在 `remote forward success for: listen 127.0.0.1:18081` 即为成功。此时公网仍不通，正常。

### C2 边缘确认监听

```bash
sudo ss -lntp | grep 18081
# 期望 users:(("sshd",pid=…,fd=…))
```

### C3 常驻

macOS（`deploy-site.sh` 会装 `com.knot.edge-tunnel`）：

```bash
./ops/scripts/deploy-site.sh --site zjj
```

Linux 用等价 unit：

```ini
[Unit]
Description=Knot edge tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/knot/AgentLink/knot-platform
Environment=KNOT_SITE=zjj
ExecStart=/opt/knot/AgentLink/knot-platform/ops/scripts/run-edge-tunnel.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now knot-edge-tunnel
```

验证自动重连：`kill` 掉 ssh 进程，30 秒内边缘的 `18081` 应重新出现。

---

## 5. 工作人员：D 段

在 `zjj.xknot.si.conf` 的 443 server 内、`location /` 之前加入：

```nginx
    location ^~ /api/admin {
        default_type application/json;
        return 404 '{"error":"not_found"}';
    }

    location /api/ {
        proxy_pass http://127.0.0.1:18081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location = /help {
        proxy_pass http://127.0.0.1:18081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 30s;
    }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo ss -lntp | grep -E '18080|18081'   # 确认 wang 的 18080 未受影响
curl -s https://zjj.xknot.si/api/health
```

接通后把仓库里的 [`zjj.xknot.si.conf`](./zjj.xknot.si.conf) 同步成这一版，不要留两份不一致的配置。

---

## 6. 工作人员：E 段

```bash
cd xknot.si
node ops/validate-instances.mjs          # 清单结构合法
node ops/validate-federation.mjs         # 名册与清单对得上
node ops/check-health.mjs | grep zjj     # 期望 up 或 degraded
npm run build                            # 重出 hub.json
```

交接期若 `healthUrl` 仍是完整地址，先置 `null`；名册 `access` 保持 `pending`：

```json
"healthUrl": null
```

`null` 合法，运行状态记 `unknown`，门户不会展示成一个中断的实例。接通后再把名册 `access` 改为 `edge-tunnel`。

---

## 7. 验收

```bash
# 边缘
sudo ss -lntp | grep 18081
# 公网
curl -sI https://zjj.xknot.si/ | head -1
curl -s  https://zjj.xknot.si/api/health
# 中枢
cd xknot.si && node ops/check-health.mjs | grep zjj
```

四条都过，回填 [HANDOFF.md](../../../xknot.si/docs/HANDOFF.md) 第 9 节的状态。

---

## 8. 回滚

每一步可单独退，不连带 `wang` 与门户。

| 退到 | 操作 |
|------|------|
| 只停动态 | 伙伴停常驻服务；`/api` 502，静态页仍在 |
| 撤反代 | 删除 D 段三段 location，`nginx -t` 后 reload |
| 撤探测 | `instances.json` 把 `healthUrl` 置 `null`，重跑构建 |
| 全撤 | 停隧道 → 撤 conf → 删账号与 Match 文件 → `sshd -t` → reload → 重跑构建 |

删账号：

```bash
sudo rm -f /etc/ssh/sshd_config.d/knot-tunnel-zjj.conf
sudo sshd -t && sudo systemctl reload sshd
sudo userdel -r knot-tunnel-zjj
```

---

## 9. 排错

| 症状 | 原因 | 处理 |
|------|------|------|
| `ssh` 立即退出，码 255 | 公钥未装，或属主/权限不对 | `authorized_keys` 应为 `knot-tunnel-zjj:knot-tunnel-zjj` 600，`.ssh` 700 |
| `remote port forwarding failed for listen port 18081` | `PermitListen` 不匹配，或端口被占 | 按 B3 核对生效值；`sudo ss -lntp \| grep 18081` |
| 能连但立刻断 | 登录 shell 是 `nologin` | 改回 `/bin/bash`，见 B1 |
| `/api/*` 返回 JSON 404 | `^~ /api/admin` 命中了别的路径 | 该规则只应覆盖 `/api/admin` |
| `/api/health` 返回 HTML | D 段未生效，落到 `location /` 的 SPA 兜底 | `sudo nginx -T \| grep -A6 'location /api/'` |
| `/api/health` 502 | 隧道断，或本机 8080 未起 | 边缘看 `18081`；伙伴看后端日志 |
| 自己 `curl` 是 JSON，探测仍 `bad_payload` | 响应不是 `ok:true`，或不是合法 JSON | 严格输出 `{"ok":true,…}`，不要包一层 |
| `wang` 同时 502 | 改 conf 时动了 `18080` | `sudo ss -lntp \| grep 18080`，逐条回退 |
