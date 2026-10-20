# XKnot 联邦 · 加入说明

版本 1.0，2026-10-19。仅文档，不改变运行配置。

契约见 [FEDERATION.md](FEDERATION.md)，中枢实现见 [HUB.md](HUB.md)，术语见 [NAMING.md](NAMING.md)。

本文回答两件事：**怎么申请进清单**，以及 **站点怎么对外可达**（自有域名 vs 签发子域；固定公网 IP 直连 vs 非固定 IP 走边缘隧道）。

---

## 0. 结论摘要

| 问题 | 结论 |
|------|------|
| 怎么加入 | 门户右侧填表 → 运营者在 `/admin/` 人工审核 → 通过后由人写进 `instances.json` → 重新构建门户。**申请不会自动上线。** |
| 要不要 `*.xknot.si` | **不必须。** 有自有域名时，清单里登记自己的 `https` 地址即可。`*.xknot.si` 由权利人签发，与代码授权无关。 |
| 固定公网 IP | 域名（自有或签发的 `*.xknot.si`）做 HTTPS，DNS 指到该主机；中枢按清单探测 `healthUrl`。 |
| 无固定公网 IP / 仅出网 | **不能**把 A 记录指到内网机，也**不是**传统 DDNS。靠**公网边缘 nginx + 本机主动 SSH 反向隧道**把流量接到实例。 |
| 私网地址 | 契约要求探测/拉取在解析 DNS 后拒绝回环、私网、链路本地与云元数据地址。`ops/check-health.mjs`、`ops/fetch-cards.mjs`、`ops/fetch-stats.mjs` 都走 `ops/fetch-guard.mjs`，命中即判 `down` / 保留上一份。**不要把 `healthUrl` 写成只在局域网可达的地址。** |

一句话分清两条轴：

1. **域名轴**：自有域名 ↔ 权利人签发的 `*.xknot.si`（可选）。
2. **连通轴**：固定公网 IP 直连 ↔ 非固定/NAT 走边缘隧道。

---

## 1. 接入流程（申请 → 审核 → 清单 → 上线）

加入是申请制，见 [FEDERATION.md](FEDERATION.md) 第 9 节与 [HUB.md](HUB.md) 第 9 节。

```text
门户右侧表单
    │  POST /api/applications
    ▼
var/xknot.db 申请队列（pending）
    │  运营者在 /admin/ 审核
    ▼
approved / rejected / hold
    │  仅 approved 可写清单
    ▼
npm run admin -- publish <申请编号>
    │  写入 instances.json
    ▼
npm run build（校验 + 探测 + 构建）
    │  可选：同步 web/dist 到边缘
    ▼
门户地图与目录出现该条目
```

### 1.1 申请

- 入口：中枢门户右栏「申请加入」（`web/src/components/JoinPanel.vue`）。
- 接口：`POST /api/applications`（`server/app.mjs`）。
- 字段（与 `server/validate.mjs` 一致）：站点名称、地址、一句话简介、运营者、联系邮箱、区域、时区、标签、同意勾选。
- 地址规则：申请阶段允许 `http(s)`；**写进清单时必须是 `https`**（`ops/validate-instances.mjs`）。
- 同一站点地址在 `pending` / `hold` / `approved` 时再次提交返回 `409 duplicate`。
- **提交时中枢不抓取你的站点**；只有审核通过并写进清单之后，构建时才会探测。

### 1.2 审核

- 审核台：`/admin/`（`admin/` 静态页 + `/api/admin/*`）。
- 动作：通过、拒绝、搁置（可带内部备注）。
- 通知：新申请会提醒管理员；通过或拒绝后，结果按申请表里的联系邮箱寄给申请人。搁置不发信，内部备注不对外。
- 账号：`npm run admin -- create-admin <用户名>`（`server/admin-cli.mjs`）。口令与会话密钥不入本文、不入版本库。

### 1.3 写进清单并上线

```bash
cd xknot.si
npm run admin -- publish XK-2026-XXXXXX          # 或加 --id custom-slug
# 再在 federation.json 补同名 id 的成员，然后：
npm run validate:federation
npm run build                                    # 校验、探测、构建
# 可选远端同步：见 ops/README-deploy-aws.md、ops/deploy-hub.sh
```

`publish` 默认生成（`server/manifest.mjs`）：

| 字段 | 默认 |
|------|------|
| `tier` | `community` |
| `status` | `active` |
| `healthUrl` | `<url>/api/health` |
| `statsUrl` / `cardsUrl` | `null`（可选，后续再改清单） |
| `languages` | `["en"]` |

