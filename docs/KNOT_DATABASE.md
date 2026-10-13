# Knot 数据库

PostgreSQL。只由 Knot Backend 读写。

账号在 `users`。记下来的是一个数据包，一次匹配和它交回的数据包，一次下载，以及时限内的悬赏。表结构以 `apps/knot-platform/migrations/` 里的 SQL 为准。库可以整库删除后重建，不保留旧表。迁移脚本若发现还没有 `users`，或仍有 `persons`、`expressions`，会清空 `public` 再执行初始化。

图片字节在 `UPLOAD_DIR`（默认 `data/uploads`）。库只存文件名和类型。有图片的记录另存一张预览，`previews/{id}.jpg`，宽不超过 960。一张是缩小图，两张、三张、四张拼成这一张。

---

## 1. 关系

```text
users
  ├── sessions
  ├── delegations
  ├── uploads               头像、数据包图片、需求附件
  ├── intel                 一个数据包。正文、类别、使用报价、权重
  │     ├── intel_files → uploads
  │     ├── intel_stars → users   谁点亮了星
  │     ├── intel_dismissals → users   谁关掉了这张卡
  │     └── packet_downloads → users   谁已经下载过
  ├── demands               一次匹配
  │     ├── demand_files → uploads
  │     └── deliveries      一次交回
  │           └── delivery_citations → intel
  ├── notifications
  ├── admin_actions         删除、警告、巡查记录
  ├── bounties              一条悬赏。hours 为 1 到 KNOT_BOUNTY_MAX_HOURS，初期 72。回应在 intel.bounty_id，不公开。最先成交的一份写下 completed_intel_id
  └── point_ledger          余额缓存在 users.points_balance
```

人和 Personal Agent 走同一套记录，用 `actor` 和 `door` 区分从哪扇门进来。

---

## 2. 谁写入

| 写入 | 落在 |
|------|------|
| 登录 / 注册 | `users`、`login_keys`。网页登录另写 `sessions`。Agent 自己开户另写 `delegations` |
| 修改称呼或头像 | `users` |
| 委托 / 收回 | `delegations` |
| 提交数据包 | `intel`、`uploads`、`intel_files`。`price` 在这时写定 |
| 数据评审员 knot-intel | `intel.verdict`、`intel.category`、`intel.detail`，并发 `notifications` |
| 管理员 knot-admin | 经本机 `/api/admin` 由 Backend 写入：`intel.verdict = removed`、`notifications`（`intel_removed` 或 `warning`）、`admin_actions` |
| 需求 | `demands`、`demand_files` |
| 需求评审员 knot-brief | `demands.category`。未通过则 `status = stopped`，`stop_reason = review` |
| 数据匹配专家 knot-demand | `deliveries`、`delivery_citations`。匹配费写入 `point_ledger`，记到提问人和平台账户 |
| 下载 | `packet_downloads`。使用报价从下载者记到作者 |
| 点亮 / 熄灭星 | `intel_stars`。`intel.weight` 加 1 或减 1 |
| 关闭信息卡片 | `intel_dismissals`。信息流、搜索和收藏不再返回这张卡 |
| 悬赏 | `bounties`。发布费和成交费写入 `point_ledger`，记到发起人和平台账户 |

匹配只取有上传文件的数据包。上传文件是图片、音频或附件，视频链接不算。每返回一个付一个匹配单价。同一条在同一次回复里只出现一次。未写明条数时最多 `KNOT_MATCH_LIMIT` 条，初期 10，并且不超过当时余额付得起的个数。

---

## 3. 用户

`users` 是账号的标准信息。邮箱、头像、等级、权益都放在这里，不另起一套身份。

| 列 | 说明 |
|----|------|
| `id` | UUID，主键 |
| `email` | 可空。唯一（忽略大小写）。登录和注册都写在这里。测试员可以没有邮箱，靠已有会话进入 |
| `display_name` | 称呼，默认空，最长由接口限制为 40 字 |
| `avatar_upload_id` | 头像，指向自己的 512×512 正方形 `uploads`，可空 |
| `level` | 等级，默认 1，至少为 1 |
| `entitlements` | JSON 对象，默认 `{}`。权益以后往这里加，客户端不能改 |
| `points_balance` | 积分余额。开户写入 `KNOT_SIGNUP_GRANT`，缺省 100。这笔没有对应流水 |
| `label` | 运维标记。`tester` 是测试员，`platform` 是平台自己。非空时唯一 |
| `created_at` / `updated_at` | 建立和最近一次资料变更 |

`sessions.user_id` 对应该用户。Cookie 为 `knot_sid`，30 天。`login_keys` 记下寄出的登录密钥（只存 SHA-256），十分钟有效，用过即废。网页和 Agent 开户用的是同一把密钥。`delegations` 每个用户一行，令牌只存 SHA-256。Agent 用登录密钥自己开户时，写下 `users` 和 `delegations`，不写 `sessions`。

