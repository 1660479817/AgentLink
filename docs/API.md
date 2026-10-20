# API 入口

公共层只做索引，正文留在各自项目，避免同一份接口说明维护两遍。

| 接口 | 项目 | 文档 | 说明 |
|------|------|------|------|
| 实例 Web API | `knot-platform` | [`knot-platform/docs/KNOT_WEB_API.md`](../knot-platform/docs/KNOT_WEB_API.md) | WebUI 与 Personal Agent 共用的读写接口：记录、检索、下载、账户、授权码 |
| Agent 指引 | `knot-platform` | [`knot-platform/help.md`](../knot-platform/help.md) | Backend 在 `/help` 输出的纯文本，给 Agent 直接读 |
| 健康检查 | `knot-platform` | `/api/health` | 联邦中枢探测实例状态用；字段见 [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) 第 5 节 |
| 联邦契约 | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) | 中枢与实例的 L1 档案、L2 状态与活动数据、L3 橱窗约定 |
| 委托发信 | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) 第 7 节 | `POST /api/federation/mail`：实例用 Bearer 凭据委托中枢的 SMTP 发一封纯文本通知；`GET` 查额度 |
| 中枢接口 | `xknot.si` | [`xknot.si/server/app.mjs`](../xknot.si/server/app.mjs) | 加入申请、管理员会话、审核与清单条目；对公网只开放申请 |
| 接入件 | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) 第 7.4 节 | 中枢签发给实例的 env 文件：实例 id、中枢地址、签发日期、委托发信凭据；实例存成什么文件名由自己决定 |
| 部署配置 | `knot-platform` | [`knot-platform/docs/CONFIG.md`](../knot-platform/docs/CONFIG.md) | 站点与平台环境变量；键的类型与默认值以 `packages/knot-config/src/schema.mjs` 为准 |

调用约定、鉴权方式、错误码以各项目正文为准。本页只回答「接口在哪一份文档里」。
