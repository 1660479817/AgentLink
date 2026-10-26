# XKnot 联邦 · 伙伴邮件模板

版本 2.1。

本文是 `xknot.si → 伙伴` 邮件的规格说明：事件、触发条件、收件人、三语全文、变量、幂等键与链接规范。运行时的真源是 `server/notify.mjs`，两边必须一致；改文案时先改本文，再改代码、升 `TEMPLATE_VERSION`，跑 `npm test`。

契约见 [FEDERATION.md](FEDERATION.md)，加入流程见 [JOIN.md](JOIN.md)，交付规则见 [HANDOFF.md](HANDOFF.md)，术语见 [NAMING.md](NAMING.md)。本文出现的概念名以那几份为准：口语里的「节点」在本文写作**实例**，「节点拥有者」写作**伙伴**或其**主理人**。

---

## 0. 现状与范围

这条链路已经全部落到代码：

| 位置 | 作用 |
|------|------|
| `server/notify.mjs` | 模板注册表 `TEMPLATES[event]`，9 封伙伴信 + 2 封内部信，三语齐全 |
| `server/store.mjs` | `notify_log`、`claim_tokens`、申请状态与 `state_version` |
| `server/app.mjs` | 提交（自动通过）、案例动作、交付、领取的接口与发信触发 |
| `server/pages.mjs` | `/case/`、`/claim/` 两个无脚本页面 |
| `server/admin-cli.mjs` | `notify` / `handoff` / `live` / `contact-revalidate` / `suspend` / `retire` / `notify-log` |
| `server/notify.test.mjs` | 每事件 × 3 语种，断言编号在内、内部备注不在、无占位符、无凭据明文 |

一条邮件的走向：

```text
伙伴 / 主理人                          中枢 xknot.si
     │  提交申请 ────────────────────▶ POST /api/applications（即 approved）
     │  ◀────────────────────  1 approved（含案例页链接）
     │  ◀────────────────────  2 issuance
     │  ◀────────────────────  3 handoff（一次性领取页）
     │  ◀────────────────────  4 live
     │  ◀────────────────────  5 contact_revalidate（每 180 天）
     │  ◀────────────────────  6 suspended / 7 retired
     │  ◀────────────────────  8 unreachable_24h / 9 hidden_7d（运行状态巡检）
```

状态机只允许这些迁移：

```text
提交 ──▶ approved ──▶ withdrawn
```

`rejected` / `expired` 是只读状态，不再新增。

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

单个地址的上限按「一个真实伙伴走完 提交 → 签发 → 交付 → 上线」留余量（约 5 封），同时挡住脚本刷单。超限只入库不发信，记 `throttled`，由运营方决定是否补发。

### 1.5 记录

新增 `notify_log`：事件、案例编号、收件域名、地址哈希、模板版本、语种、结果、错误码、时间。**不存正文、不存完整地址、不存主题全文。**

保留 90 天，按日清理。

### 1.6 链接

| 项 | 规则 |
|----|------|
| 形式 | 一律 `https` 绝对地址，不带 URL 用户名与密码 |
| 案例链接 | `https://xknot.si/case/<caseKey>`：12 字节不透明键，不含申请编号；持有链接即可查看状态与提交材料 |
| 领取页 | `GET` 只渲染确认按钮；消费令牌必须是 `POST`（防邮件网关预取） |
| 响应头 | `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex` |
| 日志 | nginx 对 `/case/`、`/claim/`、`/api/claim`、`/api/case/` 关闭 `access_log` |
| 有效期 | 领取页 72 小时，单次使用 |
| 正文写法 | 只写「去哪里领」，不写领取页里有什么。payload 是每次交付时选的，写死一份清单就会承诺这次没放进去的项 |

### 1.7 变量卫生

