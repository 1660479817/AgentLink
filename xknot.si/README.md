# XKnot 联邦

`xknot.si` 是 XKnot 联邦的中枢。**XKnot 联邦 —— 面向 AI 与 Agent 时代的去中心化分布式信息网络。**

中枢是只读入口，持有三类信息：**站点档案、运行状态、热点橱窗**。用户、内容、积分、审核和收费都在各实例自己的部署里。

加入联邦走申请制：先在自己的机器上装一个 Knot，在它的管理界面（`/admin` 的 XKnot 栏）填资料、选二级域名并提交，平台当场核对并签发，**提交即通过**；随后中枢自动在入口主机上完成账号、证书与反代，实例自己起隧道，`/api/health` 通过后清单里的 `status` 改成 `active`。申请不会自动改动任何已上线条目。

- 名称与中英文写法：[docs/NAMING.md](docs/NAMING.md)
- 契约与字段：[docs/FEDERATION.md](docs/FEDERATION.md)
- 语种与区域：[docs/I18N.md](docs/I18N.md)
- 实现与部署：[docs/HUB.md](docs/HUB.md)
- 本地部署与端到端测试：[docs/E2E.md](docs/E2E.md)
- 加入说明：[docs/JOIN.md](docs/JOIN.md)
- Agent 接口指引（全联邦共用，正文在仓库根 [`docs/KNOT_HELP.md`](../docs/KNOT_HELP.md)）：发布在 <https://xknot.si/knot-help>

![xknot.si 中枢架构](docs/federation.svg)

## 拓扑

名册数据在 [`federation.json`](federation.json)：谁是创始实例、子域怎么来、怎么接入、隧道账号与端口。下表只是它的一个视图；改动先改名册，再同步本节。

| 子域 | 身份 | 职责 |
|------|------|------|
| `xknot.si` | 中枢 | 实例清单、简介、健康点、区域筛选 |
| `wang.xknot.si` | 创始实例 | XKnot 项目创始人的实例，永久账号，不适用下架；`tier=paid` |
| `cpswang.xknot.si` | 伙伴实例 | 社区成员，子域与入口隧道已接通，2026-10-21 收录；`tier=free` |

`xknot.si` 是联盟门户本身；其余子域是**实例**，每个跑一套 Knot 实例（当前实现是 `knot-platform`，含 WebUI、Backend 与 OpenClaw 配套）：自己的 Postgres、上传目录、账号、积分和审核。实例之间不共享会话、用户表和余额。每个实例与门户单线联系，门户只读。接入只依赖两样东西：`/api/health` 与中枢签发的接入件，与实例用什么软件、怎么部署无关。站点怎么介绍自己由主理人在实例的 `/admin` 里写，中枢按 `GET /api/federation/profile` 取回，不需要提交或审批。

## 原则

1. **实例自治。** 数据、账号、积分、审核和收费归实例。
2. **中枢只读。** 网络视图不写实例；数据侧的写入口只有加入申请，通过后才由运营方改清单。另有一项委托发信，只把信交给 SMTP，不改任何数据。
3. **入口回原站。** 每个入口和每张橱窗卡片都跳回来源站点。
4. **数据三段，各管一段。** `instances.json` 只记中枢签发的字段（`id`、`url`、`since`、`tier`、`status`、`statsUrl`、`cardsUrl`）；站点的名称、介绍、联系方式等由主理人在自己实例里写，中枢取回副本存 `var/profiles/`；`federation.json` 记成员身份与接入事实（谁在、什么身份、子域怎么来、隧道账号与端口）。清单与名册互相校验，对不上就不构建。

## 中枢提供的能力

| 层 | 能力 | 内容 |
|----|------|------|
| L1 | 站点档案 | 签发区（中枢写：`id`、`url`、`since`、`tier`、`status`）+ 自述区（主理人在实例里写：名称、一句话介绍、详细介绍、logo、主理人、联系方式、地区、时区、标签） |
| L2 | 运行状态 | 构建时探测 `/api/health`，给出健康点、上次正常时间、可用率 |
| L2 | 活动数据 | 构建时拉取 `statsUrl`，只取窗口计数，页面上标「伙伴公开的数据」 |
| L3 | 热点橱窗 | 构建时拉取 `cardsUrl`，最多 6 张卡片，点开回原站 |
| — | 门户 | 三语静态页，左栏全球地图与卡片式实例目录（可筛区域、在线、热点），右栏成员入口与四步加入指引 |
| — | 申请与收录 | 实例代交的申请入库、自动通过并签发子域、邮件通知、控制台总览与清单条目 |
| — | 委托发信 | 实例凭 Bearer 凭据委托中枢的 SMTP 发纯文本通知，带独立额度与发信记录 |
| — | 入口流量 | 中枢在入口 nginx 的日志里按子域聚合请求与字节，只给控制台看，不需要实例配合 |

