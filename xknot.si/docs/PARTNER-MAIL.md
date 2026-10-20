# XKnot 联邦 · 伙伴邮件模板

版本 1.0，2026-10-20。

本文是 `xknot.si → 伙伴` 邮件的规格说明：事件、触发条件、收件人、三语全文、变量、幂等键与链接规范。运行时的真源是 `server/notify.mjs`，两边必须一致；改文案时先改本文，再改代码、升 `TEMPLATE_VERSION`，跑 `npm test`。

契约见 [FEDERATION.md](FEDERATION.md)，加入流程见 [JOIN.md](JOIN.md)，交付规则见 [HANDOFF.md](HANDOFF.md)，术语见 [NAMING.md](NAMING.md)。本文出现的概念名以那几份为准：口语里的「节点」在本文写作**实例**，「节点拥有者」写作**伙伴**或其**主理人**。

---

## 0. 现状与范围

从 2026-10-20 起，这条链路已经全部落到代码：

| 位置 | 作用 |
|------|------|
| `server/notify.mjs` | 模板注册表 `TEMPLATES[event]`，13 封伙伴信 + 3 封内部信，三语齐全 |
| `server/store.mjs` | `notify_log`、`verify_tokens`、`claim_tokens`、申请状态机与 `state_version` |
| `server/app.mjs` | 提交、验证、案例动作、审核、交付、领取的接口与发信触发 |
| `server/pages.mjs` | `/verify/`、`/case/`、`/claim/` 三个无脚本页面 |
| `server/admin-cli.mjs` | `verify` / `notify` / `handoff` / `live` / `contact-revalidate` / `suspend` / `retire` / `notify-log` / `expire` |
| `server/notify.test.mjs` | 每事件 × 3 语种，断言编号在内、内部备注不在、无占位符、无凭据明文 |

`newApplicationMail` / `applicantReviewMail` 保留为薄包装，只为兼容旧调用点。

一条邮件的走向：

```text
伙伴 / 主理人                          中枢 xknot.si
     │  提交申请 ────────────────────▶ POST /api/applications
     │  ◀────────────────────  1 received（含验证链接）
     │  确认邮箱 ────────────────────▶ POST /api/verify
     │  ◀────────────────────  2 verified
     │                                人工审核
     │  ◀────────────────────  3 hold / 4 approved / 5 rejected
     │  ◀────────────────────  6 issuance
     │  ◀────────────────────  7 handoff（一次性领取页）
     │  ◀────────────────────  8 live
     │  ◀────────────────────  9 contact_revalidate（每 180 天）
     │  ◀──────────────────── 10 suspended / 11 retired
     │  ◀──────────────────── 12 unreachable_24h / 13 hidden_7d（运行状态巡检）
```

状态机只允许这些迁移，越界返回 `invalid_transition`：

```text
pending ──▶ verified ──▶ hold ──▶ verified
   │            │           │
   │            ├──────────▶ approved
   │            ├──────────▶ rejected
   │            └──────────▶ withdrawn
   ├──▶ withdrawn
   └──▶ expired（30 天未确认）
```

---

## 1. 发信契约

### 1.1 信封与头部

| 项 | 值 |
|----|----|
| `From` | `XKnot 联邦 <no-reply@xknot.si>`（取 `MAIL_FROM`，实例不能覆盖） |
| `Reply-To` | `no-reply@xknot.si` |
| 主题 | `[XKnot] {id} <动作>`，不含换行，≤120 字 |
| 正文 | 纯文本 UTF-8，≤4000 字 |
| 其它 | 不收 HTML、附件、抄送与密送；不放追踪像素 |

**`Reply-To` 也指向 `no-reply`，等于明确宣告「不要回信」。** `xknot.si` 的 MX 指向阿里云且只发信（见 `ops/README-deploy-aws.md`），回信会退信或掉进黑洞。因此有两个硬要求：

1. 每封正文必须有一句「本邮件由系统发出，不接收回复。」
2. 所有需要申请人动作的事，都必须带一个链接，不能靠「回复本邮件」。

### 1.2 语种

| 项 | 规则 |
|----|------|
| 维护语种 | `zh-CN`（默认）、`zh-TW`、`en` |
| 选择 | 取申请单的 `locale`；`zh-tw` / `zh-hk` / `zh-hant` → `zh-TW`，其余 `zh*` → `zh-CN`，其它 → `en` |
| 完整性 | 每个事件三份必须齐全；缺一份视为缺陷，回退 `en` 并记日志 |

