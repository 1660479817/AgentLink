# XKnot 联邦 · 加入说明

版本 2.0，2026-10-20。仅文档，不改变运行配置。

契约见 [FEDERATION.md](FEDERATION.md)，中枢实现见 [HUB.md](HUB.md)，术语见 [NAMING.md](NAMING.md)。

本文回答两件事：**怎么申请进清单**，以及 **用哪种接入模式**。只有两种模式，二选一。

---
## 0. 结论摘要

| 问题 | 结论 |
|------|------|
| 怎么加入 | 门户右侧填表 → 邮件确认邮箱 → 运营者在 `/admin/` 人工审核 → 通过后由人写进 `instances.json` → 接通验收 → 重新构建门户。**申请不会自动上线。** |
| 要提供域名吗 | 看模式：**有自有域名**就用它当身份，地址是 `https://example.com`；**没有**才由中枢签发 `<标签>.xknot.si`。 |
| 身份是什么 | 清单里的 `url`，只有这一个地址。自有域名模式就是伙伴的域名；子域模式是签发出来的子域。换机器、换 IP 只改解析，不改 `url`。 |
| 接入模式 | 二选一：**有自有域名**（`own-domain`）或**无自有域名**（`subdomain`）。写在名册 `federation.json` 的 `mode` 里，不签发第二份地址，不做 301。 |
| 有自有域名 | 站点自己在 `https://example.com` 提供 HTTPS 与 `/api/health`；中枢不签发子域、不经过入口主机。 |
| 无自有域名 | 由中枢签发 `<标签>.xknot.si`；入口主机托管静态页，`/api` 经**本机主动连出的 SSH 反向隧道**回到实例。 |
| 私网地址 | 契约要求探测/拉取在解析 DNS 后拒绝回环、私网、链路本地与云元数据地址。`ops/check-health.mjs`、`ops/fetch-cards.mjs`、`ops/fetch-stats.mjs` 都走 `ops/fetch-guard.mjs`，命中即判 `down` / 保留上一份。**不要把 `url` 写成只在局域网可达的地址**——探测地址由它推出。 |
| 断连会怎样 | 连续 24 小时探测不到 → 邮件提醒；连续 7 天 → 邮件通知并从门户暂时隐藏；恢复探测后自动回来。收录后一直没验收：14 天提醒，30 天暂时隐藏。见第 5 节。 |

一句话：**模式决定地址，地址就是身份。** 模式只有两种，没有第三条轴，也没有跳转。

---

## 1. 接入流程（申请 → 审核 → 清单 → 上线）

加入是申请制，见 [FEDERATION.md](FEDERATION.md) 第 9 节与 [HUB.md](HUB.md) 第 9 节。

整个流程只碰一次面：申请时把公钥交上来，所以审核通过后中枢能一个人把配置做完，然后才是交换点 A。细则见 [HANDOFF.md](HANDOFF.md)。

```text
伙伴：表单（模式 + 地址）→ 确认邮箱 → 在 /case/<caseKey> 贴 .pub
    │  POST /api/applications → /api/verify → /api/case/<key>/public-key
    ▼
运营者在 /admin/ 审核 → approved
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
    │  伙伴起隧道 + 常驻；中枢补 /api 反代
    │  探测通过 → status: active → npm run build
    ▼
门户地图与目录出现该条目
```

### 1.1 申请

- 入口：中枢门户右栏「申请加入」（`web/src/components/JoinPanel.vue`）。
- 接口：`POST /api/applications`（`server/app.mjs`）。
- 字段（与 `server/validate.mjs` 一致）：
  - **接入模式** `mode`：`own-domain` 或 `subdomain`，必选。
  - `own-domain` 要填 **自有域名** `domain`：完整主机名，统一收成 `https://` 开头的 origin；不接受 IP、`localhost`、带账号密码或查询串的地址，也不接受 `xknot.si` 及其子域。
  - `subdomain` 要填 **子域标签** `subdomain`：2–32 位小写字母、数字与连字符，首尾不能是连字符。系统保留名（`www`、`api`、`admin`、`mail`、`xknot` 等）不签发。
  - 站点名称、一句话简介、运营者、联系邮箱、区域、时区、标签、同意勾选。这些只用于审核与联系：**不写进清单**。上线后由主理人在自己实例的 `/admin` 里填进站点档案（自述区），中枢按 `GET /api/federation/profile` 取回。
