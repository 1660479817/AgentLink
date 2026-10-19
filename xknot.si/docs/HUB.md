# 中枢的实现与运维

契约见 [FEDERATION.md](FEDERATION.md)，术语见 [NAMING.md](NAMING.md)，语种规则见 [I18N.md](I18N.md)。本文写中枢的组成、生成流程、部署与验收。

## 1. 组成

| 部件 | 形态 | 说明 |
|------|------|------|
| 门户 | Vue 静态站 | Vue 3 + Vite，三语入口，运行时读取 `/data/hub.json` |
| 接口 | Node 常驻进程 | `POST /api/applications` 收加入申请，`/api/admin/*` 供审核台使用 |
| 审核台 | 静态页 + 接口 | `/admin/`，管理员登录后看申请、做审核、取清单条目 |
| 申请存储 | SQLite | `var/xknot.db`，表 `applications`、`admins`、`sessions`、`events` |
| 健康探测 | 构建步骤 | 构建时探测一次，写 `var/health.json` |
| 数据快照 | 构建步骤 | 合并清单与探测结果，写 `dist/data/hub.json` |
| 橱窗拉取 | 构建步骤（M2） | 构建时拉取 `cardsUrl`，写 `var/cards/{id}.json` |

门户本身仍然是静态文件，所有实例数据在构建时写入。唯一的写入口是加入申请：它不写 `instances.json`，只进审核队列；审核通过后由人或命令行把条目写进清单，再重新构建。申请接口不能改变任何已上线的条目。

项目与 bot01 无关：安装、构建、预览和测试都在本机完成。

## 2. 目录

```text
xknot.si/
├── README.md              联邦入口
├── package.json           本项目的脚本：dev / build / test / deploy / admin
├── instances.json         实例清单（唯一的人工编辑入口）
├── fixtures/              版式样例：十条伙伴条目、探测与橱窗样例，只在 --preview 下并入
├── server/
│   ├── index.mjs          接口进程入口，只监听 127.0.0.1:5181
│   ├── app.mjs            路由、同源检查、限流、Cookie
│   ├── store.mjs          SQLite：申请、管理员、会话、事件
│   ├── validate.mjs       申请表字段校验（纯函数）
│   ├── manifest.mjs       申请 → instances.json 条目，生成后自检
│   ├── mail.mjs           SMTP 客户端（net/tls，无外部依赖）与邮件组装
│   ├── notify.mjs         新申请、审核结果的三语通知正文
│   ├── mail-test.mjs      发一封测试信（npm run mail:test）
│   ├── admin-cli.mjs      建管理员、列申请、生成条目、写入清单
│   └── app.test.mjs       接口与审核流程测试
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
│   └── federation.svg     架构图
├── ops/
│   ├── xknot.si.conf            门户与接口的 nginx 配置
│   ├── dev.mjs                  同时拉起接口与 Vite
│   ├── check-health.mjs         健康探测，写 var/health.json
│   ├── build-hub-data.mjs       合并清单、探测与橱窗，写 data/hub.json
│   ├── cards.mjs                读 var/cards/ 下的橱窗与预览样例合并
│   ├── fetch-cards.mjs          橱窗拉取，写 var/cards/（M2）
│   ├── build-hub.sh             本机构建：校验、探测、构建、写快照
│   ├── verify-hub-data.mjs      发布前守卫：快照里的 id 必须与清单一致
│   ├── deploy-hub.sh            可选的静态站同步（目标由环境变量给出）
│   ├── deploy-api.sh            中枢接口、审核台与站点配置的同步
│   ├── README-deploy-aws.md     中枢托管主机的部署笔记
│   └── validate-instances.mjs   清单校验
├── var/
│   ├── health.json        探测结果（生成物，不入版本库）
│   ├── xknot.db           申请与账号（生成物，不入版本库）
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
    │   │   ├── NetworkMap.vue  联邦地图：世界底图、悬空联邦中心与飞线，点选跳到条目
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
npm run test          # 单元测试（清单、页面逻辑、接口与审核）
```

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

