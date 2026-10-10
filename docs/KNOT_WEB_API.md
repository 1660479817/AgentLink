# Knot WebUI 与 Knot Backend

Knot WebUI 在 AgentLink 平台外，只调用本文的接口访问 Knot Backend。

信息架构见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md)。库见 [KNOT_DATABASE.md](./KNOT_DATABASE.md)。

人和 Personal Agent 是同一套逻辑。WebUI 走本文。Personal Agent 走 `/api/agent`，见项目规划。

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
| GET | `/api/web/submissions` | 当前用户从 WebUI 提交的信息，含 `attachments` |

不区分关于自己还是关于别人。knot-intel 判断通过后 `verdict = passed`，奖励 1 积分。只有违规才 `rejected`。只有图片或附件时 `body` 可以为空。页面文案写「信息」，不写「情报」。

提交成功返回 `{ intel }`：`{ id, body, verdict, rejectReason, reward, createdAt }`。通过时 `reward` 为 1，否则为 `null`。

---

## 3. 信息流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/information` | 已通过的信息里权重最高的 30 条 |
| GET | `/api/web/search?q=` | 在更大范围内筛选，最多 30 条 |

条目：`{ id, role, body, imageUrls, attachments, weight }`。`role` 恒为 `intel`。`attachments` 为 `{ id, name, mime, url, image }`。不返回发布者。排序先权重、后时间。

---

## 4. 对话与星星

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/files` | `multipart` 字段 `file`，5MB 以内，返回 `{ id, url, name, mime }` |
| POST | `/api/web/demands` | `{ brief, fileIds?, citationLimit? }`。文字和附件至少有一个 |
| GET | `/api/web/demands` | 当前用户在 WebUI 的对话和卡片 |

`citationLimit` 缺省为 10，最大 10。knot-demand 按一条情报一张卡提交。引用几条就扣几个积分，每条同价。余额不够时少引用。库存盖不住时，Backend 问 knot-seek；能补上的先入库再进卡片。缺的那一截不收费。

返回 `{ demand }`：`{ id, brief, citationLimit, status, citationCount, cost, createdAt, cards }`。`cards` 为 `{ id, body, imageUrls, weight, starred }`。一条引用一张卡。

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
| POST | `/api/web/delegation` | 签发 Agent API 凭证 |
| GET | `/api/web/delegation` | 是否已委托 |
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