- 申请阶段中枢**不抓取**任何站点；自有域名也只当字符串校验，不解析、不探测。
- 同一地址（同一自有域名或同一标签）在 `pending` / `verified` / `hold` 时再次提交返回 `409 duplicate`；结案后可以再交一张单，用于补服务或变更模式。
- 提交后中枢立刻寄两封：给申请人的确认信（含 30 天有效的 `/verify/<token>` 链接）与给运营方的新申请提醒。邮件不接收回复，需要动作时一律走链接。

### 1.2 确认邮箱与案例页

- 打开 `/verify/<token>`，点按钮确认。`GET` 只显示按钮，`POST` 才消费令牌，邮箱安全网关预取链接不会替你点掉。
- 确认后申请进入 `verified`，同时收到「已进入审核」。
- **顺手把公钥贴上来**：案例页有 `ssh-ed25519 …` 的输入框。这是前置阶段的唯一输入——中枢拿到它才能在审核通过后一次把账号、`authorized_keys` 与 sshd 配置做完，不必再问一次。审核前就能交。
- 申请期间的状态、提交公钥与撤回都在 `/case/<caseKey>`：链接在每封信里，持有即可操作，不要转发。
- 归属验证已取消：申请时子域尚未签发，没有需要申请人自证的东西。真正的验收是接通后的公网 `/api/health` 探测。
- 30 天未确认会自动变成 `expired`；案例页可以重新发送确认信。

### 1.3 审核

- 审核台：`/admin/`（`admin/` 静态页 + `/api/admin/*`）。详情里直接显示接入模式、地址与联系邮箱。
- 动作：通过、拒绝、搁置、恢复审核。搁置必须勾选补材料条目，拒绝只选原因类别。
- 通知：提交、确认、通过、拒绝、搁置都会寄信；补材料只出现条目码，拒绝只出现原因类别。内部备注不对外。完整的事件与三语文案见 [PARTNER-MAIL.md](PARTNER-MAIL.md)。
- 账号：`npm run admin -- create-admin <用户名>`（`server/admin-cli.mjs`）。口令与会话密钥不入本文、不入版本库。
- 验证信寄不到时，可以人工确认：`npm run admin -- verify <申请编号>`；补发任意一封：`npm run admin -- notify <申请编号> <event>`。

### 1.4 写进清单并上线

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
| `id` | 自有域名取第一段主机名，子域模式取标签（冲突时用 `--id` 另指定） |
| `url` | `https://<自有域名>` 或 `https://<标签>.xknot.si`，由申请的模式决定 |
| `tier` | `community` |
| `status` | `pending`（已收录、未验收；`/api/health` 通过后改成 `active`） |
| `statsUrl` / `cardsUrl` | `null`（可选，后续再改清单） |

名称、介绍、语种、标签这些不在清单里：`publish` 只写签发区。伙伴接通后要提醒他打开自己实例的 `/admin` → **XKnot**，把站点档案填好；不填时门户用签发区字段与兜底文案显示。

`publish` 只写 `instances.json`。成员事实（`mode`，以及子域模式下的 `tunnel`）记在同目录的 `federation.json`，要另行补一条同名 `id` 的成员；两份文件对不上时构建会停下。

审核通过**不会**自动改 DNS、不会自动开隧道。子域模式下，工作人员按权利人流程签发（见第 3 节）。

### 1.5 前置、交换与收尾

审核通过后不是「一步一步换消息」，而是中枢先做完，再碰一次面。

| 段 | 谁做 | 做完的标志 |
|----|------|------------|
| 前置 | 工作人员 | 清单 `pending` 与名册成员写好；账号、端口、DNS、证书、静态页、子域 conf、公钥、sshd `Match`、接入件与领取链接全部就绪 |
| 交换点 A | 双方 | 伙伴拿到账号、端口、入口主机与领取链接；工作人员拿到伙伴的本机 `/api/health` 回执 |
| 收尾 | 双方 | 伙伴起隧道并常驻；工作人员补 `/api` 反代；探测通过后把 `status` 改成 `active`，再 `npm run build` |

前置之所以能一口气做完，是因为**公钥在申请阶段就交了**（第 1.2 节）。没交公钥时，前置做到静态页就停，`partner.issuance` 那封信会向伙伴索取公钥；公钥按时交到则跳过它。