## 语言与区域

| 项 | 约定 |
|----|------|
| 语种 | `en`（默认，必填）、`zh-CN`、`zh-TW`，与 WebUI 同一套 |
| 回退 | 本语种 → 基础语 → `en` → 清单里第一个有值的语种，按字段计算 |
| URL | 路径前缀 `/en/`、`/zh-CN/`、`/zh-TW/`，带 `hreflang` 与 `x-default` |
| 区域 | ISO 3166-1 alpha-2，指服务对象所在地 |
| 分组 | 全球、东亚、东南亚、南亚、中亚、中东、欧洲、北美、拉美、非洲、大洋洲、其他 |
| 语言判定 | 依据路径前缀；无 GeoIP 请求 |

语言和区域互相独立：语种是界面文案的路径前缀，区域是站点档案里的 `region`（ISO 3166-1 alpha-2）和门户的分组；两者不互相推导。站点自述是单值字段，不按语种拆分。规则见 [docs/I18N.md](docs/I18N.md)。

## 实施里程碑

| 里程碑 | 范围 |
|--------|------|
| M1 | 清单与校验、Vue 三语门户、L1 档案、L2 健康探测、区域筛选 |
| M2 | L3 橱窗拉取、L2 活动数据、门户橱窗位 |
| M3 | 加入申请、控制台、管理员账号、申请生成清单条目 |

网络视图仍然是静态文件，探测和拉取都在构建时完成。常驻的只有接口进程（收申请、存审核状态、发管理员会话）与一个每 15 分钟的巡检 timer（断连提醒、暂时隐藏）。

## 目录

```text
xknot.si/
├── README.md              本文件：联邦入口与原则
├── package.json           本项目的脚本：dev / build / test / deploy / admin
├── instances.json         实例清单：门户对外字段（控制台可改运营字段）
├── federation.json        联邦名册：成员身份、接入模式、隧道账号与端口
├── fixtures/              版式样例：十条伙伴条目与橱窗，只并入 --preview 构建
├── server/                接口：申请、管理员、清单条目（SQLite，无外部依赖）
├── admin/                 控制台静态页：总览与申请记录，/admin/ 下使用
├── docs/
│   ├── NAMING.md          名称约定：中英文对照、禁用词
│   ├── I18N.md            国际化与区域：语种、回退、区域分组
│   ├── FEDERATION.md      中枢与实例的契约
│   ├── HUB.md             中枢的实现、运行与验收
│   ├── E2E.md             本地部署形态、测试分层与覆盖矩阵
│   ├── JOIN.md            加入说明：申请、域名与隧道
│   └── federation.svg     架构图
├── e2e/                   端到端测试：接口/发信用 node --test，页面用 Playwright
├── ops/
│   ├── xknot.si.conf      门户与接口的 nginx 配置
│   ├── dev.mjs            同时拉起接口与 Vite
│   ├── local-hub.mjs      本机入口：静态站与 /api /admin 反代（对齐 nginx）
│   ├── local-stack.mjs    本地部署编排：接口 + 入口，端到端也用它起栈
│   ├── deploy-local.sh    一键本地部署：校验、构建、启动
│   ├── check-health.mjs   健康探测，写 var/health.json
│   ├── watch-health.mjs   定时巡检：24 小时提醒、7 天隐藏、恢复自动回
│   ├── xknot-health.service / .timer  systemd 定时器（每 15 分钟）
│   ├── traffic.mjs        入口访问日志 → 按子域的日流量，写 var/traffic/{id}.json
│   ├── node-status.mjs    合成节点状态（探测 + 隧道 + 位置 + 流量），写 var/status.json
│   ├── xknot-traffic.service / .timer  systemd 定时器（每小时）
│   ├── fetch-cards.mjs    橱窗拉取，写 var/cards/{id}.json
│   ├── fetch-stats.mjs    活动数据拉取，写 var/stats/{id}.json
│   ├── build-hub-data.mjs 合并清单、探测、活动数据与橱窗，写 data/hub.json
│   ├── doc-page.mjs       通用文档页：markdown → 单页 HTML + 原文
│   ├── build-hub.sh       本机构建：校验、探测、拉取、构建、写快照
│   ├── build-world-dots.mjs  生成世界底图（web/src/lib/world.js）
│   ├── deploy-hub.sh      可选的静态站同步（目标由环境变量给出）
│   ├── deploy-api.sh      中枢接口、控制台与站点配置的同步
│   ├── README-deploy-aws.md  中枢托管主机的部署笔记
│   ├── validate-instances.mjs  清单校验
│   └── validate-federation.mjs 名册校验（与清单交叉核对）
├── var/                   生成物：探测结果、申请库、会话密钥（不入版本库）
└── web/                   Vue 门户，独立安装与构建
    ├── package.json       自己的依赖与脚本
    ├── vite.config.js     三语入口、开发数据中间件、/api 与 /admin 代理
    ├── index.html         / 跳转
    ├── en/ zh-CN/ zh-TW/  三个语种的 HTML 入口
    ├── public/logos/      中枢标识与实例 LOGO
    ├── src/               Vue 源码：App、components（地图、卡片、申请表）、lib、locales
    └── dist/              构建产物（不入版本库）
```