- 所有变量去 `\r`、`\n` 后插入；用户填写的字段不进邮件头。
- `name` ≤40、`operator` ≤80、`url` ≤200、`{id}` ≤32，超出截断。
- 正文只放事实，不放判断：不写内部备注、IP、哈希、其他申请人的数据。
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
| `{confirmUrl}` | 案例页确认入口 | `https://xknot.si/case/<opaque>` |
| `{claimUrl}` | 一次性领取页 | `https://xknot.si/claim/<opaque>` |
| `{portalUrl}` | 门户条目链接 | `https://xknot.si/en/` |
| `{supportUrl}` | 对外支持入口 | 可选，留空则整行省略 |
| `{claimTtl}` | 领取有效期，随令牌实际 TTL（1–168 小时） | `72 小时` |
| `{subdomain}` | 子域 | `wang.xknot.si` |
| `{entryHost}` / `{account}` / `{port}` | 入口与隧道 | `54.169.33.64` / `knot-tunnel-wang` / `18080` |
| `{healthUrl}` | 探测地址 | `https://wang.xknot.si/api/health` |
| `{statusLabel}` | 运行状态 | `正常` |
| `{contactMasked}` | 脱敏联系人 | `m***@gmail.com` |
| `{effectiveAt}` / `{reclaimAt}` / `{exportUntil}` | 时间点 | `2026-11-01` |
| `{resumeCondition}` | 恢复条件 | 运营方填写，只写条件不写评价 |

---

## 3. 事件与状态

### 3.1 状态迁移 → 事件

| 迁移 | 事件 | 收件人 |
|------|------|--------|
| 提交（自动 `approved`） | `partner.approved` | 申请人 |
| 签发子域、接入参数确定（仅 `subdomain`） | `partner.issuance` | 主理人 |
| 接入件生成、一次性领取就绪 | `partner.handoff` | 主理人 |
| 验收通过、清单 `status` 转 `active` | `partner.live` | 主理人 |
| 运行 `active` → `suspended` | `partner.suspended` | 联系人 |
| 运行 `active` / `suspended` → `retired` | `partner.retired` | 联系人 |
| 探测 `down` 连续 24 小时 | `partner.unreachable_24h` | 联系人 |
| 探测 `down` 连续 7 天 | `partner.hidden_7d` | 联系人 |
| 每 180 天 | `partner.contact_revalidate` | 联系人 |

没有邮箱验证、搁置或拒绝信：提交即通过，所有后续动作都从案例页或运营方补发起步。

---

## 4. 模板

主题统一 `[XKnot] {id} <动作>`。正文末尾固定签名，不再重复。

### 4.1 `partner.approved`

**主题**：`[XKnot] {id} 已通过，地址已签发`

```text
{operator} 你好：

你提交的 XKnot 联邦加入申请（{id}）已通过。平台在收到申请时自动核对，通过即生效，不需要再等回信。

站点：{name}
地址：{url}
当前档位：免费

接下来中枢会自动把实例写进联邦清单并接通入口。收录当天，门户的实例目录里会出现这个条目：状态先是「待验收」，公网 /api/health 通过后转为在线。

收录不包含入口主机与 SSH 反向隧道，需要时另行确认。

委托发信默认由中枢代发：要用它，请运营方签发一次接入件（一次性领取），里面带发信凭据；不必自己配 SMTP。

申请状态与公钥提交：
{caseUrl}

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 已通過，位址已簽發`

```text
{operator} 你好：

你提交的 XKnot 聯邦加入申請（{id}）已通過。平台在收到申請時自動核對，通過即生效，不需要再等回信。

站點：{name}
位址：{url}
目前檔位：免費

接下來中樞會自動把實例寫進聯邦清單並接通入口。收錄當天，入口的實例目錄裡會出現這個條目：狀態先是「待驗收」，公網 /api/health 通過後轉為上線。

收錄不包含入口主機與 SSH 反向隧道，需要時另行確認。

委託發信預設由中樞代發：要用它，請營運方簽發一次接入件（一次性領取），裡面帶發信憑證；不必自己設 SMTP。

申請狀態與公鑰提交：
{caseUrl}

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] {id} is approved and the address is issued`

```text
Hello {operator},

Your application to join the XKnot Federation ({id}) is approved. The hub checks every application as it arrives, so approval takes effect immediately and no further reply is needed.

Site: {name}
URL: {url}
Current tier: free

The hub will now add the instance to the federation manifest and connect the entry. The entry appears in the portal's instance directory on the day it is listed: first as pending, then as online once the public /api/health check passes.

Listing does not include the entry host and SSH reverse tunnel, which are confirmed separately.

Delegated mail is on by default: when you want it, ask the operator to issue an access material (one-time claim), which carries a relay token; you need no SMTP setup of your own.

Application status and public key:
{caseUrl}

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.2 `partner.issuance`

**只在公钥迟到时发。** 正常流程里申请人在 `/case/<caseKey>` 已经交过 `.pub`，通过后中枢直接把配置做完并寄 `partner.handoff`，跳过这一封。若案例页一直没收到公钥，再用 `npm run admin -- notify <申请编号> partner.issuance` 索取；此时前置停在 `account` 一步（缺公钥写不了 `authorized_keys`）。

**主题**：`[XKnot] {id} 的接入信息已确定`

```text
{operator} 你好：

