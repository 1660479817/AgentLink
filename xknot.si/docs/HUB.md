# 中枢的实现与运维

契约见 [FEDERATION.md](FEDERATION.md)，术语见 [NAMING.md](NAMING.md)，语种规则见 [I18N.md](I18N.md)。本文写中枢的组成、生成流程、部署与验收。

## 1. 组成

| 部件 | 形态 | 说明 |
|------|------|------|
| 门户 | Vue 静态站 | Vue 3 + Vite，三语入口，运行时读取 `/data/hub.json` |
| 接口 | Node 常驻进程 | `POST /api/applications` 收加入申请，`/api/admin/*` 供审核台使用，`/api/federation/mail` 代实例发信 |
| 审核台 | 静态页 + 接口 | `/admin/`，管理员登录后先看总览（实例与探测、申请队列、发信、最近事件），再做审核、取清单条目 |
| 申请存储 | SQLite | `var/xknot.db`，表 `applications`、`admins`、`sessions`、`events`、`relay_tokens`、`relay_log` |
| 健康探测 | 构建步骤 + 定时巡检 | 构建时探测一次；`ops/watch-health.mjs` 每 15 分钟一次，写 `var/health.json` 并按连续时长发信 |
| 活动数据拉取 | 构建步骤 | 构建时拉取 `statsUrl`，写 `var/stats/{id}.json` |
| 站点档案取回 | 构建步骤 | 构建时拉取 `url` + `/api/federation/profile`，写 `var/profiles/{id}.json` |
| 数据快照 | 构建步骤 | 合并清单（签发区）、档案副本（自述区）、探测、活动数据与橱窗，写 `dist/data/hub.json` |
| 橱窗拉取 | 构建步骤 | 构建时拉取 `cardsUrl`，写 `var/cards/{id}.json` |

门户本身仍然是静态文件，所有实例数据在构建时写入。数据侧唯一的写入口是加入申请：它不写 `instances.json`，只进审核队列；审核通过后由人或命令行把条目写进清单，再重新构建。申请接口不能改变任何已上线的条目。

三份数据各管一段：`instances.json` 只放签发区（`id`、`url`、`since`、`tier`、`status`、`statsUrl`、`cardsUrl`），由人提交；`var/profiles/{id}.json` 是各实例自述区的副本，由主理人在自己站点的 `/admin` 里写、中枢按 `url` 取回；`federation.json` 记创始实例、接入模式与隧道账号端口。名册不参与渲染，只在构建前与清单交叉校验。

接口侧另有一条委托发信（`POST /api/federation/mail`），它不写清单也不写快照，只把一封信交给中枢的 SMTP；见 [FEDERATION.md](FEDERATION.md) 第 7 节。

项目与 bot01 无关：安装、构建、预览和测试都在本机完成。

## 2. 目录

```text
xknot.si/
├── README.md              联邦入口
├── package.json           本项目的脚本：dev / build / test / deploy / admin
├── instances.json         实例清单：签发区字段（构建与发布以这份为准；审核台只改这一段）
├── federation.json        联邦名册：成员身份、接入模式、隧道账号与端口
├── fixtures/              版式样例：十条伙伴条目、探测与橱窗样例，只在 --preview 下并入
├── server/
│   ├── index.mjs          接口进程入口，只监听 127.0.0.1:5181
│   ├── app.mjs            路由、同源检查、限流、Cookie
│   ├── store.mjs          SQLite：申请、状态机、验证/领取令牌、发信日志、管理员与会话
│   ├── validate.mjs       申请表字段校验（纯函数）
│   ├── manifest.mjs       申请 → instances.json 条目，生成后自检
│   ├── edit.mjs           审核台改实例配置：两份文件整份校验后原子写回
│   ├── relay.mjs          委托发信的字段校验与消息组装（纯函数）
│   ├── mail.mjs           SMTP 客户端（net/tls，无外部依赖）与邮件组装
│   ├── notify.mjs         伙伴与内部邮件模板注册表（11 + 3，三语）
│   ├── pages.mjs          /verify/、/case/、/claim/ 三个无脚本页面
│   ├── mail-test.mjs      发一封测试信（npm run mail:test）
│   ├── admin-cli.mjs      建管理员、审核辅助、补发信、交付、签发凭据
│   └── *.test.mjs         接口、状态机、模板与发信流程测试
├── admin/
│   ├── index.html         审核台入口，不参与 Vite 构建
│   ├── admin.js           登录、列表、审核、清单片段
│   └── admin.css          审核台样式
├── docs/
│   ├── NAMING.md          名称约定
│   ├── I18N.md            国际化与区域
│   ├── FEDERATION.md      中枢与实例的契约
│   ├── HUB.md             本文件
│   ├── JOIN.md            加入说明：申请、域名与隧道
│   ├── HANDOFF.md         子域签发到实例接通的交付单
│   ├── PARTNER-MAIL.md    发给伙伴的邮件模板与发信规范
│   ├── federation.svg     架构图
│   └── handoff-flow.svg   交接示意图（配 HANDOFF.md）
├── ops/
│   ├── xknot.si.conf            门户与接口的 nginx 配置
│   ├── dev.mjs                  同时拉起接口与 Vite
│   ├── check-health.mjs         健康探测，写 var/health.json
│   ├── watch-health.mjs         定时巡检：24 小时提醒、7 天隐藏、恢复自动回
│   ├── xknot-health.service     巡检服务单元（oneshot）
│   ├── xknot-health.timer       巡检定时器（每 15 分钟）
│   ├── build-hub-data.mjs       合并清单、探测、活动数据与橱窗，写 data/hub.json
│   ├── cards.mjs                读 var/cards/ 下的橱窗与预览样例合并
│   ├── stats.mjs                读 var/stats/ 下的活动数据与预览样例合并
│   ├── fetch-guard.mjs          拉取守卫：https、DNS、超时、大小、原子写
│   ├── fetch-cards.mjs          橱窗拉取，写 var/cards/{id}.json
│   ├── fetch-stats.mjs          活动数据拉取，写 var/stats/{id}.json
│   ├── fetch-profile.mjs        档案拉取：读 /api/federation/profile，写 var/profiles/{id}.json
│   ├── profile-schema.mjs       自述区的字段契约与清洗（门户与拉取共用）
│   ├── profiles.mjs             读 var/profiles/ 的副本
│   ├── build-hub.sh             本机构建：校验、探测、拉取、构建、写快照
│   ├── verify-hub-data.mjs      发布前守卫：快照里的 id 必须与清单一致
│   ├── deploy-hub.sh            可选的静态站同步（目标由环境变量给出）
│   ├── deploy-api.sh            中枢接口、审核台与站点配置的同步
│   ├── README-deploy-aws.md     中枢托管主机的部署笔记
│   ├── validate-instances.mjs   清单校验
│   └── validate-federation.mjs  名册校验（与清单交叉核对）
├── var/
│   ├── health.json        探测结果（生成物，不入版本库）
│   ├── xknot.db           申请、账号与发信记录（生成物，不入版本库）
│   ├── stats/             各实例的活动数据副本（生成物，不入版本库）
│   └── cards/             各实例的橱窗副本（生成物，不入版本库）
└── web/                   Vue 门户，独立子项目
    ├── package.json       自己的依赖与脚本
    ├── package-lock.json  自己的锁文件
    ├── vite.config.js     三语入口、开发数据中间件、/api 与 /admin 代理
    ├── index.html         / 跳转
    ├── en/                英文入口
    ├── zh-CN/             简体入口
    ├── zh-TW/             繁体入口
    ├── public/logos/      中枢标识与实例 LOGO
    ├── src/
    │   ├── main.js        挂载，语种取自 HTML 的 lang
    │   ├── App.vue        左右分栏：左网络、右加入申请
    │   ├── styles.css     全局样式与主题变量
    │   ├── components/
    │   │   ├── NetworkMap.vue  联邦地图：世界底图、悬空联邦中枢与飞线，点选跳到条目
    │   │   ├── NodeCard.vue    目录卡片：状态、简介、橱窗与当地时刻
    │   │   ├── JoinPanel.vue   加入申请表：校验、提交、成功面板
    │   │   ├── GlobePattern.vue 橙色面板上的点阵球纹路
    │   │   └── LangSwitch.vue  语种切换（浅色与橙色两种底）
    │   ├── icons/         内联 SVG 图标
    │   ├── lib/           纯逻辑：i18n、regions、hub、clock、cards、catalogs、snapshot、preview、world
    │   └── locales/       en、zh-CN、zh-TW 文案
    └── dist/              构建产物（生成物，不入版本库）
```

