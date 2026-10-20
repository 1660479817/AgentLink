# XKnot 联邦 · 开通交付单

版本 1.2，2026-10-20。

[JOIN.md](JOIN.md) 讲策略：怎么申请、域名轴与连通轴怎么选。本文只回答一个问题——**签发一个子域之后、实例真正接通之前，谁在哪一步交给谁什么**。

每个新子域复制一份填完再开工。填不满的部分就是还没谈定的部分，不要开工。

![子域开通的两段与一次交接](handoff-flow.svg)

---

## 0. 一句话

**签发不等于接通。** 签发只让 `https://<子域>/` 能打开一张静态页；`/api` 还不在那里。此时若清单里已经写了 `healthUrl`，中枢构建会把该实例的运行状态记成 `down`（`bad_payload`），门户上就是一个中断的实例。

---

## 1. 三个阶段

| 阶段 | 谁执行 | 结束标志 | 清单 `healthUrl` | 运行状态 |
|------|--------|----------|------------------|----------|
| 签发 | 工作人员 | 子域可解析、证书有效、静态占位页可见 | 尚未填写，或已置 `null` | `unknown`（合法） |
| 交接 | 双方 | 交付单填完、公钥已装、账号与端口就绪 | `null` | `unknown` |
| 接通 | 工作人员 | `/api/health` 返回 `{"ok":true,…}`，探测通过 | 填回完整地址 | `up` 或 `degraded` |

**只有第三阶段结束才算收录完成。** 签发当天不要对外宣告实例已上线。

---

## 2. 交付单（复制填写）

占位符用 `〈…〉`。交付单的最终版本写进该子域的 runbook，不进 `instances.json`。

### 2.1 身份

| 项 | 值 | 责任方 |
|----|----|--------|
| 实例 `id`（小写 kebab，2–32 位） | 〈id〉 | 工作人员定，伙伴确认 |
| 对外地址 | `https://〈子域〉` | 工作人员 |
| 签发子域 | 〈子域〉.xknot.si | 权利人 |
| 运营方 / 主理人 | 〈运营方〉 / 〈主理人〉 | 伙伴 |
| 语种与区域 | `languages`：〈…〉；`regions`：〈…〉 | 伙伴提供，工作人员写入 |
| 联系邮箱 | 与 `instances.json` 的 `contact` 一致 | 伙伴 |

### 2.2 连通与边缘

「连通方式」「证书落点」两种模式都填；账号、端口、sshd 相关项只适用于隧道模式，固定 IP 直连时写 `—`。

| 项 | 值 | 责任方 |
|----|----|--------|
| 连通方式 | 固定公网 IP 直连 / 边缘 + SSH 反向隧道 | 双方 |
| 边缘主机 | 〈host〉，SSH 端口 〈22〉 | 工作人员 |
| 证书落点 | 边缘 nginx / 伙伴主机 | 按连通方式 |
| 边缘静态根 | `/var/www/〈id〉` | 工作人员 |
| 边缘 nginx conf | `/etc/nginx/conf.d/〈id〉.conf` | 工作人员 |
| 隧道系统账号 | `knot-tunnel-〈id〉` | 工作人员新建 |
| 专属回环端口 | `〈1808x〉` | 工作人员分配 |
| 私钥位置 | `~/.ssh/knot-edge-〈id〉` | 伙伴，**不上交** |

**一个子域一套账号和一套端口，不共用。** 原因见第 7 节第 1 条。

### 2.3 公钥

| 项 | 值 | 责任方 |
|----|----|--------|
| 算法 | `ed25519` | 伙伴 |
| 公钥指纹（`SHA256:…`） | 〈指纹〉 | 双方各记一份 |
| 安装位置 | `/home/knot-tunnel-〈id〉/.ssh/authorized_keys`，600 | 工作人员 |
| 私钥 | 只在伙伴机器，权限 600 | 伙伴 |

伙伴只交 `.pub` 的文本。工作人员不索要、不接收、不复制私钥。

