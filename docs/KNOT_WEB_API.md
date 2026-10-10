# Knot Web UI ↔ Platform API

> **展示**走快照；**写操作**走既有 REST。Web **被动**拉取，**不用 SSE**。  
> 信息架构：[KNOT_WEB_UI.md](./KNOT_WEB_UI.md)

---

## 1. 分层

| 层 | 用途 | 典型接口 |
|----|------|----------|
| **A. 展示快照** | 首页 / 广场 / 我的 **只读展示**（含统计、列表片段） | `GET /api/web/v1/snapshot` |
| **B. 会话** | 是否登录、Email | `GET /api/auth/me` |
| **C. 写操作** | 发码、验码、上传、需求、交换意图、Agent token | 现有 `/api/auth/*`、`/uploads`、`/demands` 等 |

Web **禁止**为展示自行聚合全库；列表与数字以 **快照** 为准（平台可缓存/预聚合）。

---

## 2. 快照总接口

### `GET /api/web/v1/snapshot`

**鉴权：** 可选 Cookie。未登录可请求 `home`、`plaza`；`mine` 仅在登录后返回内容，否则 `mine: null` + `mineError: "REGISTER_REQUIRED"`。

**Query**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `surfaces` | string | 否 | 逗号分隔：`home,plaza,mine`。默认 `home,plaza` |
| `plaza.q` | string | 否 | 广场搜索（标题/摘要 ILIKE） |
| `plaza.cursor` | string | 否 | 分页游标（opaque，来自上次响应） |
| `plaza.limit` | integer | 否 | 默认 `20`，最大 `50` |

**Response 200** — `application/json`

根对象类型 **`WebSnapshotResponse`**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | `"1"` | 契约版本 |
| `generatedAt` | string (ISO 8601) | 快照生成时间（UTC） |
| `refreshAfterMs` | integer | **平台建议** Web 再次请求本接口的最小间隔（毫秒） |
| `viewer` | `Viewer` \| null | 当前会话；无登录为 `null` |
| `surfaces` | `SnapshotSurfaces` | 各 surface  payload |
| `errors` | `SurfaceErrors` | 某 surface 未返回时的原因 |

```typescript
type Viewer = {
  userId: string;       // uuid
  email: string;
  displayName: string;  // 现阶段 = email 本地部分，后续可扩展
};

type SnapshotSurfaces = {
  home?: HomeSurface;
  plaza?: PlazaSurface;
  mine?: MineSurface | null;
};

type SurfaceErrors = {
  mine?: "REGISTER_REQUIRED" | "internal";
};
```

---

## 3. Surface：`home`（首页）

类型 **`HomeSurface`**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `stats` | `HomeStats` | 平台级指标（全员相同，与登录无关） |
| `previewCards` | `CardPreview[]` | 公开卡片预览，建议 3～5 条 |
| `copy` | `HomeCopy` | 可选：平台下发的静态文案块（后续 CMS） |

**`HomeStats`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `cardsTotal` | integer ≥ 0 | 平台 **可公开计数** 的卡片总量（`visibility=public` 或政策定义的全量，见 §6） |
| `cardsNewToday` | integer ≥ 0 | **UTC 日** 或 **平台配置时区** 的「今日」新增卡片数（§6） |
| `exchangesToday` | integer ≥ 0 | **今日交钥匙成功次数**（Phase 0 无账本时恒为 `0`） |
| `ingestSessionsDoneTotal` | integer ≥ 0 | 平台 **累计** 完成处理的 ingest 会话数（`ingest_jobs.status = 'done'`） |
| `ingestSessionsDoneToday` | integer ≥ 0 | **今日** 完成处理的 ingest 会话数（同上，按 `updated_at` 与 `statsTimezone`） |
| `statsTimezone` | string | IANA，如 `Asia/Hong_Kong`，统计「今日」边界 |

