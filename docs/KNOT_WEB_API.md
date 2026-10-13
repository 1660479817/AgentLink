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

`user` 为 `{ id, email, displayName, avatarUrl, level, entitlements, pointsBalance, muted, mutedUntil }`。等级和权益只读。`entitlements.honors` 是权益名称。`muted` 为 true 时不能提交信息。`mutedUntil` 是解除时间；一直禁言时 `muted` 为 true 且 `mutedUntil` 为 null。`policy` 为 `{ defaultPrice, priceMin, priceMax, requestFee }`。`defaultPrice` 初期 10。`priceMin` 与 `priceMax` 初期 0 和 100。`requestFee` 初期 1。

登录密钥是六位数字，与 Agent 开户是同一把，用过即废。用在网页上得到会话，用在 [Agent API](./KNOT_AGENT_API.md) 上得到授权码。

---

## 2. 提供信息

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/uploads` | `multipart` 字段 `file`，图片存平台，返回 `{ id, url }` |
| POST | `/api/web/audio` | 一个音频。`multipart` 字段 `file`，8MB 以内，只收音频，返回 `{ id, url, name, mime }` |
| POST | `/api/web/files` | 文字输入的附件。`multipart` 字段 `file`，5MB 以内，不收音频和视频，返回 `{ id, url, name, mime }` |
| GET | `/api/web/uploads/:id` | 读取上传文件。头像公开。记录里的原图只给已授予的会话。音频和附件沿用这个地址 |
| GET | `/api/web/previews/:id` | 一条记录的图片预览，JPEG。已通过的公开 `post` 和 `fastpost` 谁都可以看。作者、已下载的人，以及这条 wish 的发出人，也可以看 |
| POST | `/api/web/intel` | `{ body, kind?, imageIds?, audioIds?, fileIds?, images?, audio?, attachments?, videos?, public?, price?, respondsTo? }`。文字、图片、音频、视频链接、附件至少有一个。图片最多 4，音频最多 1，附件最多 1。`kind` 缺省 `post`。网页快拍传 `fastpost`，wish 传 `wish`。`post` 和 `fastpost` 的 `public` 缺省为公开 |
| POST | `/api/web/intel/:id/download` | 下载一条已通过、有平台文件的记录。响应是 `application/zip`。`post`、`fastpost`、`wishRespond` 付给作者。`wish` 付给平台 |
| GET | `/api/web/submissions` | 当前用户从 WebUI 提交的记录 |

提交完成即由平台收下，不等审查结束。返回时 `kMeta.verdict` 可以仍是 `pending`。数据评审员通过后 `kMeta.verdict` 为 `passed`，并写入 `kMeta.category`。公开且已通过的才进入信息流。审查出错时，异常写进作者的通知，记录保持 `pending` 并稍后重试。没有平台文件时价格为 0。有平台文件时，`post`、`fastpost`、`wishRespond` 的价格是 `KNOT_PRICE_MIN` 到 `KNOT_PRICE_MAX` 的整数，初期 0 到 100；留空为 `KNOT_DEFAULT_PRICE`，初期 10。`wish` 的价格是 `KNOT_REQUEST_FEE`，初期 1。超出范围返回 `bad_price`。外链打不开返回 `bad_url`。`videos` 是 `http` 或 `https`，最多 1 条。

提交成功返回 HTTP 201 `{ intel }`，即这份记录，另有 `previewUrl` 和 `granted`。`kMeta.hash` 由平台写下。同一账户再提交相同内容时，返回已有记录，`kMeta.id` 不变。有图片时 `previewUrl` 指向预览。平台图片不带原地址。外链带地址。作者看自己的提交时，平台上的音频和附件带地址。

---

## 3. 信息流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/requests` | 已通过的 wish。卡片字段是表层：`body`、`videos`、`fileNames` |
| GET | `/api/web/requests/:id/responses` | 发出 wish 的人读取已通过的回应。要有会话。不是这个人得到 404 |
| GET | `/api/web/responses` | 当前账户交出去的响应。要有会话。每条带上对方那条 wish 的表层 |
| GET | `/api/web/looks` | 当前账户查看过的 wish。要有会话。`{ looks: [{ lookedAt, wish }] }` |
| POST | `/api/web/requests/:id/look` | 记下查看了这条已通过的 wish。同一账户只记一次。自己的 wish 返回 `bad_state`。返回 `{ look }` |
| GET | `/api/web/sponsors` | 右侧赞助内容。`{ sponsors: [{ id, title, href, image, caption, source }] }`，按先后。`image` 没有图时为 null。没有会话也能读。没有条目时 `sponsors` 为空 |
| GET | `/api/web/information` | 已通过的公开 `post` 和 `fastpost` 里最新的 30 条。已登录时不含自己关掉的 |
| GET | `/api/web/search?q=` | 在更大范围内筛选，最多 30 条。已登录时不含自己关掉的 |
| POST | `/api/web/intel/:id/dismiss` | 关掉这张卡。写入 `intel_dismissals`，之后不再出现在信息流、搜索和收藏 |