`fixtures/preview-instances.json` 放了十条伙伴条目（nordhavn、sakura、meridian、khaleej、saigon、bengaluru、aurora、pampa、koru、atlas），`fixtures/preview-health.json` 放它们的探测样例。用途只有一个：让目录看起来像真的有十来个成员，便于判断版式。

- 两个文件都是样例，**不是成员名单**，不写进 `instances.json`。
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
      "redirect": null,
      "regions": ["CN"],
      "timezone": "Asia/Shanghai",
      "tier": "partner",
      "status": "active",
      "health": { "status": "up", "lastOkAt": "2026-10-19T02:30:00.000Z", "version": "0.2.0" }
    }
  ]
}
```

构建流程：

```bash
./xknot.si/ops/build-hub.sh            # 校验、探测、构建、写快照
./xknot.si/ops/build-hub.sh --offline  # 跳过探测，复用 var/health.json
```

脚本顺序固定：校验清单 → 探测健康 → 安装依赖（仅首次）→ 构建 → 写 `dist/data/hub.json`。全程在本机完成，不连接远端。

页面取数规则：

- 语种取自当前 HTML 的 `lang`，不读浏览器语言，不发 GeoIP 请求。
- 文案取自 `src/locales/`，缺键回退英文，再缺就不渲染该块。
- 时间用 `formatWhen`：7 天内为相对时间，超过为绝对日期，按实例的 `timezone` 计算。
- 区域分组由 `src/lib/regions.js` 的 `groupsOf` 从 `regions` 推出。
- `hub.json` 由 nginx 以 `no-cache` 提供；状态是构建那一刻的采样，重新构建才会更新。

## 4. 页面

一屏两栏：左边白，放当前联邦的全球网络；右边橙，放加入申请。

1. **左栏（白）**：顶栏（标识、在线计数、主题与语种）→ 刊头（`KNOT` 与本地语种的名称、标语、一句定位）→ 联邦地图（`全球节点分布`、状态图例、世界底图，下面一行四个数字：节点、区域、在线、最近同步）→ 节点目录（区域筛选、只看在线、只看热点、卡片）→ 页脚（不托管内容的声明、许可、运营者入口）。左栏独立滚动，筛选条与目录头吸顶。
2. **右栏（橙）**：点阵球与经纬线做底。`申请加入 XKnot`：三步说明（提交、审核、写进清单）、表单、联邦约定。表单字段为站点名称、地址、一句话简介、运营者、联系邮箱、区域、时区、标签、同意勾选。提交成功后原地换成申请编号与提交时间，可以再提交一份。

900px 以下改成上下排：白色网络在上，橙色申请在下，整页滚动。上下排时申请表会落到节点目录之后，所以刊头多一个 `申请加入 →` 的锚点（`#join`），一处点得到。右栏被压到约 400px 时收掉步骤说明，让提交键留在首屏。

### 联邦地图

地图是一张等距圆柱投影的世界底图（`web/src/lib/world.js`，数据为 Natural Earth 110m 陆地，`ops/build-world-dots.mjs` 生成）。节点的位置由实例清单里的 `regions` 决定：国家中心点求和后取中心，因此「北欧四国」落在斯堪的纳维亚，「阿根廷 + 智利 + 乌拉圭」落在南锥体。`GLOBAL` 或没有可定位国家代码的条目不上图，收在地图下方「无固定区域」的一行小标签里，仍可点。