**收录 ≠ 接通**：写进清单时 `status` 是 `pending`，不探测、不上门户；验收通过后才改成 `active`。细则见 [HANDOFF.md](HANDOFF.md)。

`*.xknot.si` 归 PaulWang 所有，由权利人签发；见 README「归属与许可」与 [FEDERATION.md](FEDERATION.md) 第 8 节。

---
## 2. 模式一：有自有域名

适用：伙伴已有 `https://example.com`（或指定了固定公网 IP 的域名），站点可以对外可达。

**地址就是身份**：清单 `url` 写 `https://example.com`，中枢不签发子域、不跳转、不参与它的入口主机。同一站点只有一个地址，不存在「规范地址 + 跳转地址」这种第二份记录。

做什么：

1. 按第 1 节提交申请，模式选「有自有域名」，填 `https://example.com`。
2. 审核通过后，由工作人员 `publish` 写进清单；`federation.json` 记 `mode: "own-domain"`，`tunnel` 必须是 `null`。
3. 主机上自行配置 TLS（Let's Encrypt 等）与反向代理到实例的 WebUI 与 `/api`。这类配置与自营站点相同，不在中枢范围；当前实例实现的做法见 [ops/entry/README.md](../../knot-platform/ops/entry/README.md)。
4. 保证实例提供 `GET https://example.com/api/health`，把清单 `status` 改成 `active`。探测地址由 `url` 推出，不用填。
5. （可选）以后再填 `statsUrl`、`cardsUrl`；橱窗拉取脚本见 [HUB.md](HUB.md) 第 6 节。

字段摘要（完整表见 [FEDERATION.md](FEDERATION.md) 第 4.2 节）：

| 字段 | 含义 |
|------|------|
| `instances.json` 的 `url` | `https://example.com`，唯一地址 |
| `federation.json` 的 `mode` | `own-domain` |
| `federation.json` 的 `tunnel` | `null`，有值就是校验错误 |

探测地址恒为 `url` + `/api/health`，探不探只看清单 `status`。

---

## 3. 模式二：无自有域名（签发子域 + 隧道）

适用：站点在一台没有自有域名、通常也没有固定公网 IP 的机器上（家宽、NAT 后、只能主动出网）。

需要一台公网入口主机持证书与静态文件，实例主动连出建反向隧道。**这是实例侧的部署形态，不属于中枢**；具体配置与命令在实例仓库的 [ops/entry/README.md](../../knot-platform/ops/entry/README.md)。