`xknot.si` 自己就是一个独立项目：根目录管脚本、清单和接口，`web/` 管页面，依赖只装在 `web/node_modules`。它不并进 `knot-platform/` 的 `workspaces`，不引用 `knot-platform/*` 的代码，也不依赖 bot01 上的任何进程。开发环境就是本机。

```bash
cd xknot.si
npm run dev      # 接口 5181 + 门户开发服务器 5180
npm run build    # 校验、探测、构建、写快照
npm run deploy:local                 # 本机按线上形态跑：接口 + 入口，Ctrl-C 一起停
npm run test     # 单元测试（清单、名册、页面、接口、邮件）
npm run test:e2e # 接口端到端：真 HTTP、SQLite、SMTP 会话与 CLI
npm run test:ui  # 浏览器端到端：门户、申请表、控制台（首次先装 e2e 依赖）
npm run admin -- create-admin paul   # 建管理员账号
npm run mail:test -- you@example.com # 用 SMTP_* 发一封测试信
npm run deploy:api                   # 部署接口与控制台（需 XKNOT_HUB_SSH）
```

部署分两条独立的命令：`npm run deploy` 同步静态站，`npm run deploy:api` 同步接口、控制台与站点配置。两者都只认 `XKNOT_HUB_SSH` 等环境变量，仓库里没有默认主机。

控制台在本机 `http://127.0.0.1:5180/admin/`，登录后先看总览（实例与探测、申请记录、发信、最近事件），再切到「申请记录」。总览里点开实例可以就地改**签发区**与名册字段，保存会写回 `instances.json` 与 `federation.json`（先整份校验，不通过不落盘）；自述区只显示取回的副本，改动要去实例自己的 `/admin`。申请数据在 `var/xknot.db`，与这两份 JSON 一起备份。

| 文件 | 内容 |
|------|------|
| [docs/NAMING.md](docs/NAMING.md) | 名称约定：中英文对照、禁用词、代码标识 |
| [docs/I18N.md](docs/I18N.md) | 国际化：语种、回退链、区域分组、URL 与验收 |
| [docs/FEDERATION.md](docs/FEDERATION.md) | 契约：L1 字段、L2 判定、L3 橱窗格式、收录与下架 |
| [docs/HUB.md](docs/HUB.md) | 中枢的实现、运行形态和验收清单 |
| [docs/E2E.md](docs/E2E.md) | 本地部署形态、测试分层、覆盖矩阵与排障 |
| [docs/JOIN.md](docs/JOIN.md) | 加入说明：申请流程与接入形态（签发子域 + 入口隧道） |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 收录交付单：签发到接通的步骤与验收 |
| [docs/PARTNER-MAIL.md](docs/PARTNER-MAIL.md) | 发给伙伴的邮件模板与发信规范 |
| [docs/federation.svg](docs/federation.svg) | 架构图 |
| [instances.json](instances.json) | 实例清单：签发区字段 |
| [federation.json](federation.json) | 联邦名册：成员身份、接入模式、隧道账号与端口 |
| [ops/xknot.si.conf](ops/xknot.si.conf) | 门户的 nginx 配置 |
| [ops/check-health.mjs](ops/check-health.mjs) | 健康探测，写 `var/health.json` |
| [ops/watch-health.mjs](ops/watch-health.mjs) | 定时巡检：连续断连提醒、暂时隐藏、恢复自动回 |
| [ops/fetch-profile.mjs](ops/fetch-profile.mjs) | 取回各实例的 `/api/federation/profile`，写 `var/profiles/{id}.json` |
| [ops/build-hub-data.mjs](ops/build-hub-data.mjs) | 合并清单、档案副本与探测结果，写 `data/hub.json` |
| [ops/doc-page.mjs](ops/doc-page.mjs) | 通用文档页：markdown 渲染、标题简介提取、HTML 骨架，静态文档共用 |
| [ops/local-hub.mjs](ops/local-hub.mjs) | 本机入口：静态站、安全头与反代，对齐 nginx |
| [ops/local-stack.mjs](ops/local-stack.mjs) | 本地部署编排：临时数据目录、随机端口、起停 |
| [ops/deploy-local.sh](ops/deploy-local.sh) | 一键本地部署 |
| [e2e/](e2e) | 端到端测试：`*.e2e.test.mjs` 与 `browser/*.spec.mjs` |
| [ops/deploy-api.sh](ops/deploy-api.sh) | 同步中枢接口、控制台与站点配置 |
| [ops/build-hub.sh](ops/build-hub.sh) | 本机构建：校验、探测、构建、写快照 |
| [ops/deploy-hub.sh](ops/deploy-hub.sh) | 可选的远端同步，目标由环境变量给出 |
| [ops/validate-instances.mjs](ops/validate-instances.mjs) | 清单校验，不过不构建 |
| [ops/validate-federation.mjs](ops/validate-federation.mjs) | 名册校验：枚举、账号与端口唯一、与清单一一对应 |
| [web/src/lib/i18n.js](web/src/lib/i18n.js) | 语言解析、按字段回退、相对时间 |
| [web/src/lib/regions.js](web/src/lib/regions.js) | 国家代码到区域分组 |
| [web/src/lib/hub.js](web/src/lib/hub.js) | 快照到页面视图 |
| [web/src/lib/contact.js](web/src/lib/contact.js) | 申请表上展示的审核人姓名与邮箱 |