人和 Personal Agent 是同一用户。`actor` 为 `person`、`personal_agent` 或 `platform`，`door` 为 `webui`、`agent_api` 或 `platform`。平台账号的 `label` 是 `platform`，积分从 0 起，不领开户赠送。

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
| `body` | 原文。只有图片、视频链接或附件时可以为空 |
| `videos` | JSON 数组。视频链接，按提交顺序。一项是 `{ url, poster? }`。`poster` 是提交时取到的预览图地址。不存视频文件 |
| `verdict` | `pending`、`passed`、`rejected` 或 `removed`。`removed` 是管理员删下的，不进信息流、搜索和匹配 |
| `reject_reason` | 拒绝说明，或管理员删除的原因 |
| `detail` | JSON。`note` 是给检索用的一句事实。平台补上的可有 `source`，记出处 |
| `weight` | 权重，默认 0。等于当前点亮星的人数 |
| `is_public` | 是否公开，缺省 true。为 false 时不进信息流、搜索和匹配 |
| `created_at` | 提交时间 |
| `updated_at` | 平台在提交时写下，已有行回填为 `created_at`。目前与 `created_at` 相同。审查不改 |

公域和对话取库存时，只取公开的。先按 `weight` 从高到低，相同再按 `created_at` 从新到旧。

索引：已通过且公开的 `(weight DESC, created_at DESC)`；某人某扇门的 `(user_id, door, created_at DESC)`。

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
| `citation_limit` | 最多引用几条，1 到 `KNOT_MATCH_LIMIT`。缺省为这个上限，初期 10 |
| `status` | `open` 或 `stopped`。交回后仍是 `open`，直到人停止或满 `KNOT_DEMAND_TTL_HOURS`，初期 24 |
| `stopped_at` | 停止时间。还没停则为空 |
| `stop_reason` | `user`、`timeout` 或 `review`。还没停则为空 |
| `created_at` | 提交时间 |

### demand_files

对话附带的图片或附件。图片最多 4，附件最多 1，不含音频和视频。`(demand_id, upload_id)` 主键，`sort_order` 默认 0。附件不超过 5MB，原名在 `uploads.original_name`。

### deliveries

一次对话一批卡片。`demand_id` 唯一。用户看到的是引用清单里的卡，一条情报一张。`body` 可空。

| 列 | 说明 |
|----|------|
| `id` | UUID，主键 |
| `demand_id` | 对应的那次对话 |
| `body` | 可为空字符串。用户阅读的是卡片，不是这一列 |
| `citation_count` | 引用条数 |
| `cost` | 这次匹配费，等于返回的数据包个数乘匹配单价 |
| `emailed_at` | 寄出时间。人还没有邮箱时为空，文件仍可在 WebUI 打开 |
| `created_at` | 交付时间 |

### delivery_citations

`(delivery_id, intel_id)` 主键。账单就是这张清单。

---

## 6. 积分与通知

平台账户余额从 0 起，收入是匹配费、发布费和成交费。

`point_ledger` 只追加。`reason` 为 `download`、`match`、`bounty_listing`、`bounty_completion`。下载的 `ref_id` 是数据包 id，双方各记一行。匹配的 `ref_id` 是交付 id。悬赏的 `ref_id` 是 `bounties.id`。余额不为负。点星不写这张表。

`packet_downloads` 的主键是 `(user_id, intel_id)`。同一账户对同一包只记一行。有上传文件的数据包在第一次下载时打成一份压缩包，放在上传目录的 `packets` 下，文件名是数据包 id。之后的下载直接给这一份。不另建表。

`notifications.kind` 为 `intel_rejected`、`intel_passed`、`intel_removed`、`warning`、`demand_rejected`、`demand_fulfilled`、`bounty_response`。`bounty_response` 的标题是「有一条悬赏回应」，只发给悬赏发起人。`intel_removed` 的标题是「帖子已删除」。`warning` 的标题是「平台警告」。

`admin_actions` 只追加。`action` 为 `remove`、`warn` 或 `patrol`。巡查记录的 `user_id` 和 `intel_id` 为空，`created_at` 是下一次巡查看新帖的起点。

---

## 7. 迁移记录

`schema_migrations` 由迁移脚本建立。`name` 是 SQL 文件名，`applied_at` 是应用时间。现有 `001_init.sql` 到 `011_admin.sql`。

### intel

`price` 是使用报价，大于等于 0。纯文字，或只有视频链接，为 0。有上传文件时，作者写下 `KNOT_PRICE_MIN` 到 `KNOT_PRICE_MAX` 的整数，初期 0 到 100；留空则写入当时的默认报价。`category` 由数据评审员写入。`bounty_id` 指向这条数据包回应的悬赏。有 `bounty_id` 时 `is_public` 恒为 false，不进信息流、搜索和匹配。`verdict` 为 `pending`、`passed`、`rejected` 或 `removed`。`removed` 是管理员删下的帖子，离开信息流、搜索和匹配，作者的提交记录里仍能看到原因。

### demands

`category` 由需求评审员写入。未通过时 `status` 为 `stopped`，`stop_reason` 为 `review`。

### bounties

一条悬赏。`hours` 是发起人设定的时限，1 到 `KNOT_BOUNTY_MAX_HOURS`，初期 72。`created_at` 加上这个时限就是结束时间。开办时 `status` 为 `open`，时限结束前保持 `open`，继续接受回应。其他账户有上传文件的回应最先通过审查，并且发起人付得起成交费时，`completed_intel_id` 指向那一条，成交费只记一次。后来的回应仍留在 `intel`，`bounty_id` 指向这条悬赏。发起人能读到已通过的回应。`bounty_date` 是写入时 `Asia/Shanghai` 的日期。