`publish` 只写 `instances.json`。成员事实（身份、子域来源、接入方式、隧道账号与端口）记在同目录的 `federation.json`，要另行补一条同名 `id` 的成员；两份文件对不上时构建会停下。

审核通过**不会**自动签发子域、不会自动改 DNS、不会自动开隧道。需要二级域名时，由工作人员在权利人流程里另行确认并赋予（见第 3 节）。

### 1.4 与「赋予二级域名」的关系

| 步骤 | 谁做 | 说明 |
|------|------|------|
| 申请加入 | 伙伴 | 门户填表 |
| 确认收录 | 工作人员 | `/admin/` 审核通过 |
| 写联邦条目 | 工作人员 | `publish` 或手工改 `instances.json` |
| 赋予 `*.xknot.si`（若适用） | 权利人 / 工作人员 | DNS + 边缘 nginx（或直连主机）；**不是申请接口的自动副作用** |
| 构建与发布门户 | 工作人员 | `npm run build` 与部署脚本 |

签发之后到实例真正接通的交接（工作人员交付哪些信息、伙伴做哪些动作）见 [HANDOFF.md](HANDOFF.md)。**签发 ≠ 接通**：此时边缘通常只有静态占位页，清单里若已填 `healthUrl`，探测会记 `down`。

`*.xknot.si` 归 PaulWang 所有，由权利人签发；见 README「归属与许可」与 [FEDERATION.md](FEDERATION.md) 第 8 节。

---

## 2. 情况一：有自有域名（不必用 xknot 子域）

适用：伙伴已有 `https://example.com`（或任意自有主机名），站点已对外可达。

做什么：

1. 按第 1 节提交申请；表单「地址」填自有站点的公开 HTTPS URL。
2. 审核通过后写入 `instances.json`：`url` / `canonical` 指向自有域名；**不要求**再申请 `xxx.xknot.si`。
3. 保证实例提供 `GET /api/health`（或在清单里改 `healthUrl` 为实际探测地址），满足第 4 节。
4. （可选）以后再填 `statsUrl`、`cardsUrl`；橱窗拉取脚本为 M2，见 [HUB.md](HUB.md) 第 6 节。

字段含义摘要（完整表见 [FEDERATION.md](FEDERATION.md) 第 4.2 节）：

| 字段 | 含义 |
|------|------|
| `url` | 中枢入口上展示/跳转用的地址 |
| `canonical` | 真实站点地址（可与 `url` 相同） |
| `redirect` | 有值时中枢侧只做 301，不展示为独立条目 |
| `healthUrl` | L2 探测地址；空则不探测，状态为 `unknown` |

`redirect` 是给「同一个站有多个入口」用的：清单里保留一个规范条目，其余入口只写 `redirect` 指向它。当前清单没有这种条目，`url` 就是真实站点地址。

---

## 3. 情况二：没有自有域名，使用 xknot

适用：希望用权利人签发的 `某名.xknot.si` 作为对外主机名。

前提：

- 工作人员审核通过并同意签发该子域（人工，非自助 API）。
- 子域签发后，再决定**连通方式**（固定 IP 直连，或边缘 + 隧道）。

### 3.1 主机有固定公网 IP

```text
浏览器 ──HTTPS──▶ 伙伴主机（公网 IP）
                     Knot 实例监听 443/反代
DNS: 某名.xknot.si  A/AAAA → 该公网 IP
```

落地要点：

1. 工作人员签发 `某名.xknot.si`，DNS 指到伙伴主机公网 IP。
2. 主机上自行配置 TLS（Let’s Encrypt 等）与反向代理到 Knot Backend / WebUI。这类配置与自营站点相同，见实例仓库的 [ops/edge/README.md](../../knot-platform/ops/edge/README.md) 与 [subdomain-fixed-ip.md](../../knot-platform/ops/edge/subdomain-fixed-ip.md)。
3. 清单里 `url`、`canonical`、`healthUrl` 使用该 `https://某名.xknot.si/...`。
4. 中枢构建时对公网 `healthUrl` 探测；与边缘隧道无关。

**不要**把签发子域的 A 记录指到 RFC1918 / 链路本地地址——公网解析不到，探测也会失败。

### 3.2 主机无固定公网 IP（或仅出网 / NAT 后）

需要一台公网边缘机持证书与静态文件，实例主动连出建反向隧道。**这是实例侧的部署形态，不属于中枢**；具体配置与命令在实例仓库的 [ops/edge/README.md](../../knot-platform/ops/edge/README.md)。