实例 {id}（{name}）的接入信息已确定。

实例地址：{url}
入口主机：{entryHost}
隧道账号：{account}
专属端口：{port}

下一步需要你做两件事：

1. 在本机生成密钥，私钥留在本机：
   ssh-keygen -t ed25519 -f ~/.ssh/knot-entry-{id} -N ''

2. 把 ~/.ssh/knot-entry-{id}.pub 的内容交给我们：
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

實例位址：{url}
入口主機：{entryHost}
隧道帳號：{account}
專屬埠：{port}

下一步需要你做兩件事：

1. 在本機產生金鑰，私鑰留在本機：
   ssh-keygen -t ed25519 -f ~/.ssh/knot-entry-{id} -N ''

2. 把 ~/.ssh/knot-entry-{id}.pub 的內容交給我們：
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

Instance URL: {url}
Entry host: {entryHost}
Tunnel account: {account}
Dedicated port: {port}

Two things to do next:

1. Generate a key pair on your own machine, keeping the private key local:
   ssh-keygen -t ed25519 -f ~/.ssh/knot-entry-{id} -N ''

2. Send us the contents of ~/.ssh/knot-entry-{id}.pub:
   {caseUrl}

Send the .pub file only. Never send the private key, and never paste it into mail or a web page.

Once the key is installed and the port is ready, we will send a handoff message.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.3 `partner.handoff`

**主题**：`[XKnot] {id} 的接入资料已就绪`

```text
{operator} 你好：

实例 {id}（{name}）的接入资料已就绪。

请在 {claimTtl}内领取：
{claimUrl}

领取页只显示一次，领取后请立即写进实例配置；不要转发、截图或存进版本库。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

**主題**：`[XKnot] {id} 的接入資料已就緒`

```text
{operator} 你好：

實例 {id}（{name}）的接入資料已就緒。

請在 {claimTtl}內領取：
{claimUrl}

領取頁只顯示一次，領取後請立即寫進實例設定；不要轉發、截圖或存進版本庫。

本郵件由系統發出，不接收回覆。

—— XKnot 聯邦
```

**Subject**：`[XKnot] access material for {id} is ready`

```text
Hello {operator},

Access material for instance {id} ({name}) is ready.

Claim it within {claimTtl}:
{claimUrl}

The claim page is shown once. Write it into the instance configuration right away; do not forward, screenshot, or commit it.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.4 `partner.live`

**主题**：`[XKnot] {id} 已在联邦上线`

```text
{operator} 你好：

实例 {id}（{name}）已接入 XKnot 联邦。

公网地址：{url}
门户条目：{portalUrl}
运行状态：{statusLabel}

之后中枢会定期探测 {healthUrl}。连续不可达时运行状态会变成中断，条目保留，不自动删除。

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

之後中樞會定期探測 {healthUrl}。連續不可達時運行狀態會變成中斷，條目保留，不自動刪除。

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

The hub probes {healthUrl} periodically. If the instance stays unreachable, its runtime status becomes down; the entry stays and is not removed automatically.

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

**触发**：`ops/provision-worker.mjs` 探测到 `/api/health` 通过、清单 `status` 转 `active` 的那一轮自动发送（`ops/notify-live.mjs`）。事件 + 申请号在 `notify_log` 里唯一，进程重启不会补发第二封；投递失败标 `failed`，之后可用 `admin-cli live <申请号>` 补发。没有 SMTP 配置时只打一行日志，不影响验收。

---

### 4.5 `partner.contact_revalidate`

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

### 4.6 `partner.suspended`

**主题**：`[XKnot] {id} 已暂停收录`

```text
{operator} 你好：

实例 {id}（{name}）已在联邦中暂停收录。

生效时间：{effectiveAt}

影响：

- 门户不再展示该条目的站点档案与热点橱窗
- 委托发信暂停（凭据保留，恢复收录后继续可用）
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
- 委託發信暫停（憑證保留，恢復收錄後繼續可用）
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
- relay sending is paused (the credential stays and works again once the listing resumes)
- the tunnel account is disabled

Not affected:

- the instance's own database, accounts, content, and points

To resume: {resumeCondition}

This message was sent automatically; replies are not monitored.

