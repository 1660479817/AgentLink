# XKnot 联邦 · 加入说明

版本 2.0，2026-10-20。仅文档，不改变运行配置。

契约见 [FEDERATION.md](FEDERATION.md)，中枢实现见 [HUB.md](HUB.md)，术语见 [NAMING.md](NAMING.md)。

本文回答两件事：**怎么申请进清单**，以及 **签发之后怎么接通**。接入只有一种形态：中枢签发 `<标签>.xknot.si`，入口主机 + SSH 反向隧道。

---
## 0. 结论摘要

| 问题 | 结论 |
|------|------|
| 怎么加入 | 先在本机部署实例 → 打开 `/admin` → 填自述、选子域标签并提交 → 平台当场核对并签发子域，**提交即通过** → 运营方写进 `instances.json` → 接通验收 → 重新构建门户。**通过不等于上线。** |
| 要提供域名吗 | 不用。地址由中枢签发：`<标签>.xknot.si`，标签 6–32 位。已经有自有域名的站点不需要走联邦这一步。 |
| 身份是什么 | 清单里的 `url`，只有这一个地址，签发了就不再变。换机器、换 IP 只重连隧道、改解析，不改 `url`。 |
| 接入形态 | 只有一种：中枢签发 `<标签>.xknot.si`；隧通之前入口发占位页，通了之后整站（含 `/`）都经**本机主动连出的 SSH 反向隧道**回到实例。名册 `mode` 恒为 `subdomain`，`tunnel` 必填。 |
| 自有域名 | 不登记、不签发、不跳转。站点有自有域名时，它自己就是入口，联邦这一步可以略过。 |
| 私网地址 | 契约要求探测/拉取在解析 DNS 后拒绝回环、私网、链路本地与云元数据地址。`ops/check-health.mjs`、`ops/fetch-cards.mjs`、`ops/fetch-stats.mjs` 都走 `ops/fetch-guard.mjs`，命中即判 `down` / 保留上一份。**不要把 `url` 写成只在局域网可达的地址**——探测地址由它推出。 |
| 断连会怎样 | 连续 24 小时探测不到 → 邮件提醒；连续 7 天 → 邮件通知并从门户暂时隐藏；恢复探测后自动回来。收录后一直没验收：14 天提醒，30 天暂时隐藏。见第 5 节。 |

一句话：**地址就是身份，地址由中枢签发。** 接入形态只有一种，没有第二条轴，也没有跳转。

---

## 1. 接入流程（申请 → 通过 → 清单 → 上线）

加入是申请制，见 [FEDERATION.md](FEDERATION.md) 第 9 节与 [HUB.md](HUB.md) 第 9 节。

整个流程只碰一次面：申请时把公钥交上来，所以申请通过后中枢能一个人把配置做完，然后才是交换点 A。细则见 [HANDOFF.md](HANDOFF.md)。

```text
伙伴：实例 /admin（子域标签 + 站点档案）→ 在 /case/<caseKey> 贴 .pub
    │  POST /api/applications → 当场 approved（reviewed_by=auto）
    ▼
批准信与运营方提醒同时寄出
    │
    ▼
中枢前置（不需要伙伴在场，一次做完）
    │  写清单 status: pending · 写名册 mode/tunnel · 分配账号与端口
    │  DNS · 证书 · 静态根与占位页 · 子域 conf（只静态）
    │  建账号 · 装公钥 · sshd Match · 接入件与领取链接 · 交付信
    ▼
交换点 A（唯一一次碰面）
    │  中枢给：账号、端口、入口主机、领取链接、公钥指纹
    │  伙伴给：本机 {"ok":true,...} 回执
    ▼
收尾（两边各做各的，不再等答复）
    │  伙伴起隧道 + 常驻；中枢把 / 与 /api 一起接到隧道
    │  探测通过 → status: active → npm run build
    ▼
门户地图与目录出现该条目
```

### 1.1 申请

