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
| GET | `/api/web/session` | 当前用户。无会话时 `user` 为 null。同时返回 `policy` |
| DELETE | `/api/web/session` | 结束会话，不删除用户 |
| PATCH | `/api/web/profile` | `{ displayName?, avatarUploadId? }`。称呼最多 40 字。头像必须是本人已上传的 512×512 正方形。页面会把更大的正方形收成 512×512；不是正方形返回 `bad_avatar_square`，尺寸不对返回 `bad_avatar_size` |

`user` 为 `{ id, email, displayName, avatarUrl, level, entitlements, pointsBalance }`。等级和权益只读。`policy` 为 `{ demandTtlHours, matchLimit, bountyMaxHours, defaultPrice, priceMin, priceMax, listingFee, completionFee }`。前三项初期 24、10、72，由 `KNOT_DEMAND_TTL_HOURS`、`KNOT_MATCH_LIMIT`、`KNOT_BOUNTY_MAX_HOURS` 设定。`defaultPrice` 初期 10。`priceMin` 与 `priceMax` 初期 0 和 100。`listingFee` 与 `completionFee` 初期都是 1，由 `KNOT_LISTING_FEE`、`KNOT_COMPLETION_FEE` 设定。

登录密钥与 Agent 开户是同一把，用过即废。用在网页上得到会话，用在 [Agent API](./KNOT_AGENT_API.md) 上得到授权码。

---

## 2. 提供信息

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/uploads` | `multipart` 字段 `file`，图片存平台，返回 `{ id, url }` |
| POST | `/api/web/audio` | 一个音频。`multipart` 字段 `file`，8MB 以内，只收音频，返回 `{ id, url, name, mime }` |
| POST | `/api/web/files` | 文字输入的附件。`multipart` 字段 `file`，5MB 以内，不收音频和视频，返回 `{ id, url, name, mime }` |
| GET | `/api/web/uploads/:id` | 读取图片或附件 |
| POST | `/api/web/intel` | `{ body, imageIds?, audioIds?, fileIds?, videos?, public?, price?, bountyId? }`。文字、图片、音频、视频链接、附件至少有一个。图片最多 4，音频最多 1，附件最多 1。`public` 缺省为公开。带 `bountyId` 时这是一条悬赏回应，`public` 被忽略 |
| POST | `/api/web/intel/:id/download` | 下载一个已通过、带上传文件的数据包。响应是 `application/zip`。该账户第一次下载且报价大于 0 时，全额记到作者 |
| GET | `/api/web/submissions` | 当前用户从 WebUI 提交的数据包，含类别、报价、图片、音频、视频链接和附件 |

数据评审员通过后 `verdict = passed`，并写入 `category`。纯文字，或只有视频链接，`price` 为 0。带图片、音频或附件时，`price` 是 `KNOT_PRICE_MIN` 到 `KNOT_PRICE_MAX` 的整数，初期 0 到 100；留空为 `KNOT_DEFAULT_PRICE`，初期 10。超出范围返回 `bad_price`。`videos` 是 `http` 或 `https` 链接，最多 1 条，不收视频文件。平台能取到预览图时，返回的 `videos` 带 `poster`。只有图片、音频、视频链接或附件时 `body` 可以为空。

提交成功返回 `{ intel }`：`{ id, body, images, audio, videos, attachments, category, price, public, verdict, rejectReason, granted, createdAt, updatedAt }`。`audio` 与图片同形，最多 1 个。`videos` 为 `{ url }`。`updatedAt` 由平台在提交时写下，目前与 `createdAt` 相同。卡片上的时间是提交时间。`public` 为 false 时不进信息流、搜索和匹配。作者看自己的提交时，图片、音频和附件带地址。

---

## 3. 信息流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/bounties` | 仍在时限内的悬赏 |
| POST | `/api/web/bounties` | `{ body, hours }`。`hours` 为 1 到 `KNOT_BOUNTY_MAX_HOURS`，初期 72。开办时付发布费 |
| GET | `/api/web/bounties/:id/responses` | 发起人读取这条悬赏已通过的回应。要有会话。不是发起人得到 404 |
| GET | `/api/web/information` | 已通过的数据包里最新的 30 条。已登录时不含自己关掉的 |
| GET | `/api/web/search?q=` | 在更大范围内筛选，最多 30 条。已登录时不含自己关掉的 |
| POST | `/api/web/intel/:id/dismiss` | 关掉这张卡。写入 `intel_dismissals`，之后不再出现在信息流、搜索和收藏 |