### 1.3 幂等与重试

| 项 | 规则 |
|----|------|
| 幂等键 | `{event}:{caseId}:{stateVersion}`，库内唯一索引 |
| 重复触发 | 同键第二次直接跳过，不重发 |
| 5xx | 不重试，记 `failed`，告警运营方 |
| 超时 / 4xx | 最多 3 次，退避 1 / 5 / 30 分钟 |
| 状态回退 | 同一事件在状态回退再前进时不重发（键含版本号，由实现决定是否换版） |

### 1.4 限流

| 范围 | 上限 |
|------|------|
| 单个收件地址 | 12 封 / 天 |
| 单个收件域名 | 30 封 / 天 |
| 全站伙伴信 | 200 封 / 天 |
| 内部信 | 30 封 / 小时 |

单个地址的上限按「一个真实伙伴走完 收到 → 验证 → 补件 → 通过 → 签发 → 交付 → 上线」留余量（约 8 封），同时挡住脚本刷单。超限只入库不发信，记 `throttled`，由运营方决定是否补发。

### 1.5 记录

新增 `notify_log`：事件、案例编号、收件域名、地址哈希、模板版本、语种、结果、错误码、时间。**不存正文、不存完整地址、不存主题全文。**

保留 90 天，按日清理。

### 1.6 链接

| 项 | 规则 |
|----|------|
| 形式 | 一律 `https` 绝对地址，不带 URL 用户名与密码 |
| 案例链接 | `https://xknot.si/case/<caseKey>`：12 字节不透明键，不含申请编号；持有链接即可查看状态与提交材料 |
| 验证 / 领取页 | `GET` 只渲染确认按钮；消费令牌必须是 `POST`（防邮箱网关预取） |
| 响应头 | `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex` |
| 日志 | nginx 对 `/case/`、`/verify/`、`/claim/`、`/api/verify`、`/api/claim`、`/api/case/` 关闭 `access_log` |
| 有效期 | 验证链接 30 天；领取页 72 小时；两者均单次使用 |

### 1.7 变量卫生

- 所有变量去 `\r`、`\n` 后插入；用户填写的字段不进邮件头。
- `name` ≤40、`operator` ≤80、`url` ≤200、`{id}` ≤32，超出截断。
- 正文只放事实，不放判断：不写内部备注、审核人、IP、哈希、其他申请人的数据。
- 任何凭据明文、私钥、SMTP 口令不得出现在正文。

---

## 2. 变量

| 变量 | 含义 | 示例 |
|------|------|------|
| `{id}` | 申请编号 | `XK-2026-7F3C9Q` |
| `{name}` | 站点名 | `Knot · wang` |
| `{url}` | 站点地址 | `https://wang.xknot.si` |
| `{operator}` | 运营方 / 主理人 | `PaulWang` |
| `{origin}` | 门户地址 | `https://xknot.si` |
| `{caseUrl}` | 案例页 | `https://xknot.si/case/<opaque>` |
| `{verifyUrl}` | 邮箱确认页 | `https://xknot.si/verify/<opaque>` |
| `{confirmUrl}` | 联系人确认页 | `https://xknot.si/case/<opaque>?confirm=1` |
| `{claimUrl}` | 一次性领取页 | `https://xknot.si/claim/<opaque>` |
| `{portalUrl}` | 门户条目链接 | `https://xknot.si/en/` |
| `{supportUrl}` | 对外支持入口 | 见第 6 节，暂空 |
| `{reviewSla}` | 审核时限 | `3 个工作日` |
| `{verifyTtl}` / `{confirmTtl}` / `{claimTtl}` | 有效期 | `30 天` / `30 天` / `72 小时` |
| `{dueAt}` | 补材料截止 | `2026-11-03` |
| `{expireAt}` | 申请结束日 | `2026-11-20` |
| `{reapplyAfter}` | 可重提日期 | `2026-10-27` |
| `{reasonLabel}` / `{reasonHint}` | 拒绝类别与说明 | 见 3.2 |
| `{items}` | 补材料清单 | 由 3.1 的条目码渲染 |
| `{host}` / `{subdomain}` | 子域 | `wang.xknot.si` |
| `{accessLabel}` | 连通方式 | `边缘 + SSH 反向隧道` |
| `{edgeHost}` / `{account}` / `{port}` | 边缘与隧道 | `54.169.33.64` / `knot-tunnel-wang` / `18080` |
| `{healthUrl}` | 探测地址 | `https://wang.xknot.si/api/health` |
| `{statusLabel}` | 运行状态 | `正常` |
| `{contactMasked}` | 脱敏联系人 | `m***@gmail.com` |
| `{effectiveAt}` / `{reclaimAt}` / `{exportUntil}` | 时间点 | `2026-11-01` |
| `{resumeCondition}` | 恢复条件 | 运营方填写，只写条件不写评价 |