- 入口：实例自己的 `/admin`，「接入 XKnot」一块（`knot-platform/admin/index.html`），由实例代交中枢的 `POST /api/admin/xknot/apply`。
- 中枢门户右栏不再收申请表：那里是「登录你的 XKnot」与四步加入指引（部署 → `/admin` → 选子域提交 → 提交即通过），已经开通的主理人从这里看本站状态、健康与活动计数。
- 接口：`POST /api/applications`（`server/app.mjs`）。直接调也可以，字段与从实例代交时一致。
- 子域先查一次：`GET /api/subdomains/check?label=` 返回 `available`、`reason`（`too_short` / `too_long` / `format` / `reserved` / `taken` / `ok`）与候选建议。实例的 `/admin` 里就是「检查」按钮。
- 字段（与 `server/validate.mjs` 一致）：
  - **子域标签** `subdomain`：**6–32 位**小写字母、数字与连字符，首尾不能是连字符。少于 6 位一律不签：短号留给以后，不当第一批发出去。系统保留名（`www`、`api`、`admin`、`mail`、`xknot` 等）不签发。
  - 站点名称、一句话简介、运营者、联系邮箱、区域、时区、标签、同意勾选。这些只用于审核与联系：**不写进清单**。上线后由主理人在自己实例的 `/admin` 里填进站点档案（自述区），中枢按 `GET /api/federation/profile` 取回。
  - 门户上显示的区域由中枢按你这条隧道的出口 IP 判定，不取申请时填的那个：机器换到另一个城市或机房，页面会跟着变。填错不影响接入，只在隧道没连上时用来兜底。
  - `mode` 与 `domain` 已停用。仍带着 `mode: "own-domain"` 或非空 `domain` 的请求返回 `400`，字段错误码是 `not_supported`，不会悄悄当成签发申请。
  - 校验失败时 `fields` 里的子域错误码与预检一致：`required` / `too_short` / `too_long` / `format` / `reserved`。
- 申请阶段中枢**不抓取**任何站点。
- 同一标签在 `approved` 时再次提交返回 `409 duplicate`；撤回之后可以再交一张单，用于补服务或换标签。
- 提交后中枢立刻寄两封：给申请人的批准信（含子域地址、档位与 `/case/<caseKey>` 链接）与给运营方的新申请提醒。邮件不接收回复，需要动作时一律走案例页链接。

### 1.2 提交即通过

- 平台在收到申请时核对字段并查重，通过后直接把申请写成 `approved`，`reviewed_by` 记 `auto`。没有待审队列、没有邮箱确认关卡。
- 子域当场签发，批准信立刻寄出：地址、当前档位（默认 `free`）与 `/case/<caseKey>` 链接都在信里。
- **顺手把公钥贴上来**：案例页有 `ssh-ed25519 …` 的输入框。这是前置阶段的唯一输入——中枢拿到它才能在通过后一次把账号、`authorized_keys` 与 sshd 配置做完，不必再问一次。
- 申请期间的状态、提交公钥与撤回都在 `/case/<caseKey>`：链接在每封信里，持有即可操作，不要转发。
- 归属验证已取消：申请时子域尚未签发，没有需要申请人自证的东西。真正的验收是接通后的公网 `/api/health` 探测。

### 1.3 控制台（只读记录与运维）

- 控制台：`/admin/`（`admin/` 静态页 + `/api/admin/*`）。详情里直接显示地址、档位、公钥、隧道账号与联系邮箱。
- **没有审核动作**：申请提交即通过。控制台只做记录查看、实例配置、清单条目生成、探测与发信观察。
- 通知：提交时寄一封批准信给申请人、一封新成员提醒给运营方；后续签发、交付、上线、断连等按事件寄信。内部备注不对外。完整的事件与三语文案见 [PARTNER-MAIL.md](PARTNER-MAIL.md)。
- 账号：`npm run admin -- create-admin <用户名>`（`server/admin-cli.mjs`）。口令与会话密钥不入本文、不入版本库。
- 补发任意一封：`npm run admin -- notify <申请编号> <event>`。

### 1.4 写进清单并上线

```bash
cd xknot.si
npm run admin -- publish XK-2026-XXXXXX \
  --tunnel-account knot-tunnel-cpswang --tunnel-port 18090   # 清单与名册一起写
npm run validate:federation
npm run build                                    # 校验、探测、构建
# 可选远端同步：见 ops/README-deploy-aws.md、ops/deploy-hub.sh
```

`publish` 默认生成（`server/manifest.mjs`）：

| 字段 | 默认 |
|------|------|
| `id` | 子域标签（冲突时用 `--id` 另指定） |
| `url` | `https://<标签>.xknot.si`，由标签拼成 |
| `tier` | `free` |
| `status` | `pending`（已收录、未验收；`/api/health` 通过后改成 `active`） |
| `statsUrl` / `cardsUrl` | `null`（可选，后续再改清单） |