`xknot.si/` 自己就是一个 npm 项目，页面的依赖隔离在 `web/`。两级都可以直接跑：

```bash
cd xknot.si
npm run dev           # 接口 5181 + 开发服务器 5180，含 fixtures/ 的样例条目
npm run dev:real      # 同样端口，只读真实清单
npm run api           # 只起接口
npm run build         # 校验、探测、构建、写快照，产物在 web/dist
npm run build:preview # 并入样例条目构建，只看版式，不用于发布
npm run verify        # 复核 dist/data/hub.json 的实例与 instances.json 一致
npm run validate      # 清单 + 名册两份校验
npm run test          # 单元测试（清单、名册、页面逻辑、接口与审核）
```

### 2.1 名册字段

`federation.json` 记网络成员的事实，不参与门户渲染。字段与取值：

| 字段 | 取值 | 说明 |
|------|------|------|
| `version` | 整数 ≥1 | 结构版本 |
| `updatedAt` | `YYYY-MM-DD` | 最后改动日 |
| `hub` | 主机名 | 中枢自己的主机，固定 `xknot.si` |
| `members[].id` | 小写 kebab | 必须与 `instances.json` 的 `id` 一致 |
| `members[].host` | 主机名 | 必须等于清单 `url` 的主机 |
| `members[].role` | `founder` / `partner` | 有且只有一个 `founder` |
| `members[].standing` | `permanent` / `regular` | `founder` 必须是 `permanent`，且不能 `listed: false` |
| `members[].mode` | `own-domain` / `subdomain` | 接入模式，决定 `url` 的形态 |
| `members[].tunnel` | `null` 或 `{ account, port }` | `subdomain` 必填，`own-domain` 必须为 `null`；账号与端口全名册唯一 |
| `members[].listed` | `true` / `false` | 是否已收录；决定是否要在清单里出现 |
| `members[].since` | `YYYY-MM-DD` / `null` | `listed: true` 时必填 |
| `members[].note` | ≤200 字 | 给工作人员看的一句话 |

校验在 `ops/validate-federation.mjs`，`ops/federation.test.mjs` 覆盖负例。名册与清单靠 `id` 双向对齐，多一条少一条都失败。

审核台与管理员：

```bash
cd xknot.si
XKNOT_ADMIN_PASSWORD='...' npm run admin -- create-admin paul
npm run admin -- list                 # 待审申请
npm run admin -- show XK-2026-XXXXXX
npm run admin -- manifest XK-2026-XXXXXX
npm run admin -- publish XK-2026-XXXXXX
```

本机打开 `http://127.0.0.1:5180/admin/` 登录审核；接口进程也会在 `http://127.0.0.1:5181/admin/` 直接提供同一页。

```bash
cd xknot.si/web
npm ci
npm run dev      # 开发，端口 5180
npm run build    # 产物 dist/，不含数据快照
npm run test     # 纯逻辑单元测试
```

`xknot.si/` 只在 `web/` 内装依赖，根目录没有 `node_modules`。它不并进 `knot-platform/` 的 `workspaces`，也不引用 `knot-platform/*` 的代码，更不依赖 bot01 上的任何进程。

## 3. 构建与数据

门户是 Vue 3 + Vite 的多入口构建：`en/`、`zh-CN/`、`zh-TW/` 各一个 HTML，`index.html` 跳转到 `/en/`。每个入口的 `lang`、`hreflang`、`canonical` 直接写在 HTML 里，不依赖客户端脚本。

页面运行时读取一份快照：

```text
/data/hub.json
```

快照由 `ops/build-hub-data.mjs` 生成；合并逻辑在 `web/src/lib/snapshot.js`，探测任务和开发服务器共用同一份实现。内容是清单字段加上每个实例的探测结果：

### 3.1 版式样例

`fixtures/preview-instances.json` 放十条伙伴的签发区，`fixtures/preview-profiles.json` 放对应的自述区，`fixtures/preview-health.json` 放探测样例。用途只有一个：让目录看起来像真的有十来个成员，便于判断版式。

- 三个文件都是样例，**不是成员名单**。真实成员记在 `federation.json`（名册）、`instances.json`（签发区）与各实例自己的档案里，样例不写进这些文件。
- 只在 `XKNOT_PREVIEW=1` 时并入内存与本次构建；真实清单里已有同 id 时以真实条目为准，真实探测结果也优先。
- `ops/verify-hub-data.mjs` 在每次构建后复核：生产快照里的 id 必须与 `instances.json` 完全一致，多一条少一条都让构建失败；预览构建只放行 `fixtures/` 里的 id。`ops/deploy-hub.sh` 同步前会再核一次。
- `npm run validate:fixtures` 校验样例本身合法，`preview.test.mjs` 覆盖合并规则。
- 换成真实成员时，删掉对应样例条目即可，中枢代码不用改。

```json
{
  "generatedAt": "2026-10-19T03:00:00.000Z",
  "instances": [
    {
      "id": "wang",
      "name": { "en": "Knot · wang", "zh-CN": "Knot · wang", "zh-TW": "Knot · wang" },
      "url": "https://wang.xknot.si",
      "regions": ["CN"],
      "timezone": "Asia/Shanghai",
      "tier": "partner",
      "status": "active",
      "health": { "status": "up", "lastOkAt": "2026-10-19T02:30:00.000Z", "version": "0.2.0" }
    }
  ]
}
```

上面的 `name`、`regions`、`timezone` 来自该实例的自述区副本；`id`、`url`、`tier`、`status` 来自清单；`health` 来自探测。缺少自述区时门户只显示签发区字段。

构建流程：

```bash
./xknot.si/ops/build-hub.sh            # 校验、探测、取档案、构建、写快照
./xknot.si/ops/build-hub.sh --offline  # 跳过探测，复用 var/health.json
```

脚本顺序固定：校验清单 → 探测健康 → 取回档案 → 安装依赖（仅首次）→ 构建 → 写 `dist/data/hub.json`。全程在本机完成，不连接远端。

页面取数规则：

- 语种取自当前 HTML 的 `lang`，不读浏览器语言，不发 GeoIP 请求。
- 文案取自 `src/locales/`，缺键回退英文，再缺就不渲染该块。
- 时间用 `formatWhen`：7 天内为相对时间，超过为绝对日期，按实例的 `timezone` 计算。
- 区域分组由 `src/lib/regions.js` 的 `groupsOf` 从 `regions` 推出。
- `hub.json` 由 nginx 以 `no-cache` 提供；状态是构建那一刻的采样，重新构建才会更新。