- 底图是点阵填充的陆地 + 30° 经纬网，和右栏的点阵球同一套语汇。地图只说「在哪」，不承载地理细节。
- 地图上方悬着一个**联邦中心**徽标（`XKNOT` + 联邦中心），不落经纬度。标识由 `BrandMark` 按三档分辨率出图，徽标其余布局不变。
- 每个节点一条**半透明橙色长划线弧**飞向联邦中心（`stroke-dasharray: 10 5`，选中态 `12 4`），弧线朝中轴外侧鼓一点，十根线才不会在中心下方挤成一根柱子。长划线的节奏更像航线；线的状态只靠粗细与浓淡区分（选中的加粗加深、不可达的压淡），不另起一套配色。弧上的短亮光点按清单顺序错开延迟，从节点飞向中心。
- 链路颜色走 `--map-link-line`（浅色 `rgba(232,112,28,.42)`，深色 `rgba(255,154,82,.40)`），和右栏申请区的橙是同一支暖色；联邦中心徽标里的占位标记用不透明的 `--map-link`，线的落点才不会和徽标分家。
- 弧线的交汇点取在画布上缘之上（`HUB.y < 0`），藏在徽标后面，地图上不会留下一个结。
- **节点之间另有一层浅绿直连**，画在橙色弧线下面：将来站点按协议标准直接交换数据，不必每条都绕到中枢。每个站取最近的 2、3 或 4 个邻居（按清单顺序轮流取，`PEER_DEGREES = [2, 3, 4]`），所以网是疏密不均的，不是完全图。两点互相选中时只画一条，A–B 与 B–A 是同一根线。直连用直线，朝中心的弧线用曲线，形状本身就把两套语义分开了。
- 直连颜色走 `--map-peer`（浅色 `rgba(31,168,110,.4)`，深色 `rgba(126,231,178,.24)`）；两端有一头 `down` 时压到 0.4 透明度，选中某站时与它相连的几条加深加粗。地图脚注给一小段绿线和一句解释，不混进状态图例——绿线说的是协议关系，不是可达性。
- 徽标用 `transform: translate(-50%, -74%)` 悬在地图上缘，底下有一层随呼吸收放的投影；徽标本体与投影各自做 7s 上下浮动，`prefers-reduced-motion` 下停止。
- 地图宽度到 620px 才在点旁常驻站名（容器查询）；更窄只留点，悬停或聚焦出标签。
- 挤在同一片区域的两个点会上下错开约 17 个单位，保证都点得到。点选后滚到对应条目并高亮 2.6 秒；被筛掉的点变暗但仍可点。
- 动效只有脉冲、飞向中心的光点与徽标浮动，`prefers-reduced-motion` 下全部停止。

### 品牌资产

品牌标识是栅格图，放在 `web/public/`，不引用外站。

| 文件 | 分辨率 | 用途 |
|------|--------|------|
| `logos/xknot.jpg` | 1024×1024 | 原图，分享卡片 `og:image` |
| `logos/xknot-icon.png` | 512×512 | 母版，生成下面三档 |
| `logos/xknot-icon-32.png` | 32×32（小） | 1× 屏幕的页头与地图徽标 |
| `logos/xknot-icon-64.png` | 64×64（中） | 2× 屏幕、审核台页头 |
| `logos/xknot-icon-128.png` | 128×128（大） | 3× 及以上屏幕，兼作 src 回落 |
| `favicon-32.png` / `favicon-16.png` | 32、16 | 浏览器页签 |
| `apple-touch-icon.png` | 180×180 | iOS 主屏 |

页头与地图徽标都由 `components/BrandMark.vue` 出图：`srcset` 用 `1x / 2x / 3x` 描述指向 32 / 64 / 128 三档，浏览器按设备像素比取一档，高分屏不再把小图放大。审核台页头用同一组 `srcset`。

### 节点目录与热点橱窗

目录是一列卡片网格（`repeat(auto-fill, minmax(272px, 1fr))`，约 750px 起两列，更宽到三列），每张卡片是一个站点：

- 头部：站点徽记（有 `logo` 用 logo，否则用站名首字，底色取清单里的 `themeColor`）、站名（整张卡片可点的入口）、分级徽章、进入箭头；站名下一行是节点自己时区的当前时刻、区域与 `UTC±X`。
- 正文：一句话简介，最多两行。
- 橱窗位：有 L3 卡片时显示第一条，火焰标 + 原标题（伙伴的语言，不翻译）+「更新于 X」+ 语言码 +「另 N 条」。点它直接去伙伴站点的那一篇，与卡片本身的入口分开。
- 页脚：信号条与状态、延迟。延迟只在 `up`、`degraded` 时显示；`down` 时显示上次正常的时间，避免把探测耗时当成响应时间。

卡片的圆角 10px、1px 描边，悬停抬升 2px 并露出顶部状态色条。被地图点选时整张卡片高亮 2.6 秒。

热点是「有就长出来，没有就空着」：没有橱窗的卡片不占位、不写「暂无」，只是比同一行的卡片矮一截留白。目录头在有热点时多一个 `只看热点 N` 开关，没有热点时整个开关不出现，避免永远点不出东西的入口。