---

## 3. 事件与状态

### 3.1 补材料条目码（`{items}` 的数据源）

运营方只勾条目码，不写自由文本，避免内部评价进入对外邮件。

| 码 | zh-CN | zh-TW | en |
|----|-------|-------|-----|
| `site_unreachable` | 站点地址从公网打不开 | 站點位址從公網打不開 | the site URL is not reachable from the public internet |
| `health_missing` | 站点没有提供可用的 `/api/health` | 站點沒有提供可用的 `/api/health` | the site does not expose a working `/api/health` |
| `intro_unclear` | 一句话简介与实际内容不一致 | 一句話簡介與實際內容不一致 | the one-line intro does not match the site |
| `name_conflict` | 名称或标识可能与已有成员冲突 | 名稱或標識可能與已有成員衝突 | the name or mark may conflict with an existing member |
| `contact_invalid` | 联系邮箱无法送达 | 聯絡信箱無法送達 | the contact address is not deliverable |
| `region_mismatch` | 区域或时区与实际运营地不符 | 區域或時區與實際營運地不符 | the region or timezone does not match where you operate |
| `other` | 材料不足 | 材料不足 | the information provided is not sufficient |

### 3.2 拒绝类别

| 码 | `{reasonLabel}` | `{reasonHint}` |
|----|-----------------|----------------|
| `incomplete` | 材料不足 | 申请表缺少关键信息，或所选子域与站点用途不符。 |
| `unreachable` | 站点不可达 | 所选落点无法从公网访问，或子域没有按约定接通。 |
| `policy` | 不符合联邦约定 | 站点用途或内容与 XKnot 联邦的收录约定不符。 |

拒绝信只给类别与一句说明，不给审核人、不给内部备注、不给评分。

### 3.3 状态迁移 → 事件

| 迁移 | 事件 | 收件人 |
|------|------|--------|
| — → `pending` | `partner.received` | 申请人 |
| `pending` → `verified` | `partner.verified` | 申请人 |
| `verified` → `hold` | `partner.hold` | 申请人 |
| `verified` / `hold` → `approved` | `partner.approved` | 申请人 |
| `verified` / `hold` → `rejected` | `partner.rejected` | 申请人 |
| 开通 `reserved` → `issuing` | `partner.issuance` | 主理人 |
| 开通 `issuing` → `handed_off` | `partner.handoff` | 主理人 |
| 开通 `handed_off` → `live` | `partner.live` | 主理人 |
| 运行 `active` → `suspended` | `partner.suspended` | 联系人 |
| 运行 `active` / `suspended` → `retired` | `partner.retired` | 联系人 |
| 探测 `down` 连续 24 小时 | `partner.unreachable_24h` | 联系人 |
| 探测 `down` 连续 7 天 | `partner.hidden_7d` | 联系人 |
| 每 180 天 | `partner.contact_revalidate` | 联系人 |

`hold` 不发拒绝信；`pending` → `expired` 不单独发信，由第 1 封的「30 天后自动结束」预告覆盖。

---

## 4. 模板

主题统一 `[XKnot] {id} <动作>`。正文末尾固定签名，不再重复。

### 4.1 `partner.received`

**主题**：`[XKnot] {id} 已收到加入申请`

```text
{operator} 你好：

我们已收到你提交的 XKnot 联邦加入申请。

编号：{id}
站点：{name}
地址：{url}

接下来三步：

1. 用下面的链接确认邮箱。{verifyTtl} 内未确认，申请会自动结束。
   {verifyUrl}

2. 邮箱确认后进入人工审核，通常 {reviewSla} 内给出结果。

3. 通过后签发你选的子域，再按所选落点接通。清单条目先以「未接通」状态写入，公网 /api/health 验证通过后才显示为在线。

申请状态随时可查：
{caseUrl}

本邮件由系统发出，不接收回复；需要补充材料时，请用上面的申请页。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已收到加入申請`

