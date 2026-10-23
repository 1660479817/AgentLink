# 数据库层核对结论

核对时间：2026-10-23
事实基准：两套线上库的实际 dump（非文档、非记忆）

| 项目 | 结论 |
|---|---|
| 线上库 A（`cpswang.xknot.si`，本机 PG14:5440） | `audit/db/cpswang-live-schema.sql`，30 表 / 196 列 / 68 索引 / 127 约束 |
| 线上库 B（`wang.xknot.si`，bot01 PG16:5433） | `audit/db/wang-live-schema.sql`，30 表 / 196 列 / 68 索引 / 127 约束 |
| 两站结构差异 | **无**。diff 仅 pg_dump 版本头、`public` schema COMMENT、restrict 随机串 |
| 迁移从零重放 | `001_accounts.sql` 可重建出与线上**完全一致**的结构 |
| 迁移记录 | `schema_migrations` 仅 `001_accounts.sql` 一条；`schema_milestone` 记 `0.6.0` |
| 文档覆盖 | `KNOT_DATABASE.md` 提到全部 30 张表，无「文档有、库无」的幽灵表 |

## 已证实为「通过」

1. **两站同源**：结构与列数完全一致，不存在「发布站和测试站 schema 漂移」这一常见事故源。
2. **迁移可信**：从空库跑 `node scripts/migrate.js` 得到的结构与线上逐列一致（195 列同名同类型），差异仅为同一条 `CREATE TABLE` 内的列书写顺序：
   - `accounts.agent_type`
   - `intel.search_compact`、`intel.search_bigrams`
   - `retrieval_jobs.attempts`
   这三处说明线上库曾以 `ALTER TABLE ADD COLUMN` 追加过列，而 `001_accounts.sql` 后来被改写成把列内联进基线。结构等价，但**意味着迁移文件是可被事后编辑的基线快照，而不是单调递进的变更历史**——`schema_migrations` 的 checksum 因此不能当作「线上跑过哪些变更」的证据。
3. **无幽灵表**：30 张表全部在文档里有对应描述。

## 需运行/人工确认（静态判不了）

| 事项 | 为什么 |
|---|---|
| 文档对 28 张表是散文式描述、仅 `accounts` 有逐列表格 | 散文是否每列都准确，正则判不了，交给 S15 文档切片逐条核 |
| `schema_milestone.version` 的值是 `2026-10-0.6.0` | 字段名是 version，值却像日期+版本拼接，疑似格式残留，需人工判断是否设计如此 |
| 约束与索引的业务语义 | `127` 个约束是否覆盖了全部业务唯一性假设（如同人同条只能打赏一次、余额非负），需对照 `KNOT_ECONOMY.md` 逐条核 |

## 附注

本目录下 `crosscheck-db-doc.mjs` 的列覆盖率指标（47/195）**不可用**：文档以散文描述列，脚本只认表格行，产生大量假阳性。已从结论中剔除，逐列准确性交由 S15 文档切片人工核对。