## 4. 页面

一屏两栏：左边白，放当前联邦的全球网络；右边橙，放加入申请。

1. **左栏（白）**：顶栏（标识、在线计数、主题与语种）→ 刊头（`XKNOT` 与本地语种的名称、标语、一句定位）→ 联邦地图（`全球实例分布`、状态图例、世界底图，下面一行四个数字：实例、区域、在线、最近同步）→ 实例目录（区域筛选、只看在线、只看热点、卡片）→ 页脚（不托管内容的声明、许可、运营者入口）。左栏独立滚动，筛选条与目录头吸顶。
2. **右栏（橙）**：点阵球与经纬线做底。`申请加入 XKnot`：三步说明（提交、审核、写进清单）、表单、联邦约定。表单字段为站点名称、地址、一句话简介、运营者、联系邮箱、区域、时区、标签、同意勾选。提交成功后原地换成申请编号与提交时间，可以再提交一份。

900px 以下改成上下排：白色网络在上，橙色申请在下，整页滚动。上下排时申请表会落到实例目录之后，所以刊头多一个 `申请加入 →` 的锚点（`#join`），一处点得到。右栏被压到约 400px 时收掉步骤说明，让提交键留在首屏。

### 联邦地图

地图是一张等距圆柱投影的世界底图（`web/src/lib/world.js`，数据为 Natural Earth 110m 陆地，`ops/build-world-dots.mjs` 生成）。实例的位置由实例清单里的 `regions` 决定：国家中心点求和后取中心，因此「北欧四国」落在斯堪的纳维亚，「阿根廷 + 智利 + 乌拉圭」落在南锥体。`GLOBAL` 或没有可定位国家代码的条目不上图，收在地图下方「无固定区域」的一行小标签里，仍可点。

- 底图是点阵填充的陆地 + 30° 经纬网，和右栏的点阵球同一套语汇。地图只说「在哪」，不承载地理细节。
- 地图上方悬着一个**联邦中枢**徽标（`XKNOT` + 联邦中枢），不落经纬度。标识由 `BrandMark` 按三档分辨率出图，徽标其余布局不变。
- 每个实例一条**半透明橙色长划线弧**飞向联邦中枢（`stroke-dasharray: 10 5`，选中态 `12 4`），弧线朝中轴外侧鼓一点，十根线才不会在中枢下方挤成一根柱子。长划线的节奏更像航线；线的状态只靠粗细与浓淡区分（选中的加粗加深、不可达的压淡），不另起一套配色。弧上的短亮光点按清单顺序错开延迟，从实例飞向中枢。
- 链路颜色走 `--map-link-line`（浅色 `rgba(232,112,28,.42)`，深色 `rgba(255,154,82,.40)`），和右栏申请区的橙是同一支暖色；联邦中枢徽标里的占位标记用不透明的 `--map-link`，线的落点才不会和徽标分家。
- 弧线的交汇点取在画布上缘之上（`HUB.y < 0`），藏在徽标后面，地图上不会留下一个结。
- **实例之间另有一层浅绿直连**，画在橙色弧线下面：将来站点按协议标准直接交换数据，不必每条都绕到中枢。每个站取最近的 2、3 或 4 个邻居（按清单顺序轮流取，`PEER_DEGREES = [2, 3, 4]`），所以网是疏密不均的，不是完全图。两点互相选中时只画一条，A–B 与 B–A 是同一根线。直连用直线，朝中枢的弧线用曲线，形状本身就把两套语义分开了。
- 直连颜色走 `--map-peer`（浅色 `rgba(31,168,110,.4)`，深色 `rgba(126,231,178,.24)`）；两端有一头 `down` 时压到 0.4 透明度，选中某站时与它相连的几条加深加粗。地图脚注给一小段绿线和一句解释，不混进状态图例——绿线说的是协议关系，不是可达性。
- 徽标用 `transform: translate(-50%, -74%)` 悬在地图上缘，底下有一层随呼吸收放的投影；徽标本体与投影各自做 7s 上下浮动，`prefers-reduced-motion` 下停止。
- 地图宽度到 620px 才在点旁常驻站名（容器查询）；更窄只留点，悬停或聚焦出标签。
- 挤在同一片区域的两个点会上下错开约 17 个单位，保证都点得到。点选后滚到对应条目并高亮 2.6 秒；被筛掉的点变暗但仍可点。
- 动效只有脉冲、飞向中枢的光点与徽标浮动，`prefers-reduced-motion` 下全部停止。

### 品牌资产

标识的矢量母版在仓库根的 `docs/xknot-mark.svg`，`web/public/` 里只放由它栅格化出来的成品，不引用外站。

| 文件 | 分辨率 | 用途 |
|------|--------|------|
| `logos/xknot.jpg` | 1024×1024 | 分享卡片 `og:image`：深橙底 + 白色标识 |
| `logos/xknot-icon.png` | 512×512 | 大档母版 |
| `logos/xknot-icon-32.png` | 32×32（小） | 1× 屏幕的页头与地图徽标 |
| `logos/xknot-icon-64.png` | 64×64（中） | 2× 屏幕、审核台页头 |
| `logos/xknot-icon-128.png` | 128×128（大） | 3× 及以上屏幕，兼作 src 回落 |
| `favicon-32.png` / `favicon-16.png` | 32、16 | 浏览器页签 |
| `apple-touch-icon.png` | 180×180 | iOS 主屏（白底，主屏图标不要透明） |

页头与地图徽标都由 `components/BrandMark.vue` 出图：`srcset` 用 `1x / 2x / 3x` 描述指向 32 / 64 / 128 三档，浏览器按设备像素比取一档，高分屏不再把小图放大。审核台页头用同一组 `srcset`。

全站只有一个标识版本：透明底的深橙几何标，没有字标。图形自带留白，页头不再给它加圆角或描边；`og:image` 是唯一反白的一处。档位与重出命令见 `docs/README.md`。

### 实例目录与热点橱窗

目录是一列卡片网格（`repeat(auto-fill, minmax(272px, 1fr))`，约 750px 起两列，更宽到三列），每张卡片是一个站点：

- 头部：站点徽记（有 `logo` 用 logo，否则用站名首字，底色取清单里的 `themeColor`）、站名（整张卡片可点的入口）、分级徽章、进入箭头；站名下一行是实例自己时区的当前时刻、区域与 `UTC±X`。
- 正文：一句话简介，最多两行。
- 橱窗位：有 L3 卡片时显示第一条，火焰标 + 原标题（伙伴的语言，不翻译）+「更新于 X」+ 语言码 +「另 N 条」。点它直接去伙伴站点的那一篇，与卡片本身的入口分开。
- 页脚：信号条与状态、延迟。延迟只在 `up`、`degraded` 时显示；`down` 时显示上次正常的时间，避免把探测耗时当成响应时间。

卡片的圆角 10px、1px 描边，悬停抬升 2px 并露出顶部状态色条。被地图点选时整张卡片高亮 2.6 秒。

热点是「有就长出来，没有就空着」：没有橱窗的卡片不占位、不写「暂无」，只是比同一行的卡片矮一截留白。目录头在有热点时多一个 `只看热点 N` 开关，没有热点时整个开关不出现，避免永远点不出东西的入口。

橱窗年龄分三档（`lib/cards.js`）：24 小时内 `fresh`，一周内 `recent`，7–30 天 `aging` 转灰（仍在，但不再当新闻读），超过 30 天不再展示。`hub.json` 里每个实例的 `cards` 最多 6 条，只带 `id`、`title`、`summary`、`url`、`lang`、`updatedAt`，正文 `body` 不进门户。