```text
{operator} 你好：

我們已收到你提交的 XKnot 聯邦加入申請。

編號：{id}
站點：{name}
位址：{url}

接下來三步：

1. 用下面的連結確認信箱。{verifyTtl} 內未確認，申請會自動結束。
   {verifyUrl}

2. 信箱確認後進入人工審核，通常 {reviewSla} 內給出結果。

3. 通過後簽發你選的子網域，再按所選落點接通。清單條目先以「未接通」狀態寫入，公網 /api/health 驗證通過後才顯示為上線。

申請狀態隨時可查：
{caseUrl}

本郵件由系統發出，不接收回覆；需要補充材料時，請用上面的申請頁。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} application received`

```text
Hello {operator},

We have received your application to join the XKnot Federation.

Reference: {id}
Site: {name}
URL: {url}

Next, three steps:

1. Confirm your email address using the link below. The application closes automatically if it is not confirmed within {verifyTtl}.
   {verifyUrl}

2. After confirmation the application enters manual review. We usually reply within {reviewSla}.

3. Once approved, we issue the subdomain you picked and then connect the landing mode you chose. The listing entry is written as not yet connected; it shows as online only after the public /api/health check passes.

You can check the status at any time:
{caseUrl}

This message was sent automatically; replies are not monitored. Use the application page above to send additional material.

— XKnot Federation
```

---

### 4.2 `partner.verified`

**主题**：`[XKnot] {id} 已进入审核`

```text
{operator} 你好：

申请 {id}（{name}）的邮箱已确认，现在进入人工审核。

审核会核对三件事：站点可以从公网访问、一句话简介与实际内容一致、名称与标识不与其他成员冲突。

结果会寄到这个邮箱，通常在 {reviewSla} 内。

这期间要改信息或补材料：
{caseUrl}

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已進入審核`

```text
{operator} 你好：

申請 {id}（{name}）的信箱已確認，現在進入人工審核。

審核會核對三件事：站點可以從公網訪問、一句話簡介與實際內容一致、名稱與標識不與其他成員衝突。

結果會寄到這個信箱，通常 {reviewSla} 內。

這期間要改資訊或補材料：
{caseUrl}

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} is under review`

```text
Hello {operator},

The email address for application {id} ({name}) is confirmed, and the application is now under manual review.

Review checks three things: the site is reachable from the public internet, the one-line intro matches the site, and the name or mark does not conflict with an existing member.

We will write to this address with the result, usually within {reviewSla}.

To change details or send additional material meanwhile:
{caseUrl}

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.3 `partner.hold`

**主题**：`[XKnot] {id} 需要补充材料`

```text
{operator} 你好：

申请 {id}（{name}）需要补充材料，审核暂时搁置。

需要补充：
{items}

请在 {dueAt} 前通过申请页补齐：
{caseUrl}

逾期未补，申请会在 {expireAt} 结束。之后可以重新提交，编号会换新的。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 需要補充材料`

```text
{operator} 你好：

申請 {id}（{name}）需要補充材料，審核暫時擱置。

需要補充：
{items}

請在 {dueAt} 前透過申請頁補齊：
{caseUrl}

逾期未補，申請會在 {expireAt} 結束。之後可以重新提交，編號會換新的。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} needs more information`

```text
Hello {operator},

Application {id} ({name}) needs more information, so review is on hold.

Still needed:
{items}

Please send it through the application page by {dueAt}:
{caseUrl}

If nothing arrives, the application closes on {expireAt}. You can apply again afterwards with a new reference.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

`{items}` 由 3.1 的条目码渲染，每条一行，行首 `- `。

---

### 4.4 `partner.approved`

**主题**：`[XKnot] {id} 已通过收录审核`

```text
{operator} 你好：

你提交的 XKnot 联邦加入申请（{id}）已通过审核。

站点：{name}
地址：{url}

接下来由工作人员把实例写进实例清单并重新构建门户。收录当天，门户的实例目录里会出现这个条目。

收录不包含下面三项，需要时另行确认：

- 签发 *.xknot.si 子域
- 边缘主机与 SSH 反向隧道
- 委托发信凭据

需要其中任何一项，请在申请页说明：
{caseUrl}

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已通過收錄審核`

