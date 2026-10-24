# 第五批修复：下载计费端到端用例 + 发布收口

第四批（`fix-log-4.md`）把 S13-02/03/04、S10-12 收口，并把 `schema.mjs` 的文档生成语种双语化。
这一批把「部分」里最后一条能低成本收口的 S10-14（下载计费无端到端用例）补齐，然后落定整个
审计台账的发布态。

## 1. 下载计费端到端用例（S10-14，P3）

**发现**：`points/requests/market` 已补用例，但「扣多少、扣没扣」的下载打包与计费链路没有
端到端用例——`chargeDownload` 的「买家扣款 + 作者入账 + 平台服务费」三笔动账、判重幂等、
同钱包自付免费这三条路径，回归只能靠手点。

**修在哪**：

- `backend/src/market.js`：`chargeDownload` 加 `export`（本来就在下载事务里被调，导出不改变
  生产语义，只为可测）。
- `backend/src/market.test.js`：新增 `downloadClient` 助手（mock 钱包表、`packet_downloads`
  判重、附件字节、`accounts` 扣款、`point_ledger` 记账、`packet_downloads` 解锁行），三条用例：

  - `a download charges the buyer once and credits author and platform in one batch`——3 MB 附件
    收 3 积分服务费，`price 10 + fee 3` 三笔动账按钱包 id 排序：作者 `+10`、平台 `+3`、买家 `-13`；
  - `a repeated download bills once but still records the unlock`——判重命中，账本零写入，解锁行照记；
  - `a download from the same wallet pays nothing`——作者（或其 Agent）下自己的东西，零动账、零解锁行。

`market.test.js` 从 36 条涨到 **39 条，全绿**。

## 2. 台账发布态

这一批之后，469 条审计全部落定最终判定，不再有「进行中」的悬空项：

| 状态 | 条数 | 含义 |
|---|---|---|
| `fixed` | 443 | 已修复并带回归用例（本轮 S10-14 补入） |
| `partial` | 10 | 已做一半，剩余部分明确不在本版范围内，逐条留了「还差什么」 |
| `defer` | 13 | 需架构/部署/依赖决策，风险大于收益，暂缓 |
| `wontfix` | 3 | 无功能风险或属设计如此，仅记录 |

10 条 `partial` 的剩余部分都是独立工作，不阻塞本版发布：

- `S03-04`（P2）凭据可走文件，仍受 `--base` 支配——bench 令牌绑定待做；
- `S10-05`（P2）查询已加 `LIMIT 50`，键集分页与保留期待做；
- `S10-08`（P2）zip 加密头不再整份转码，`readFile` 整份读入与 `zipNames` 同步扫描待改流式；
- `S16-04`（P2）README 已约束「一个部署根一个站点」，按站点分槽位待做；
- `S21-07`（P3）`AppButton` 的 `to` 分支补了禁用态，弹窗内分享/打赏仍是自有皮肤；
- `S21-10`（P3）resize 监听改 `ResizeObserver`，首屏同步整份 `JSON.parse` 待改异步；
- `S21-12`（P3）下载状态机已补测试，打赏弹窗待抽成可测模块；
- `S23-20`（P3）reopen 错误码已能读出，`isSale` 仍在前端复刻、等后端给字段；
- `S24-06`（P3）整目录同步 + 部署前拦截越界 import，纯函数下沉待做；
- `S33-06`（P2）补了视图清洗用例，组件测试缺依赖待引入测试框架。

## 3. 版本与发布范围

- **knot-platform 0.6.0 → 0.7.0**：管理端「日志」栏（终审失败）、iOS HEIC 浏览器转 JPEG、
  授权码轮换原子化、可见性谓词收口、配置文档/模板英文生成、日期运算键 max 上限、
  下载计费与管理路由测试覆盖；`CHANGELOG.md` / `CHANGELOG_CN.md` 同步。
- **xknot.si 0.2.0 → 0.3.0**：实例清单缓存 `server/instances.mjs`、provision/store/app/publish
  等改动、文档译英与 `*_CN.md` 对照稿。
- 全仓测试：knot-platform **876** 条、xknot.si **472** 条，全绿。