```text
浏览器 ──HTTPS──▶ 公网入口（nginx + 证书）
                     ├── /、/assets/ ──▶ 入口主机上的磁盘 /var/www/<id>（静态）
                     └── /api/、/help ─▶ 127.0.0.1:18081
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
| 名册 | `mode: "subdomain"`，`tunnel: { account, port }` 必填 |

这一段里的 DNS、证书、静态根、`server` 块、隧道账号与端口，**全部是中枢在交换点 A 之前一个人做完的**，不需要伙伴在场或先做点什么。伙伴唯一要在审核前交的是公钥。顺序与十项清单见 [HANDOFF.md](HANDOFF.md) 第 3 节。模板与步骤见 [ops/entry/README.md](../../knot-platform/ops/entry/README.md)；通配多租户自动 server 未做（见第 7 节）。

`ops/README-deploy-aws.md` 注明：隧道用户 `knot-tunnel@` 需在入口主机另行开通后再用隧道；入口主机由部署配置给出，仓库里不写默认值。

**每个子域要有自己的隧道账号和回环端口，不能与同机已有实例共用**——`Match` 首条匹配生效，`PermitListen` 也只允许一个端口。逐项交接见 [HANDOFF.md](HANDOFF.md)。

### 3.1 换 IP

隧道模式下 IP 变了不需要改任何清单字段：实例重新连出、入口主机的回环端口不变，探测自动恢复。家里换了网络也同理。

从**无域名**改成**有自有域名**（或反过来）不是改清单地址就完事，那是换模式：

1. 伙伴发邮件给运营方（`manwjh@gmail.com`），写清实例 id、新模式与地址。
2. 工作人员改 `instances.json` 的 `url` 与 `federation.json` 的 `mode`（子域模式的 `tunnel` 同时增删），跑 `npm run validate:federation`。
3. 旧子域按权利人流程回收；门户重新构建后条目指向新地址。

这是变更管理，不是额外门槛；但模式一变，地址就变，不能靠 301 过渡。

---

## 4. 联邦探测注意（`/api/health`）

中枢 L2 由两处执行：构建时 `ops/check-health.mjs`，以及常驻定时器 `ops/watch-health.mjs`（每 15 分钟一次，见第 5 节）。

### 4.1 实例侧应满足

| 项 | 要求 |
|----|------|
| 方法 | `GET`，响应 `Content-Type` 可解析为 JSON |
| 成功体 | `{ "ok": true, "service": "…", "version": "…" }`（`ok === true` 为硬条件） |
| URL | 恒为 `url` + `/api/health`（`ops/probe-target.mjs` 推出）；`url` 必须是 **https**，不得带 URL 用户名/密码 |
| 重定向 | 中枢**不跟随**重定向；3xx 记为 `down` |
| 超时 | 5 秒；≤2 秒为 `up`，>2 秒为 `degraded` |
| 凭据 | 中枢不带 Cookie、不带令牌 |

`status` 非 `active` 的条目不探测。清单 `status` 仍是 `pending`（已收录、未验收）时不探，状态 `unknown`，合法。

### 4.2 私网与不可达地址

| 层级 | 现状（以仓库为准） |
|------|-------------------|
| 契约 | [FEDERATION.md](FEDERATION.md) §6.6 / §8：探测与拉取在解析 DNS 后拒绝回环、私有网段、链路本地、云元数据地址 |
| L2 实现 | `ops/check-health.mjs` 强制 `https`、禁重定向、超时、`ok === true`，并经 `ops/fetch-guard.mjs` 拒绝私网地址 |
| L3 / 活动数据 | `ops/fetch-cards.mjs` 与 `ops/fetch-stats.mjs` 使用同一份守卫；失败保留上一份，不影响构建 |

实务结论：**清单的 `url` 不能是仅内网可达的地址**——探测机在公网侧解析与探测，内网地址会被判 `private_address` 或 `down`。走隧道的实例应让入口把 `/api` 反代过隧道，探测的仍是 `https://<子域>/api/health`。

### 4.3 申请地址 vs 探测地址

- 申请表里的自有域名或子域标签：只是登记地址，**接收时不解析、不抓取**。
- 写入 `instances.json` 并把 `status` 改成 `active` 之后：才对 `url` + `/api/health`（及将来的 `cardsUrl`）主动 GET。

---

## 5. 断连监测与暂时隐藏

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

## 6. 与中枢 / 入口 / 实例的职责边界

| 角色 | 负责 | 不负责 |
|------|------|--------|
| **中枢**（`xknot.si`） | `instances.json`、申请队列与审核台、探测与断连通知、门户静态站 | 用户账号、内容、积分、订单；托管伙伴站点；替伙伴部署或维护隧道 |
| **入口主机**（公网机上的 nginx / sshd，仅子域模式） | 证书、对外 HTTPS、静态页、把 `/api` 反代到隧道端口；隧道用户隔离 | 业务库；审核联邦申请；改 `instances.json` |
| **实例**（伙伴的 Knot，当前实现是 `knot-platform`） | 自有部署、库、上传、账号、审核、证书（自有域名时）或维持隧道（无域名时）、提供 `/api/health` 与可选橱窗 | 改中枢清单；要求中枢代管内容 |

两边的代码与脚本分开存放：中枢的部署文件在本文同级的 `ops/`；实例的部署文件在 [`knot-platform/ops/`](../../knot-platform/ops)。中枢不引用实例的文件，实例也不引用中枢的文件；两边只以 HTTP 契约与接入件相连，本文只做策略说明与跳转。换一个实例实现（Go、Rust、别的语言）不影响中枢的代码、清单和探测。

**中枢主机与入口主机可以是同一台机器，当前部署就是这样。** 角色的归属不因为同机而合并：中枢的配置归 `xknot.si/ops/`，入口的配置归实例侧 `knot-platform/ops/entry/`。同机时最容易犯的错，是拿入口的 nginx 配置去改中枢站点，或反过来。完整的概念图与归属见 [`docs/concepts.md`](../../docs/concepts.md)。

