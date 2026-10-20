# XKnot 联邦 · 加入说明

版本 1.1，2026-10-20。仅文档，不改变运行配置。

契约见 [FEDERATION.md](FEDERATION.md)，中枢实现见 [HUB.md](HUB.md)，术语见 [NAMING.md](NAMING.md)。

本文回答两件事：**怎么申请进清单**，以及 **站点落在哪里**。

---
## 0. 结论摘要

| 问题 | 结论 |
|------|------|
| 怎么加入 | 门户右侧填表 → 邮件确认邮箱 → 运营者在 `/admin/` 人工审核 → 通过后由人写进 `instances.json` → 重新构建门户。**申请不会自动上线。** |
| 要提供域名吗 | **不用。** 申请时只选一个子域标签，地址由中枢签发为 `<标签>.xknot.si`。自有域名不是申请条件。 |
| 身份是什么 | 签发出来的子域。清单里的 `url` 恒为 `https://<标签>.xknot.si`；换机器、换网络、换 IP 都不改身份。 |
| 站点落在哪里 | 由申请人选，二选一：**自有域名或固定公网 IP 直连**，或**动态 IP / 无公网入口走边缘隧道**。落点后续可以改，改的时候提变更。 |
| 固定公网 IP | 子域 DNS 指到该主机；主机自己做 HTTPS 与反代；中枢按清单探测 `healthUrl`。 |
| 无固定公网 IP / 仅出网 | **不能**把 A 记录指到内网机，也**不是**传统 DDNS。靠**公网边缘 nginx + 本机主动 SSH 反向隧道**把动态请求接到实例。 |
| 私网地址 | 契约要求探测/拉取在解析 DNS 后拒绝回环、私网、链路本地与云元数据地址。`ops/check-health.mjs`、`ops/fetch-cards.mjs`、`ops/fetch-stats.mjs` 都走 `ops/fetch-guard.mjs`，命中即判 `down` / 保留上一份。**不要把 `healthUrl` 写成只在局域网可达的地址。** |
| 断连会怎样 | 连续 24 小时探测不到 → 邮件提醒；连续 7 天 → 邮件通知并从门户暂时隐藏；恢复探测后自动回来。签发后一直没接通：14 天提醒，30 天暂时隐藏。见第 5 节。 |

一句话分清两条轴：

1. **身份轴**：`<标签>.xknot.si`，由中枢签发，所有条目都有。
2. **落点轴**：自有域名/固定公网 IP 直连 ↔ 动态 IP/NAT 走边缘隧道。

两条轴互不替代。自有域名是落点的一种，不再充当联邦里的身份。

---

## 1. 接入流程（申请 → 审核 → 清单 → 上线）

加入是申请制，见 [FEDERATION.md](FEDERATION.md) 第 9 节与 [HUB.md](HUB.md) 第 9 节。

```text
门户右侧表单（选子域标签 + 落点方式）
    │  POST /api/applications
    ▼
var/xknot.db 申请队列（pending：等邮箱确认）
    │  邮件 → /verify/<token> → POST /api/verify
    ▼
verified（等人工审核；可在 /case/<caseKey> 看状态、补公钥）
    │  运营者在 /admin/ 审核
    ▼
approved / rejected / hold
    │  仅 approved 可写清单
    ▼
npm run admin -- publish <申请编号>
    │  写入 instances.json（id 与 url 都来自子域标签）
    ▼
签发交接（/claim/<token> 交付接入件；见 HANDOFF.md）
    │  实例接通，公网 /api/health 可达
    ▼
npm run build（校验 + 探测 + 构建）
    │  可选：同步 web/dist 到边缘
    ▼
门户地图与目录出现该条目
```

### 1.1 申请

- 入口：中枢门户右栏「申请加入」（`web/src/components/JoinPanel.vue`）。
- 接口：`POST /api/applications`（`server/app.mjs`）。
- 字段（与 `server/validate.mjs` 一致）：
  - **子域名**：2–32 位小写字母、数字与连字符，首尾不能是连字符。系统保留名（`www`、`api`、`admin`、`mail`、`xknot` 等）不签发。
  - **落点方式**：`direct`（自有域名或固定公网 IP）或 `tunnel`（动态 IP / 无公网入口），必选。
  - 站点名称、一句话简介、运营者、联系邮箱、区域、时区、标签、同意勾选。
