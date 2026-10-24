# 第二轮数据库重扫结论

基准：当前工作区（HEAD `a362d15` + 未提交改动）。两站线上：`cpswang.xknot.si`（本地 5440，PostgreSQL 14）、`wang.xknot.si`（bot01 5433，PostgreSQL 16）。

## 一致性核对

| 项 | 结果 |
|---|---|
| 两站线上 schema 逐字节对比 | ✅ 完全一致（仅 pg_dump 版本注释差异） |
| 两站 `schema_migrations` 记录 | ✅ 都是 3 条：001 / 002 / 003 |
| 001+002 从零重放 vs 线上 | ✅ 除下述漂移外，195 列中的 194、68 索引中的 67 完全一致 |

## 迁移漂移（核心发现）

工作区 `knot-platform/backend/migrations/` 只有 `001_accounts.sql`、`002_notification_data.sql`，
`003_login_guard_and_idempotency.sql` 已被删除（`git status` 显示 `D`）。但两站线上都**已经应用** 003，
`schema_migrations` 记录着 003 的 checksum `618dbb34…`。

003 原文件做了两件事：
1. 建 `login_failures` 表 + `login_failures_locked_idx`（登录失败计数）；
2. `admin_actions` 加 `request_id` 列 + `admin_actions_request_id_idx`（积分发放幂等键）。

删掉 003 后，代码的取舍是：

- **`login_failures` 部分**：改成 `login.js` 里进程内 `Map` 计数（`LOGIN_MAX_FAILURES=10` → 锁 15 分钟），
  不再落库。表成了孤儿，但仍残留在两站线上。
- **`request_id` 部分**：**代码仍在用**。`admin.js:690,715,737` 的 `grantPoints` 依赖
  `admin_actions.request_id` 列与 `admin_actions_request_id_idx` 唯一约束做幂等。这一段的 DDL 被
  连 003 一起删掉，**没有搬回 001 基线或任何新迁移**。

## 后果

1. **R2-001（P1）从零重建的库缺 `request_id` 列**：新部署 / `--reset` 重建的库，重放 001+002 后没有
   `admin_actions.request_id` 列与索引，`grantPoints` 的 `INSERT … request_id`、`SELECT … WHERE request_id`
   都会报「列不存在」，积分发放功能在全新实例上直接崩溃。测试用 mock 掩盖了这一点（`admin.test.js:334`
   用 `sql.includes("request_id")` 伪造列存在）。

2. **R2-002（P1）下次部署必然失败**：`deploy-site.sh:388` 会自动跑 `migrate.js`。`migrate.js:118-127`
   的 stale 检查发现 `schema_migrations` 里有 003、迁移文件却已删，`process.exit(1)`；重试 5 次后
   `deploy-site.sh` 回滚旧版本并报「检查 DATABASE_URL」——错误信息与真实原因（003 被删）无关，
   会把运维带偏。

3. **R2-003（P3）孤儿对象**：`login_failures` 表（两站线上）、`admin_actions.request_id`（对已有库
   不是孤儿但已被 003 删除的 DDL 所定义）、`docs/KNOT_DATABASE.md` / `KNOT_DATABASE_CN.md` 仍记载
   `login_failures` 表，文档与代码漂移。

## 修复建议

把 `admin_actions.request_id` 的 DDL（`ALTER TABLE … ADD COLUMN IF NOT EXISTS request_id TEXT` +
`CREATE UNIQUE INDEX … request_id … WHERE request_id IS NOT NULL`）搬回 `001_accounts.sql` 基线，
或拆成一个新的 `003_admin_action_idempotency.sql`。同时：
- 若要彻底弃用 `login_failures` 表，写一个反向迁移（`DROP TABLE login_failures` + 删 `schema_migrations`
  里 003 的记录），或保留 003 文件只删 login_failures 段落；
- 更新 `KNOT_DATABASE.md` / `KNOT_DATABASE_CN.md`，去掉 `login_failures` 表说明。
