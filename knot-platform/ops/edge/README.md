# 实例边缘：让 Knot 实例有公网入口

本目录属于**实例侧**部署：每台用 `knot-platform` 部署的站点，需要公网域名时在这里取配置。

这里只有**模板和通用步骤**，没有任何具体域名。一个实例自己的入口写在它自己的站点目录里：

```text
sites/<站点>/site.env                实例身份、边缘主机、隧道
sites/<站点>/edge.<域名>.env          一个公网入口一份
```

所以 `wang.xknot.si`、`knot.zenheart.net` 这类具体域名不会出现在本目录下——它们属于持有那个实例的人，不属于这份软件。

## 两种连通方式

| 方式 | 适用 | 配置 |
|------|------|------|
| 固定公网 IP 直连 | 主机有稳定公网 IP 或弹性 IP | [subdomain-fixed-ip.md](./subdomain-fixed-ip.md) |
| 边缘 + SSH 反向隧道 | 主机在 NAT 后、只有出网，或不想直接暴露 | 本文下半部分 |

选哪种由实例自己决定。

## 本目录文件

| 路径 | 用途 |
|------|------|
| `site.conf.template` | 一个公网入口的 nginx 配置（由 `site.env` 叠加 `edge.<域名>.env` 渲染） |
| `sshd-tunnel.conf.template` | 边缘隧道账号的 sshd Match 块（变量化） |
| `sshd-knot-tunnel.conf` | 上面模板渲染出来的成品，`knot-tunnel` + `18080` 的实例 |
| `subdomain-fixed-ip.md` | 固定公网 IP 直连 runbook |

伙伴子域的签发、交接与接通流程属于联邦中枢，不在本目录：[`xknot.si/docs/HANDOFF.md`](../../../xknot.si/docs/HANDOFF.md)。伙伴要配的三件事（对外地址、隧道对端、端口）见交付单第 4 节；本目录给的是 `knot-platform` 把它们写成哪几个键。

## 一个实例可以有多个入口

同一个后端挂两个公网域名是正常形态（自有域名 + 签发子域，或两个自有域名）。每个入口一份文件：

```bash
# sites/<站点>/site.env —— 全实例共用
KNOT_EDGE=1
KNOT_EDGE_SSH=ec2-user@<边缘公网IP>
KNOT_PUBLIC_ORIGIN=https://<规范域名>
KNOT_PUBLIC_ALIASES=https://<第二域名>
KNOT_TUNNEL=1
KNOT_TUNNEL_KEY=$HOME/.ssh/knot-edge
KNOT_EDGE_PROXY_PORT=18080
```

```bash
# sites/<站点>/edge.<域名>.env —— 一个入口一份，文件名必须等于域名
KNOT_DOMAIN=<域名>
KNOT_EDGE_WEB_ROOT=/var/www/<slug>
KNOT_EDGE_CONF=/etc/nginx/conf.d/<域名>.conf
KNOT_ENTRY_SERVE=static        # 或 proxy
KNOT_ENTRY_OWNER=self          # 或 issued
KNOT_ENTRY_PUBLISHER=staff     # 或 partner
```

入口文件是**叠加层**：只写与 `site.env` 不同的项，其余沿用。`KNOT_EDGE_WEB_ROOT` 与 `KNOT_EDGE_CONF` 必须各不相同，否则后推的会覆盖前一个；`config.mjs check` 会拦住这种情况。

签发子域时，交付单（[`xknot.si/docs/HANDOFF.md`](../../../xknot.si/docs/HANDOFF.md) 第 4 节）给的「对外地址 / 隧道对端 / 远端到本地端口」在这里落成：

| 交付单里的项 | 写进 | 键 |
|---|---|---|
| 对外地址 | `edge.<域名>.env`（入口）+ `site.env`（规范入口） | `KNOT_DOMAIN`、`KNOT_PUBLIC_ORIGIN` |
| 隧道对端 | `site.env` | `KNOT_TUNNEL=1`、`KNOT_TUNNEL_SSH=knot-tunnel-<id>@<边缘主机>`、`KNOT_TUNNEL_KEY=<私钥>` |
| 远端到本地端口 | `site.env` | `KNOT_TUNNEL_REMOTE_PORT=<端口>`、`KNOT_TUNNEL_LOCAL_PORT=<后端端口>` |

`KNOT_EDGE=1` 只为让 `deploy-site.sh` 在这台机器上装隧道常驻服务；静态文件归谁推由交付单 2.5 决定。

`push-edge.sh` 逐个入口处理，也可以只推一个：

