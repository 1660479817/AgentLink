# Knot 数据库

PostgreSQL。只由 Knot Backend 读写。

账号在 `users`。记下来的是一条情报，一次对话和它交回的文件，以及有效期内的悬赏。表结构以 `apps/knot-platform/migrations/` 里的 SQL 为准。库可以整库删除后重建，不保留旧表。迁移脚本若发现还没有 `users`，或仍有 `persons`、`expressions`，会清空 `public` 再执行初始化。

图片字节在 `UPLOAD_DIR`（默认 `data/uploads`）。库只存文件名和类型。

---

## 1. 关系

```text
users
  ├── sessions
  ├── delegations
  ├── uploads               头像、情报图片、对话附件
  ├── intel                 一条情报，带权重
  │     ├── intel_files → uploads
  │     ├── intel_stars → users   谁点亮了星
  │     └── intel_dismissals → users   谁关掉了这张卡
  ├── demands               一次对话
  │     ├── demand_files → uploads
  │     └── deliveries      一份文件
  │           └── delivery_citations → intel
  ├── notifications
  ├── bounties              一条悬赏。截止前保持开放
  │     └── bounty_claims   一个人的认领和交货。截止后记下质量和分到的积分
  └── point_ledger          余额缓存在 users.points_balance
```

人和 Personal Agent 走同一套记录，用 `actor` 和 `door` 区分从哪扇门进来。

---

## 2. 谁写入

| 写入 | 落在 |
|------|------|
| 登录 / 注册 | `users`、`login_keys`、`sessions` |
| 修改称呼或头像 | `users` |
| 委托 / 收回 | `delegations` |
| 提供情报 | `intel`、`uploads`、`intel_files` |
| knot-intel | `intel.verdict`、`intel.detail`。通过则 `point_ledger` 入账 1，并发 `notifications` |
| 对话 | `demands`、`demand_files` |
| knot-demand | 把 seek 交回的结果写入 `intel`（平台账号），再写 `deliveries`、`delivery_citations`。按引用条数扣 `point_ledger`，并发 `notifications` |
| knot-seek | 不写库。结果交给 knot-demand |
| 点亮 / 熄灭星 | `intel_stars`。`intel.weight` 加 1 或减 1 |
| 关闭信息卡片 | `intel_dismissals`。信息流、搜索和收藏不再返回这张卡 |
| 悬赏 | `bounties`、`bounty_claims`。截止后按质量把积分写入 `point_ledger`，`reason` 为 `bounty` |

每条情报同一个单价，数值是 1。合格入账 1。一张卡引用一条，就扣 1。同一条库存在同一次回复里只出现一次。未写明条数时最多 10 条，并且不超过当时余额。

---

## 3. 用户

`users` 是账号的标准信息。邮箱、头像、等级、权益都放在这里，不另起一套身份。

| 列 | 说明 |
|----|------|
| `id` | UUID，主键 |
| `email` | 可空。唯一（忽略大小写）。登录和注册都写在这里。测试员可以没有邮箱，靠已有会话进入 |
| `display_name` | 称呼，默认空，最长由接口限制为 40 字 |
| `avatar_upload_id` | 头像，指向自己的图片 `uploads`，可空 |
| `level` | 等级，默认 1，至少为 1 |
| `entitlements` | JSON 对象，默认 `{}`。权益以后往这里加，客户端不能改 |
| `points_balance` | 积分余额，默认 10。这 10 分没有对应流水 |
| `label` | 运维标记。`tester` 是测试员，`platform` 是平台自己。非空时唯一 |
| `created_at` / `updated_at` | 建立和最近一次资料变更 |

`sessions.user_id` 对应该用户。Cookie 为 `knot_sid`，30 天。`login_keys` 记下寄出的登录密钥（只存 SHA-256），十分钟有效，用过即废。`delegations` 每个用户一行，令牌只存 SHA-256。

人和 Personal Agent 仍是同一用户。`actor` 为 `person`、`personal_agent` 或 `platform`，`door` 为 `webui`、`agent_api` 或 `platform`。平台账号的 `label` 是 `platform`，积分从 0 起，不领开户的 10 分。

---

## 4. 情报

### intel

一条情报。关于自己或关于别人，都是这一行。用户不选类别。

