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

---

## 2. 提供信息

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/uploads` | `multipart` 字段 `file`，图片存平台，返回 `{ id, url }` |
| POST | `/api/web/files` | 文字输入的附件。`multipart` 字段 `file`，5MB 以内，返回 `{ id, url, name, mime }` |
| GET | `/api/web/uploads/:id` | 读取图片或附件 |
| POST | `/api/web/intel` | `{ body, imageIds?, fileIds? }`。文字、图片、附件至少有一个 |
| GET | `/api/web/submissions` | 当前用户从 WebUI 提交的信息，含 `images`、`attachments` |

不区分关于自己还是关于别人。knot-intel 判断通过后 `verdict = passed`，奖励 1 积分。只有违规才 `rejected`。只有图片或附件时 `body` 可以为空。页面文案写「信息」，不写「情报」。

提交成功返回 `{ intel }`：同一份信息 `{ body, images, attachments }`，另有 `id`、`verdict`、`rejectReason`、`reward`、`createdAt`。通过时 `reward` 为 1，否则为 `null`。链接写在 `body` 里。

---

## 3. 信息流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/bounties` | 有效期内的悬赏。未登录都显示为可认领；已登录时，自己的认领或提交状态叠在对应条目上 |
| GET | `/api/web/information` | 已通过的信息里最新的 30 条。已登录时不含自己关掉的 |
| GET | `/api/web/search?q=` | 在更大范围内筛选，最多 30 条。已登录时不含自己关掉的 |
| POST | `/api/web/intel/:id/dismiss` | 关掉这张卡。写入 `intel_dismissals`，之后不再出现在信息流、搜索和收藏 |

悬赏条目：`{ id, body, images, attachments, reward, status }`。列表里的信息是要做的事。`reward` 是截止后按交货质量分配的积分总额。`status` 是当前用户自己的进度：`open`、`claimed`、`completed`、`submitted`。同一条可以有多人认领。有效期从写入起算，小时数是 `BOUNTY_TTL_HOURS`，缺省 24。

条目：`{ id, role, body, images, attachments, imageUrls, author, createdAt }`。`role` 恒为 `intel`。`images` 与 `attachments` 为 `{ id, url, name, mime }`。`imageUrls` 是图片地址。`author` 是 `{ name, avatarUrl }`，没有称呼时 `name` 为空，不返回用户 id 和邮箱。关掉一张卡要有会话，返回 `{ ok: true }`。没有这张已通过的信息时 404。

---

## 4. 对话与星星

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/files` | `multipart` 字段 `file`，5MB 以内，返回 `{ id, url, name, mime }` |
| POST | `/api/web/demands` | `{ brief, fileIds?, citationLimit? }`。文字和附件至少有一个 |
| GET | `/api/web/demands` | 当前用户在 WebUI 的对话和卡片 |

`citationLimit` 缺省为 10，最大 10。knot-demand 按一条情报一张卡提交。引用几条就扣几个积分，每条同价。余额不够时少引用。库存盖不住时，Backend 问 knot-seek；能补上的先入库再进卡片。缺的那一截不收费。

返回 `{ demand }`：`{ id, brief, citationLimit, status, body, images, attachments, cards, citationCount, cost, createdAt }`。`images`、`attachments` 是发出去的材料。`cards` 每张是 `{ id, body, images, attachments }`。一条引用一张卡。`body` 是这些卡拼成的文字。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/intel/:id/star` | 点亮。写入收藏，该情报权重加 1。已经亮着则不变 |
| DELETE | `/api/web/intel/:id/star` | 熄灭。移出收藏，权重减 1 |
| GET | `/api/web/stars` | 当前用户的收藏，卡片字段与上面相同 |

---

## 5. 通知与积分

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/notifications` | `{ unread, notifications[] }` |
| POST | `/api/web/notifications/read` | 全部标已读 |

`kind`：`intel_rejected`、`intel_credited`、`demand_fulfilled`。余额在会话返回的 `user.pointsBalance`。

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
| 400 | `empty_body`、`bad_mime` |
| 503 | `process_unavailable` |

---

## 8. 边界

数据库与 knot-intel、knot-demand、knot-seek 的流水线只在 Backend 内。上传目录由 `UPLOAD_DIR` 配置。登录密钥经 SMTP 寄出（`SMTP_HOST`、`MAIL_FROM`）。卡片仍先在 WebUI 打开，`deliveries.emailed_at` 留空。