**`CardPreview`**（找信息可见字段，**无**联系方式）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string (uuid) | |
| `title` | string \| null | |
| `summary` | string \| null | 可截断 |
| `thumbUrl` | string \| null | 相对或绝对 URL |
| `visibility` | `"public"` \| `"registered"` \| `"verified"` | |
| `createdAt` | string (ISO 8601) | |

**`HomeCopy`**（可选，Phase 0 可空对象）

| 字段 | 类型 |
|------|------|
| `headline` | string |
| `subheadline` | string |

---

## 4. Surface：`plaza`（信息广场）

类型 **`PlazaSurface`**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `cards` | `CardPreview[]` | 当前页列表 |
| `pagination` | `CursorPagination` | |
| `filters` | `PlazaFiltersApplied` | 回显当前条件 |

**`CursorPagination`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `nextCursor` | string \| null | 有更多则非 null |
| `limit` | integer | |

**`PlazaFiltersApplied`**

| 字段 | 类型 |
|------|------|
| `q` | string \| null |

排序规则 **由平台决定**（默认 `created_at DESC`），不下发可选排序给 Web Phase 0。

---

## 5. Surface：`mine`（我的 · 仅登录）

类型 **`MineSurface`**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `welcome` | `MineWelcome` | |
| `ingestJobs` | `IngestJobRow[]` | 最近 N 条，默认 10 |
| `myCards` | `CardPreview[]` | 本人卡片最近 N 条，默认 20 |
| `exchange` | `MineExchangeSummary` | 第一期填充 |

**`MineWelcome`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `email` | string | |
| `agentTokenActive` | boolean | 是否存在至少一条 active `agent_tokens` |
| `ingestProcessingCount` | integer | status ∈ `pending`,`processing` |

**`IngestJobRow`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string (uuid) | |
| `status` | `"pending"` \| `"processing"` \| `"done"` \| `"failed"` | |
| `error` | string \| null | |
| `mime` | string | |
| `createdAt` | string (ISO 8601) | |
| `updatedAt` | string (ISO 8601) | |

**`MineExchangeSummary`**（Phase 0 占位）

| 字段 | 类型 | 说明 |
|------|------|------|
| `msgboxUnread` | integer | 恒 `0` 直至 Msgbox 上线 |
| `keysHandedOffToday` | integer | 与 `home.stats.exchangesToday` 用户维度；Phase 0 为 `0` |
| `threads` | `MsgboxThread[]` | Phase 0 恒 `[]` |
| `handoffs` | `HandoffRecord[]` | Phase 0 恒 `[]` |

**`MsgboxThread` / `HandoffRecord`**：第一期填充；Web 已预留列表 UI，无数据时空态。

---

## 6. 平台如何生成快照

**每次请求现算**，但逻辑集中在 **`web-snapshot` 模块**（非路由内联 SQL），流水线：

```text
HTTP 路由 (routes/web-snapshot.js)
  → buildWebSnapshot (web-snapshot/index.js)
       → readers.*     从 PostgreSQL 读原始行/计数（facts）
       → compose.*     编排各 surface
       → beautify.*    展示算法：截断摘要、计数规范化、ISO 时间、后续可接平滑/文案 CMS
       → 契约 JSON    surfaces + refreshAfterMs
  → 响应（可选：短期内存缓存 refreshAfterMs 内同参复用）
```

| 文件 | 职责 |
|------|------|
| `web-snapshot/readers.js` | 只读 SQL，返回 **原始事实** |
| `web-snapshot/beautify.js` | **美化 / 算法**（与库结构解耦，便于改展示而不改查询） |
| `web-snapshot/compose.js` | surface 级 **成行数据** |
| `web-snapshot/index.js` | 对外 `buildWebSnapshot` |

配置仍来自 `system_config.webDisplay`（`refreshAfterMs`、`statsTimezone`、`cardsTotalMode` 等）。

| 配置项 | 存储 | 默认 |
|--------|------|------|
| `refreshAfterMs` | `system_config.webDisplay` | `60000` |
| `statsTimezone` | 同上 | `Asia/Hong_Kong` |
| `homePreviewSize` | 同上 | `5` |
| `cardsTotalMode` | 同上 | `"public_visible"`（仅 public）或 `"all_cards"` |

