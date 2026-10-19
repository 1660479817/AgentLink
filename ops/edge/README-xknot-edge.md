# xknot 边缘：签发子域 + SSH 反向隧道

本文对应「无固定公网 IP / NAT 后」的连通方式。契约与加入流程见 `xknot.si/docs/JOIN.md` §3.2；固定 IP 直连见同目录 [xknot-subdomain.fixed-ip.md](./xknot-subdomain.fixed-ip.md)。

## 角色

| 角色 | 做什么 |
|------|--------|
| 公网边缘（当前新加坡 `54.169.33.64`） | nginx 持证书；`sshd` 允许隧道用户只监听 `127.0.0.1:18080` |
| 内网实例（如 bot01） | 跑 Knot Backend（本机 `127.0.0.1:8080`）；主动 `ssh -R` 把边缘 `18080` 转到本机 |
| DNS | `某名.xknot.si` A/AAAA → **边缘公网 IP**（不是内网机） |

不要把 A 记录指到 RFC1918。不要把隧道绑到边缘已占用的 `127.0.0.1:8080`（ZenHeart 等）。

## 仓库文件

| 路径 | 用途 |
|------|------|
| `sshd-knot-tunnel.conf` | `Match User knot-tunnel`，`PermitListen 127.0.0.1:18080` |
| `wang.xknot.si.conf` | 单子域 nginx 模板（`server_name wang.xknot.si` → `127.0.0.1:18080`） |
| `knot.zenheart.net.conf` | 自营示范（同模式，域名不是 xknot） |
| `../scripts/run-edge-tunnel.sh` | 实例侧：`-R 127.0.0.1:18080:127.0.0.1:8080` |
| `../launchd/com.knot.edge-tunnel.plist` | macOS 常驻示例 |

通配 `*.xknot.si` 多租户自动 server **未做**；每个签发子域目前手工一份 conf（或复制本模板改 `server_name` / 证书路径 / 静态根）。

## 边缘落地（工作人员）

1. **隧道用户**：系统用户 `knot-tunnel`，仅密钥登录；authorized_keys 只放实例侧公钥。私钥不进仓库。
2. **sshd**：把 `sshd-knot-tunnel.conf` 放到 `/etc/ssh/sshd_config.d/`（需已有 `Include /etc/ssh/sshd_config.d/*.conf`），然后：
   ```bash
   sudo sshd -t && sudo systemctl reload sshd
   ```
   确认 Match 生效且 `PermitListen` 仅为 `127.0.0.1:18080`。
3. **静态根**：`sudo mkdir -p /var/www/<slug>`，可放占位 `index.html`。
4. **证书（先 80 后 443）**：
   - 先启用仅 `:80` + `/.well-known/acme-challenge/`（webroot = `/var/www/<slug>`）。
   - `sudo certbot certonly --webroot -w /var/www/<slug> -d <slug>.xknot.si`
   - 再启用完整 443 conf（参考 `wang.xknot.si.conf`），`nginx -t && sudo systemctl reload nginx`。
5. **回归**：确认同机 `xknot.si` / `root.xknot.si` / `zenheart.net` / `knot.zenheart.net` 仍正常。

## 实例侧隧道

```bash
# 环境可覆盖；默认见 run-edge-tunnel.sh
export KNOT_EDGE_KEY="$HOME/.ssh/knot-edge"          # 私钥路径，仅本机
export KNOT_EDGE_HOST="knot-tunnel@<边缘公网IP>"
./ops/scripts/run-edge-tunnel.sh
```

常驻：把 `ops/launchd/com.knot.edge-tunnel.plist` 里的 `__KNOT_HOME__` 换成实例仓路径后装入 LaunchAgent（或等价 systemd）。`KeepAlive` + `ServerAliveInterval` 已在脚本/plist 侧考虑断线重连。

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