| 列 | 说明 |
|----|------|
| `id` | UUID，主键 |
| `user_id` | 提交者。公域不返回这个 id，只返回称呼和头像 |
| `actor` | `person`、`personal_agent` 或 `platform` |
| `door` | `webui`、`agent_api` 或 `platform` |
| `body` | 原文。只有图片或附件时可以为空。链接写在原文里 |
| `verdict` | `pending`、`passed` 或 `rejected` |
| `reject_reason` | 拒绝说明。只有违规才拒绝 |
| `detail` | JSON。`note` 是给检索用的一句事实。平台补上的可有 `source`，记出处 |
| `weight` | 权重，默认 0。等于当前点亮星的人数 |
| `created_at` | 提交时间 |

公域和对话取库存时，先按 `weight` 从高到低，相同再按 `created_at` 从新到旧。

索引：已通过的 `(weight DESC, created_at DESC)`；某人某扇门的 `(user_id, door, created_at DESC)`。

### intel_files

`(intel_id, upload_id)` 主键，`sort_order` 默认 0。情报或上传删除时级联删除。`uploads` 是 `id`、`user_id`、`storage_name`、`mime`、`original_name`、`created_at`。

### intel_stars

谁的收藏。`(user_id, intel_id)` 主键，`created_at` 为点亮时间。同一对只一行。删掉这行就是熄灭。`intel.weight` 与行数一致。

### intel_dismissals

谁关掉了哪张卡。`(user_id, intel_id)` 主键，`created_at` 为关闭时间。情报还在，只是这个人的信息流、搜索和收藏不再列出。以后按这些记录做偏好。

---

## 5. 对话与交付

### demands

| 列 | 说明 |
|----|------|
| `id` | UUID，主键 |
| `user_id` | 谁在对话 |
| `actor` | `person` 或 `personal_agent` |
| `door` | `webui` 或 `agent_api` |
| `brief` | 约定 |
| `citation_limit` | 最多引用几条，1 到 10，默认 10 |
| `status` | `open` 或 `fulfilled` |
| `created_at` | 提交时间 |

### demand_files

对话附带的图片或文件。`(demand_id, upload_id)` 主键，`sort_order` 默认 0。文件不超过 5MB，原名在 `uploads.original_name`。

### deliveries

一次对话一批卡片。`demand_id` 唯一。表名仍是 `demands`。用户看到的是引用清单里的卡，一条情报一张。`body` 可空。

| 列 | 说明 |
|----|------|
| `id` | UUID，主键 |
| `demand_id` | 对应的那次对话 |
| `body` | 可为空字符串。用户阅读的是卡片，不是这一列 |
| `citation_count` | 引用条数 |
| `cost` | 扣除的积分，等于条数乘单价 |
| `emailed_at` | 寄出时间。人还没有邮箱时为空，文件仍可在 WebUI 打开 |
| `created_at` | 交付时间 |

### delivery_citations

`(delivery_id, intel_id)` 主键。账单就是这张清单。

---

## 6. 积分与通知

`point_ledger` 只追加。`reason` 为 `intel_reward`、`demand` 或 `bounty`。奖励的 `ref_id` 是情报 id，平台补上的也用这一条，只入账一次。扣款的 `ref_id` 是交付 id。悬赏的 `ref_id` 是 `bounties.id`。余额不为负。点星不写这张表。

`notifications.kind` 现为 `intel_rejected`、`intel_credited`、`demand_fulfilled`。

---

## 7. 迁移记录

`schema_migrations` 由迁移脚本建立。`name` 是 SQL 文件名，`applied_at` 是应用时间。现有 `001_init.sql`、`002_bounties.sql`、`003_bounty_claims.sql`、`004_information.sql`。

### bounties

一条悬赏。有效期从 `created_at` 起算，小时数是 `BOUNTY_TTL_HOURS`，缺省 24。过期后不能再认领、完成或提交。`bounty_date` 是写入时 `Asia/Shanghai` 的日期。`reward` 是截止后拿来分配的绩点总额，至少为 1。库存缺的那一截由 Backend 写入，`demand_id` 指向那次对话，同一对话只一行。`status` 在截止前为 `open`，分配之后为 `settled`。

`bounty_claims` 是一个人在这条悬赏上的进度。同一个人只能一行。`status` 为 `claimed`、`completed`、`submitted`。`result` 是交货文字。`bounty_claim_files` 记下交货引用的图片和其他附件，主键是 `(bounty_id, user_id, upload_id)`。截止时 knot-demand 判断这份交货对不对得上：对得上 `quality` 为 1，否则为 0。`awarded` 是按质量从 `reward` 里分到的整数，余数给先提交的。没提交的不参与。