橱窗年龄分三档（`lib/cards.js`）：24 小时内 `fresh`，一周内 `recent`，7–30 天 `aging` 转灰（仍在，但不再当新闻读），超过 30 天不再展示。`hub.json` 里每个实例的 `cards` 最多 6 条，只带 `id`、`title`、`summary`、`url`、`lang`、`updatedAt`，正文 `body` 不进门户。

目录里的钟点是**节点自己时区**的当前时刻，每 20 秒刷新一次，并带 `UTC±X` 偏移。这条信息让「分布在不同时区、由不同的人维护」在版面上直接可见，不再只是一句声明。区域仍只用于筛选，不参与排序。

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
- 动效只表达「链路在动」：顶栏扫光、节点脉冲、条目入场错峰、从地图跳转时的高亮。全部在 `prefers-reduced-motion` 下关闭。
- 360px、390px、768px、1280px、1440px 宽度下均可完成主操作。可点击区域不小于 44×44px。
- 英文文案按比中文长 30% 到 50% 预留，按钮和状态点不设固定宽度。
- 图标用内联 SVG，可点击时有 `aria-label`。

## 5. 健康探测

`ops/check-health.mjs`：

- 读 `instances.json`。
- 并发探测每个 `healthUrl`，超时 5 秒，不跟随重定向。
- 合并上一次的 `checks`、`ok`、`since`，累加。
- 原子写入 `var/health.json`。

`status` 不是 `active` 的条目不探测，保留上一次的结果。

手动执行：

```bash
cd xknot.si
npm run probe          # 只探测，写 var/health.json
npm run build          # 探测并构建
npm run build -- --offline   # 跳过探测，复用上一次结果
```

探测在构建时执行一次，没有常驻定时任务，也不依赖任何远端机器。`var/health.json` 保留上一次结果用于累加，重新构建即刷新页面上的状态。

## 6. 橱窗拉取

M2 实现，入口 `ops/fetch-cards.mjs`：

- 读 `instances.json`，只处理 `cardsUrl` 非空的条目。
- 按 [FEDERATION.md](FEDERATION.md) 第 6.6 节执行 URL 检查和内容清洗。
- 校验 `formatVersion`、卡片数量、字段长度和图片主机。
- 成功时原子覆盖 `var/cards/{id}.json`，失败时保留上一份。
- 构建时执行，与健康探测同一步骤。

展示侧已经落地，先于拉取脚本：`ops/cards.mjs` 读 `var/cards/`，`web/src/lib/cards.js` 净化字段、按契约封顶 6 条并计算年龄，`hub.json` 的每个实例因此多一个 `cards` 数组。页面只展示第一条，其余落在「另 N 条」里。拉取脚本只需要按同样的文件名写文件，页面不用再改。

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
| `XKNOT_SESSION_SECRET` | 自动生成 | 首次启动写到 `var/session-secret`，`0600` |
| `XKNOT_SECURE_COOKIE` | 关 | 生产置 `1`，会话 Cookie 加 `Secure` |
| `XKNOT_TRUST_PROXY` | 关 | 生产置 `1`，限流按 `X-Forwarded-For` 的首个地址 |

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
| `XKNOT_ADMIN_EMAIL` | （空） | 新申请通知的收件地址；留空则只通知审核台 |
| `XKNOT_PUBLIC_ORIGIN` | `https://xknot.si` | 邮件里链接用的门户地址 |

生产把密码放在 `/opt/xknot/var/mail.env`（`0600`），由 systemd 的 `EnvironmentFile` 读入，不写进 unit 文件。`npm run mail:test -- <收件地址>` 用同一套环境变量发一封测试信。

接口没有外部依赖，Node 26 的 `node:sqlite` 即可运行，根目录仍然不需要 `node_modules`；SMTP 客户端用 `node:net` / `node:tls`，也没有引入新依赖。

### 7.3 同步到托管目录（可选）

构建完成后，如需同步，使用：

```bash
XKNOT_EDGE=user@host ./xknot.si/ops/deploy-hub.sh --dry-run
XKNOT_EDGE=user@host ./xknot.si/ops/deploy-hub.sh
```