**入口按范围分两处**：可复用的模板在 [`knot-platform/ops/entry/`](../../knot-platform/ops/entry/)（任何实例都能用）；中枢已签发子域的具体 conf 与接通 runbook 在 [`xknot.si/ops/entry/`](../ops/entry/)（写死域名，只有中枢工作人员会改）。

- 中枢 nginx：`ops/xknot.si.conf`；中枢部署笔记：`ops/README-deploy-aws.md`
- 公网入口模板（实例侧）：`../../knot-platform/ops/entry/README.md`
- 已签发子域的入口（中枢侧）：`../ops/entry/`，如 `zjj.xknot.si.conf` 与 `zjj-tunnel.md`

收费与子域服务不在中枢订单链路里发生（见 README「收录与收费」）。

---

## 7. 未实现 / 另任务（勿当成已上线）

| 项 | 状态 |
|----|------|
| 邮箱确认 / 案例页 / 一次性领取页 | **已实现**：`/verify/<token>`、`/case/<caseKey>`、`/claim/<token>` |
| 两种模式的地址校验 | **已实现**：`server/validate.mjs`（自有域名规范化、子域标签 2–32 位与保留名、同地址查重） |
| 断连提醒与暂时隐藏 | **已实现**：`ops/watch-health.mjs` + `ops/check-health.mjs` |
| 申请通过后自动签发 DNS | **未实现**；人工确认 + 权利人签发 |
| 传统 DDNS（客户端改 A 到当前出口 IP） | **不做**；NAT 场景用入口 + SSH 反向隧道 |
| 签发子域 + DNS 指到伙伴自己的固定 IP（不走隧道） | **不支持**：名册只有 `own-domain` / `subdomain` 两档，这一组合两头都不算，`validate-federation.mjs` 会拒绝。没有落地步骤；要固定 IP 就用伙伴自己的域名走 `own-domain` |
| 单子域入口配置 | **已有**（实例侧）：入口与 nginx 由实例实现自己渲染。当前实现是 `knot-platform`：入口文件 [`sites/_template/entry.example.env`](../../knot-platform/sites/_template/entry.example.env)，模板 [`knot-platform/ops/entry/site.conf.template`](../../knot-platform/ops/entry/site.conf.template)，步骤见 [`knot-platform/ops/entry/README.md`](../../knot-platform/ops/entry/README.md)。中枢只要求「一个子域一套账号与端口、`/api` 能通到实例」 |
| 通配多租户 `*.xknot.si` 入口 nginx | **未做**；每签发子域仍手工一份 conf，不能自动按 Host 分租户 |
| 中枢站点 HTTPS / NS 切换细节 | 见 `ops/README-deploy-aws.md`；证书与部分 DNS 步骤标为另任务 |

## 8. 委托发信（可选）

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

## 9. 相关文件速查

中枢侧（本目录 `xknot.si/`）：

| 路径 | 用途 |
|------|------|
| `instances.json` | 联邦清单唯一真源 |
| `docs/HANDOFF.md` | 子域签发到实例接通的交付单模板（一子域一账号一端口） |
| `server/app.mjs` / `validate.mjs` / `manifest.mjs` / `admin-cli.mjs` | 申请、校验、生成条目、写入清单 |
| `admin/` | 审核台 |
| `ops/check-health.mjs` | L2 探测与状态机 |
| `ops/watch-health.mjs` | 每 15 分钟的巡检、提醒与隐藏 |
| `ops/validate-instances.mjs` | 清单校验 |
| `ops/build-hub.sh` / `deploy-hub.sh` | 构建与静态站同步 |
| `ops/deploy-api.sh` | 接口、审核台与站点配置的同步 |
| `ops/xknot.si.conf` | 门户的 nginx |

实例侧（`knot-platform`，当前实现；换实现时这四项由该实现自己的文档承担）：

| 路径 | 用途 |
|------|------|
| `knot-platform/ops/entry/README.md` | 入口 + 隧道落地 |
| `knot-platform/sites/_template/entry.example.env` | 单入口的站点配置模板（域名、静态根、conf、投放方式） |
| `knot-platform/ops/entry/sshd-tunnel.conf.template` | 入口隧道账号的 sshd 配置 |

密钥、口令、PEM 路径只写在各机私有环境与 `~/.ssh/`，本文与版本库均不收录。