```text
浏览器 ──HTTPS──▶ 公网边缘（nginx + 证书）
                     ├── /、/assets/ ──▶ 边缘磁盘 /var/www/<id>（静态）
                     └── /api/、/help ─▶ 127.0.0.1:18081
                                              │  边缘 sshd 上的回环端口
                                              ▼
                                     反向隧道（实例主动连出）
                                              ▼
                           NAT 后的实例 127.0.0.1:8080（Knot Backend）
```

**静态在边缘，只有动态走隧道。** 漏掉这一点，就没有人负责把 WebUI 产物推到边缘，页面上线后只有接口能通。

中枢这边只关心三件事：

| 项 | 要求 |
|----|------|
| 不是什么 | **不是**把 DNS A 指到家里的内网 IP；**不是**传统 DDNS 客户端改 A 记录 |
| 是什么 | 边缘持公网 IP 与证书；实例用 SSH 远程转发，把边缘回环端口接到本机服务 |
| 清单 | `healthUrl` 必须是**公网 HTTPS**（经边缘可达），不能写 `http://192.168.…` 或 `http://127.0.0.1:…` |
| 密钥 | 只在运行机 `~/.ssh/`，**不进仓库、不写本文** |

签发子域的工作人员另外要把该子域的 DNS 指到边缘公网 IP，并在边缘加一份 `server` 块。模板与步骤见 [ops/edge/README.md](../../knot-platform/ops/edge/README.md)；通配多租户自动 server 未做（见第 6 节）。

`ops/README-deploy-aws.md` 注明：隧道用户 `knot-tunnel@` 需在边缘机另行开通后再用隧道；边缘主机由部署配置给出，仓库里不写默认值。

**每个子域要有自己的隧道账号和回环端口，不能与同机已有实例共用**——`Match` 首条匹配生效，`PermitListen` 也只允许一个端口。逐项交接见 [HANDOFF.md](HANDOFF.md)。

---

## 4. 联邦探测注意（healthUrl）

中枢 L2 由构建步骤 `ops/check-health.mjs` 执行（无常驻巡检进程）。

### 4.1 实例侧应满足

| 项 | 要求 |
|----|------|
| 方法 | `GET`，响应 `Content-Type` 可解析为 JSON |
| 成功体 | `{ "ok": true, "service": "…", "version": "…" }`（`ok === true` 为硬条件） |
| URL | 清单里 `healthUrl` 必须是 **https**，不得带 URL 用户名/密码 |
| 重定向 | 中枢**不跟随**重定向；3xx 记为 `down` |
| 超时 | 5 秒；≤2 秒为 `up`，>2 秒为 `degraded` |
| 凭据 | 中枢不带 Cookie、不带令牌 |

`status` 非 `active` 的条目不探测。`healthUrl` 为空则状态 `unknown`，合法。

### 4.2 私网与不可达地址

| 层级 | 现状（以仓库为准） |
|------|-------------------|
| 契约 | [FEDERATION.md](FEDERATION.md) §6.6 / §8：探测与拉取在解析 DNS 后拒绝回环、私有网段、链路本地、云元数据地址 |
| L2 实现 | `ops/check-health.mjs` 强制 `https`、禁重定向、超时、`ok === true`，并经 `ops/fetch-guard.mjs` 拒绝私网地址 |
| L3 / 活动数据 | `ops/fetch-cards.mjs` 与 `ops/fetch-stats.mjs` 使用同一份守卫；失败保留上一份，不影响构建 |

实务结论：**清单不应登记仅内网可达的 `healthUrl`**——构建机在公网侧解析与探测，内网地址会被判 `private_address` 或 `down`。走隧道的实例应暴露边缘上的公网 HTTPS 健康检查路径。

### 4.3 申请地址 vs 探测地址

- 申请表里的站点地址：**接收时不抓取**。
- 写入 `instances.json` 并构建后：才对 `healthUrl`（及将来的 `cardsUrl`）主动 GET。

---

## 5. 与中枢 / 边缘 / 实例的职责边界

| 角色 | 负责 | 不负责 |
|------|------|--------|
| **中枢**（`xknot.si`） | `instances.json`、申请队列与审核台、构建时 L2 探测、门户静态站 | 用户账号、内容、积分、订单；托管伙伴站点；自动签发子域；替伙伴开隧道 |
| **边缘**（公网机上的 nginx / sshd） | 证书、对外 HTTPS、把动态请求反代到隧道端口或本机静态目录；隧道用户隔离 | 业务库；审核联邦申请；改 `instances.json` |
| **实例**（伙伴 Knot，用 `knot-platform` 部署） | 自有部署、库、上传、账号、审核、证书（直连时）或维持隧道（NAT 时）、提供 `/api/health` 与可选橱窗 | 改中枢清单；要求中枢代管内容 |