— XKnot Federation
```

---

### 4.7 `partner.retired`

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

### 4.8 `partner.unreachable_24h`

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
需要变更地址或请人协助，请写信给 {outbox}。

本邮件由系统发出，不接收回复。

—— XKnot 联邦
```

### 4.9 `partner.hidden_7d`

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
**主题**：`[XKnot] 新成员 {id} · {name} 已自动通过`
**正文**：

```text
有一条新的加入申请，已按提交即通过自动结案。

编号：{id}
站点：{name}
地址：{url}
运营方：{operator}
联系邮箱：{email}
区域 / 时区：{region} / {timezone}
简介：{intro}
标签：{tags}

下一步是写清单、接通入口；收录后的档位默认免费，要改收费在实例配置里改：
{origin}/admin/
```

### 5.2 `internal.instance_alert`

**主题**：`[XKnot] {id} 运行状态异常`

```text
实例 {id}（{name}）需要关注。

现象：{alertLabel}
首次出现：{firstSeenAt}
最近一次探测：{checkedAt}（{httpStatus}，{latencyMs} ms）
公网地址：{url}

处置面板：{origin}/admin/
```

`{alertLabel}` 取值：`down_24h`（连续 24 小时不可达）、`down_7d`（连续 7 天，已暂时关闭）、`never_14d`（签发后 14 天仍未接通）、`never_30d`（签发后 30 天，已暂时关闭）、`relay_quota_80`（发信额度用掉 80%）、`cert_expiring_14d`（入口主机证书 14 天内到期）。

---

## 6. 上线前必须补齐

| 项 | 状态 | 影响 |
|----|------|------|
| 案例页 `/case/<caseKey>` | 已实现 | 状态、公钥与撤回的动作入口；`issuance`、`handoff`、`contact_revalidate` 也指向这里 |
| 领取页 `/claim/<token>` | 已实现 | 明文只显示一次，72 小时过期；邮件正文不含凭据 |
| 对外支持入口 `{supportUrl}` | **待定** | 选了 `no-reply` 之后伙伴没有回信渠道。上线前必须在支持页与工单邮箱之间定一个；为空时该行整段省略，但那样伙伴只能靠案例页 |
| `no-reply@xknot.si` 的发信认证 | 已配 | 阿里云要求 `SMTP_USER` 与 `SMTP_FROM` 一致；改发信地址要同时改两处 |
| `MAIL_FROM` 与 `Reply-To` 一致 | 已配 | 二者都用 `no-reply@xknot.si`，与「不接收回复」的措辞一致 |
| 模板版本与文案责任人 | 已定 | 运行时版本 `TEMPLATE_VERSION=2.2.0`；改文案必须两边一起改并升版本 |
| 归属验证记录 | **无** | 申请只按子域走，签发前没有可验证的域名。验收改为接通后的公网 `/api/health` 探测；`proof_method` / `proof_at` 两列已不再写入，申请对象不返回这两个字段 |

---

## 7. 与实现的对应

| 位置 | 实际做法 |
|------|----------|
| `server/notify.mjs` | `TEMPLATES[event] = { audience, subject: {locale}, text: {locale} }`；占位符 `{name}`；`buildMail(event, application, options)` |
| `server/store.mjs` | `notify_log` + `unique(event, case_id, state_version)`；`state_version` 在每次状态迁移 +1；运营类事件（签发/交付/上线）不传版本号，允许补发 |
| `server/app.mjs` | 提交（自动通过）、案例动作、交付处调用 `dispatchMail`；限流命中记 `throttled` |
| `server/pages.mjs` | 两个页面无脚本、无构建；所有变量经 `escapeHtml`；页面自带 CSP 与 `no-store` |
| `server/admin-cli.mjs` | `notify` 补发任意事件；`handoff` 生成领取令牌并打印领取地址；`suspend` / `retire` 只发信，清单状态仍需按 ops 清单改 |
| `server/notify.test.mjs` | 11 个事件 × 3 语种；断言无占位符残留、无凭据明文、内部备注不外发 |
| `ops/xknot.si.conf` | `/case/`、`/claim/`、`/api/claim`、`/api/case/` 关闭 `access_log` |

改文案的流程：先改本文，再改 `server/notify.mjs`，升 `TEMPLATE_VERSION`，跑 `npm test`。测试断言关键要素（编号、语种、闭合句、档位），不逐字比对全文，避免标点改动就红。