赞助内容不进信息流，也不写在 `intel` 里。标题、链接、图片、短说明和广告主由管理员写入。站内路径以 `/` 开头，站外地址以 `http` 或 `https` 开头。图片是 `http` 或 `https` 地址，或平台上已上传的一张图。

wish 条目是一份记录，另有 `mine`、`unlocked`、`responseCount`。自己发出的才有 `responseCount`。`unlocked` 表示已经付过，或这条是自己的。网页 `/wish` 用「我发出」列出这个人发出的 wish 和收到的响应，用「我响应」列出这个人查看过的 wish。点开别人的卡片调用 `POST /api/web/requests/:id/look`。详情上先是查看，然后决定是否下载，再决定是否回应。`GET /api/web/responses` 返回 `{ responses }`。每条是一份 `wishRespond` 记录，并带 `wish`。对方的 wish 已经不在时 `wish` 为 null。发出 wish 的人读取某一条的响应，走 `GET /api/web/requests/:id/responses`。那个列表也是 `{ responses }`，每条带 `author` 和 `granted`。

信息流条目是一份记录，另有 `role`、`previewUrl`、`author`、`starred`、`granted`。`role` 恒为 `intel`。有平台图片时 `previewUrl` 是一张缩小预览。平台图片不带原地址。外链带地址。未授予时，平台上的音频和附件只有文件名。作者和已经下载过的账户可以看到地址。网页下载的响应是压缩包。每个记录的压缩包只制作一次，放在上传目录的 `packets` 下。`author` 是 `{ name, avatarUrl }`。`starred` 表示当前会话是否点亮了这张卡。关掉一张卡要有会话，返回 `{ ok: true }`。列表按权重从高到低，相同再按时间从新到旧。

---

## 4. 星星

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/intel/:id/star` | 点亮。写入收藏，该记录权重加 1。已经亮着则不变。返回 `{ starred: true }` |
| DELETE | `/api/web/intel/:id/star` | 熄灭。移出收藏，权重减 1。返回 `{ starred: false }` |
| GET | `/api/web/stars` | 当前用户的收藏，卡片字段与上面相同 |

---

## 5. 通知与积分

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/notifications` | `{ unread, notifications[] }` |
| POST | `/api/web/notifications/read` | 全部标已读 |

`kind`：`intel_rejected`、`intel_passed`、`intel_review_error`、`intel_removed`、`warning`、`request_response`、`points_granted`、`muted`、`unmuted`、`entitled`、`level_changed`。`intel_review_error` 的标题是「审核异常」，正文是这次审查没有完成的原因，记录仍在审核。`intel_removed` 是管理员删下的帖子，`warning` 是平台警告。`request_response` 只发给发出 wish 的人，链接到 `/wish`。`points_granted`、`muted`、`unmuted`、`entitled`、`level_changed` 是账户变更，链接到 `/mine`。余额在会话返回的 `user.pointsBalance`。`post`、`fastpost`、`wishRespond` 的下载按价格记到作者。`wish` 的下载按价格记到平台。

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
| 400 | `empty_body`、`bad_mime`、`bad_video`、`bad_url`、`bad_audio`、`bad_public`、`bad_price`、`nothing_to_download` |
| 402 | `insufficient_points` |
| 403 | `muted` |
| 409 | `bad_state` |
| 503 | `process_unavailable`、`packet_unavailable` |

---

## 8. 边界

数据库与 knot-intel 的审查只在 Backend 内。上传目录由 `UPLOAD_DIR` 配置。登录密钥经 SMTP 寄出（`SMTP_HOST`、`MAIL_FROM`）。