```bash
./ops/scripts/push-edge.sh --site <站点>
./ops/scripts/push-edge.sh --site <站点> --entry <域名>
```

## 投放方式：`static` 还是 `proxy`

两种都由同一个模板渲染，只差 `KNOT_ENTRY_SERVE`：

| | 首页与 `/assets/` 从哪来 | 什么时候用 |
|---|---|---|
| `static` | 边缘磁盘 `KNOT_EDGE_WEB_ROOT` 的 `dist` | 长期。静态直出，首屏不穿隧道 |
| `proxy` | 隧道回 `127.0.0.1:<回源端口>` 的 Backend | 发布包还没推边缘时，页面与接口不错版本 |

`proxy` 的好处是页面与接口永远来自同一次构建，代价是每个静态文件都要穿一次隧道。两种投放的耗时用 `ops/scripts/speed-check.sh` 量，通常差一个数量级。

`/api/admin` 的 404、`/api/web/uploads/` 的缓存、ACME 目录在两种投放里一致，只有「首页与静态资源从哪来」不同。

## 隧道方式落地（边缘机）

1. **隧道账号**：建系统用户 `knot-tunnel-<id>`，只允许密钥登录；`authorized_keys` 只放实例侧公钥。私钥不进仓库。每个入口一个账号、一个端口，不共用。

2. **sshd**：渲染 [`sshd-tunnel.conf.template`](./sshd-tunnel.conf.template) 后放进 `/etc/ssh/sshd_config.d/`（主配置需已有 `Include /etc/ssh/sshd_config.d/*.conf`）：

   ```bash
   node ops/scripts/render-config.mjs ops/edge/sshd-tunnel.conf.template /tmp/sshd-tunnel.conf
   sudo install -m 644 /tmp/sshd-tunnel.conf /etc/ssh/sshd_config.d/knot-tunnel.conf
   sudo sshd -t && sudo systemctl reload sshd
   ```

   确认 `Match User knot-tunnel` 生效，且 `PermitListen` 只有 `127.0.0.1:<回源端口>`。

3. **静态根**：`sudo mkdir -p /var/www/<slug>`，可先放占位 `index.html`。

4. **证书**：先只启用 `:80` + `/.well-known/acme-challenge/`（webroot 指向静态根），签完再上 443。

   ```bash
   sudo certbot certonly --webroot -w /var/www/<slug> -d <域名>
   ```

5. **nginx**：`push-edge.sh` 从模板渲染并装上，不需要手写。手工验证时：

   ```bash
   ./ops/scripts/push-edge.sh --site <站点> --entry <域名> --no-build
   ```

6. **回归**：边缘机可能同时托管多个项目，`nginx -t` 通过后再 reload，确认同机其它 `server_name` 仍正常。

## 隧道方式落地（实例主机）

实例主动连出，把边缘的回环端口转到本机 Backend：

```bash
./ops/scripts/run-edge-tunnel.sh
```

也就是一条常驻的：

```bash
ssh -N -i ~/.ssh/knot-edge \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:<回源端口>:127.0.0.1:8080 \
  knot-tunnel-<id>@<边缘公网IP>
```

macOS 用 [`../launchd/com.knot.edge-tunnel.plist`](../launchd/com.knot.edge-tunnel.plist) 常驻；其它系统用 systemd 等等价方式。关键是断线自动重连。

## 验收

```bash
# 边缘上应看到回源端口被隧道账号占用
ss -lntp | grep <回源端口>

# 公网
curl -sI https://<域名>/
curl -s https://<域名>/api/health
```

`/` 在 `static` 投放时应返回静态页；`/api/*` 在隧道未连时返回 502。

`discover.json` 是 `try_files` 先看磁盘再看隧道，所以**每个 static 入口的磁盘上都不能留旧快照**——留一份就永远不回落。`push-discover.sh` 因此逐入口推，别只推规范入口。

**页面与接口来自同一次构建**才算验收通过——只看 `/api/health` 会漏掉「接口新、页面旧」：

```bash
./ops/scripts/speed-check.sh https://<域名>/ https://<域名>/api/health
# 再对照首页引用的 assets/index-*.js 与 /api/health 的 release
```

## 安全

- 边缘对 `/api/admin` 直接 404，不穿隧道。
- `PermitOpen none`、`PermitTTY no`、`ForceCommand sleep infinity`：隧道账号不能开 shell，也不能正向转发。
- 密钥、口令、PEM 只留在各机 `~/.ssh/` 与私有环境，不写进文档与版本库。
