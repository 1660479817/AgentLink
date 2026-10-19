# Knot 联邦

`xknot.si` 是 Knot 联邦的中枢。**Knot 联邦 —— Agent 时代的分布式信息网络。**

中枢是只读入口，持有三类信息：**站点档案、运行状态、热点橱窗**。用户、内容、积分、审核和收费都在各实例自己的部署里。

加入联邦走申请制：门户右侧填表，运营者在审核台人工审核，通过后由人把条目写进清单再构建。申请只进队列，不直接改变任何已上线条目。

- 名称与中英文写法：[docs/NAMING.md](docs/NAMING.md)
- 契约与字段：[docs/FEDERATION.md](docs/FEDERATION.md)
- 语种与区域：[docs/I18N.md](docs/I18N.md)
- 实现与部署：[docs/HUB.md](docs/HUB.md)
- 加入说明：[docs/JOIN.md](docs/JOIN.md)

![xknot.si 中枢架构](docs/federation.svg)

## 拓扑

| 子域 | 运营方 | 职责 |
|------|--------|------|
| `xknot.si` | 中枢 | 实例清单、简介、健康点、区域筛选 |
| `wang.xknot.si` | 自营 | 旗舰实例（当前唯一的真实成员） |
| `travel.xknot.si` | OPC 伙伴 | 旅行垂直（版式示例，尚未上线） |
| `ai.xknot.si` | OPC 伙伴 | AI 垂直（版式示例，尚未上线） |

`xknot.si` 是联盟门户本身；其余子域是**伙伴站点**，每个跑一套用 `knot-platform` 完整部署的 Knot（WebUI + Backend + OpenClaw 配套）：自己的 Postgres、上传目录、账号、积分和审核。实例之间不共享会话、用户表和余额。每个实例与门户单线联系，门户只读。

## 原则

1. **实例自治。** 数据、账号、积分、审核和收费归实例。
2. **中枢只读。** 网络视图不写实例；唯一的写入口是加入申请，审核通过后才由人改清单。
3. **入口回原站。** 每个入口和每张橱窗卡片都跳回来源站点。
4. **一份清单。** `instances.json` 是实例身份的唯一真源。

## 中枢提供的能力

| 层 | 能力 | 内容 |
|----|------|------|
| L1 | 站点档案 | 名称、简介、区域、语言、运营方、联系方式、接口地址 |
| L2 | 运行状态 | 构建时探测 `/api/health`，给出健康点、上次正常时间、可用率 |
| L3 | 热点橱窗 | 构建时拉取 `cardsUrl`，最多 6 张卡片，点开回原站 |
| — | 门户 | 三语静态页，左栏全球地图与卡片式节点目录（可筛区域、在线、热点），右栏加入申请 |
| — | 申请与审核 | 申请表入库、邮件通知、管理员审核、生成清单条目 |

## 语言与区域

| 项 | 约定 |
|----|------|
| 语种 | `en`（默认，必填）、`zh-CN`、`zh-TW`，与 WebUI 同一套 |
| 回退 | 本语种 → 基础语 → `en` → 清单里第一个有值的语种，按字段计算 |
| URL | 路径前缀 `/en/`、`/zh-CN/`、`/zh-TW/`，带 `hreflang` 与 `x-default` |
| 区域 | ISO 3166-1 alpha-2，指服务对象所在地 |
| 分组 | 全球、东亚、东南亚、南亚、中亚、中东、欧洲、北美、拉美、非洲、大洋洲、其他 |
| 语言判定 | 依据路径前缀；无 GeoIP 请求 |

语言和区域互相独立：新加坡的旅行实例可以是 `regions: ["SG","MY"]`、`languages: ["en","zh-CN"]`。规则见 [docs/I18N.md](docs/I18N.md)。

## 实施里程碑

| 里程碑 | 范围 |
|--------|------|
| M1 | 清单与校验、Vue 三语门户、L1 档案、L2 健康探测、区域筛选 |
| M2 | L3 橱窗拉取、L2 活动数据、门户橱窗位 |
| M3 | 加入申请、审核台、管理员账号、申请生成清单条目 |

网络视图仍然是静态文件，探测和拉取都在构建时完成。常驻的只有一个接口进程：收申请、存审核状态、发管理员会话。

## 目录

```text
xknot.si/
├── README.md              本文件：联邦入口与原则
├── package.json           本项目的脚本：dev / build / test / deploy / admin
├── instances.json         实例清单（唯一的人工编辑入口）
├── fixtures/              版式样例：十条伙伴条目与橱窗，只并入 --preview 构建
├── server/                接口：申请、管理员、审核、清单条目（SQLite，无外部依赖）
├── admin/                 审核台静态页，/admin/ 下使用
├── docs/
│   ├── NAMING.md          名称约定：中英文对照、禁用词
│   ├── I18N.md            国际化与区域：语种、回退、区域分组
│   ├── FEDERATION.md      中枢与实例的契约
│   ├── HUB.md             中枢的实现、运行与验收
│   ├── JOIN.md            加入说明：申请、域名与隧道
│   └── federation.svg     架构图
├── ops/
│   ├── xknot.si.conf      门户与接口的 nginx 配置
│   ├── dev.mjs            同时拉起接口与 Vite
│   ├── check-health.mjs   健康探测，写 var/health.json
│   ├── build-hub-data.mjs 合并清单与探测结果，写 data/hub.json
│   ├── fetch-cards.mjs    橱窗拉取，写 var/cards/（M2）
│   ├── build-hub.sh       本机构建：校验、探测、构建、写快照
│   ├── build-world-dots.mjs  生成世界底图（web/src/lib/world.js）
│   ├── deploy-hub.sh      可选的静态站同步（目标由环境变量给出）
│   ├── deploy-api.sh      中枢接口、审核台与站点配置的同步
│   ├── README-deploy-aws.md  中枢托管主机的部署笔记
│   └── validate-instances.mjs  清单校验
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
npm run test     # 单元测试（清单、页面、接口、邮件）
npm run admin -- create-admin paul   # 建审核账号
npm run mail:test -- you@example.com # 用 SMTP_* 发一封测试信
npm run deploy:api                   # 部署接口与审核台（需 XKNOT_EDGE）
```