```text
{operator} 你好：

你提交的 XKnot 聯邦加入申請（{id}）已通過審核。

站點：{name}
位址：{url}

接下來由工作人員把實例寫進實例清單並重新建置入口。收錄當天，入口的實例目錄裡會出現這個條目。

收錄不包含下面三項，需要時另行確認：

- 簽發 *.xknot.si 子網域
- 邊緣主機與 SSH 反向隧道
- 委託發信憑證

需要其中任何一項，請在申請頁說明：
{caseUrl}

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} was approved for listing`

```text
Hello {operator},

Your application to join the XKnot Federation ({id}) has been approved.

Site: {name}
URL: {url}

A staff member will now add the instance to the instance manifest and rebuild the portal. The entry appears in the portal's instance directory on the day it is listed.

Listing does not include the following, which are confirmed separately:

- a *.xknot.si subdomain
- an edge host and SSH reverse tunnel
- a relay token for delegated mail

If you need any of them, say so on the application page:
{caseUrl}

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.5 `partner.rejected`

**主题**：`[XKnot] {id} 的审核结果`

```text
{operator} 你好：

你提交的 XKnot 联邦加入申请（{id}）本次未通过审核。

站点：{name}
地址：{url}
原因类别：{reasonLabel}

{reasonHint}

情况有变化时可以修改后重新提交，{reapplyAfter} 之后开放。
申请页：{caseUrl}

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 的審核結果`

```text
{operator} 你好：

你提交的 XKnot 聯邦加入申請（{id}）本次未通過審核。

站點：{name}
位址：{url}
原因類別：{reasonLabel}

{reasonHint}

情況有變化時可以修改後重新提交，{reapplyAfter} 之後開放。
申請頁：{caseUrl}

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] result for {id}`

```text
Hello {operator},

Your application to join the XKnot Federation ({id}) was not approved this time.

Site: {name}
URL: {url}
Reason: {reasonLabel}

{reasonHint}

You can revise and apply again from {reapplyAfter}.
Application page: {caseUrl}

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.6 `partner.issuance`

**主题**：`[XKnot] {id} 的接入信息已确定`

```text
{operator} 你好：

实例 {id}（{name}）的接入信息已确定。

子域：{subdomain}
连通方式：{accessLabel}
边缘主机：{edgeHost}
隧道账号：{account}
专属端口：{port}

「隧道账号」「专属端口」两行只在隧道方式下出现。

下一步需要你做两件事：

1. 在本机生成密钥，私钥留在本机：
   ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-{id} -N ''

2. 把 ~/.ssh/knot-edge-{id}.pub 的内容交给我们：
   {caseUrl}

只交 .pub。不要交私钥，也不要贴进邮件或网页。

我们确认公钥已装、端口已就绪后，会再发一封交付信。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 的接入資訊已確定`

```text
{operator} 你好：

實例 {id}（{name}）的接入資訊已確定。

子網域：{subdomain}
連通方式：{accessLabel}
邊緣主機：{edgeHost}
隧道帳號：{account}
專屬埠：{port}

「隧道帳號」「專屬埠」兩行只在隧道方式下出現。

下一步需要你做兩件事：

1. 在本機產生金鑰，私鑰留在本機：
   ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-{id} -N ''

2. 把 ~/.ssh/knot-edge-{id}.pub 的內容交給我們：
   {caseUrl}

只交 .pub。不要交私鑰，也不要貼進郵件或網頁。

我們確認公鑰已裝、埠已就緒後，會再發一封交付信。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] access details for {id} are set`

```text
Hello {operator},

Access details for instance {id} ({name}) are set.

Subdomain: {subdomain}
Connectivity: {accessLabel}
Edge host: {edgeHost}
Tunnel account: {account}
Dedicated port: {port}

The account and port lines appear only for tunnel mode.

Two things to do next:

1. Generate a key pair on your own machine, keeping the private key local:
   ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-{id} -N ''

2. Send us the contents of ~/.ssh/knot-edge-{id}.pub:
   {caseUrl}

Send the .pub file only. Never send the private key, and never paste it into mail or a web page.

Once the key is installed and the port is ready, we will send a handoff message.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.7 `partner.handoff`

**主题**：`[XKnot] {id} 的接入资料已就绪`

```text
{operator} 你好：