### 2.4 清单与名册

两份文件，各管一段。**同一 `id` 必须两边都有或两边都没有**，否则构建停下。

清单 `instances.json`（门户渲染用）：

| 项 | 值 | 责任方 |
|----|----|--------|
| `url` / `canonical` | `https://〈子域〉` | 工作人员 |
| `healthUrl` | 交接期 `null`；接通后 `https://〈子域〉/api/health` | 工作人员 |
| `tier` / `status` | `community` / `active` | 工作人员 |
| 站点档案其余字段 | 名称、一句话简介、标签、`since` | 工作人员 |

名册 `federation.json`（成员事实，不参与渲染）：

| 项 | 值 | 责任方 |
|----|----|--------|
| `host` | `〈子域〉.xknot.si`，须与清单 `url` 的主机一致 | 工作人员 |
| `role` / `standing` | `partner` / `regular`（创始实例为 `founder` / `permanent`） | 工作人员 |
| `issuance` | `subdomain-issued` / `own-domain` / `subdomain-reserved` / `none` | 工作人员 |
| `access` | `edge-tunnel` / `direct` / `pending` | 工作人员 |
| `tunnel` | `{ account, port }`；账号与端口同机唯一，直连填 `null` | 工作人员 |
| `listed` / `since` | `true` / 收录日期 | 工作人员 |

### 2.5 分工

| 项 | 值 | 责任方 |
|----|----|--------|
| 静态 WebUI 谁推到边缘 | 工作人员推 / 伙伴自行 rsync | 交付单选定一种 |
| 穿隧道的动态路径 | `/api/`、`/help` | 固定 |
| 管理面 | 边缘 `^~ /api/admin` 返回 404，不穿隧道 | 固定 |
| 隧道常驻 | launchd / systemd，断线自动重连 | 伙伴 |
| 数据库、上传、账号、积分、备份 | 伙伴 | 固定 |

### 2.6 人与时间

| 项 | 值 |
|----|----|
| 工作人员执行人 | 〈姓名〉 |
| 伙伴执行人 | 〈姓名〉 |
| 约定变更窗口 | 〈时间，含时区〉 |
| 交付单签发日 | 〈YYYY-MM-DD〉 |

---

## 3. 工作人员清单

按序执行，每步有可核对的产物。

- [ ] **DNS**：A/AAAA 指向边缘公网 IP。不得写 RFC1918、链路本地或云元数据地址。
- [ ] **证书**：`certbot certonly --webroot`，确认续期任务存在。
- [ ] **静态根**：`/var/www/〈id〉` 与占位页。
- [ ] **子域 conf**：复制同机已有单子域模板，改 `server_name`、证书路径、静态根；此时**不加** `/api` 反代。
- [ ] **`nginx -t` 通过后再 reload**，并确认同机其它 `server_name` 仍正常。
- [ ] **端口登记**：在交付单写下账号名与端口，确认与同机其它实例不冲突（名册里账号与端口必须唯一）。
- [ ] **名册登记**：`federation.json` 加同名 `id` 的成员，`host` 与清单 `url` 主机一致，`access` 与 `tunnel` 填实。
- [ ] **伙伴报「本机自测通过」后**：建账号、装公钥、写 sshd `Match` 块，`sshd -t` 后 reload。
- [ ] **伙伴报「隧道已起」后**：`ss -lntp | grep 〈端口〉` 确认监听归属。
- [ ] **补反代**：`/api/`、`/help`、`/api/admin` 404，`nginx -t` 后 reload。
- [ ] **公网验收**：`/` 返回页面，`/api/health` 返回 JSON 且 `ok:true`。
- [ ] **填回清单**：`healthUrl` 从 `null` 改为完整地址；名册 `access` 改为 `edge-tunnel`，重跑构建，探测为 `up`。

## 4. 伙伴清单