- 申请人不需要提供任何现有站点地址。申请阶段中枢**不抓取**任何站点。
- 同一子域在 `pending` / `verified` / `hold` 时再次提交返回 `409 duplicate`；`approved` 之后可以再交一张单，用于补服务或变更落点。
- 提交后中枢立刻寄两封：给申请人的确认信（含 30 天有效的 `/verify/<token>` 链接）与给运营方的新申请提醒。邮件不接收回复，需要动作时一律走链接。

### 1.2 确认邮箱与案例页

- 打开 `/verify/<token>`，点按钮确认。`GET` 只显示按钮，`POST` 才消费令牌，邮箱安全网关预取链接不会替你点掉。
- 确认后申请进入 `verified`，同时收到「已进入审核」。
- 申请期间的状态、提交公钥与撤回都在 `/case/<caseKey>`：链接在每封信里，持有即可操作，不要转发。
- 归属验证已取消：申请时子域尚未签发，没有需要申请人自证的东西。真正的验收是接通后的公网 `/api/health` 探测。
- 30 天未确认会自动变成 `expired`；案例页可以重新发送确认信。

### 1.3 审核

- 审核台：`/admin/`（`admin/` 静态页 + `/api/admin/*`）。详情里直接显示子域、落点方式与联系邮箱。
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
| `id` | 申请里选的子域标签（冲突时用 `--id` 另指定） |
| `url` | `https://<标签>.xknot.si` |
| `tier` | `community` |
| `status` | `active` |
| `healthUrl` | `null`；接通并验证后才写 `<url>/api/health` |
| `statsUrl` / `cardsUrl` | `null`（可选，后续再改清单） |
| `languages` | `["en"]` |

`publish` 只写 `instances.json`。成员事实（身份、子域来源、接入方式、隧道账号与端口）记在同目录的 `federation.json`，要另行补一条同名 `id` 的成员；两份文件对不上时构建会停下。

审核通过**不会**自动改 DNS、不会自动开隧道。需要二级域名时，工作人员按权利人流程签发（见第 3 节）。

### 1.5 签发之后

| 步骤 | 谁做 | 说明 |
|------|------|------|
| 申请加入 | 伙伴 | 门户填表：子域标签 + 落点方式 |
| 确认收录 | 工作人员 | `/admin/` 审核通过 |
| 写联邦条目 | 工作人员 | `publish` 或手工改 `instances.json` / `federation.json` |
| 签发 `*.xknot.si` | 权利人 / 工作人员 | DNS + 边缘 nginx（隧道）或指向伙伴主机（直连） |
| 交付接入件 | 工作人员 | `/claim/<token>` 一次性领取，见 [HANDOFF.md](HANDOFF.md) |
| 接通验收 | 工作人员 | 公网 `GET <子域>/api/health` 返回 `ok: true` 后才填 `healthUrl` |
| 构建与发布门户 | 工作人员 | `npm run build` 与部署脚本 |

**签发 ≠ 接通**：签发后清单条目已是 `active`，但 `healthUrl` 为空，探测状态为 `unknown`，门户上不显示为在线。这条规则见 [HANDOFF.md](HANDOFF.md)。

`*.xknot.si` 归 PaulWang 所有，由权利人签发；见 README「归属与许可」与 [FEDERATION.md](FEDERATION.md) 第 8 节。

---
## 2. 落点一：自有域名或固定公网 IP

适用：伙伴已有 `https://example.com`，或有一台带固定公网 IP 的主机，站点可以对外可达。

这里说的是**落点**，不是身份：联邦条目仍然挂在 `https://<标签>.xknot.si`。自有域名可以通过 `canonical` 或 `redirect` 记录，方便同一个站点有多个入口时做跳转。

做什么：

1. 按第 1 节提交申请，落点选「自有域名或固定公网 IP」。
2. 审核通过、签发子域后，把 `<标签>.xknot.si` 的 A/AAAA 记录指到该主机（或指到你自有域名前面的反代）。
3. 主机上自行配置 TLS（Let's Encrypt 等）与反向代理到实例的 WebUI 与 `/api`。这类配置与自营站点相同，不在中枢范围；当前实例实现的做法见 [ops/edge/README.md](../../knot-platform/ops/edge/README.md) 与 [subdomain-fixed-ip.md](../../knot-platform/ops/edge/subdomain-fixed-ip.md)。
4. 保证实例提供 `GET /api/health`，再在清单里填 `<url>/api/health`，满足第 4 节。
5. （可选）以后再填 `statsUrl`、`cardsUrl`；橱窗拉取脚本见 [HUB.md](HUB.md) 第 6 节。

