# 第四批修复：内网门/管理路由/重签原子/可见性收口

第三批（`fix-log-3.md`）之后，「部分」里还剩两条 P2 的路由级测试缺口（S13-02、S13-03）、
一条 P2 的「审计与业务变更不在同一事务」（S13-04），以及一条 P3 的「可见性判据三处重复」
（S10-12）。这一批把四条都收口，每条都带回归用例。`admin.test.js` 从 43 条涨到 **66 条，
全绿**；全仓测试 872 条通过（另有一处与本次无关的 `schema.test.js` 生成文档语种问题，见文末）。

| # | 发现 | 原来缺什么 | 修在哪 | 回归测试 |
|---|---|---|---|---|
| 1 | S13-02 内网门只在纯函数层被测 | 路由中间件那步（非内网 404 / 未配令牌 503）从未执行，删掉判断 43 条仍绿 | `backend/src/admin.test.js` | ×2 |
| 2 | S13-03 敏感端点无 HTTP 用例 | `/mute` 等 9 条权限最敏感的端点一条路由用例都没有 | `backend/src/admin.test.js` | ×12 |
| 3 | S13-04 审计行与业务不在同一事务 | 重签令牌先换 `token_hash` 再记账，审计失败留下半完成状态 | `backend/src/admin.js` | ×1 |
| 4 | S10-12 可见性判据三处重复 | 新增 verdict（如 `draft`）时 `preview.js` 与 `existingResponseId` 会静默走岔 | 各处改用 `visibleVerdict` / `verdictVisible` | 现有用例 |

---

## 1. 内网门路由级覆盖（S13-02，P2）

**发现**：`routes/admin.js` 用 `isIntranetAddress(req.socket.remoteAddress)` 决定 404。
纯函数 `isIntranetAddress` 被测过，但把这条中间件判断删掉，`admin.test.js` 43 条用例仍然
全绿——门到底关不关得住，测试说了不算。

**修在哪**：`backend/src/admin.test.js`，新增 `the admin router turns the public away with 404
and unconfigured token with 503`。用 `Object.defineProperty` 覆写 `req.socket.remoteAddress`：

- 公网地址 `203.0.113.19` 带上正确令牌请求，仍回 HTTP 404 `{ error: "not_found" }`；
- 内网地址但未配令牌，回 HTTP 503 `{ error: "admin_unconfigured" }`。

两个分支都在路由层被真正走到，不再是「函数对、接线没测」。

## 2. 敏感端点路由级用例（S13-03，P2）

**发现**：`/api/admin` 约 35 个端点里只有 9 个有 HTTP 用例，权限最敏感的几条——禁言/解禁、
改等级、改权益、查用户、查账号、改外账号资料、停用邀请——一条都没有。

**修在哪**：`backend/src/admin.test.js`，补 `withAdminRoute` 助手后逐条落地：

- `unmute`（清 deadline + 一行审计）；
- `entitlements`（按名发放 + 空改动拒绝 `bad_entitlement`）；
- `level`（改一次 + 越界拒绝 `bad_level`）；
- `warnings`（记一行 + 歧义名拒绝 `ambiguous`）；
- `users` / `accounts`（各列其管理范围，`searchUsers` 带 `LIMIT 20`）；
- `accounts/:id/profile`（外账号写入回 403 `not_editable`）；
- `invites/:id/disable`（关停 + 一行审计）；
- 三条拒绝路径：`mute` 非法 deadline、`unmute` 缺失用户、`remove` 缺失帖。

## 3. 重签令牌原子化（S13-04，P2）

**发现**：`rotateManagedAgentToken` 先 `UPDATE accounts SET token_hash = …`，再单独
`INSERT INTO admin_actions`。审计写失败时，库里是新码、审计没记上——谁改的、什么时候改的
没留痕，也就无法定位是发码还是换码。测试把审计 mock 全设成功，这条失败路径零覆盖。

**修在哪**：`backend/src/admin.js`，把「换 `token_hash` + 记 `issue` 审计」收进同一个
`withClient` 事务；任一步失败走 `putBack()` 把授权码文件也退回旧值，异常再抛 `env_failed`。

**回归测试**：`a failed audit write puts the old code back instead of half-rotating`——审计
INSERT 抛错时，断言授权码文件仍写回旧码，不留半换状态。

## 4. 可见性判据收口（S10-12，P3）

**发现**：`visibleVerdict()` 生成 `IN ('pending','passed')`，`preview.js` 手写同样的比较，
`existingResponseId` 用反向的 `verdict NOT IN ('rejected','removed')`。同一句「什么算可见」
三套写法，新增 `draft` 这类 verdict 时后两者会静默走岔。

**修在哪**：统一到 `visibleVerdict()`（SQL）与 `verdictVisible()`（JS）一份，
`retrieval.js`、`preview.js`、`discoverBoard.js`、`market.js`、`facets.js` 都走它；
`verdict NOT IN ('rejected','removed')` 旧写法已清除。附件的四处口径
（`HAS_ATTACHMENT` / `isDownloadableFile` / `kindOf` / `isAttachmentUpload`）语义各自不同——
SQL 过滤、可下载性、压缩包分类、计费口径——是分工不是重复，不合并。

---

## 未随批处理

- `schema.test.js` 里 `generated example files and docs are committed as generated` 的挂点已随双语化收口：
  `schema.mjs` 的 `desc`、`GROUPS.label`、模板头、`renderDocs`、`defaultCell` 全部译成英文，
  生成器 `config.mjs docs --write` 现在输出英文 `docs/CONFIG.md`，四个模板也重生成英文；
  `docs/CONFIG_CN.md` 保留为中文快照（与并行任务的 `*_CN.md` 约定一致）。`npm test` 873 条全绿。