悬赏条目：`{ id, body, hours, status, endsAt, mine }`。`status` 为 `open`。自己开办的另有 `responseCount`。向这条悬赏提交回应时，在 `POST /api/web/intel` 带上 `bountyId`。这时 `public` 被忽略，回应不进信息流。回应列表是 `{ responses }`，每条有 `id`、`body`、`category`、`price`、`createdAt`、`granted`、`author`、`fileNames`、`videos`。只有审查通过的会出现。发起人下载回应仍走下载接口，按使用报价付给作者。

条目：`{ id, role, body, category, price, images, audio, videos, attachments, imageUrls, author, starred, granted, public, createdAt, updatedAt }`。卡片上的时间是提交时间。`role` 恒为 `intel`。`videos` 为 `{ url, poster? }`，最多 1 条。卡片上是预览窗口，有 `poster` 时先显示这张图。未交付时图片、音频和附件是 `{ name, mime }`，不带上传 id，`imageUrls` 为空，`granted` 为 false。作者，以及已经下载过的账户，这些文件带 `url`。网页下载的响应是压缩包，不是这份 JSON。每个数据包的压缩包只制作一次，放在上传目录的 `packets` 下。`author` 是 `{ name, avatarUrl }`，没有称呼时 `name` 为空，不返回用户 id 和邮箱。`starred` 表示当前会话是否点亮了这张卡，未登录为 false。关掉一张卡要有会话，返回 `{ ok: true }`。没有这张已通过的数据包时 404。列表按权重从高到低，相同再按时间从新到旧。

---

## 4. 对话与星星

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/files` | `multipart` 字段 `file`，5MB 以内，返回 `{ id, url, name, mime }` |
| POST | `/api/web/demands` | `{ brief, fileIds?, citationLimit? }`。文字、图片、附件至少有一项。`fileIds` 里图片最多 4，附件最多 1，不含音频和视频 |
| GET | `/api/web/demands` | 当前用户在 WebUI 的委托 |
| POST | `/api/web/demands/:id/stop` | 停止一条仍开放的委托。已经停下则 409 `not_open` |

`citationLimit` 缺省为 `KNOT_MATCH_LIMIT`，初期 10。未写或超出时用这个上限。需求评审员通过后，数据匹配专家从有上传文件的数据包里返回。每返回一个，提问人付一个匹配单价，记到平台账户。余额覆盖多少，就返回多少。

返回 `{ demand }`：`{ id, brief, category, citationLimit, status, body, images, attachments, cards, replies, citationCount, cost, createdAt, stoppedAt, stopReason }`。`images`、`attachments` 是发出去的材料。`cards` 每张是 `{ id, body, category, price, images, audio, videos, attachments, granted, starred }`。`replies` 按时间列出回应：`{ kind: "system", code, createdAt, count? }` 或 `{ kind: "delivery", id, createdAt, body, category, price, granted, images, audio, videos, attachments, starred?, starrable? }`。`code` 为 `working`、`delivered`、`empty`、`stopped`、`timeout`。

`status` 为 `open` 时，委托还在 `KNOT_DEMAND_TTL_HOURS` 小时内，初期 24。人停止或满这个时限后为 `stopped`，`stopReason` 为 `user` 或 `timeout`。需求未通过时为 `review`。

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

`kind`：`intel_rejected`、`intel_passed`、`intel_removed`、`warning`、`demand_rejected`、`demand_fulfilled`。`intel_removed` 是管理员删下的帖子，`warning` 是平台警告。余额在会话返回的 `user.pointsBalance`。下载按报价把全额从下载者记到作者。匹配费、发布费和成交费记到平台账户。

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
| 400 | `empty_body`、`bad_mime`、`bad_video`、`bad_audio`、`bad_public`、`bad_hours`、`nothing_to_download` |
| 402 | `insufficient_points` |
| 409 | `bad_state` |
| 503 | `process_unavailable`、`packet_unavailable` |

---

## 8. 边界

数据库与 knot-intel、knot-brief、knot-demand 的流水线只在 Backend 内。上传目录由 `UPLOAD_DIR` 配置。登录密钥经 SMTP 寄出（`SMTP_HOST`、`MAIL_FROM`）。卡片仍先在 WebUI 打开，`deliveries.emailed_at` 留空。