名称、介绍、语种、标签这些不在清单里：`publish` 只写签发区。伙伴接通后要提醒他打开自己实例的 `/admin` → **XKnot**，把站点档案填好；不填时门户用签发区字段与兜底文案显示。

`publish` 同时写 `instances.json` 与 `federation.json`：成员事实（`mode` 恒为 `subdomain`、`tunnel` 的账号与端口）由 `--tunnel-account` / `--tunnel-port` 给出，`host` 取 `url` 的主机名，两份文件都通过校验才落盘。只给清单不给隧道参数时，名册仍会缺这一条，构建会停下。

申请通过**不会**自动改 DNS、不会自动开隧道。工作人员按权利人流程签发（见第 2 节）。

### 1.5 前置、交换与收尾

通过之后不是「一步一步换消息」，而是中枢先做完，再碰一次面。

**现在默认由常驻进程自动完成。** `xknot-provision`（`ops/provision-worker.mjs`）每 20 秒扫一次：已通过、已交公钥、还没有接通记录的申请，会建一条 run，然后逐项推进 `allocate → publish → account → sshd → static → dns → vhost → tls`。每一步都幂等，失败只记错误码并留在原地重试。做完后进入 `awaiting_tunnel`，探测到 `https://<子域>/api/health` 通过就把入口 conf 从占位页改成整站反代，再把清单里的 `status` 改成 `active`。

| 段 | 谁做 | 做完的标志 |
|----|------|------------|
| 前置 | 中枢（自动） | 清单 `pending` 与名册成员写好；账号、端口、静态页、子域 conf、公钥、sshd `Match`、DNS 检查、证书全部就绪 |
| 交换点 A | 实例来取 | 实例按案例键读 `GET /api/case/<key>/progress`，在 `handoff` 里拿到入口主机、账号与端口，写进 `sites/<站点>/tunnel.env` 并起隧道；`issued` 里有签发的 id、地址、档位与日期 |
| 收尾 | 中枢（自动） | 探测通过后把 `status` 改成 `active`；`XKNOT_AFTER_ACTIVATE` 可挂重建门户的命令 |
| 收尾 | 实例（自动） | 看到 `run.state = active` 后把 `issued` 写成 `sites/<站点>/xknot.env`，重启 Backend；`/api/federation/profile` 从此有内容 |

**通讯方向。** 实例在 NAT 后，中枢拨不进去。所有动作都是实例连出：交公钥、读进度、取交接参数。案例键本身就是能力凭据，不再另发领取链接。

**唯一的外部前提是 DNS。** 入口域名要有一条泛解析 `*.xknot.si → 入口公网 IP`；没有它，`dns` 这一步会一直报 `dns_missing`，错误码直接显示在实例管理界面的 XKnot 栏里。

前置之所以能一口气做完，是因为**公钥在申请阶段就交了**（第 1.2 节）。实例侧现在会自动生成密钥并提交，不需要人去案例页贴。

**收录 ≠ 接通**：写进清单时 `status` 是 `pending`，不探测、不上门户；验收通过后才改成 `active`。细则见 [HANDOFF.md](HANDOFF.md)。

手动补跑的场合（worker 停着、要把某一张单重来）：`node ops/provision-worker.mjs` 按同一套步骤跑；或者按 [HANDOFF.md](HANDOFF.md) 的十项清单一个人做完。

`*.xknot.si` 归 PaulWang 所有，由权利人签发；见 README「归属与许可」与 [FEDERATION.md](FEDERATION.md) 第 8 节。

## 2. 接通：入口主机 + 反向隧道

适用：实例在一台通常没有固定公网 IP 的机器上（家宽、NAT 后、只能主动出网），由中枢签发子域并接到入口。

需要一台公网入口主机持证书与静态文件，实例主动连出建反向隧道。**这是实例侧的部署形态，不属于中枢**；具体配置与命令在实例仓库的 [ops/entry/README.md](../../knot-platform/ops/entry/README.md)。

```text
浏览器 ──HTTPS──▶ 公网入口（nginx + 证书）
                     ├── /、/assets/ ──▶ 入口主机上的磁盘 /var/www/<id>（静态）
                     └── /api/ ─▶ 127.0.0.1:18081
                                              │  入口 sshd 上的回环端口
                                              ▼
                                     反向隧道（实例主动连出）
                                              ▼
                           NAT 后的实例 127.0.0.1:8080（Knot Backend）
```

