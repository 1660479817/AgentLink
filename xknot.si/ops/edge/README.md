# 子域边缘：签发子域 + SSH 反向隧道

本文对应「无固定公网 IP / NAT 后」的连通方式。加入流程与域名轴见 [docs/JOIN.md](../../docs/JOIN.md) §3.2；固定公网 IP 直连见同目录 [subdomain-fixed-ip.md](./subdomain-fixed-ip.md)。

边缘是一台独立的公网机，不属于中枢进程的一部分：它只持证书并反代回源。中枢的静态站和接口在 `docs/HUB.md` §7。

## 角色

| 角色 | 做什么 |
|------|--------|
| 公网边缘 | nginx 持证书；`sshd` 允许隧道用户只监听 `127.0.0.1:18080` |
| 内网实例 | 跑 Knot Backend（本机 `127.0.0.1:8080`）；主动 `ssh -R` 把边缘 `18080` 转到本机 |
| DNS | `某名.xknot.si` A/AAAA → **边缘公网 IP**（不是内网机） |

不要把 A 记录指到 RFC1918。不要把隧道绑到边缘已占用的 `127.0.0.1:8080`（同机其它站点可能占着）。

## 仓库文件

| 路径 | 用途 |
|------|------|
| `wang.xknot.si.conf` | 单子域 nginx 模板（`server_name wang.xknot.si` → `127.0.0.1:18080`） |
| `subdomain-fixed-ip.md` | 伙伴自有固定公网 IP 时直连的 runbook |
| `docs/JOIN.md` | 加入流程与契约入口 |

本目录只有中枢这一侧的配置。实例侧的隧道命令写在下面第「实例侧隧道」一节，不依赖任何外部仓库。

通配 `*.xknot.si` 多租户自动 server **未做**；每个签发子域目前手工一份 conf（或复制 `wang.xknot.si.conf` 改 `server_name` / 证书路径 / 静态根）。

## 边缘落地（工作人员）

1. **隧道用户**：系统用户 `knot-tunnel`，仅密钥登录；`authorized_keys` 只放实例侧公钥。私钥不进仓库。

2. **sshd**：新建 `/etc/ssh/sshd_config.d/knot-tunnel.conf`（需主配置已有 `Include /etc/ssh/sshd_config.d/*.conf`）：

   ```text
   Match User knot-tunnel
       AllowTcpForwarding remote
       PermitListen 127.0.0.1:18080
       PermitOpen none
       X11Forwarding no
       AllowAgentForwarding no
       PermitTTY no
       GatewayPorts no
       ClientAliveInterval 30
       ClientAliveCountMax 3
       ForceCommand /usr/bin/sleep infinity
   ```

   ```bash
   sudo sshd -t && sudo systemctl reload sshd
   ```

   确认 Match 生效且 `PermitListen` 仅为 `127.0.0.1:18080`。

3. **静态根**：`sudo mkdir -p /var/www/<slug>`，可放占位 `index.html`。

4. **证书（先 80 后 443）**：
   - 先启用仅 `:80` + `/.well-known/acme-challenge/`（webroot = `/var/www/<slug>`）。
   - `sudo certbot certonly --webroot -w /var/www/<slug> -d <slug>.xknot.si`
   - 再启用完整 443 conf（参考 `wang.xknot.si.conf`），`nginx -t && sudo systemctl reload nginx`。

5. **回归**：`nginx -t` 之后确认同机其它站点的 `server_name` 与证书路径没有被覆盖。

## 实例侧隧道

实例侧只需要一条常驻的 SSH 远程转发：

```bash
ssh -N \
  -i "$HOME/.ssh/knot-edge" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:18080:127.0.0.1:8080 \
  knot-tunnel@<边缘公网IP>
```

常驻用 systemd、LaunchAgent 或等价方式；关键是断线自动重连。Knot 平台的现成实现是可选的参考，不是本项目的依赖。

验收：

```bash
# 边缘上应看到 18080 被 knot-tunnel 占用
ss -lntp | grep 18080

# 公网
curl -sI https://<slug>.xknot.si/
curl -s https://<slug>.xknot.si/api/health
```

`/api/health` 需实例 Backend 在跑且隧道已连；仅 nginx + 证书就绪时 `/` 可返回静态页，`/api/*` 在无隧道时为 502。

## 安全注意

- 边缘对 `/api/admin` 直接 404，不穿隧道。
- `PermitOpen none`、`PermitTTY no`、`ForceCommand sleep infinity`：隧道用户不能开 shell、不能正向转发。
- 密钥、口令、PEM 只留在各机 `~/.ssh/` 与私有环境，不写进本文与版本库。