目录里的钟点是**实例自己时区**的当前时刻，每 20 秒刷新一次，并带 `UTC±X` 偏移。这条信息让「分布在不同时区、由不同的人维护」在版面上直接可见，不再只是一句声明。区域仍只用于筛选，不参与排序。

分级的排序规则不变：`demo` → `partner` → `community`，同级按 `since`，再按 `id`。

区域筛选：全部，加上清单里实际出现过的分组，顺序固定为全球、东亚、东南亚、南亚、中亚、中东、欧洲、北美、拉美、非洲、大洋洲、其他。没有条目的分组不显示，避免点开是空列表。

M2 的拉取步骤落地后，`ops/fetch-cards.mjs` 把每个 `cardsUrl` 取回写 `var/cards/{id}.json`；构建（`ops/build-hub-data.mjs`）与开发服务器（`web/vite.config.js`）都通过 `ops/cards.mjs` 读这个目录，条目形状与页面渲染在这一步就固定下来。`fixtures/preview-cards.json` 提供样例橱窗，含多种语言与非拉丁标题。样例里的 `generatedAt` 是固定时间，所以样例热点会随真实时间变旧；要长期保持预览里的热点，改样例里的日期即可。

页面不提供注册、登录、搜索和站内阅读。唯一的表单是加入申请：它只写中枢的申请队列，不创建账号、不改已有实例。橱窗正文只作摘要，点开回原站。

### 4.1 路径

| 路径 | 内容 |
|------|------|
| `/` | 302 到 `/en/` |
| `/en/` | 英文页面 |
| `/zh-CN/` | 简体页面 |
| `/zh-TW/` | 繁体页面 |
| `/data/hub.json` | 运行时快照，`no-cache` |
| `/admin/` | 审核台，需要管理员会话才能读数据 |
| `/api/applications` | 加入申请，`POST` |
| `/api/admin/*` | 登录、会话、申请列表、审核、清单条目 |

语言切换是普通链接，回到同一页面。页面不读取访客 IP，不发起 GeoIP 请求。

### 4.2 视觉方向

中枢是独立产品，不沿用 Knot 实例的 Facebook 风格。它读起来像一张基础设施仪表盘，而不是内容社区：

- 默认浅色：页面 `#F3F6FB`，面板 `#FFFFFF`，正文 `#0A1322`，次要文字 `#475569`。
- 主色是单一蓝 `#0B5FFF`，辅色青 `#0093A6` 与紫 `#6D4AFF`；状态色绿 `#0B7A54`、黄 `#A16207`、红 `#B42318`。
- 深色不是纯黑，是墨蓝：页面 `#0A1220`，面板 `#101A2B`，主色提亮到 `#5B9BFF`。顶栏按钮切换，选择存进 `localStorage`，入口页头内联脚本先贴主题，避免刷新闪白。
- 两套主题共用一套语义变量（`--page`、`--surface`、`--ink`、`--line`、`--accent`、`--ok` 等），组件里不写死颜色。
- 字体：标题与正文 Space Grotesk，技术标签 JetBrains Mono。两个字体随构建打包，不请求外部 CDN；中文回退到系统黑体。
- 视觉元素：细网格底纹、两处柔光、1px 描边、行分隔线、信号条、联邦地图。不用霓虹、扫描线、故障效果。
- 密度优先：宽屏两列卡片，首屏能看见四张以上实例；卡片以信息为主，不做大图封面，不把目录推到第二屏。
- 动效只表达「链路在动」：顶栏扫光、实例脉冲、条目入场错峰、从地图跳转时的高亮。全部在 `prefers-reduced-motion` 下关闭。
- 360px、390px、768px、1280px、1440px 宽度下均可完成主操作。可点击区域不小于 44×44px。
- 英文文案按比中文长 30% 到 50% 预留，按钮和状态点不设固定宽度。
- 图标用内联 SVG，可点击时有 `aria-label`。

## 5. 健康探测

`ops/check-health.mjs`：

- 读 `instances.json` 与 `federation.json`。
- 每个实例的探测地址恒为 `url` + `/api/health`（`ops/probe-target.mjs` 推出）；清单 `status` 为 `active` 才探，`pending` / `suspended` / `retired` 都不探。
- 并发探测这些地址，超时 5 秒，不跟随重定向。
- 合并上一次的 `checks`、`ok`、`since`，累加。
- 原子写入 `var/health.json`。

`status` 不是 `active` 的条目不探测，保留上一次的结果。

探测在构建时执行一次，也不依赖任何远端机器。`var/health.json` 保留上一次结果用于累加，重新构建即刷新页面上的状态。

### 5.1 定时巡检与断连规则

生产上由 systemd timer 每 15 分钟运行 `ops/watch-health.mjs`。它复用 `check-health.mjs` 的探测与状态合并，再按连续时长处理：

| 条件 | 动作 |
|------|------|
| `down` 连续 24 小时 | 给实例 `contact` 寄 `partner.unreachable_24h` |
| `down` 连续 7 天 | 寄 `partner.hidden_7d`，门户不再展示该条目 |
| 任一探测 `up` / `degraded` | 清空 `downSince` 与隐藏标记，自动回到门户 |
| 清单 `status` 仍为 `pending` 且 `since` 已 14 天 | 内部提醒运营方 |
| 清单 `status` 仍为 `pending` 且 `since` 已 30 天 | 门户暂时隐藏 |

- 状态写在 `var/health.json` 的 `downSince`、`notified`、`hiddenAt`、`hiddenReason`；每条通知只发一次。
- 同一个 id 重新签发（清单 `since` 变了）时，旧状态作废，不继承隐藏标记与断连计时。
- 隐藏是 `buildHubData` 输出里的 `health.hidden`，**不改 `instances.json`**，也不动实例自己的数据。
- 没有 SMTP 时照常写状态，日志里会标出没发出去的信。
- `node ops/watch-health.mjs --dry-run` 只探测与打印，不写状态、不发信。

单位文件：`ops/xknot-health.service`（oneshot）与 `ops/xknot-health.timer`（`OnBootSec=2min`、`OnUnitActiveSec=15min`）。安装：

```bash
sudo install -m 644 ops/xknot-health.service ops/xknot-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xknot-health.timer
systemctl list-timers xknot-health.timer
```

### 5.2 手工执行

```bash
cd xknot.si
npm run probe                # 只探测，写 var/health.json
node ops/watch-health.mjs    # 探测 + 发信 + 写状态
node ops/watch-health.mjs --dry-run   # 预览，不落盘
npm run build                # 探测并构建
npm run build -- --offline   # 跳过探测，复用上一次结果
```

## 6. 数据拉取

M2 的两步都在构建时执行，入口分别是 `ops/fetch-cards.mjs` 与 `ops/fetch-stats.mjs`：

- 读 `instances.json`，只处理 `cardsUrl` / `statsUrl` 非空的条目，非 active 的跳过。
- 按 [FEDERATION.md](FEDERATION.md) 第 5.6、6.6 节执行 URL 检查与内容清洗。
- 校验 `formatVersion`（橱窗）、卡片数量、字段长度、图片主机与计数类型。
- 带上一份的 `ETag`；304 时不动文件。
- 成功时原子覆盖 `var/cards/{id}.json` 或 `var/stats/{id}.json`，失败时保留上一份。
- 与健康探测同一步骤，`--offline` 时两步一起跳过。

展示侧读这两个目录：`ops/cards.mjs` 与 `ops/stats.mjs`，`hub.json` 的每个实例因此多一个 `cards` 数组和一个 `stats` 对象。页面只展示第一条橱窗与最多两项计数；没有 `stats` 的条目显示「未公开」，不显示 0。

