# 审计进度

**状态：全部完成。**

覆盖证明：`node audit/inventory/verify-coverage.mjs` → 619/619 文件，35/35 报告，缺失 0。

| 片 | 范围 | 文件/行 | 发现 |
|---|---|---|---|
| S01 | `.cursor/rules` | 6 / 313 | 16 |
| S02 | 仓库根 | 4 / 367 | 8 |
| S03 | `bench` | 15 / 2215 | 18 |
| S04 | 根 `docs`（KNOT_HELP） | 23 / 1045 | 18 |
| S05 | `knot-platform` lock | 1 / 3699 | 5 |
| S06 | `knot-platform` 顶层 | 3 / 464 | 5 |
| S07 | admin 界面 | 6 / 2968 | 9 |
| S08 | `admin.js` | 1 / 2856 | 17 |
| S09 | `admin.css` | 1 / 2247 | 9 |
| S10 | backend 核心 | 35 / 6976 | 16 |
| S11 | backend 路由 | 47 / 6949 | 13 |
| S12 | backend 测试 | 33 / 6824 | 16 |
| S13 | `admin.test.js` | 1 / 1571 | 11 |
| S14 | 迁移与上传 | 9 / 1321 | 10 |
| S15 | `knot-platform/docs` | 17 / 1954 | 7 |
| S16 | ops 部署 | 66 / 6942 | 23 |
| S17 | ops 辅助 | 24 / 2998 | 23 |
| S18 | packages | 25 / 3346 | 13 |
| S19 | `knot-config/schema.mjs` | 1 / 1740 | 12 |
| S20 | `sites` 配置 | 4 / 315 | 7 |
| S21 | web 视图 | 90 / 6986 | 15 |
| S22 | `styles.css` | 1 / 5762 | 11 |
| S23 | web 组件 | 30 / 4560 | 24 |
| S24 | `xknot.si` 顶层 | 23 / 2660 | 17 |
| S25 | `xknot.si/admin/admin.js` | 1 / 1214 | 13 |
| S26 | `xknot.si/admin` 其余 | 2 / 1194 | 12 |
| S27 | `xknot.si/docs`（FEDERATION） | 10 / 3934 | 13 |
| S28 | xknot ops | 40 / 6662 | 18 |
| S29 | xknot ops 备份/发布 | 17 / 2306 | 18 |
| S30 | `xknot.si/server` | 23 / 6327 | 17 |
| S31 | `app.mjs` | 1 / 1444 | 11 |
| S32 | store / validate | 3 / 1387 | 17 |
| S33 | xknot web | 54 / 6371 | 15 |
| S34 | xknot web lock | 1 / 1403 | 4 |
| S35 | `xknot.si/web/App.vue` | 1 / 1269 | 8 |

合计 469 条：P0×1、P1×32、P2×195、P3×241。

## 地基（非切片）

| 项 | 状态 |
|---|---|
| 全量清单 619 文件 / 110,589 行，35 片 | ✅ `missing=0 extra=0` |
| 报告覆盖 | ✅ **619/619，缺失 0** |
| 两站线上 schema 对照 | ✅ 完全一致（30 表 / 196 列 / 68 索引 / 127 约束） |
| 迁移从零重放 vs 线上 | ✅ 结构一致 |
| 两站运行时接口实测 | ✅ 全绿，权限闸门生效 |
| P0/P1 与实测声称复核 | ✅ 见 `findings/verification-log.md` |
| 工作区 vs 线上版本 | ⚠️ 333 行未提交改动，线上跑 HEAD，不在审计范围 |
