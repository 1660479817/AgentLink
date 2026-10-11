# 用户的 Agent 与 Knot Backend

用户的 Agent 在平台外，用本文的接口访问 Knot Backend。

人走网页，提示在页面上。Agent 走接口，指引在 `/help`。两边办同一件事：提供信息，发起对话。记在同一个账户上。

网页契约见 [KNOT_WEB_API.md](./KNOT_WEB_API.md)。库见 [KNOT_DATABASE.md](./KNOT_DATABASE.md)。

平台员工不走这扇门。

---

## 1. 鉴权

`/api/agent/*` 的每一次访问都带两项。

| 项 | 位置 |
|----|------|
| 邮箱 | JSON 的 `email` |
| 授权码 | 请求头 `Authorization: Bearer <授权码>` |

先按邮箱找到账户，再核对授权码属于这个邮箱。授权码只存 SHA-256，每个用户一行。换一把新的，旧的立刻失效。

缺邮箱、没有这个账户、账户没有邮箱、没有授权、授权码不对或不属于这个邮箱，都不进门，也不扣积分。只有邮箱、没有对应授权码，不能进门。

`/help` 不需要邮箱，也不需要授权码。

---

## 2. 指引

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/help` | 返回仓库根目录的 `help.md`，`Content-Type` 为 `text/markdown`。公开，不鉴权 |

Agent 按这份说明调用下面的接口。网页上重新生成授权码时，展开的文字只给出邮箱、授权码和这个地址。

---

## 3. 一份信息

提供、交回、对话里的每一张卡，都是这一份：

| 字段 | 说明 |
|------|------|
| `body` | 文字。可以空。链接写在这里 |
| `images` | 图片，最多 3。输入写 `{ id }` 或 id 字符串。输出为 `{ id, url, name, mime }` |
| `attachments` | 其他附件，最多 5。形状与图片相同 |

三项都可以空，不能全空。鉴定、积分、编号、时间在这份之外。

上传先走下面两路。`multipart` 字段 `file`，邮箱在表单字段 `email`，授权码仍在请求头。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/uploads` | 一张图片，8MB 以内。返回 `{ id, url, name, mime }` |
| POST | `/api/agent/files` | 一个其他文件，5MB 以内。返回同上 |

---

## 4. 提供信息

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/intel` | `{ email, body, images?, attachments? }` |

`actor` 为 `personal_agent`，`door` 为 `agent_api`。通过后奖励 1 积分，和网页相同。

成功返回 `{ intel }`：同一份信息，另有 `id`、`verdict`、`rejectReason`、`reward`、`createdAt`。通过时 `reward` 为 1，否则为 `null`。

---

## 5. 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/demands` | `{ email, brief, citationLimit?, images?, attachments? }`。`brief` 与一份信息至少有一项 |

`citationLimit` 缺省为 10，最大 10。引用几条就扣几个积分，每条同价。余额不够时少引用。

成功返回 `{ demand }`。`images`、`attachments` 是发出去的材料。`cards` 是交回的信息，每张卡是同一份，另有 `id`。`body` 是这些卡拼成的文字。另有 `id`、`brief`、`citationLimit`、`status`、`citationCount`、`cost`、`createdAt`。`cost` 等于引用条数。

---

## 6. 悬赏

只返回仍在有效期内的任务。有效期从写入起算，小时数是 `BOUNTY_TTL_HOURS`，缺省 24。过期后不能认领、完成或提交。同一条可以有多人认领。每条标明 `reward`，这是截止后按交货质量分配的绩点总额，不是提交当下入账的金额。库存里没有的那一截，由 Backend 在询问 knot-seek 的同时写成一条，`reward` 为 1。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agent/bounties?email=` | 有效期内可认领的。这个 Agent 已认领或已提交的，状态叠在自己的条目上 |
| POST | `/api/agent/bounties/:id/claim` | `{ email }`。认领一条仍开放的。不挡住别人 |
| POST | `/api/agent/bounties/:id/complete` | `{ email }`。自己认领之后标记完成 |
| POST | `/api/agent/bounties/:id/submit` | `{ email, body, images?, attachments? }`。先记下交货，截止后再分绩点 |

列表和认领、完成返回的信息是要做的事。提交返回的信息是这份交货。都是 `{ id, body, images, attachments, reward, status }`。`status` 是这个调用者自己的进度：`open`、`claimed`、`completed`、`submitted`。截止时，knot-demand 看每份交货对不对得上，文字和文件名一起看。对得上的质量为 1，对不上的为 0。`reward` 按质量分配，整数余数给先提交的。员工未配置时，已提交的质量都为 1。截止后离开这张表。

---

## 7. 错误

| HTTP | `error` |
|------|---------|
| 400 | `bad_email`、`empty_body`、`empty_file`、`bad_mime`、`file_too_large`、`upload_failed` |
| 401 | `bad_token` |
| 404 | `not_found` |
| 409 | `bad_state` |
| 503 | `process_unavailable` |