## 7. 运行与部署

项目在本机开发、构建和预览，不依赖 bot01，也不经过任何中转机。

### 7.1 本机

```bash
cd xknot.si
npm run dev      # 接口 5181 + 开发服务器 5180，/data/hub.json 现算
npm run api      # 只起接口
npm run build    # 产物 web/dist，含 data/hub.json
npm run preview  # 预览构建产物（在 web/ 内执行）
```

`web/dist` 是完整的静态站：`index.html`、三个语种目录、`assets/`、`data/hub.json`。申请表单与审核台需要 `server/` 的接口进程；只想看版式时，可以只跑静态站。

### 7.2 静态托管（可选）

需要公开域名时才做这一步。门户不要求特定托管方，任何能提供静态文件的服务器都可以：

- 根目录指向 `web/dist`。
- `/` 302 到 `/en/`，或直接放一个跳转用的 `index.html`。
- `/assets/` 长缓存，`/data/hub.json` 用 `no-cache`。
- `/api/` 与 `/admin/` 反代到 `127.0.0.1:5181`（接口只监听回环，不要直接暴露端口）。
- `ops/xknot.si.conf` 是一份 nginx 参考配置。
- 证书由 Certbot 管理，不改 `ssl_certificate` 配置。

接口进程的环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `XKNOT_API_PORT` | `5181` | 监听端口 |
| `XKNOT_API_HOST` | `127.0.0.1` | 监听地址，不要改成 `0.0.0.0` |
| `XKNOT_DATA_DIR` | `var/` | 库文件、会话密钥 |
| `XKNOT_INSTANCES_FILE` | `instances.json` | 清单路径。本地联调与端到端指向临时清单，接口、审核台的「编辑」与 `admin-cli`（含 `publish`）一起生效，不动仓库里的实例表 |
| `XKNOT_FEDERATION_FILE` | `federation.json` | 名册路径。总览里实例的账号配置从这里读，审核台「编辑」也写回这份文件；按 `mtime` 缓存，改完不必重启 |
| `XKNOT_SESSION_SECRET` | 自动生成 | 首次启动写到 `var/session-secret`，`0600` |
| `XKNOT_SECURE_COOKIE` | 关 | 生产置 `1`，会话 Cookie 加 `Secure` |
| `XKNOT_TRUST_PROXY` | 关 | 生产置 `1`，限流取 `X-Forwarded-For` 的末尾地址（nginx 追加的真实来源），不取可伪造的首个地址 |

邮件可选，不配就不发信：

| 变量 | 默认 | 说明 |
|------|------|------|
| `SMTP_HOST` | （空） | SMTP 主机。与 `MAIL_FROM` 同时有值才启用发信 |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | 关 | 465 隐式 TLS 写 `1`；587 用 STARTTLS 保持 `0` |
| `SMTP_USER` | （空） | SMTP 用户名。阿里云邮件推送要求与发信地址一致 |
| `SMTP_PASS` | （空） | SMTP 密码 |
| `SMTP_FROM` | （空） | 发信地址 |
| `MAIL_FROM` | （空） | 发信地址，优先于 `SMTP_FROM` |
| `XKNOT_ADMIN_EMAIL` | （空） | 新申请与验证通知的收件地址；留空则只通知审核台 |
| `XKNOT_PUBLIC_ORIGIN` | `https://xknot.si` | 邮件与页面里链接用的门户地址 |
| `XKNOT_MAIL_REPLY_TO` | 取 `MAIL_FROM` | 伙伴信的 `Reply-To`；默认 `no-reply@xknot.si` |
| `XKNOT_SUPPORT_URL` | （空） | 伙伴信里的可选联系入口；留空整行省略 |
| `XKNOT_REVIEW_SLA` | `3 个工作日` | 审核时限的展示文案 |
| `XKNOT_RELAY_ENABLED` | 随 SMTP | 委托发信开关；配了 SMTP 即开，置 `0` 可单独关掉 |
| `XKNOT_RELAY_DAILY_LIMIT` | `50` | 每份凭据 24 小时内的发信上限 |

生产把密码放在 `/opt/xknot/var/mail.env`（`0600`），由 systemd 的 `EnvironmentFile` 读入，不写进 unit 文件。`npm run mail:test -- <收件地址>` 用同一套环境变量发一封测试信。

接口没有外部依赖，Node 26 的 `node:sqlite` 即可运行，根目录仍然不需要 `node_modules`；SMTP 客户端用 `node:net` / `node:tls`，也没有引入新依赖。

### 7.3 同步到托管目录（可选）

构建完成后，如需同步，使用：

```bash
XKNOT_HUB_SSH=user@host ./xknot.si/ops/deploy-hub.sh --dry-run
XKNOT_HUB_SSH=user@host ./xknot.si/ops/deploy-hub.sh
```

`XKNOT_HUB_SSH` 必填，脚本不写死主机；`XKNOT_TARGET`（默认 `/var/www/xknot`）和 `XKNOT_SSH_KEY` 可覆盖。这一步由执行构建的机器直接发起，与 bot01 无关。

接口、审核台与站点配置用 `ops/deploy-api.sh`，同样只认 `XKNOT_HUB_SSH`：

```bash
XKNOT_HUB_SSH=user@host ./xknot.si/ops/deploy-api.sh --dry-run
XKNOT_HUB_SSH=user@host ./xknot.si/ops/deploy-api.sh
```

它同步 `server/`、`admin/`、`docs/` 和清单校验依赖，安装 nginx 配置与 systemd unit，`nginx -t` 后重启接口并 reload nginx。静态站与接口分开部署，互不覆盖。

### 7.4 更新流程

清单或文案变更：

```bash
cd xknot.si
npm run build     # 校验、探测、构建、写快照
npm run test
# 需要公开时再同步 dist
```

回滚方式：检出上一版 `instances.json`、`web/src` 和 `var/`，重新构建。

### 7.5 把发信地址共享给伙伴

中枢用一个发信域名（当前是 `xknot.si`），给每个实例建一个发信地址，例如 `knot-wang@xknot.si`、`knot-travel@xknot.si`。每个发信地址单独设 SMTP 密码；伙伴离开就删地址或改密码，不影响其他实例。

伙伴把下面这几项填进实例自己的邮件配置（用 `knot-platform` 时是 `sites/<站点>/platform.env`）。`SMTP_HOST` 跟阿里云控制台区域走：华东 `smtpdm.aliyun.com`，新加坡 `smtpdm-ap-southeast-1.aliyuncs.com`。

```bash
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=knot-travel@xknot.si
SMTP_PASS='该发信地址的 SMTP 密码'
SMTP_FROM=knot-travel@xknot.si
MAIL_FROM=knot-travel@xknot.si
KNOT_ADMIN_EMAIL=partner@example.com
```

- `SMTP_USER` 必须等于 `SMTP_FROM`。显示名可以写 `MAIL_FROM="Knot · travel <knot-travel@xknot.si>"`。
- 新地址或刚改的 SMTP 密码有约 10 分钟生效延迟，期间会返回 `535 Authentication failure`；`SMTP_HOST` 的区域必须与控制台一致。
- `xknot.si` 的 MX 已指向 `mx01.dm.aliyun.com`，这个域只用于发信；不要再用它配企业邮箱收信，MX 会冲突。回信地址用伙伴自己的邮箱。
- 只用于登录密钥、审核与交易通知；不要拿它群发。同一个域名的发信信誉是共用的，一个实例滥发会影响所有实例。
- 发信额度、日上限和退信处理以阿里云邮件推送控制台为准；每个地址单独看。
- 伙伴不需要 `XKNOT_*` 变量；那些只属于中枢接口。