实例 {id}（{name}）的接入资料已就绪。

请在 {claimTtl} 内领取：
{claimUrl}

领取页只显示一次，内容包含：

- 委托发信凭据（如已开通）
- 接入件（实例 id、中枢地址、签发日期）
- 连通参数（隧道账号、专属端口；直连为空）
- 接通前的验收命令

领取后请立即写进实例配置，不要转发、截图或存进版本库。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 的接入資料已就緒`

```text
{operator} 你好：

實例 {id}（{name}）的接入資料已就緒。

請在 {claimTtl} 內領取：
{claimUrl}

領取頁只顯示一次，內容包含：

- 委託發信憑證（如已開通）
- 接入件（實例 id、中樞位址、簽發日期）
- 連通參數（隧道帳號、專屬埠；直連為空）
- 接通前的驗收命令

領取後請立即寫進實例設定，不要轉發、截圖或存進版本庫。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] access material for {id} is ready`

```text
Hello {operator},

Access material for instance {id} ({name}) is ready.

Claim it within {claimTtl}:
{claimUrl}

The claim page is shown once and contains:

- the relay token, if delegated mail is enabled
- the access material (instance id, hub origin, issue date)
- the connectivity parameters (tunnel account and port; empty for direct)
- the acceptance commands

Write it into the instance configuration right away. Do not forward, screenshot, or commit it.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.8 `partner.live`

**主题**：`[XKnot] {id} 已在联邦上线`

```text
{operator} 你好：

实例 {id}（{name}）已接入 XKnot 联邦。

公网地址：{url}
门户条目：{portalUrl}
运行状态：{statusLabel}

之后中枢按实例清单探测 {healthUrl}。连续不可达时运行状态会变成中断，条目保留，不自动删除。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已在聯邦上線`

```text
{operator} 你好：

實例 {id}（{name}）已接入 XKnot 聯邦。

公網位址：{url}
入口條目：{portalUrl}
運行狀態：{statusLabel}

之後中樞按實例清單探測 {healthUrl}。連續不可達時運行狀態會變成中斷，條目保留，不自動刪除。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} is live on the federation`

```text
Hello {operator},

Instance {id} ({name}) is now part of the XKnot Federation.

Public URL: {url}
Portal entry: {portalUrl}
Runtime status: {statusLabel}

The hub keeps probing {healthUrl} as listed in the instance manifest. If the instance stays unreachable, its runtime status becomes down; the entry stays and is not removed automatically.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.9 `partner.contact_revalidate`

**主题**：`[XKnot] 请确认 {id} 的联系人`

```text
{operator} 你好：

我们每 180 天确认一次成员的联系人是否有效。

请确认这个邮箱仍然可用：{contactMasked}
{confirmUrl}

{confirmTtl} 内未确认，我们会把实例标记为联系人待确认，并暂停向该地址发送运营通知。站点本身、收录与运行状态都不受影响。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] 請確認 {id} 的聯絡人`

```text
{operator} 你好：

我們每 180 天確認一次成員的聯絡人是否有效。

請確認這個信箱仍然可用：{contactMasked}
{confirmUrl}

{confirmTtl} 內未確認，我們會把實例標記為聯絡人待確認，並暫停向該位址發送營運通知。站點本身、收錄與運行狀態都不受影響。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] please confirm the contact for {id}`

```text
Hello {operator},

We confirm member contacts every 180 days.

Please confirm that this address still works: {contactMasked}
{confirmUrl}

If it is not confirmed within {confirmTtl}, we mark the instance contact as stale and stop sending operational notices to that address. The site, its listing, and its runtime status are unaffected.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.10 `partner.suspended`

**主题**：`[XKnot] {id} 已暂停收录`

```text
{operator} 你好：

实例 {id}（{name}）已在联邦中暂停收录。

生效时间：{effectiveAt}

影响：

- 门户不再展示该条目的站点档案与热点橱窗
- 委托发信凭据已吊销
- 隧道账号暂停

不受影响：

- 实例自己的库、账号、内容与积分
- 实例自己的域名与证书

恢复条件：{resumeCondition}

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已暫停收錄`

```text
{operator} 你好：

實例 {id}（{name}）已在聯邦中暫停收錄。

生效時間：{effectiveAt}

影響：

- 入口不再展示該條目的站點檔案與熱點櫥窗
- 委託發信憑證已吊銷
- 隧道帳號暫停

不受影響：

- 實例自己的庫、帳號、內容與積分
- 實例自己的網域與憑證

恢復條件：{resumeCondition}

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} is suspended`