- [ ] **先在本机把实例跑通**，不碰边缘：`curl -s http://〈内网地址〉:8080/api/health` 返回 `{"ok":true,…}`。这一步不过，后面全部无效。
- [ ] **把「本机自测通过」告知工作人员**，对方据此建账号。
- [ ] **生成密钥**：`ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-〈id〉 -N ''`，把 `.pub` 交给工作人员，记下指纹。
- [ ] **写 `site.env`**（字段见下）。
- [ ] **收到「账号已就绪」后手动起隧道**，等工作人员确认边缘出现监听；此时公网仍不通，正常。
- [ ] **装常驻服务**，`kill` 掉 ssh 进程，确认 30 秒内自动重连。
- [ ] **公网验收**，把三条命令的实际输出回执给工作人员。
- [ ] **静态推送**（若交付单 2.5 约定由伙伴推）。

`site.env` 字段（用 `knot-platform` 部署时）：

```bash
KNOT_DOMAIN=〈子域〉
KNOT_PUBLIC_ORIGIN=https://〈子域〉

KNOT_EDGE=1
KNOT_EDGE_SSH=〈工作人员账号〉@〈边缘主机〉
KNOT_EDGE_PROXY_PORT=〈端口〉

KNOT_TUNNEL=1
KNOT_TUNNEL_SSH=knot-tunnel-〈id〉@〈边缘主机〉
KNOT_TUNNEL_KEY=$HOME/.ssh/knot-edge-〈id〉
KNOT_TUNNEL_REMOTE_PORT=〈端口〉
KNOT_TUNNEL_LOCAL_PORT=8080
```

`KNOT_EDGE=1` 在这里只为让 `deploy-site.sh` 装隧道常驻服务。**不要跑 `push-edge.sh`**——静态文件的归属由交付单 2.5 决定。

---

## 5. 探测契约

中枢在构建时对 `healthUrl` 发一次 `GET`（`ops/check-health.mjs`）。伙伴按这张表实现 `/api/health`。

| 项 | 要求 |
|----|------|
| 协议 | 必须 `https`，不得带 URL 用户名/密码 |
| 方法 | `GET`，不带 Cookie、不带令牌 |
| 重定向 | **不跟随**；3xx 记 `down` |
| 超时 | 5 秒 |
| 响应体 | 必须是 JSON 且 `ok === true`，否则 `bad_payload` |
| 判定 | ≤2 秒 `up`，>2 秒 `degraded` |

`healthUrl` 为 `null` 时不探测，运行状态 `unknown`。这是交接期的标准值。

---

## 6. 边界

中枢提供：入口页、站点档案、运行状态、热点橱窗、委托发信。

中枢不提供、也不代管：

- 私钥、边缘 sudo、伙伴的数据库与备份。
- 伙伴的内容、账号、积分、订单、审核。
- 自动签发子域、替伙伴改 DNS、替伙伴维持隧道。
- `instances.json` 之外的任何写入入口。

---

## 7. 常见卡点

1. **两个实例共用隧道账号会静默失败。** sshd 的 `Match` 首条匹配生效，同一个 `User` 写两段只有第一段算数；`PermitListen` 又只允许一个端口。第二个实例连上来占不到端口，`ExitOnForwardFailure=yes` 直接退出，日志里只有一行 `remote port forwarding failed`。必须一子域一账号一端口。
2. **以为整站都穿隧道。** 实际是静态文件读边缘磁盘，只有 `/api` 穿隧道。漏掉这点就没人负责推 WebUI 产物，页面打开只有接口能通。交付单 2.5 要写清静态由谁推。
3. **先填 `healthUrl` 再接通。** 门户先挂一个中断的实例。交接期用 `null`。
4. **reload 前没 `nginx -t`。** 边缘通常同时托管多个 `server_name`，一份坏 conf 带停一片。
5. **把内网地址写进清单。** 构建机在公网侧探测，`http://192.168.*` 只会得到 `down`。
6. **隧道只在终端里手动跑。** 断开后没人拉起。常驻服务是完成条件，不是可选项。
7. **隧道账号的登录 shell 设成 `nologin`。** `ForceCommand` 经登录 shell 执行，会话会立刻退出。登录限制靠 `PermitTTY no` + `PermitOpen none` + `ForceCommand`，不靠换 shell。
8. **只改清单，忘记名册。** `federation.json` 里没有对应 `id`，`npm run validate:federation` 直接失败，构建停下。两条一起加。