## 8. 验收

下面按里程碑列人工验收项。可自动化的部分已经落进 `e2e/`：本地怎么起栈、
每一项对应哪个用例、哪些只能人工看，见 [E2E.md](E2E.md)。

M1：

- [ ] `https://xknot.si/` 返回 302 到 `/en/`
- [ ] `/en/`、`/zh-CN/`、`/zh-TW/` 内容一致，只有语言不同
- [ ] 每个页面有正确的 `lang`、`hreflang`，`x-default` 指向 `/en/`
- [ ] 字段在三种语言都缺时不渲染该块，页面没有空行和键名
- [ ] 实例列表每条有名称、简介、当地时刻和健康点
- [ ] 目录里的时刻是实例时区的当前时间，不是访客本地时间
- [ ] 点地图上的实例会滚到对应条目并短暂高亮；被区域筛掉的实例变暗但仍可点
- [ ] 地图上方的联邦中枢徽标悬空显示，每个实例有一条半透明橙色长划线弧连到它；徽标显示 xknot 标识，仍居中且不压住地图标题
- [ ] 实例之间另有浅绿直连，每个站的邻居数为 2、3 或 4；刷新页面连法不变
- [ ] 「只看在线」只留下 `up` 与 `degraded`
- [ ] 停掉一个实例，重新构建后它的点变红，同时显示上次正常时间，其他实例不受影响
- [ ] `instances.json` 加一条、`federation.json` 同步登记、重新构建后页面出现新条目，无需改代码
- [ ] `npm run validate:federation` 对缺名册、缺清单、重复端口、两个 founder 都返回 1
- [ ] `status` 不是 `active` 的条目保留上次结果，不被探测覆盖
- [ ] 区域筛选按分组工作，未知国家落「其他」
- [ ] 目录是卡片网格：宽屏两列、窄屏单列，卡片等高，悬停抬升并露出状态色条
- [ ] 有橱窗的卡片显示一条热点（标题、语言码、更新于 X），点它回原站那一篇
- [ ] 没有橱窗的卡片不显示占位，也不写「暂无」
- [ ] `只看热点` 开关只在有热点时出现，打开后只剩带橱窗的卡片
- [ ] 页面在 360px、390px、768px、1280px、1440px 宽下可读、可点，不出现横向溢出
- [ ] 一屏两栏：宽屏左白右橙、各自滚动；900px 以下上下排，刊头的 `申请加入 →` 能跳到右栏
- [ ] 英文文案不溢出按钮和状态点
- [ ] 除加入申请外，门户不发起写请求；视图不设置 cookie
- [ ] 页面只请求同源的 `/data/hub.json` 与 `/api/applications`，不直接请求伙伴站点
- [ ] `validate-instances.mjs` 对正确清单返回 0，对错误清单返回 1
- [ ] `validate-federation.mjs` 对正确名册返回 0；清单多一条、名册少一条时返回 1
- [ ] `federation.test.mjs` 覆盖 founder 唯一、永久账号不可下架、账号与端口唯一、名册与清单一一对应

M2：

- [ ] 伙伴只改自己站点上的 `knot-cards.json`，重新构建后门户出现新橱窗
- [ ] 拉取失败时保留上一份，页面显示「更新于」旧时间
- [ ] 卡片超过 7 天标灰，超过 30 天整组隐藏
- [ ] 图片加载失败显示占位，不撑破布局
- [ ] 每张卡片的跳转都回原站
- [ ] 删除 `var/cards/{id}.json` 即整组下架
- [ ] 至少一个伙伴提供 `statsUrl`，构建后卡片出现「伙伴公开的数据」一行
- [ ] 缺 `statsUrl` 时不显示这一行，也不写 0
- [ ] 伙伴的 `statsUrl` 返回坏 JSON 或私有地址时，构建继续，上一份保留

委托发信：

- [ ] `relay-token <instance>` 打印一次明文，`relay-tokens` 里看不到明文
- [ ] 用该凭据发一封测试信，收件人看到 `From` 是 `MAIL_FROM`、`Reply-To` 是实例的 `contact`
- [ ] 未带凭据返回 401，伪造凭据返回 401，吊销后返回 401
- [ ] 实例不在清单或状态不是 `active` 时返回 403
- [ ] `to` 带显示名、`subject` 带换行、`text` 超过 4000 字时返回 400
- [ ] `replyTo` 用外部域名返回 400 `foreign_domain`
- [ ] 超过每日额度返回 429；同一 `idempotencyKey` 重试不重复发信
- [ ] SMTP 故障返回 502，`relay-log` 里有一条 `failed`，且日志不含正文与完整地址
- [ ] 未配 SMTP 或 `XKNOT_RELAY_ENABLED=0` 时返回 503

M3：加入申请

- [ ] 表单空着提交时逐项报错，焦点落到第一个错误字段
- [ ] 提交成功显示 `XK-YYYY-XXXXXX` 形式的编号，刷新后回到空白表单
- [ ] 同一地址再次提交返回重复提示，不新增记录
- [ ] 站点地址不是 `https://`、邮箱不完整、简介超过 60 字时拒绝提交
- [ ] 未登录访问 `/api/admin/applications` 返回 401
- [ ] 审核台登录后能看到申请，通过/拒绝/搁置都会更新状态与审核人
- [ ] 总览里点实例就地展开配置，不跳站；点「编辑」能改并写回两份 JSON，非法值返回 400 且文件不变
- [ ] 已通过的申请能生成清单条目，`validateInstance` 无错误
- [ ] `publish` 写回 `instances.json` 后重新构建，条目出现在地图与目录
- [ ] 接口进程重启后申请与账号仍在
- [ ] 跨站 POST 返回 403；连续提交触发 429

## 9. 加入申请与审核

申请只进队列，不直接进清单。三个角色各自独立：访客提交、管理员审核、人执行构建。

### 9.1 数据

`var/xknot.db`（SQLite，WAL）：

| 表 | 内容 |
|----|------|
| `applications` | 申请：名称、接入模式、自有域名或子域标签、运营者、邮箱、区域、时区、简介、标签、状态、案例键、状态版本、验证与审核记录 |
| `admins` | 管理员：用户名、scrypt 口令、创建时间、最近登录 |
| `sessions` | 会话：令牌的 SHA-256、管理员、过期时间 |
| `events` | 审计：提交、验证、通过、拒绝、搁置、撤回、过期、建号、删号、凭据签发与吊销 |
| `verify_tokens` | 邮箱验证令牌：SHA-256、申请、签发/过期/使用时间 |
| `claim_tokens` | 一次性领取令牌：SHA-256、申请、交付内容、签发/过期/使用时间 |
| `notify_log` | 发信记录：事件、案例、状态版本、语种、收件域名、地址哈希、模板版本、结果；不含正文 |
| `relay_tokens` | 委托发信凭据：实例、标签、令牌 SHA-256、每日上限、签发与吊销时间 |
| `relay_log` | 发信记录：实例、收件域名、地址哈希、主题长度、结果；不含正文 |

申请状态与迁移：

```text
pending ──▶ verified ──▶ hold ──▶ verified
   │            │           │
   │            ├──────────▶ approved
   │            ├──────────▶ rejected
   │            └──────────▶ withdrawn
   ├──▶ withdrawn
   └──▶ expired（30 天未确认）
```