```text
Hello {operator},

Instance {id} ({name}) is suspended from the federation.

Effective: {effectiveAt}

Affected:

- the portal no longer shows this entry's site profile or showcase
- the relay token is revoked
- the tunnel account is disabled

Not affected:

- the instance's own database, accounts, content, and points
- the instance's own domain and certificate

To resume: {resumeCondition}

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.11 `partner.retired`

**主题**：`[XKnot] {id} 已退出联邦`

```text
{operator} 你好：

实例 {id}（{name}）已退出 XKnot 联邦。

生效时间：{effectiveAt}
子域回收：{reclaimAt}
运行状态与橱窗缓存：已删除

你的实例、内容与用户数据仍在自己的机器上，中枢不保留副本。
需要导出中枢侧与该实例相关的记录（申请单、审计事件），请在 {exportUntil} 前提出。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已退出聯邦`

```text
{operator} 你好：

實例 {id}（{name}）已退出 XKnot 聯邦。

生效時間：{effectiveAt}
子網域回收：{reclaimAt}
運行狀態與櫥窗快取：已刪除

你的實例、內容與使用者資料仍在自己的機器上，中樞不保留副本。
需要匯出中樞側與該實例相關的紀錄（申請單、稽核事件），請在 {exportUntil} 前提出。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} has left the federation`

```text
Hello {operator},

Instance {id} ({name}) has left the XKnot Federation.

Effective: {effectiveAt}
Subdomain reclaimed: {reclaimAt}
Runtime status and showcase cache: deleted

Your instance, content, and user data remain on your own machine. The hub keeps no copy.
If you need an export of hub-side records for this instance (application, audit events), ask before {exportUntil}.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.12 `partner.unreachable_24h`

**触发**：`ops/watch-health.mjs` 发现实例连续 24 小时不可达；`notified.down_24h` 未写过。
**收件人**：清单里的 `contact`
**主题**：`[XKnot] {id} 已连续 24 小时无法访问`

```text
{operator} 你好：

中枢探测不到实例 {id}（{name}）。

公网地址：{url}
健康检查：{url}/api/health
首次失败：{firstSeenAt}
最近一次探测：{checkedAt}

门户上现在显示为中断。若 7 天内仍未恢复，该条目会从联邦列表中暂时关闭；
恢复探测后自动回到列表，不需要重新申请。

先在本机确认实例在运行，再确认公网地址与隧道是否通。
需要变更落点或请人协助，回复本信或联系 {outbox}。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

### 4.13 `partner.hidden_7d`

**触发**：连续不可达满 7 天，`hiddenAt` 第一次写下。
**收件人**：清单里的 `contact`
**主题**：`[XKnot] {id} 已从联邦列表暂时关闭`

```text
{operator} 你好：

实例 {id}（{name}）已连续 7 天不可达，条目已从联邦列表暂时关闭。

公网地址：{url}
首次失败：{firstSeenAt}
最近一次探测：{checkedAt}

这不影响你的实例、内容、账号与数据。清单条目仍然保留，
探测恢复后会自动重新出现在列表里；也可以写信给 {outbox} 请人核对。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

---

## 5. 内部信

内部信发给运营方，不进伙伴链路。它们是唯一允许 `Reply-To` 指向真人的一类。

### 5.1 `internal.application_new`

**收件人**：`XKNOT_ADMIN_EMAIL`；`Reply-To` = 申请人邮箱
**主题**：`[XKnot] 待审申请 {id} · {name}`
**正文**：

```text
有一条新的加入申请，等待审核。

编号：{id}
站点：{name}
地址：{url}
运营方：{operator}
联系邮箱：{email}
区域 / 时区：{region} / {timezone}
简介：{intro}
标签：{tags}
申请接入：{requestSummary}

审核台：{origin}/admin/
```

### 5.2 `internal.application_verified`

**主题**：`[XKnot] 申请 {id} 邮箱已确认`

```text
申请 {id}（{name}）的邮箱已确认，可以开始审核。

地址：{url}
区域 / 时区：{region} / {timezone}
审核台：{origin}/admin/
```

### 5.3 `internal.instance_alert`

**主题**：`[XKnot] {id} 运行状态异常`