**静态在入口主机，只有动态走隧道。** 漏掉这一点，就没有人负责把 WebUI 产物推到入口主机，页面上线后只有接口能通。

中枢这边只关心三件事：

| 项 | 要求 |
|----|------|
| 不是什么 | **不是**把 DNS A 指到家里的内网 IP；**不是**传统 DDNS 客户端改 A 记录 |
| 是什么 | 入口持公网 IP 与证书；实例用 SSH 远程转发，把入口回环端口接到本机服务 |
| 清单 | `url` 必须是**公网 HTTPS**（经入口可达），不能写 `http://192.168.…` 或 `http://127.0.0.1:…`；探测地址由它推出 |
| 密钥 | 只在运行机 `~/.ssh/`，**不进仓库、不写本文** |
| 名册 | `mode: "subdomain"`，`tunnel: { account, port }` 必填，不允许为空 |

这一段里的 DNS、证书、静态根、`server` 块、隧道账号与端口，**全部是中枢在交换点 A 之前一个人做完的**，不需要伙伴在场或先做点什么。伙伴唯一要在审核前交的是公钥。顺序与十项清单见 [HANDOFF.md](HANDOFF.md) 第 3 节。模板与步骤见 [ops/entry/README.md](../../knot-platform/ops/entry/README.md)；通配多租户自动 server 未做（见第 6 节）。

`ops/README-deploy-aws.md` 注明：隧道用户 `knot-tunnel@` 需在入口主机另行开通后再用隧道；入口主机由部署配置给出，仓库里不写默认值。

**每个子域要有自己的隧道账号和回环端口，不能与同机已有实例共用**——`Match` 首条匹配生效，`PermitListen` 也只允许一个端口。逐项交接见 [HANDOFF.md](HANDOFF.md)。

### 2.1 换 IP

IP 变了不需要改任何清单字段：实例重新连出、入口主机的回环端口不变，探测自动恢复。家里换了网络也同理。

换**子域标签**等于换身份，不是改一个字符串：

1. 伙伴发邮件给运营方（`manwjh@gmail.com`），写清实例 id、新标签与原因。
2. 工作人员按新申请重签，改 `instances.json` 的 `url` 与 `federation.json` 的 `host`，跑 `npm run validate:federation`。
3. 旧子域按权利人流程回收；门户重新构建后条目指向新地址。

地址一变就不做 301 过渡，旧地址上的链接会断。请尽量在第一次提交时把标签定好。

---

## 3. 联邦探测注意（`/api/health`）

中枢 L2 由两处执行：构建时 `ops/check-health.mjs`，以及常驻定时器 `ops/watch-health.mjs`（每 15 分钟一次，见第 5 节）。

### 3.1 实例侧应满足

| 项 | 要求 |
|----|------|
| 方法 | `GET`，响应 `Content-Type` 可解析为 JSON |
| 成功体 | `{ "ok": true, "service": "…", "version": "…" }`（`ok === true` 为硬条件） |
| URL | 恒为 `url` + `/api/health`（`ops/probe-target.mjs` 推出）；`url` 必须是 **https**，不得带 URL 用户名/密码 |
| 重定向 | 中枢**不跟随**重定向；3xx 记为 `down` |
| 超时 | 5 秒；≤2 秒为 `up`，>2 秒为 `degraded` |
| 凭据 | 中枢不带 Cookie、不带令牌 |

`status` 非 `active` 的条目不探测。清单 `status` 仍是 `pending`（已收录、未验收）时不探，状态 `unknown`，合法。

### 3.2 私网与不可达地址

| 层级 | 现状（以仓库为准） |
|------|-------------------|
| 契约 | [FEDERATION.md](FEDERATION.md) §6.6 / §8：探测与拉取在解析 DNS 后拒绝回环、私有网段、链路本地、云元数据地址 |
| L2 实现 | `ops/check-health.mjs` 强制 `https`、禁重定向、超时、`ok === true`，并经 `ops/fetch-guard.mjs` 拒绝私网地址 |
| L3 / 活动数据 | `ops/fetch-cards.mjs` 与 `ops/fetch-stats.mjs` 使用同一份守卫；失败保留上一份，不影响构建 |

实务结论：**清单的 `url` 不能是仅内网可达的地址**——探测机在公网侧解析与探测，内网地址会被判 `private_address` 或 `down`。走隧道的实例应让入口把 `/api` 反代过隧道，探测的仍是 `https://<子域>/api/health`。