`pending` 表示等邮箱确认，不能直接审核；`approved` 只代表「可以收录」，与实例是否接通无关。同一地址在 `pending`、`verified`、`hold` 时再次提交返回 `409 duplicate`；`approved` 之后放行，补服务或变更模式要能再交一张单。

申请只有两种模式：`mode` 为 `own-domain` 时必填 `domain`（完整主机名，统一收成 `https://` origin，不接受 IP、`localhost`、账号密码、查询串，也不接受 `xknot.si` 及其子域）；`mode` 为 `subdomain` 时必填 `subdomain` 标签（2–32 位小写字母、数字、连字符，保留名不签发），`url` 由它拼成 `https://<标签>.xknot.si`。归属验证（DNS TXT / well-known）已从申请流程移除——签发前没有可验证的域名，验收改为接通后的公网 `/api/health`。

申请表上方写明审核人姓名与邮箱（`web/src/lib/contact.js`，默认 `PaulWang` / `manwjh@gmail.com`，可在构建前用 `VITE_XKNOT_OPERATOR_NAME`、`VITE_XKNOT_OPERATOR_EMAIL` 覆盖）。提交时除给申请人的回执外，还会给 `XKNOT_ADMIN_EMAIL` 寄一封内部提醒。

### 9.2 接口

| 方法与路径 | 权限 | 说明 |
|------------|------|------|
| `POST /api/applications` | 公开 | 提交申请，201 返回编号；字段错误 400 带 `fields`；限流 429 |
| `POST /api/admin/login` | 公开 | 用户名 + 口令，成功后种 `xknot_admin` Cookie |
| `POST /api/admin/logout` | 会话 | 删除当前会话 |
| `GET /api/admin/session` | 会话 | 当前管理员 |
| `GET /api/admin/overview` | 会话 | 总览汇总：实例与逐个账号的配置、探测、申请队列、24 小时发信与最近事件 |
| `POST /api/admin/instances/:id/config` | 会话 | 改实例配置：`{ instance, member }` 两份补丁，整份校验通过后原子写回 `instances.json` 与 `federation.json`；不合法返回 400 + `fields[]` |
| `GET /api/admin/applications?status=` | 会话 | 列表与各状态计数 |
| `POST /api/admin/applications/:id/review` | 会话 | `approve` / `reject` / `hold` / `resume`；`hold` 带 `items[]`，`reject` 带 `reason` |
| `POST /api/admin/applications/:id/verify` | 会话 | 验证信寄不到时人工确认邮箱 |
| `POST /api/admin/applications/:id/notify` | 会话 | 补发任意伙伴事件（`event` 取自 PARTNER-MAIL.md） |
| `POST /api/admin/applications/:id/handoff` | 会话 | 生成一次性领取令牌并寄交付信，返回 `claimUrl` |
| `GET /api/admin/notify-log?limit=&case=` | 会话 | 发信日志 |
| `GET /api/admin/applications/:id/manifest` | 会话 | 生成清单条目，生成后自检，不合法返回 422 |
| `GET /verify/:token` | 公开 | 邮箱确认页；只渲染按钮，不消费令牌 |
| `POST /api/verify` | 公开 | 消费验证令牌（表单或 JSON），一次有效 |
| `GET /case/:caseKey` | 公开 | 案例页：状态、补材料、公钥、撤回 |
| `POST /api/case/:caseKey/{resend-verify,withdraw,public-key,confirm-contact}` | 公开 | 案例页动作；成功 303 回案例页 |
| `GET /claim/:token` | 公开 | 领取页；只渲染按钮，不消费令牌 |
| `POST /api/claim` | 公开 | 消费领取令牌，明文只返回这一次 |
| `POST /api/federation/mail` | 凭据 | 代实例发一封纯文本通知；字段错误 400，额度或频率超限 429，SMTP 失败 502 |
| `GET /api/federation/mail` | 凭据 | 查该凭据 24 小时额度 |

`/case/`、`/verify/`、`/claim/` 以及对应的 `/api/` 写操作在 nginx 里关闭了 `access_log`：链接本身就是能力凭据。三个页面都不执行脚本，变量全部转义，响应带 `no-store`、`no-referrer`、`X-Robots-Tag: noindex`。

委托发信：