```text
实例 {id}（{name}）需要关注。

现象：{alertLabel}
首次出现：{firstSeenAt}
最近一次探测：{checkedAt}（{httpStatus}，{latencyMs} ms）
公网地址：{url}

处置面板：{origin}/admin/
```

`{alertLabel}` 取值：`down_24h`（连续 24 小时不可达）、`down_7d`（连续 7 天，已暂时关闭）、`never_14d`（签发后 14 天仍未接通）、`never_30d`（签发后 30 天，已暂时关闭）、`relay_quota_80`（发信额度用掉 80%）、`cert_expiring_14d`（边缘证书 14 天内到期）。

---

## 6. 上线前必须补齐

| 项 | 状态 | 影响 |
|----|------|------|
| 案例页 `/case/<caseKey>` | 已实现 | `hold`、`issuance`、`handoff`、`contact_revalidate` 的动作入口 |
| 邮箱验证页 `/verify/<token>` | 已实现 | `received` 里的验证链接可用；GET 不消费，POST 才消费 |
| 领取页 `/claim/<token>` | 已实现 | 明文只显示一次，72 小时过期；邮件正文不含凭据 |
| 对外支持入口 `{supportUrl}` | **待定** | 选了 `no-reply` 之后伙伴没有回信渠道。上线前必须在支持页与工单邮箱之间定一个；为空时该行整段省略，但那样伙伴只能靠案例页 |
| `no-reply@xknot.si` 的发信认证 | 已配 | 阿里云要求 `SMTP_USER` 与 `SMTP_FROM` 一致；改发信地址要同时改两处 |
| `MAIL_FROM` 与 `Reply-To` 一致 | 已配 | 二者都用 `no-reply@xknot.si`，与「不接收回复」的措辞一致 |
| 模板版本与文案责任人 | 已定 | 运行时版本在 `TEMPLATE_VERSION`；改文案必须两边一起改并升版本 |
| 归属验证记录 | **已取消** | 申请只按子域走，签发前没有可验证的域名。验收改为接通后的公网 `/api/health` 探测；旧的 `proof_method` 列仅保留历史数据 |

---

## 7. 与实现的对应

| 位置 | 实际做法 |
|------|----------|
| `server/notify.mjs` | `TEMPLATES[event] = { audience, subject: {locale}, text: {locale} }`；占位符 `{name}`；`buildMail(event, application, options)` |
| `server/store.mjs` | `notify_log` + `unique(event, case_id, state_version)`；`state_version` 在每次状态迁移 +1；运营类事件（签发/交付/上线）不传版本号，允许补发 |
| `server/app.mjs` | 提交、验证、审核、案例动作处调用 `dispatchMail`；限流命中记 `throttled` |
| `server/pages.mjs` | 三个页面无脚本、无构建；所有变量经 `escapeHtml`；页面自带 CSP 与 `no-store` |
| `server/admin-cli.mjs` | `notify` 补发任意事件；`handoff` 生成领取令牌并打印领取地址；`suspend` / `retire` 只发信，清单状态仍需按 ops 清单改 |
| `server/notify.test.mjs` | 16 个事件 × 3 语种；断言无占位符残留、无凭据明文、内部备注不外发 |
| `ops/xknot.si.conf` | `/verify/`、`/case/`、`/claim/`、`/api/verify`、`/api/claim`、`/api/case/` 关闭 `access_log` |

改文案的流程：先改本文，再改 `server/notify.mjs`，升 `TEMPLATE_VERSION`，跑 `npm test`。测试断言关键要素（编号、语种、闭合句、条目码），不逐字比对全文，避免标点改动就红。

---

## 8. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-10-20 | 1.0 | 首版：11 封伙伴信 + 3 封内部信；`Reply-To` 定为 `no-reply@xknot.si`；补材料与拒绝改为条目码 |
| 2026-10-20 | 1.1 | 落地：模板注册表、`notify_log` 去重、验证/案例/领取三页、状态机、管理命令与测试；限流调整为 12/30/200；案例链接改为不透明 `caseKey` |
| 2026-10-20 | 1.2 | 申请改为只按子域走；新增 `partner.unreachable_24h` 与 `partner.hidden_7d`（13 封伙伴信 + 3 封内部信）；去掉归属验证条目码与文案；内部告警增加 `down_7d` / `never_14d` / `never_30d` |