`XKNOT_EDGE` 必填，脚本不写死主机；`XKNOT_TARGET`（默认 `/var/www/xknot`）和 `XKNOT_SSH_KEY` 可覆盖。这一步由执行构建的机器直接发起，与 bot01 无关。

接口、审核台与站点配置用 `ops/deploy-api.sh`，同样只认 `XKNOT_EDGE`：

```bash
XKNOT_EDGE=user@host ./xknot.si/ops/deploy-api.sh --dry-run
XKNOT_EDGE=user@host ./xknot.si/ops/deploy-api.sh
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

伙伴在自己的 `ops/env/knot-platform.local.env` 里填。`SMTP_HOST` 跟阿里云控制台区域走：华东 `smtpdm.aliyun.com`，新加坡 `smtpdm-ap-southeast-1.aliyuncs.com`。

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

M1：

- [ ] `https://xknot.si/` 返回 302 到 `/en/`
- [ ] `/en/`、`/zh-CN/`、`/zh-TW/` 内容一致，只有语言不同
- [ ] 每个页面有正确的 `lang`、`hreflang`，`x-default` 指向 `/en/`
- [ ] 字段在三种语言都缺时不渲染该块，页面没有空行和键名
- [ ] 实例列表每条有名称、简介、当地时刻和健康点
- [ ] 目录里的时刻是节点时区的当前时间，不是访客本地时间
- [ ] 点地图上的节点会滚到对应条目并短暂高亮；被区域筛掉的节点变暗但仍可点
- [ ] 地图上方的联邦中心徽标悬空显示，每个节点有一条半透明橙色长划线弧连到它；徽标显示 xknot 标识，仍居中且不压住地图标题
- [ ] 节点之间另有浅绿直连，每个站的邻居数为 2、3 或 4；刷新页面连法不变
- [ ] 「只看在线」只留下 `up` 与 `degraded`
- [ ] 停掉一个实例，重新构建后它的点变红，同时显示上次正常时间，其他实例不受影响
- [ ] `instances.json` 加一条、重新构建后页面出现新条目，无需改代码
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

M2：

- [ ] 伙伴只改自己站点上的 `knot-cards.json`，重新构建后门户出现新橱窗（展示侧已就绪：构建与开发服务器都读 `var/cards/{id}.json`，拉取脚本待实现）
- [ ] 拉取失败时保留上一份，页面显示「更新于」旧时间
- [ ] 卡片超过 7 天标灰，超过 30 天整组隐藏
- [ ] 图片加载失败显示占位，不撑破布局
- [ ] 每张卡片的跳转都回原站
- [ ] 删除 `var/cards/{id}.json` 即整组下架
- [ ] 至少一个伙伴提供 `statsUrl`，页面标注「伙伴公开的数据」
- [ ] 缺 `statsUrl` 显示「未公开」，不显示 0

M3：加入申请

- [ ] 表单空着提交时逐项报错，焦点落到第一个错误字段
- [ ] 提交成功显示 `XK-YYYY-XXXXXX` 形式的编号，刷新后回到空白表单
- [ ] 同一地址再次提交返回重复提示，不新增记录
- [ ] 站点地址不是 `https://`、邮箱不完整、简介超过 60 字时拒绝提交
- [ ] 未登录访问 `/api/admin/applications` 返回 401
- [ ] 审核台登录后能看到申请，通过/拒绝/搁置都会更新状态与审核人
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
| `applications` | 申请：名称、地址、运营者、邮箱、区域、时区、简介、标签、状态、审核人、审核备注 |
| `admins` | 管理员：用户名、scrypt 口令、创建时间、最近登录 |
| `sessions` | 会话：令牌的 SHA-256、管理员、过期时间 |
| `events` | 审计：提交、通过、拒绝、搁置、建号、删号 |

状态只有 `pending`、`approved`、`rejected`、`hold`。同一地址在 `pending`、`hold`、`approved` 时再次提交返回 `409 duplicate`，避免刷队列。

### 9.2 接口