### 3.3 申请地址 vs 探测地址

- 申请表里的子域标签：只是登记地址，**接收时不解析、不抓取**。
- 写入 `instances.json` 并把 `status` 改成 `active` 之后：才对 `url` + `/api/health`（及将来的 `cardsUrl`）主动 GET。

---

## 4. 断连监测与暂时隐藏

`ops/watch-health.mjs` 每 15 分钟跑一次探测，把结果与连续时长写进 `var/health.json`，并按下面的规则发信。**`instances.json` 不会被自动改动**；隐藏是门户渲染时的一次判断。

| 情况 | 触发 | 动作 |
|------|------|------|
| 连续不可达 24 小时 | `downSince` 起算 | 给实例 `contact` 寄提醒，说明地址、首次失败时间、恢复后自动回列表 |
| 连续不可达 7 天 | `downSince` 起算 | 寄「已从联邦列表暂时关闭」，门户不再展示该条目 |
| 恢复 | 任意一次探测 `up` / `degraded` | 清空计时与隐藏标记，条目自动回到列表，**不需要重新申请** |
| 收录后 14 天仍未验收 | 清单 `since` 起算，且 `status` 仍为 `pending` | 给运营方内部提醒，请人跟进交接 |
| 收录后 30 天仍未验收 | 同上 | 从门户暂时隐藏，并内部提醒 |

要点：

- 每条通知只发一次，记在 `var/health.json` 的 `notified` 里；重复运行不会重复发信。
- 隐藏不影响实例本身：库、账号、内容、积分都还在伙伴机器上，清单条目也保留。
- 需要人工核对或恢复，写信给运营方 `manwjh@gmail.com`。
- 没有配 SMTP 时脚本照常写状态，只是不发信；这一类记录会出现在日志里。
- `--dry-run` 只探测与打印，不写状态、不发信，避免预览把待发标记吃掉。

实现：`ops/watch-health.mjs`（发信与调度）、`ops/check-health.mjs`（探测与状态机）。定时器：`ops/xknot-health.service`、`ops/xknot-health.timer`。

---

## 5. 与中枢 / 入口 / 实例的职责边界

| 角色 | 负责 | 不负责 |
|------|------|--------|
| **中枢**（`xknot.si`） | `instances.json`、申请记录与控制台、探测与断连通知、门户静态站 | 用户账号、内容、积分、订单；托管伙伴站点；替伙伴部署或维护隧道 |
| **入口主机**（公网机上的 nginx / sshd） | 证书、对外 HTTPS、静态页、把 `/api` 反代到隧道端口；隧道用户隔离 | 业务库；审核联邦申请；改 `instances.json` |
| **实例**（伙伴的 Knot，当前实现是 `knot-platform`） | 自有部署、库、上传、账号、审核、维持隧道、提供 `/api/health` 与可选橱窗 | 改中枢清单；要求中枢代管内容 |

两边的代码与脚本分开存放：中枢的部署文件在本文同级的 `ops/`；实例的部署文件在 [`knot-platform/ops/`](../../knot-platform/ops)。中枢不引用实例的文件，实例也不引用中枢的文件；两边只以 HTTP 契约与接入件相连，本文只做策略说明与跳转。换一个实例实现（Go、Rust、别的语言）不影响中枢的代码、清单和探测。

**中枢主机与入口主机可以是同一台机器，当前部署就是这样。** 角色的归属不因为同机而合并：中枢的配置归 `xknot.si/ops/`，入口的配置归实例侧 `knot-platform/ops/entry/`。同机时最容易犯的错，是拿入口的 nginx 配置去改中枢站点，或反过来。完整的概念图与归属见 [`docs/concepts.md`](../../docs/concepts.md)。

**入口按范围分两处**：可复用的模板在 [`knot-platform/ops/entry/`](../../knot-platform/ops/entry/)（任何实例都能用）；中枢已签发子域的具体 conf 与接通 runbook 在 [`xknot.si/ops/entry/`](../ops/entry/)（写死域名，只有中枢工作人员会改）。

- 中枢 nginx：`ops/xknot.si.conf`；中枢部署笔记：`ops/README-deploy-aws.md`
- 公网入口模板（实例侧）：`../../knot-platform/ops/entry/README.md`
- 已签发子域的入口（中枢侧）：`../ops/entry/`，只放需要手工维护的 conf 与 runbook；`cpswang` 由自动接通写入，不在仓库里