字段含义摘要（完整表见 [FEDERATION.md](FEDERATION.md) 第 4.2 节）：

| 字段 | 含义 |
|------|------|
| `url` | 身份地址，恒为 `https://<标签>.xknot.si` |
| `canonical` | 真实站点地址；有自有域名时填它 |
| `redirect` | 有值时中枢侧只做 301，不展示为独立条目 |
| `healthUrl` | L2 探测地址；空则不探测，状态为 `unknown` |

`redirect` 是给「同一个站有多个入口」用的：清单里保留一个规范条目，其余入口只写 `redirect` 指向它。当前清单没有这种条目，`url` 就是站点地址。

---

## 3. 落点二：动态 IP / 没有公网入口（边缘 + 隧道）

适用：站点在一台没有固定公网 IP 的机器上（家宽、NAT 后、只能主动出网）。

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

签发子域的工作人员另外要把该子域的 DNS 指到边缘公网 IP，并在边缘加一份 `server` 块。模板与步骤见 [ops/edge/README.md](../../knot-platform/ops/edge/README.md)；通配多租户自动 server 未做（见第 7 节）。

`ops/README-deploy-aws.md` 注明：隧道用户 `knot-tunnel@` 需在边缘机另行开通后再用隧道；边缘主机由部署配置给出，仓库里不写默认值。

**每个子域要有自己的隧道账号和回环端口，不能与同机已有实例共用**——`Match` 首条匹配生效，`PermitListen` 也只允许一个端口。逐项交接见 [HANDOFF.md](HANDOFF.md)。

### 3.1 换落点

IP 变了、家里换了网络、从隧道改成自有域名，都按变更处理：

1. 伙伴发邮件给运营方（`manwjh@gmail.com`），写清实例 id 与新的落点。
2. 工作人员更新 DNS / 边缘配置，必要时改 `federation.json` 的 `access` 与 `tunnel`。
3. `instances.json` 的 `url` **不动**——身份没变。探测恢复后状态自动回到 `up`。

这也意味着：换 IP 不是伙伴自己改 DDNS，而是提交一次变更；但这是正常的变更管理，不是额外的门槛。

---

## 4. 联邦探测注意（healthUrl）

中枢 L2 由两处执行：构建时 `ops/check-health.mjs`，以及常驻定时器 `ops/watch-health.mjs`（每 15 分钟一次，见第 5 节）。

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

实务结论：**清单不应登记仅内网可达的 `healthUrl`**——探测机在公网侧解析与探测，内网地址会被判 `private_address` 或 `down`。走隧道的实例应暴露边缘上的公网 HTTPS 健康检查路径。

### 4.3 申请子域 vs 探测地址

- 申请表里的子域标签：只是选名，**接收时不解析、不抓取**。
- 写入 `instances.json` 并接通后：才对 `healthUrl`（及将来的 `cardsUrl`）主动 GET。

---

## 5. 断连监测与暂时隐藏

`ops/watch-health.mjs` 每 15 分钟跑一次探测，把结果与连续时长写进 `var/health.json`，并按下面的规则发信。**`instances.json` 不会被自动改动**；隐藏是门户渲染时的一次判断。

| 情况 | 触发 | 动作 |
|------|------|------|
| 连续不可达 24 小时 | `downSince` 起算 | 给实例 `contact` 寄提醒，说明地址、首次失败时间、恢复后自动回列表 |
| 连续不可达 7 天 | `downSince` 起算 | 寄「已从联邦列表暂时关闭」，门户不再展示该条目 |
| 恢复 | 任意一次探测 `up` / `degraded` | 清空计时与隐藏标记，条目自动回到列表，**不需要重新申请** |
| 签发后 14 天仍未接通 | 清单 `since` 起算，且 `healthUrl` 为空 | 给运营方内部提醒，请人跟进交接 |
| 签发后 30 天仍未接通 | 同上 | 从门户暂时隐藏，并内部提醒 |

要点：