- 凭据由命令行签发：`npm run admin -- relay-token <instance> [--label text] [--daily 50]`。明文只打印一次，库里只有 SHA-256。
- 实例要的接入件由 `npm run admin -- access <申请编号> --id <instance> --with-relay --out <文件>` 生成：只含实例 id、中枢地址、签发日期与委托发信凭据（发信地址由中枢地址推导）。格式与键名见 [FEDERATION.md 第 7.4 节](FEDERATION.md#74-接入件)；实例存成什么文件名、放哪个目录，是实例自己的事。站点拓扑不进这份文件，部署与接入因此互不牵连。
- 吊销按凭据 id，或按实例 id 一次吊销该实例全部凭据：`npm run admin -- relay-revoke <id|instance>`。
- 只认 `Authorization: Bearer`，不读 Cookie；实例必须在清单里且 `status: active`。
- 单凭据每分钟 6 封、默认每 24 小时 50 封；全站每小时最多 240 封。
- 只发纯文本，发信人恒为 `MAIL_FROM`；`Reply-To` 必须落在实例自己的域名，省略时用 `contact`。
- 记录只留收件域名与地址哈希，`relay-log` 可查；默认保留 30 天。
- 没配 `SMTP_HOST` / `MAIL_FROM` 或 `XKNOT_RELAY_ENABLED=0` 时，该接口返回 503。

邮件通知：

- 提交后立刻寄两封：给申请人的 `partner.received`（含 30 天有效的验证链接），给 `XKNOT_ADMIN_EMAIL` 的 `internal.application_new`。内部告警最多每小时 30 封，超过只入库不发信。
- 确认邮箱后寄 `partner.verified` 与 `internal.application_verified`；审核结果寄 `partner.approved` / `partner.rejected` / `partner.hold`。
- 发信幂等键是 `{event}:{caseId}:{stateVersion}`，状态迁移每次 `+1`；重复点同一个审核动作返回 409，也不会重复发信。
- `hold` 只寄条目码，`reject` 只寄原因类别；审核备注只在库里和审核台，永远不出现在信里。
- 伙伴信 `Reply-To` 是 `no-reply@xknot.si`，正文写明不接收回复；只有内部信把 `Reply-To` 指向申请人。
- 发信失败只写进程日志与 `notify_log`，提交和审核照常成功；没配 `SMTP_HOST` / `MAIL_FROM` 时静默跳过。
- 限流：单个收件地址 12 封/天、单个域名 30 封/天、全站 200 封/天；超限记 `throttled`，可用 `admin-cli notify` 补发。

伙伴侧的事件、收件人、三语全文与发信规范以 [PARTNER-MAIL.md](PARTNER-MAIL.md) 为准。

接收侧规则：

- 请求体上限 16KB，只接受 JSON；`Origin` 与 `Host` 不一致的 POST 返回 403。
- 字段上限与清单一致：名称 2–40、简介 60、运营者 80、邮箱 120、标签 5 个。
- 地址只接受 `http(s)`、必须带点、不能带账号密码；通过审核后写进清单时会再校验一次 `https`。
- 表单里有一个对用户隐藏的字段，填了就当作机器人：返回成功，不落库。
- 限流在进程内按来源地址的哈希计数：提交每小时 8 次，登录每 15 分钟 12 次。
- 口令用 `scrypt` 加盐；会话令牌 32 字节随机数，库里只存哈希，Cookie 为 `HttpOnly`、`SameSite=Strict`、`Path=/`。

### 9.3 审核台

`/admin/` 是一个不参与构建的静态页：

- 登录后默认是**总览**：四个数字（实例、待审核申请、24 小时发信、委托发信），实例与探测列表，申请队列，以及最近事件。数据来自 `GET /api/admin/overview`。
- 实例行显示名称、地址、分级、在线/离线/未探测、延迟或断连时长；有橱窗或活动数据的实例带标记。
- 点一行在下面展开这个账号的配置，不跳站点：名册身份、席位、接入模式、隧道账号与端口、清单列出、加入时间、时区、语言、运营者、所有者、联系邮箱、对外地址、探测地址、橱窗与统计入口，以及名册备注。地址类字段单独给链接，跳站是明确动作，点整行只展开。
- 配置里的身份字段来自 `federation.json`，地址类字段来自 `instances.json`；两边都按文件 `mtime` 读，改完刷新总览就能看到，不用重启接口。清单里有、名册里没有的实例会显示「未进名册」。
- 展开后点「编辑」可以就地改配置，不跳页：名称（简/英）、对外地址、分级、状态、加入时间、时区、联系邮箱、橱窗与统计地址，以及名册侧的域名、角色、席位、接入模式、隧道账号与端口、是否写进清单、备注。
- 保存走 `POST /api/admin/instances/:id/config`：先整份跑 `validateInstances` 与 `validateRoster`，通过才用临时文件 + rename 写回两份 JSON；不通过时错误列在表单里，输入不丢，文件一个字节也不改。模式改成 `own-domain` 时 `tunnel` 一并清空；改成 `subdomain` 时必须同时填账号与端口。
- 名册里还没有的账号，表单会按默认身份补一条（`role: partner`、`standing: regular`、`mode: subdomain`、`listed: true`）；保存前会检查名册里已有成员，不会出现两个创始席位。
- 申请队列按状态列出数量，点一行直接切到对应的申请分类；「已通过但未写进清单」会单独提示。
- 「申请审核」按状态分栏（待审、搁置、已通过、已拒绝、全部），左侧列表、右侧详情。
- 详情显示站点、运营者、邮箱、区域、时区、简介、标签与提交时间。
- 三个动作：通过、拒绝、搁置，备注只内部可见。
- 通过的条目可以「生成」清单片段，复制粘贴进 `instances.json`，或直接用命令行写入。

### 9.4 写进清单

```bash
node server/admin-cli.mjs publish XK-2026-XXXXXX
node server/admin-cli.mjs publish XK-2026-XXXXXX --id custom-slug
```

`publish` 只接受 `approved` 的申请，按站点域名推出 `id`（punycode 与非法字符退回 `node-...`），补齐清单必填字段，用发布前的同一套 `validateInstance` 自检，再写回 `instances.json`。已存在同一地址或同一 `id` 时拒绝写入。

`publish` 不写名册。写进清单之后必须在 `federation.json` 补一条同名 `id` 的成员：`host`、`role`、`standing`、`mode`，`subdomain` 模式还要 `tunnel.account` 与 `tunnel.port`（同机唯一）。漏了这一步，`npm run validate:federation` 会报「the instance is not registered in federation.json」，构建停下。

接口按清单文件的 `mtime` 缓存并重新读取，`publish` 新增条目或把 `status` 改成 `suspended` 后，下一次委托发信请求立即生效，不需要重启进程。

生成条目的默认值：

| 字段 | 取值 |
|------|------|
| `tier` | `community` |
| `status` | `pending`（验收后人工改 `active`） |
| `since` | 审核当天 |
| `languages` | `["en"]` |
| `regions` | 申请里选的国家代码（或 `GLOBAL`） |
| `name`、`intro`、`operator` | 同一段文字填进三个语种，后续可在清单里改 |

清单没有探测地址字段：它恒为 `url` + `/api/health`。收录时 `status` 是 `pending`，不探测也不上门户；验收通过后改成 `active`。

审核通过不会自动上线，也不会自动部署。写清单、重新构建、同步 `dist` 仍是三步人工操作。

### 9.5 补记缺失的申请单

早期先签发子域、后把实例写进 `instances.json` 的站点，库里没有对应的申请单。少了它，`admin-cli access <申请编号>` 找不到编号，每次只能手工拼接入件。

```bash
node server/admin-cli.mjs backfill wang --email owner@example.com --admin paul
node server/admin-cli.mjs backfill wang --dry-run     # 只看会不会补
```

`backfill` 只把清单里已有的事实抄成一条 `approved` 申请：`url`、`since`、`tier`、`status` 取自 `instances.json`；名称、运营者、简介、区域、时区、标签取自 `var/profiles/<id>.json`（没有就用实例 id）。走同一条状态机 `pending → verified → approved`，审阅注记里写明「按 instances.json 补记」与来源。

- 它不签发新地址、不改清单、不发信，也不伪造当时的审核人：`reviewedBy` 只是执行补记的账号。
- 同一地址已有申请单（任何状态）时直接跳过，重复执行没有副作用。
- 联系邮箱必须显式给：`--email`，或环境里的 `XKNOT_ADMIN_EMAIL`。没有邮箱的单不成立，脚本不会替你编一个。

补记之后就该用编号走正常流程：

```bash
node server/admin-cli.mjs access XK-2026-XXXXXX --id wang
```

### 9.6 备份与清理

`var/xknot.db` 与 `var/session-secret` 要跟 `instances.json` 一起备份。数据库是普通 SQLite 文件，停机复制即可；WAL 模式下同时复制 `-wal` 与 `-shm`，或先执行 `sqlite3 var/xknot.db 'pragma wal_checkpoint(truncate)'`。

`npm run test` 覆盖提交、重复、限流、跨源、登录、审核、清单生成、退出登录与邮件通知；测试用内存库和一个本地假 SMTP，不碰 `var/`，也不发真信。

## 10. 运维

| 场景 | 操作 |
|------|------|
| 新增实例 | 审核通过 → `npm run admin -- publish <id>`（`status: pending`）→ 在 `federation.json` 补同名成员 → 前置（账号、端口、DNS、证书、静态页、conf、公钥、`access` 领取链接）→ 交换点 A → 验收后把 `status` 改 `active` → `npm run build`。顺序见 [HANDOFF.md](HANDOFF.md) |
| 暂停实例 | `status` 改 `suspended`，保留上次健康结果 |
| 实例失联 | 构建时探测失败即显示 `down`，连续 30 天再决定是否删除 |
| 橱窗违规 | 删除 `var/cards/{id}.json`，从清单移除 `cardsUrl`，重新构建 |
| 探测异常 | 查 `var/health.json` 的 `error` 字段：`timeout`、`redirect`、`bad_payload`、`http_<code>` |
| 页面异常 | `npm run build` 重建 `web/dist` |
| 状态不刷新 | 重新构建；页面上的状态是构建时的采样 |
| 忘记管理员口令 | 删掉该账号再建：`npm run admin -- delete-admin <name>`，然后 `create-admin` |
| 接口挂了 | 看进程日志；库文件在 `var/`，重启不丢申请 |
| 申请被刷 | 调低限流或临时关掉表单；已入库的记录在审核台拒绝 |
| 通知信没到 | `npm run mail:test -- <地址>`；查 `journalctl -u xknot-api` 里的 `mail failed`、发信地址是否设了 SMTP 密码、DNS 的 SPF/DKIM/DMARC 是否通过 |
| 发信被限流 | 查阿里云邮件推送的日额度与发信地址类型；共享给伙伴时按站点分开发信地址 |