收费与子域服务不在中枢订单链路里发生（见 README「收录与收费」）。

---

## 6. 未实现 / 另任务（勿当成已上线）

| 项 | 状态 |
|----|------|
| 自动通过 / 案例页 / 一次性领取页 | **已实现**：提交即 `approved`、`/case/<caseKey>`、`/claim/<token>`；邮箱确认关卡已移除 |
| 地址校验 | **已实现**：`server/validate.mjs`（子域标签 6–32 位、保留名、同标签查重；`mode` / `domain` 已停用） |
| 子域标签预检 | **已实现**：`GET /api/subdomains/check`；`ops/subdomain.mjs` 判长度、保留名、占用，并给候选 |
| 成员登录（邮箱 + 授权码） | **已实现**：`/api/member/code`、`/api/member/session`、`/api/member/logout`；门户右栏显示本站状态、健康、活动计数与橱窗条数 |
| 断连提醒与暂时隐藏 | **已实现**：`ops/watch-health.mjs` + `ops/check-health.mjs` |
| 免费 / 收费档位 | **已实现**：清单 `tier` 为 `free` / `paid`（`demo` 仅样例），默认 `free`，运营方手动升级 |
| 申请通过后自动签发 DNS | **未实现**；人工按权利人流程签发 |
| 传统 DDNS（客户端改 A 到当前出口 IP） | **不做**；NAT 场景用入口 + SSH 反向隧道 |
| 签发子域 + DNS 指到伙伴自己的固定 IP（不走隧道） | **不支持**：接入只有「入口主机 + 反向隧道」一种形态，这一组合两头都不算，`validate-federation.mjs` 会拒绝。要固定 IP 就用自有域名自建站点，不走联邦 |
| 单子域入口配置 | **已有**（实例侧）：入口与 nginx 由实例实现自己渲染。当前实现是 `knot-platform`：入口文件 [`sites/_template/entry.example.env`](../../knot-platform/sites/_template/entry.example.env)，模板 [`knot-platform/ops/entry/site.conf.template`](../../knot-platform/ops/entry/site.conf.template)，步骤见 [`knot-platform/ops/entry/README.md`](../../knot-platform/ops/entry/README.md)。中枢只要求「一个子域一套账号与端口、`/api` 能通到实例」 |
| 通配多租户 `*.xknot.si` 入口 nginx | **未做**；每签发子域仍手工一份 conf，不能自动按 Host 分租户 |
| 中枢站点 HTTPS / NS 切换细节 | 见 `ops/README-deploy-aws.md`；证书与部分 DNS 步骤标为另任务 |

## 7. 委托发信（可选）

自己的 SMTP 难送达时，可以把通知信交给中枢代发。契约在 [FEDERATION.md](FEDERATION.md) 第 7 节。

| 项 | 说明 |
|----|------|
| 前提 | 实例已在清单里且 `status: active`；中枢已配 SMTP |
| 怎么开通 | 向运营方要一份发信凭据，由中枢命令行签发，明文只给一次 |
| 实例配置 | `XKNOT_HUB_ORIGIN=https://xknot.si`、`XKNOT_HUB_RELAY_TOKEN=…`；发信地址按中枢地址推导 |
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
| `admin/` | 控制台：记录、实例配置、探测与发信 |
| `ops/check-health.mjs` | L2 探测与状态机 |
| `ops/watch-health.mjs` | 每 15 分钟的巡检、提醒与隐藏 |
| `ops/validate-instances.mjs` | 清单校验 |
| `ops/build-hub.sh` / `deploy-hub.sh` | 构建与静态站同步 |
| `ops/deploy-api.sh` | 接口、控制台与站点配置的同步 |
| `ops/xknot.si.conf` | 门户的 nginx |

实例侧（`knot-platform`，当前实现；换实现时这四项由该实现自己的文档承担）：

| 路径 | 用途 |
|------|------|
| `knot-platform/ops/entry/README.md` | 入口 + 隧道落地 |
| `knot-platform/sites/_template/entry.example.env` | 单入口的站点配置模板（域名、静态根、conf、投放方式） |
| `knot-platform/ops/entry/sshd-tunnel.conf.template` | 入口隧道账号的 sshd 配置 |

密钥、口令、PEM 路径只写在各机私有环境与 `~/.ssh/`，本文与版本库均不收录。
