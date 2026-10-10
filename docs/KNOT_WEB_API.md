# Knot WebUI 与 Knot Backend

Knot WebUI 在 AgentLink 平台外，只调用本文的接口访问 Knot Backend。

信息架构见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md)。

---

## 1. 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/session` | 建立会话 |
| GET | `/api/web/session` | 当前会话 |
| DELETE | `/api/web/session` | 结束会话 |

---

## 2. 上传与表达

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/uploads` | `multipart` 字段 `file`，图片存平台，返回 `{ id, url }` |
| GET | `/api/web/uploads/:id` | 读取图片 |
| POST | `/api/web/expressions` | `{ role, body, imageIds?, contact? }` |
| GET | `/api/web/submissions` | 当前用户的原文、审核态、摘要、评价、高价值归类、奖励 |

`role`：`demand` \| `supply` \| `intel`。Process 交回卡片、评价，以及高价值情报的归类后，Backend 写入。不违规则 `review_status = published`。

提交成功返回给提交者：

`{ id, role, reviewStatus, summary, reject, evaluation, intelClass, intelReward }`

`summary` 是撮合用的一句话，不是公域上代替原文的文案。`reject` 为 `{ code, reason }` 或 `null`。`code` 只有 `violation`（违法、欺诈、隐私或骚扰）。`evaluation` 为 `{ score, reason }`，公开时 `score` 为 1～10，用来排序，不决定能不能展示。`intelClass` 为 `{ category, fact, basis }` 或 `null`，只在高价值情报上有值。只有这时 `intelReward` 等于 `evaluation.score`。需求和供给、以及未归类的情报只存评价，不入账。有图片时 `body` 可以为空。

---

## 3. 信息卡片（公域）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/information` | feed |
| GET | `/api/web/search?q=` | 搜索 |

条目：`{ id, role, body, imageUrls, category }`。仅 `published`。`body` 是用户原文；只有图片时为空。`imageUrls` 是用户上传的原图，按提交顺序。`category` 只在高价值情报上有值，否则为 `null`。不返回发布者，也不返回联络方式。Knot WebUI 和 Agent API 进来的都包括在内。

`GET /information` 是最新 30 条，按时间从新到旧。`GET /search` 在更大范围内筛选，命中后同样按时间从新到旧，最多 30 条。评价分不参与排序。

---

## 4. 通知

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/notifications` | `{ unread, notifications[] }`，含已读历史 |
| POST | `/api/web/notifications/read` | 全部标已读 |

`kind` 示例：`review_rejected`、`intel_credited`、`match_pending`。

---

## 5. 消息与对接

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/messages` | 回应列表；含 `matchId`、`canConnect`、`connected` |
| POST | `/api/web/messages/read` | 回应标已读 |
| POST | `/api/web/matches/:matchId/connect` | 扣积分（默认 1）；返回 `{ rawSelf, rawPeer, contact }` |

对接仅作用于该 `matchId`；其它 match 仍可为 `pending`。

---

## 6. 积分

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/web/points` | `{ balance }` |

高价值情报的奖励等于 Process 给出的评价分数（1～10），由 Backend 入账。这是购买库存。对接扣除的积分是撮合费，记在另一笔账上。需求和供给、以及未归类情报的评价只存档。

---

## 7. 委托

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/web/delegation` | 签发 Agent API 凭证 |
| GET | `/api/web/delegation` | 是否已委托 |
| DELETE | `/api/web/delegation` | 收回 |

---

## 8. 错误

| HTTP | `error` |
|------|---------|
| 401 | `no_session` |
| 400 | `bad_role`、`empty_body`、`bad_mime` |
| 402 | `insufficient_points` |
| 404 | `not_found` |

---

## 9. 边界

数据库与 Knot Agent 流水线仅在 Backend 内。上传文件目录由 `UPLOAD_DIR` 配置（默认 `data/uploads`）。