| 方法与路径 | 权限 | 说明 |
|------------|------|------|
| `POST /api/applications` | 公开 | 提交申请，201 返回编号；字段错误 400 带 `fields`；限流 429 |
| `POST /api/admin/login` | 公开 | 用户名 + 口令，成功后种 `xknot_admin` Cookie |
| `POST /api/admin/logout` | 会话 | 删除当前会话 |
| `GET /api/admin/session` | 会话 | 当前管理员 |
| `GET /api/admin/applications?status=` | 会话 | 列表与各状态计数 |
| `POST /api/admin/applications/:id/review` | 会话 | `approve` / `reject` / `hold`，可带备注 |
| `GET /api/admin/applications/:id/manifest` | 会话 | 生成清单条目，生成后自检，不合法返回 422 |

邮件通知：

- 新申请落库后寄给 `XKNOT_ADMIN_EMAIL`，`Reply-To` 是申请人邮箱，最多每小时 30 封；超过只入库不发信。
- 审核把状态从 `pending` / `hold` 改成 `approved` 或 `rejected` 时，按申请时的 `locale` 给申请人寄三语结果信；`hold` 不发，重复点同一个动作也不重复发。
- 审核备注只在库里和审核台，不寄给申请人。
- 发信失败只写进程日志，提交和审核照常成功；没配 `SMTP_HOST` / `MAIL_FROM` 时静默跳过。

接收侧规则：

- 请求体上限 16KB，只接受 JSON；`Origin` 与 `Host` 不一致的 POST 返回 403。
- 字段上限与清单一致：名称 2–40、简介 60、运营者 80、邮箱 120、标签 5 个。
- 地址只接受 `http(s)`、必须带点、不能带账号密码；通过审核后写进清单时会再校验一次 `https`。
- 表单里有一个对用户隐藏的字段，填了就当作机器人：返回成功，不落库。
- 限流在进程内按来源地址的哈希计数：提交每小时 8 次，登录每 15 分钟 12 次。
- 口令用 `scrypt` 加盐；会话令牌 32 字节随机数，库里只存哈希，Cookie 为 `HttpOnly`、`SameSite=Strict`、`Path=/`。

### 9.3 审核台

`/admin/` 是一个不参与构建的静态页：

- 登录后按状态分栏（待审、搁置、已通过、已拒绝、全部），左侧列表、右侧详情。
- 详情显示站点、运营者、邮箱、区域、时区、简介、标签与提交时间。
- 三个动作：通过、拒绝、搁置，备注只内部可见。
- 通过的条目可以「生成」清单片段，复制粘贴进 `instances.json`，或直接用命令行写入。

### 9.4 写进清单

```bash
node server/admin-cli.mjs publish XK-2026-XXXXXX
node server/admin-cli.mjs publish XK-2026-XXXXXX --id custom-slug
```

`publish` 只接受 `approved` 的申请，按站点域名推出 `id`（punycode 与非法字符退回 `node-...`），补齐清单必填字段，用发布前的同一套 `validateInstance` 自检，再写回 `instances.json`。已存在同一地址或同一 `id` 时拒绝写入。

生成条目的默认值：

| 字段 | 取值 |
|------|------|
| `tier` | `community` |
| `status` | `active` |
| `since` | 审核当天 |
| `languages` | `["en"]` |
| `regions` | 申请里选的国家代码（或 `GLOBAL`） |
| `healthUrl` | `<url>/api/health` |
| `name`、`intro`、`operator` | 同一段文字填进三个语种，后续可在清单里改 |

审核通过不会自动上线，也不会自动部署。写清单、重新构建、同步 `dist` 仍是三步人工操作。

### 9.5 备份与清理

`var/xknot.db` 与 `var/session-secret` 要跟 `instances.json` 一起备份。数据库是普通 SQLite 文件，停机复制即可；WAL 模式下同时复制 `-wal` 与 `-shm`，或先执行 `sqlite3 var/xknot.db 'pragma wal_checkpoint(truncate)'`。

`npm run test` 覆盖提交、重复、限流、跨源、登录、审核、清单生成、退出登录与邮件通知；测试用内存库和一个本地假 SMTP，不碰 `var/`，也不发真信。

## 10. 运维

| 场景 | 操作 |
|------|------|
| 新增实例 | 审核通过 → `npm run admin -- publish <id>` → `npm run build` |
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