两边的代码与脚本分开存放：中枢的部署文件在本文同级的 `ops/`；实例的部署文件在 [`knot-platform/ops/`](../../knot-platform/ops)（`edge/` 下是边缘配置）。中枢不引用实例的文件，实例也不引用中枢的文件；本文只做策略说明与跳转。

- 中枢 nginx：`ops/xknot.si.conf`；中枢部署笔记：`ops/README-deploy-aws.md`
- 实例边缘：`../../ops/edge/README.md`、`../../ops/edge/subdomain-fixed-ip.md`

收费与子域服务不在中枢订单链路里发生（见 README「收录与收费」）。

---

## 6. 未实现 / 另任务（勿当成已上线）

| 项 | 状态 |
|----|------|
| 申请通过后自动签发 `*.xknot.si` | **未实现**；人工确认 + 权利人签发 |
| 传统 DDNS（客户端改 A 到当前出口 IP） | **不做**；NAT 场景用边缘 + SSH 反向隧道 |
| 单子域边缘 nginx 模板（`wang.xknot.si`） | **已有**：[`ops/edge/wang.xknot.si.conf`](../../knot-platform/ops/edge/wang.xknot.si.conf)（实例侧）；步骤见 [`ops/edge/README.md`](../../knot-platform/ops/edge/README.md)；固定 IP 见 [`ops/edge/subdomain-fixed-ip.md`](../../knot-platform/ops/edge/subdomain-fixed-ip.md) |
| 通配多租户 `*.xknot.si` 边缘 nginx | **未做**；每签发子域仍手工一份 conf，不能自动按 Host 分租户 |
| 中枢站点 HTTPS / NS 切换细节 | 见 `ops/README-deploy-aws.md`；证书与部分 DNS 步骤标为另任务 |

## 7. 委托发信（可选）

自己的 SMTP 难送达时，可以把通知信交给中枢代发。契约在 [FEDERATION.md](FEDERATION.md) 第 7 节。

| 项 | 说明 |
|----|------|
| 前提 | 实例已在清单里且 `status: active`；中枢已配 SMTP |
| 怎么开通 | 向运营方要一份发信凭据，由中枢命令行签发，明文只给一次 |
| 实例配置 | `XKNOT_HUB_RELAY_URL=https://xknot.si/api/federation/mail`、`XKNOT_HUB_RELAY_TOKEN=…` |
| 发信人 | 恒为中枢的 `MAIL_FROM`，实例不能覆盖 |
| 回信 | `Reply-To` 必须落在实例自己的域名；省略时用清单里的 `contact` |
| 内容 | 只发纯文本，≤4000 字，不收附件、HTML、抄送与密送 |
| 额度 | 默认每 24 小时 50 封，可调；单凭据每分钟 6 封 |
| 记录 | 中枢只留收件域名、地址哈希与结果，不留正文 |
| 停用 | 运营方 `relay-revoke <instance>` 即刻生效；不影响实例其他功能 |

退信与投诉由实例自己盯。滥发会导致与中枢共用的发信域一起被降权，凭据会被直接吊销。

---

## 8. 相关文件速查

中枢侧（本目录 `xknot.si/`）：

| 路径 | 用途 |
|------|------|
| `instances.json` | 联邦清单唯一真源 |
| `docs/HANDOFF.md` | 子域签发到实例接通的交付单模板（一子域一账号一端口） |
| `server/app.mjs` / `validate.mjs` / `manifest.mjs` / `admin-cli.mjs` | 申请、校验、生成条目、写入清单 |
| `admin/` | 审核台 |
| `ops/check-health.mjs` | L2 探测 |
| `ops/validate-instances.mjs` | 清单校验 |
| `ops/build-hub.sh` / `deploy-hub.sh` | 构建与静态站同步 |
| `ops/deploy-api.sh` | 接口、审核台与站点配置的同步 |
| `ops/xknot.si.conf` | 门户的 nginx |

实例侧（仓库根的 `ops/`，属于用 `knot-platform` 部署的站点）：

| 路径 | 用途 |
|------|------|
| `ops/edge/README.md` | 边缘 + 隧道落地 |
| `ops/edge/wang.xknot.si.conf` | 单子域 nginx 模板（隧道反代） |
| `ops/edge/subdomain-fixed-ip.md` | 固定公网 IP 直连 runbook |
| `ops/edge/sshd-tunnel.conf.template` | 边缘隧道账号的 sshd 配置 |

密钥、口令、PEM 路径只写在各机私有环境与 `~/.ssh/`，本文与版本库均不收录。