- 每条通知只发一次，记在 `var/health.json` 的 `notified` 里；重复运行不会重复发信。
- 隐藏不影响实例本身：库、账号、内容、积分都还在伙伴机器上，清单条目也保留。
- 需要人工核对或恢复，写信给运营方 `manwjh@gmail.com`。
- 没有配 SMTP 时脚本照常写状态，只是不发信；这一类记录会出现在日志里。
- `--dry-run` 只探测与打印，不写状态、不发信，避免预览把待发标记吃掉。

实现：`ops/watch-health.mjs`（发信与调度）、`ops/check-health.mjs`（探测与状态机）。定时器：`ops/xknot-health.service`、`ops/xknot-health.timer`。

---

## 6. 与中枢 / 边缘 / 实例的职责边界

| 角色 | 负责 | 不负责 |
|------|------|--------|
| **中枢**（`xknot.si`） | `instances.json`、申请队列与审核台、探测与断连通知、门户静态站 | 用户账号、内容、积分、订单；托管伙伴站点；替伙伴部署或维护隧道 |
| **边缘**（公网机上的 nginx / sshd） | 证书、对外 HTTPS、把动态请求反代到隧道端口或本机静态目录；隧道用户隔离 | 业务库；审核联邦申请；改 `instances.json` |
| **实例**（伙伴的 Knot，当前实现是 `knot-platform`） | 自有部署、库、上传、账号、审核、证书（直连时）或维持隧道（NAT 时）、提供 `/api/health` 与可选橱窗 | 改中枢清单；要求中枢代管内容 |

两边的代码与脚本分开存放：中枢的部署文件在本文同级的 `ops/`；实例的部署文件在 [`knot-platform/ops/`](../../knot-platform/ops)（`edge/` 下是边缘配置）。中枢不引用实例的文件，实例也不引用中枢的文件；两边只以 HTTP 契约与接入件相连，本文只做策略说明与跳转。换一个实例实现（Go、Rust、别的语言）不影响中枢的代码、清单和探测。

- 中枢 nginx：`ops/xknot.si.conf`；中枢部署笔记：`ops/README-deploy-aws.md`
- 实例边缘（当前实现）：`../../knot-platform/ops/edge/README.md`、`../../knot-platform/ops/edge/subdomain-fixed-ip.md`

收费与子域服务不在中枢订单链路里发生（见 README「收录与收费」）。

---

## 7. 未实现 / 另任务（勿当成已上线）

| 项 | 状态 |
|----|------|
| 邮箱确认 / 案例页 / 一次性领取页 | **已实现**：`/verify/<token>`、`/case/<caseKey>`、`/claim/<token>` |
| 子域申请与保留名校验 | **已实现**：`server/validate.mjs`（2–32 位、保留名、同子域查重） |
| 断连提醒与暂时隐藏 | **已实现**：`ops/watch-health.mjs` + `ops/check-health.mjs` |
| 申请通过后自动签发 DNS | **未实现**；人工确认 + 权利人签发 |
| 传统 DDNS（客户端改 A 到当前出口 IP） | **不做**；NAT 场景用边缘 + SSH 反向隧道 |
| 单子域边缘配置 | **已有**（实例侧）：入口与 nginx 由实例实现自己渲染。当前实现是 `knot-platform`：入口文件 [`sites/_template/edge.example.env`](../../knot-platform/sites/_template/edge.example.env)，模板 [`ops/edge/site.conf.template`](../../knot-platform/ops/edge/site.conf.template)，步骤见 [`ops/edge/README.md`](../../knot-platform/ops/edge/README.md)。中枢只要求「一个子域一套账号与端口、`/api` 能通到实例」 |
| 通配多租户 `*.xknot.si` 边缘 nginx | **未做**；每签发子域仍手工一份 conf，不能自动按 Host 分租户 |
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
| `knot-platform/ops/edge/README.md` | 边缘 + 隧道落地 |
| `knot-platform/sites/_template/edge.example.env` | 单入口的站点配置模板（域名、静态根、conf、投放方式） |
| `knot-platform/ops/edge/subdomain-fixed-ip.md` | 固定公网 IP 直连 runbook |
| `knot-platform/ops/edge/sshd-tunnel.conf.template` | 边缘隧道账号的 sshd 配置 |

密钥、口令、PEM 路径只写在各机私有环境与 `~/.ssh/`，本文与版本库均不收录。