**今日统计：** 在 `statsTimezone` 下 `[00:00, now)` 对 `information_cards.created_at` / 交钥匙表 / **`ingest_jobs.updated_at`（仅 `status='done'`）** 计数。

**ingest 会话（处理会话）：** 一次上传解读流水线对应一条 `ingest_jobs`。`ingestSessionsDoneTotal` = 全库 `done` 条数；`ingestSessionsDoneToday` = 当日窗口内 **`status='done'` 且 `updated_at`** 落入窗口（完成时刻以 `updated_at` 为准）。

**交钥匙计数（`exchangesToday`）：** 仅 **交钥匙成功** 事件（第一期 `key_handoffs` 表）；Phase 0 返回 `0`。

---

## 7. 写操作 API（Web 已用 · 不变）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/auth/request` | 无 | `{ email }` 发验证码 |
| POST | `/api/auth/verify` | 无 | `{ email, code }` → Set-Cookie |
| POST | `/api/auth/logout` | Cookie | |
| GET | `/api/auth/me` | Cookie | `{ user \| null }` |
| POST | `/api/demands` | 无 | `{ body, contact_hint? }` |
| GET | `/api/cards/:id` | 可选 | 详情（披露检查） |
| POST | `/api/uploads` | 注册 | multipart |
| POST | `/api/exchange/intent` | 注册 | `{ card_id }` |
| … | `/api/auth/tokens` | 注册 | Agent 凭证 |

展示型 **`GET /api/cards`** 保留兼容，**新 Web 应改用 snapshot.plaza / previewCards**。

---

## 8. 错误码

| HTTP | `error` | 场景 |
|------|---------|------|
| 400 | `bad_surface` | 未知 surface 名 |
| 401 | — | 写操作未登录 |
| 403 | `REGISTER_REQUIRED` | 写操作 / mine 未登录 |
| 502 | `smtp_failed` | 发码失败 |

快照接口：**尽量 200**，单 surface 失败写入 `errors` 而非整包 500。

---

## 9. 示例

**请求**

```http
GET /api/web/v1/snapshot?surfaces=home,plaza,mine&plaza.limit=20 HTTP/1.1
Cookie: knot_sid=...
```

**响应（节选）**

```json
{
  "schemaVersion": "1",
  "generatedAt": "2026-10-10T02:00:00.000Z",
  "refreshAfterMs": 60000,
  "viewer": {
    "userId": "…",
    "email": "you@example.com",
    "displayName": "you"
  },
  "surfaces": {
    "home": {
      "stats": {
        "cardsTotal": 128,
        "cardsNewToday": 7,
        "exchangesToday": 0,
        "ingestSessionsDoneTotal": 42,
        "ingestSessionsDoneToday": 3,
        "statsTimezone": "Asia/Hong_Kong"
      },
      "previewCards": [],
      "copy": {}
    },
    "plaza": {
      "cards": [],
      "pagination": { "nextCursor": null, "limit": 20 },
      "filters": { "q": null }
    },
    "mine": {
      "welcome": {
        "email": "you@example.com",
        "agentTokenActive": true,
        "ingestProcessingCount": 1
      },
      "ingestJobs": [],
      "myCards": [],
      "exchange": { "msgboxUnread": 0, "keysHandedOffToday": 0 }
    }
  },
  "errors": {}
}
```

---

## 10. 版本与演进

- 破坏性变更 → `schemaVersion` 升为 `"2"` 或新路径 `/api/web/v2/snapshot`。
- 新增 surface → 扩展 `surfaces` 枚举，旧 Web 忽略未知键。

---

## 11. 实现状态

| 项 | 状态 |
|----|------|
| 本文档 | 定稿 v1 |
| `GET /api/web/v1/snapshot` | 路由 `routes/web-snapshot.js`；流水线 `src/web-snapshot/` |
| `system_config.webDisplay` | 见迁移 `005_web_display_config.sql` |