部署分两条独立的命令：`npm run deploy` 同步静态站，`npm run deploy:api` 同步接口、审核台与站点配置。两者都只认 `XKNOT_EDGE` 等环境变量，仓库里没有默认主机。

审核台在本机 `http://127.0.0.1:5180/admin/`。申请数据在 `var/xknot.db`，与 `instances.json` 一起备份。

| 文件 | 内容 |
|------|------|
| [docs/NAMING.md](docs/NAMING.md) | 名称约定：中英文对照、禁用词、代码标识 |
| [docs/I18N.md](docs/I18N.md) | 国际化：语种、回退链、区域分组、URL 与验收 |
| [docs/FEDERATION.md](docs/FEDERATION.md) | 契约：L1 字段、L2 判定、L3 橱窗格式、收录与下架 |
| [docs/HUB.md](docs/HUB.md) | 中枢的实现、运行形态和验收清单 |
| [docs/JOIN.md](docs/JOIN.md) | 加入说明：申请流程、自有域名与签发子域、固定 IP 与隧道 |
| [docs/federation.svg](docs/federation.svg) | 架构图 |
| [instances.json](instances.json) | 实例清单 |
| [ops/xknot.si.conf](ops/xknot.si.conf) | 门户的 nginx 配置 |
| [ops/check-health.mjs](ops/check-health.mjs) | 健康探测，写 `var/health.json` |
| [ops/build-hub-data.mjs](ops/build-hub-data.mjs) | 合并清单与探测结果，写 `data/hub.json` |
| [ops/deploy-api.sh](ops/deploy-api.sh) | 同步中枢接口、审核台与站点配置 |
| [ops/build-hub.sh](ops/build-hub.sh) | 本机构建：校验、探测、构建、写快照 |
| [ops/deploy-hub.sh](ops/deploy-hub.sh) | 可选的远端同步，目标由环境变量给出 |
| [ops/validate-instances.mjs](ops/validate-instances.mjs) | 清单校验，不过不构建 |
| [web/src/lib/i18n.js](web/src/lib/i18n.js) | 语言解析、按字段回退、相对时间 |
| [web/src/lib/regions.js](web/src/lib/regions.js) | 国家代码到区域分组 |
| [web/src/lib/hub.js](web/src/lib/hub.js) | 快照到页面视图 |

中枢的代码放在本目录，不并进 `knot-platform/`。本仓库里的另外两处属于**实例侧**，与本项目互不引用：

| 位置 | 内容 |
|------|------|
| [`knot-platform/`](../knot-platform) | 实例实现：Backend、WebUI 与共享包。`xxx.xknot.si` 跑的就是它 |
| [`knot-platform/ops/`](../knot-platform/ops) | 实例的部署、边缘、备份、巡检脚本；子域边缘模板在 `ops/edge/` |
| [`docs/`](../docs) | 跨项目文档：命名、部署配置 |

方向是单向的：中枢只按清单探测实例的公网 `healthUrl`，不读实例的代码、库或进程；实例也不改中枢的清单。子域签发与清单登记是这里的策略（[docs/JOIN.md](docs/JOIN.md)），而边缘与隧道怎么落地是实例侧的事（[`knot-platform/ops/edge/README.md`](../knot-platform/ops/edge/README.md)）。

## 收录与收费

收录免费，但改成了申请制。门户右侧填表，运营者在 `/admin/` 审核，通过后执行 `npm run admin -- publish <id>` 写进 `instances.json`，再构建上线。申请只进队列；新申请会邮件提醒管理员，审核结果会按申请表里的联系邮箱寄给申请人，但不会自动改动任何已上线条目。

收费不在中枢发生。`*.xknot.si` 子域、部署、升级、备份和故障响应是单独的服务，中枢不处理订单、不扣费、不分账。

收录有法律门槛：违法、欺诈、冒充和商标侵权的实例从清单删除，规则见 [FEDERATION.md](docs/FEDERATION.md) 第 9 节。

## 归属与许可

`xknot.si` 及其下签发的子域归 **PaulWang** 所有。代码以 [Apache-2.0](../LICENSE) 发布，版权人是 PaulWang，署名见 [NOTICE](./NOTICE)。许可证全文在仓库根；本项目自带一份 `NOTICE`，单独取用本目录时署名不依赖根目录。

- 许可证授予代码的版权与专利许可，**不含商标**。`Knot`、`xknot`、`xknot.si` 的名称和标识不随代码授权。
- `*.xknot.si` 子域只由权利人签发。自部署实例可使用自有域名，也可写「基于 Knot」，不得暗示官方认证。
- 收录不改变归属。伙伴的站点、内容和用户属于伙伴。
