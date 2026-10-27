# API 入口

公共层只做索引，正文留在各自项目，避免同一份接口说明维护两遍。唯一的例外是 Agent 接口指引：它讲的是全联邦共用的协议，不属于任何一个实例，所以正文就在本目录。

| 接口 | 项目 | 文档 | 说明 |
|------|------|------|------|
| 实例 Web API | `knot-platform` | [`knot-platform/docs/KNOT_WEB_API.md`](../knot-platform/docs/KNOT_WEB_API.md) | WebUI 与 Personal Agent 共用的读写接口：记录、检索、下载、账户、授权码 |
| Agent 接口指引 | 公共层 | [`KNOT_HELP.md`](./KNOT_HELP.md) | 全联邦共用的 Agent 协议说明，正文英文；由 `xknot.si` 构建发布成 <https://xknot.si/knot-help>（HTML）与 `/knot-help.md`（原文）。实例不提供文档端点。 |
| 健康检查 | `knot-platform` | `/api/health` | 联邦中枢探测实例状态用；字段见 [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) 第 5 节 |
| 联邦契约 | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) | 中枢与实例的 L1 档案、L2 状态与活动数据、L3 橱窗约定 |
| 委托发信 | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) 第 7 节 | `POST /api/federation/mail`：实例用 Bearer 凭据委托中枢的 SMTP 发一封纯文本通知；`GET` 查额度 |
| 中枢接口 | `xknot.si` | [`xknot.si/server/app.mjs`](../xknot.si/server/app.mjs) | 加入申请（提交即通过）、管理员会话与清单条目；对公网只开放申请 |
| 接入计费 | `xknot.si` | [`xknot.si/docs/BILLING.md`](../xknot.si/docs/BILLING.md) | 付费接入订阅：`/api/member/billing/*`、`/api/billing/webhook`、`/api/admin/billing`；收款边界、权益与状态机见正文（规划，未实现） |
| 接入件 | `xknot.si` | [`xknot.si/docs/FEDERATION.md`](../xknot.si/docs/FEDERATION.md) 第 7.4 节 | 中枢签发给实例的 env 文件：实例 id、中枢地址、签发日期、委托发信凭据；实例存成什么文件名由自己决定 |
| 部署配置 | `knot-platform` | [`knot-platform/docs/CONFIG.md`](../knot-platform/docs/CONFIG.md) | 站点与平台环境变量；键的类型与默认值以 `packages/knot-config/src/schema.mjs` 为准 |

调用约定、鉴权方式、错误码以各项目正文为准。本页只回答「接口在哪一份文档里」。