中枢的代码放在本目录，不并进 `knot-platform/`。仓库里另外两个位置与本项目互不引用：

| 位置 | 内容 |
|------|------|
| [`knot-platform/`](../knot-platform) | **独立项目**：实例实现，Backend、WebUI 与共享包。`xxx.xknot.si` 现在跑的就是它；换实现不影响中枢 |
| [`knot-platform/ops/`](../knot-platform/ops) | 实例的部署、入口、备份、巡检脚本；子域入口模板在 `ops/entry/` |
| [`docs/`](../docs) | **根公共资产**：版权与商标、LOGO 母版、API 入口索引、联邦层文档；不属于实例侧 |

方向是单向的：中枢只按清单的 `url` 探测实例的 `/api/health`，不读实例的代码、库或进程；实例也不改中枢的清单。两边只通过两个契约接触——探测（[docs/FEDERATION.md](docs/FEDERATION.md) 第 5 节）与接入件（第 7.4 节）。子域签发与清单登记是这里的策略（[docs/JOIN.md](docs/JOIN.md)），入口与隧道怎么落地是实例侧的事（[`knot-platform/ops/entry/README.md`](../knot-platform/ops/entry/README.md)）。

## 收录与收费

收录免费，走申请制。门户右侧填表，平台收到即核对并签发子域（申请单状态直接是 `approved`，`reviewed_by` 记 `auto`），同时寄一封批准信。之后由运营方执行 `npm run admin -- publish <id>` 写进 `instances.json`，并在 `federation.json` 补一条同名 `id` 的名册成员（也可以在控制台点开这个账号的「编辑」补齐名册字段），然后构建上线。新申请会邮件提醒管理员；申请不会自动改动任何已上线条目。创始实例（`wang`）是永久账号，不适用下架。

联邦成员分 `free` 与 `paid` 两档，默认 `free`，由运营方按需改为 `paid`；`demo` 只用于版式样例。档位写在清单的 `tier` 字段，只影响门户展示与排序，不改变接入方式。

收费不在中枢发生。`*.xknot.si` 子域、部署、升级、备份和故障响应是单独的服务，中枢不处理订单、不扣费、不分账。

收录有法律门槛：违法、欺诈、冒充和商标侵权的实例从清单删除，规则见 [FEDERATION.md](docs/FEDERATION.md) 第 9 节。

## 归属与许可

`xknot.si` 及其下签发的子域归 **PaulWang** 所有。代码以 [Apache-2.0](../LICENSE) 发布，版权人是 PaulWang，署名见 [NOTICE](./NOTICE)。许可证全文在仓库根；本项目自带一份 `NOTICE`，单独取用本目录时署名不依赖根目录。

- 许可证授予代码的版权与专利许可，**不含商标**。`Knot`、`xknot`、`xknot.si` 的名称和标识不随代码授权。
- `*.xknot.si` 子域只由权利人签发。自部署实例可使用自有域名，也可写「基于 Knot」，不得暗示官方认证。
- 收录不改变归属。伙伴的站点、内容和用户属于伙伴。