---

## 8. 完成定义

三条同时成立才算交付：

```bash
# 1. 边缘：端口被隧道账号持有
sudo ss -lntp | grep 〈端口〉

# 2. 公网：健康检查是 JSON 且 ok 为 true
curl -s https://〈子域〉/api/health

# 3. 中枢：运行状态为 up / degraded
cd xknot.si && node ops/check-health.mjs | grep 〈id〉
```

缺任何一条，`healthUrl` 保持 `null`，对外不宣告已收录完成。

---

## 9. 样例：zjj

2026-10-19 签发。实测：`/` 返回 `200 text/html` 占位页；`/api/health` 返回 `200 text/html`（SPA 兜底），会被判 `bad_payload`。

| 项 | 值 | 状态 |
|----|----|------|
| 实例 `id` | `zjj` | 已定 |
| 对外地址 | `https://zjj.xknot.si` | 已签发 |
| 连通方式 | 边缘 + 隧道（动态 IP） | 已定 |
| 边缘静态根 | `/var/www/zjj` | 已就绪 |
| 边缘 conf | 静态占位版，无 `/api` | 待补 |
| 隧道账号 | `knot-tunnel-zjj` | 待建 |
| 专属端口 | `18081` | 待分配 |
| 清单 `healthUrl` | 已置 `null`（交接期） | 已改 |
| 名册 `access` / `tunnel` | `pending` / `knot-tunnel-zjj:18081` | 已登记，待接通 |

逐步命令见 [`../../knot-platform/ops/edge/zjj-tunnel.md`](../../knot-platform/ops/edge/zjj-tunnel.md)。

---

## 10. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-10-19 | 1.0 | 首版：两段式交接、勾选清单、zjj 样例 |
| 2026-10-20 | 1.1 | 补交接示意图 `handoff-flow.svg`；阶段表加入运行状态；术语按 NAMING 统一（实例 / 伙伴 / 工作人员 / 运行状态）；补「仅隧道模式」标注与 `nologin` 卡点；增加完成定义；zjj 的 `healthUrl` 置 `null` |
| 2026-10-20 | 1.2 | 增加联邦名册 `federation.json`：交付单拆成清单与名册两张表，勾选清单补名册登记；卡点补「只改清单忘记名册」 |

---

## 11. 相关文件

| 路径 | 用途 |
|------|------|
| [JOIN.md](JOIN.md) | 申请、审核、两条轴、探测注意 |
| [FEDERATION.md](FEDERATION.md) | 中枢契约 |
| [HUB.md](HUB.md) | 中枢实现与运维 |
| [NAMING.md](NAMING.md) | 术语与写法 |
| [`../federation.json`](../federation.json) | 联邦名册：成员身份、子域来源、接入方式、隧道账号与端口 |
| [`../instances.json`](../instances.json) | 实例清单：门户对外字段 |
| [`../ops/validate-federation.mjs`](../ops/validate-federation.mjs) | 名册校验（与清单交叉核对） |
| [`../../knot-platform/ops/edge/README.md`](../../knot-platform/ops/edge/README.md) | 实例侧边缘与隧道配置 |
| [`../../knot-platform/ops/edge/subdomain-fixed-ip.md`](../../knot-platform/ops/edge/subdomain-fixed-ip.md) | 固定公网 IP 直连 |
| [`../../knot-platform/ops/edge/zjj-tunnel.md`](../../knot-platform/ops/edge/zjj-tunnel.md) | zjj 接通 runbook |
| `ops/check-health.mjs` | 健康探测实现（第 5 节的来源） |
