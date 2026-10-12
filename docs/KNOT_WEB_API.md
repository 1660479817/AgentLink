# Knot WebUI 与 Knot Backend

Knot WebUI 在 AgentLink 平台外，只调用本文的接口访问 Knot Backend。

信息架构见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md)。库见 [KNOT_DATABASE.md](./KNOT_DATABASE.md)。

人和他的 Agent 是同一套逻辑。WebUI 走本文。用户的 Agent 走 [KNOT_AGENT_API.md](./KNOT_AGENT_API.md)。

---

## 1. 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/login` | `{ email }`。登录和注册同一入口。把登录密钥寄到这个邮箱。同一邮箱一分钟内只寄一次 |
| POST | `/api/web/login/key` | `{ email, key }`。密钥正确则进入账号。邮箱还没有用户时注册，已有则登录。返回 `{ user }` |
| GET | `/api/web/session` | 当前用户。无会话时 `{ user: null }` |
| DELETE | `/api/web/session` | 结束会话，不删除用户 |
| PATCH | `/api/web/profile` | `{ displayName?, avatarUploadId? }`。称呼最多 40 字。头像必须是本人已上传的图片 |

`user` 为 `{ id, email, displayName, avatarUrl, level, entitlements, pointsBalance }`。等级和权益只读。

登录密钥与 Agent 开户是同一把，用过即废。用在网页上得到会话，用在 [Agent API](./KNOT_AGENT_API.md) 上得到授权码。

---

## 2. 提供信息

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/uploads` | `multipart` 字段 `file`，图片存平台，返回 `{ id, url }` |
| POST | `/api/web/files` | 文字输入的附件。`multipart` 字段 `file`，5MB 以内，返回 `{ id, url, name, mime }` |
| GET | `/api/web/uploads/:id` | 读取图片或附件 |
| POST | `/api/web/intel` | `{ body, imageIds?, fileIds?, price?, bountyId? }`。文字、图片、附件至少有一个 |
| POST | `/api/web/intel/:id/download` | 下载一个已通过的数据包。返回 `{ intel }`，图片和文件带地址 |
| GET | `/api/web/submissions` | 当前用户从 WebUI 提交的数据包，含类别、报价、图片和附件 |

数据评审员通过后 `verdict = passed`，并写入 `category`。纯文字 `price` 为 0。带图片或其他附件时，`price` 是作者写下的整数；留空为 `KNOT_DEFAULT_PRICE`，初期 10。只有图片或附件时 `body` 可以为空。

提交成功返回 `{ intel }`：`{ id, body, images, attachments, category, price, verdict, rejectReason, granted, createdAt }`。作者看自己的提交时，附件带地址。

---

## 3. 信息流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/bounties` | 仍在时限内的悬赏 |
| POST | `/api/web/bounties` | `{ body, hours }`。`hours` 为 1 到 72。开办时付发布费 |
| GET | `/api/web/information` | 已通过的数据包里最新的 30 条。已登录时不含自己关掉的 |
| GET | `/api/web/search?q=` | 在更大范围内筛选，最多 30 条。已登录时不含自己关掉的 |
| POST | `/api/web/intel/:id/dismiss` | 关掉这张卡。写入 `intel_dismissals`，之后不再出现在信息流、搜索和收藏 |

悬赏条目：`{ id, body, hours, status, endsAt }`。`status` 为 `open`。向这条悬赏提交数据包时，在 `POST /api/web/intel` 带上 `bountyId`。

条目：`{ id, role, body, category, price, images, attachments, imageUrls, author, starred, granted, createdAt }`。`role` 恒为 `intel`。未交付时附件是 `{ id, name, mime }`，`imageUrls` 为空，`granted` 为 false。作者，以及已经下载过的账户，附件带 `url`。`author` 是 `{ name, avatarUrl }`，没有称呼时 `name` 为空，不返回用户 id 和邮箱。`starred` 表示当前会话是否点亮了这张卡，未登录为 false。关掉一张卡要有会话，返回 `{ ok: true }`。没有这张已通过的数据包时 404。列表按权重从高到低，相同再按时间从新到旧。

---

## 4. 对话与星星

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/files` | `multipart` 字段 `file`，5MB 以内，返回 `{ id, url, name, mime }` |
| POST | `/api/web/demands` | `{ brief, fileIds?, citationLimit? }`。文字和附件至少有一个 |
| GET | `/api/web/demands` | 当前用户在 WebUI 的委托 |
| POST | `/api/web/demands/:id/stop` | 停止一条仍开放的委托。已经停下则 409 `not_open` |

`citationLimit` 缺省为 10，最大 10。需求评审员通过后，数据匹配专家从带附件的数据包里返回。每返回一个，提问人付一个匹配单价，记到平台账户。余额覆盖多少，就返回多少。

返回 `{ demand }`：`{ id, brief, category, citationLimit, status, body, images, attachments, cards, replies, citationCount, cost, createdAt, stoppedAt, stopReason }`。`images`、`attachments` 是发出去的材料。`cards` 每张是 `{ id, body, category, price, images, attachments, granted, starred }`。`replies` 按时间列出回应：`{ kind: "system", code, createdAt, count? }` 或 `{ kind: "delivery", id, createdAt, body, category, price, granted, images, attachments, starred?, starrable? }`。`code` 为 `working`、`delivered`、`empty`、`stopped`、`timeout`。

`status` 为 `open` 时，委托还在 24 小时内。人停止或满 24 小时后为 `stopped`，`stopReason` 为 `user` 或 `timeout`。需求未通过时为 `review`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/intel/:id/star` | 点亮。写入收藏，该情报权重加 1。已经亮着则不变。返回 `{ starred: true }` |
| DELETE | `/api/web/intel/:id/star` | 熄灭。移出收藏，权重减 1。返回 `{ starred: false }` |
| GET | `/api/web/stars` | 当前用户的收藏，卡片字段与上面相同 |

---

## 5. 通知与积分

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/notifications` | `{ unread, notifications[] }` |
| POST | `/api/web/notifications/read` | 全部标已读 |

`kind`：`intel_rejected`、`intel_passed`、`demand_rejected`、`demand_fulfilled`。余额在会话返回的 `user.pointsBalance`。下载按报价把全额从下载者记到作者。匹配费、发布费和成交费记到平台账户。

---

## 6. 委托

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/delegation` | 签发或更换授权码。返回 `{ token, createdAt }`。明文只此一次，旧码立刻失效 |
| GET | `/api/web/delegation` | `{ delegated, createdAt }`。没有授权时 `createdAt` 为 null。不返回明文 |
| DELETE | `/api/web/delegation` | 收回 |

---

## 7. 错误

| HTTP | `error` |
|------|---------|
| 401 | `no_session` |
| 400 | `empty_body`、`bad_mime`、`bad_hours` |
| 402 | `insufficient_points` |
| 409 | `bad_state` |
| 503 | `process_unavailable` |

---

## 8. 边界

数据库与 knot-intel、knot-brief、knot-demand 的流水线只在 Backend 内。上传目录由 `UPLOAD_DIR` 配置。登录密钥经 SMTP 寄出（`SMTP_HOST`、`MAIL_FROM`）。卡片仍先在 WebUI 打开，`deliveries.emailed_at` 留空。
