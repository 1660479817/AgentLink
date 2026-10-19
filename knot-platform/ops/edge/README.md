# 实例边缘：让 Knot 实例有公网入口

本目录属于**实例侧**部署：每台用 `knot-platform` 部署的站点，需要公网域名时在这里取配置。联盟门户 `xknot.si` 只登记站点档案与健康地址，不托管这里的任何文件。

实例的域名不一定是 `*.xknot.si`。作者自己的站点用 `knot.zenheart.net`；拿到子域签发的伙伴用 `某名.xknot.si`。两者的边缘配置是同一套，差别只在域名与证书。

## 两种连通方式

| 方式 | 适用 | 配置 |
|------|------|------|
| 固定公网 IP 直连 | 主机有稳定公网 IP 或弹性 IP | [subdomain-fixed-ip.md](./subdomain-fixed-ip.md) |
| 边缘 + SSH 反向隧道 | 主机在 NAT 后、只有出网，或不想直接暴露 | 本文下半部分 |

选哪种由实例自己决定。中枢只按清单里的公网 `healthUrl` 探测，不关心你是直连还是隧道。

## 本目录文件

| 路径 | 用途 |
|------|------|
| `site.conf.template` | 门户与接口的 nginx 模板（由 `sites/<站点>/site.env` 渲染） |
| `sshd-tunnel.conf.template` | 边缘隧道账号的 sshd Match 块（变量化） |
| `knot.zenheart.net.conf` | 自营实例在 `knot.zenheart.net` 的生成样例 |
| `wang.xknot.si.conf` | 实例拿到 `某名.xknot.si` 时的单子域模板（隧道反代） |
| `zjj.xknot.si.conf` | `zjj.xknot.si` 签发阶段样例（静态占位，无隧道反代） |
| `subdomain-fixed-ip.md` | 固定公网 IP 直连 runbook |

通配 `*.xknot.si` 多租户自动 server **未做**；每个子域目前手工一份 conf（复制 `wang.xknot.si.conf`，改 `server_name`、证书路径与静态根）。

域名怎么申请、清单怎么登记，见联盟门户的 [JOIN.md](../../../xknot.si/docs/JOIN.md)；那部分是联盟的策略，不是这里的部署步骤。

## 隧道方式落地（边缘机）

1. **隧道账号**：建系统用户 `knot-tunnel`，只允许密钥登录；`authorized_keys` 只放实例侧公钥。私钥不进仓库。

2. **sshd**：渲染 [`sshd-tunnel.conf.template`](./sshd-tunnel.conf.template) 后放进 `/etc/ssh/sshd_config.d/`（主配置需已有 `Include /etc/ssh/sshd_config.d/*.conf`）：

   ```bash
   node ops/scripts/render-config.mjs ops/edge/sshd-tunnel.conf.template /tmp/sshd-tunnel.conf
   sudo install -m 644 /tmp/sshd-tunnel.conf /etc/ssh/sshd_config.d/knot-tunnel.conf
   sudo sshd -t && sudo systemctl reload sshd
   ```

   确认 `Match User knot-tunnel` 生效，且 `PermitListen` 只有 `127.0.0.1:18080`。

3. **静态根**：`sudo mkdir -p /var/www/<slug>`，可先放占位 `index.html`。

4. **证书**：先只启用 `:80` + `/.well-known/acme-challenge/`（webroot 指向静态根），签完再上 443。

   ```bash
   sudo certbot certonly --webroot -w /var/www/<slug> -d <slug>.xknot.si
   ```

5. **nginx**：以 [`wang.xknot.si.conf`](./wang.xknot.si.conf) 为模板改 `server_name`、证书路径与静态根，`nginx -t` 后 reload。

6. **回归**：边缘机可能同时托管多个项目，`nginx -t` 通过后再 reload，确认同机其它 `server_name` 仍正常。

## 隧道方式落地（实例主机）

实例主动连出，把边缘的回环端口转到本机 Backend：

```bash
# sites/<站点>/site.env
KNOT_EDGE=1
KNOT_EDGE_SSH=ec2-user@<边缘公网IP>
KNOT_TUNNEL=1
KNOT_TUNNEL_KEY=$HOME/.ssh/knot-edge
KNOT_EDGE_PROXY_PORT=18080
```

```bash
./ops/scripts/run-edge-tunnel.sh
```

也就是一条常驻的：

```bash
ssh -N -i ~/.ssh/knot-edge \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:18080:127.0.0.1:8080 \
  knot-tunnel@<边缘公网IP>
```

macOS 用 [`../launchd/com.knot.edge-tunnel.plist`](../launchd/com.knot.edge-tunnel.plist) 常驻；其它系统用 systemd 等等价方式。关键是断线自动重连。

## 验收

```bash
# 边缘上应看到 18080 被 knot-tunnel 占用
ss -lntp | grep 18080

# 公网
curl -sI https://<slug>.xknot.si/
curl -s https://<slug>.xknot.si/api/health
```

`/` 在只有 nginx + 证书时应返回静态页；`/api/*` 在隧道未连时返回 502。

## 安全

- 边缘对 `/api/admin` 直接 404，不穿隧道。
- `PermitOpen none`、`PermitTTY no`、`ForceCommand sleep infinity`：隧道账号不能开 shell，也不能正向转发。
- 密钥、口令、PEM 只留在各机 `~/.ssh/` 与私有环境，不写进文档与版本库。
