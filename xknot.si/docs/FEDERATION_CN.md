# XKnot 联邦 · 中枢契约

版本 2.1。中枢是轻量入口。

> L1 分成**签发区**（`instances.json`，中枢写）与**自述区**（`sites/<站点>/profile.json`，主理人在实例 `/admin` 里写）。中枢按 `url` 取回 `GET /api/federation/profile`，副本落 `var/profiles/{id}.json`。改名、换联系方式直接改自述区，不必向中枢提交或审批。

> 接入只有一种形态——中枢签发 `<标签>.xknot.si`，入口主机 + SSH 反向隧道。名册用 `mode` + `tunnel` 记接入，清单用 `url` + `status` 记身份与验收状态。术语见 [NAMING.md](NAMING.md)。

术语与中英文写法见 [NAMING.md](NAMING.md)，语种与区域规则见 [I18N.md](I18N.md)。本文出现的概念名以那两份为准。

![XKnot 联邦架构](federation.svg)

## 0. 摘要

`xknot.si` 是 XKnot 联邦的中枢，提供三项信息：**站点档案、运行状态、热点橱窗**。用户、内容、积分和运营属于各实例。

另有一项单向服务：**委托发信**（第 7 节）。实例把一封纯文本通知交给中枢的 SMTP 送出，因为联邦只有一张已验证的发信地址。它不属于上面三层信息，也不写中枢的清单与快照；凭据默认写进接入件，中枢可以按实例暂停受理。

## 1. 三层信息

中枢与实例之间只交换三层信息，按谁写、谁读、信任等级划分：

| 层 | 名字 | 谁写 | 流向 | 变化频率 | 信任 |
|----|------|------|------|----------|------|
| **L1** | 站点档案 | 中枢写签发区，主理人写自述区 | 中枢读自己的清单，再按 `url` 取回自述区 | 签发很少，自述随时 | 签发区是中枢的权威身份；自述区是伙伴的表达 |
| **L2** | 运行状态 | 实例（机器生成） | 中枢 GET | 分钟级 | 可验证的事实 |
| **L3** | 热点橱窗 | 伙伴（发布在自己站点） | 中枢 GET | 天级 | 伙伴的表达，中枢免审 |

一条规则贯穿三层：

> **中枢只读：一切由中枢主动 GET，清单是唯一的写入口。**

伙伴登记一个 URL，内容留在自己站点，中枢按时去取。这带来三个性质：

- 中枢没有数据接收接口，不需要令牌、接收校验、限流和原子写。
- 伙伴不需要向中枢提交材料，也不需要通知任何人。
- 网关只有一个：`instances.json`。改条目、提交、发布，就是全部操作。

`instances.json` 只管对外展示的字段。网络成员的事实——创始实例、接入形态、隧道账号与端口——记在同目录的 `federation.json`（联邦名册）。名册不参与门户渲染，两份文件在构建前交叉校验，对不上就不发布。

唯一的例外是第 7 节的**委托发信**：实例 POST 一封信给中枢的 SMTP。它不写清单、不写快照、不留正文，也不是第四层信息，只是一项送信服务。

三层的信任等级不同：

- L2 是伙伴无法否认的事实。站点不可达就是 `down`；自报的活跃度只做展示。
- L3 是伙伴主动挑选的表达。展示什么由伙伴决定，中枢负责取回、渲染并跳回原站。

## 2. 职责边界

### 2.1 中枢负责

- 维护 `instances.json` 与清单校验。
- 构建时探测 `/api/health`，写 `var/health.json`。
- 构建时取回 `url` + `/api/federation/profile`，写 `var/profiles/{id}.json`。
- 构建时拉取 `statsUrl`，写 `var/stats/{id}.json`。
- 构建时拉取 `cardsUrl`，写 `var/cards/{id}.json`。
- 构建三语门户：Vue 3 + Vite，产物是静态文件，运行时只读 `/data/hub.json`。
- 整组下架违规实例的橱窗。
- 按第 7 节代实例发信，维护凭据、额度与发信记录。

### 2.2 实例负责

- 用户、会话、账号、积分、订单和结算。
- 内容发布、编辑、撤下、审核与投诉处理。
- 图片和媒体托管。
- 自己的数据库、备份、域名和证书。
- 对欧盟用户的数据主体请求。

### 2.3 新增能力的判定

新增一项能力，数据来源必须满足下面之一：

1. 写在 `instances.json` 里，由中枢写入（常驻 worker 或命令行）。
2. 由中枢按清单里的 URL 主动 GET。

中枢不接收写入，也不存伙伴的数据。清单之外的数据都由实例发布，中枢只取回副本。

委托发信是唯一的写调用，判定条件另算：它必须绑定清单里的实例、只发纯文本、不留正文、
有独立凭据与额度、可随时吊销或暂停，且不改变中枢的任何数据。不满足就不做。

## 3. 实施里程碑

| 里程碑 | 范围 | 交付 |
|--------|------|------|
| **M1** | L1 档案、L2 健康探测、三语门户、区域筛选 | 静态站 + 构建脚本 |
| **M2** | L3 热点橱窗、L2 活动数据 | 增加拉取步骤与门户橱窗位 |

两个里程碑都在构建时取数，只产出静态文件，没有常驻服务。

## 4. L1：站点档案

L1 装在两处，按谁有权改划分：

| 区 | 字段 | 存在哪 | 谁写 |
|----|------|--------|------|
| **签发区** | `id`、`url`、`since`、`tier`、`status`、`cardsUrl`、`statsUrl` | `xknot.si/instances.json` | 中枢 |
| **自述区** | `name`、`locale`、`tagline`、`intro`、`logo`、`owner`、`contact`、`region`、`timezone`、`tags` | 实例的 `sites/<站点>/profile.json` | 主理人，在实例 `/admin` 里编辑 |
| **观测区** | `health`、`locations`（出口 IP 判出的国家码） | 中枢的 `var/health.json`、`var/geoip/locations.json` | 中枢自己：探测与隧道对端，实例无从声明 |

中枢不接收写入：签发区改清单、提交、发布；自述区由主理人在自己站点改，中枢下次构建时按 `url` 取回。观测区只由中枢写，任何一方都不能在接口里改它。三区合起来才是门户上的一条档案。

### 4.1 签发区

单一真源：`instances.json`。修改、提交、发布即完成一次变更。没有后台和审批界面。

| 字段 | 约束 |
|------|------|
| `id` | 小写字母、数字、连字符，2–32 位，清单内唯一，不可改 |
| `url` | 身份地址，各语种共用。恒为中枢签发的 `https://<标签>.xknot.si`；落在其它域名下会被校验拒绝 |
| `since` | ISO 日期，收录日 |
| `tier` | `demo`、`free`、`paid`。清单只收这三个值 |
| `status` | `pending`、`active`、`suspended`、`retired`。`pending` 只表示已收录、未验收 |
| `statsUrl` | 可空。有值时拉取 L2 活动数据 |
| `cardsUrl` | 可空。有值时拉取 L3 橱窗 |

条目里出现自述区字段（`name`、`logo`、`intro` 等）会被 `ops/validate-instances.mjs` 拒绝：那些属于主理人，不能从中枢这边改。

### 4.2 自述区

主理人在实例的 `/admin` → **XKnot** 里编辑，落在 `sites/<站点>/profile.json`；实例通过 `GET /api/federation/profile` 公开它。字段、上限、必填项与校验规则见 [`knot-platform/docs/PROFILE.md`](../../knot-platform/docs/PROFILE.md)；两边的实现是 `ops/profile-schema.mjs` 与 `knot-platform/backend/src/profile.js`，以本仓库的 `ops/profile-schema.mjs` 为准。

格式是 `{ "formatVersion": 2, "updatedAt": "YYYY-MM-DD", "site": { … } }`，十项扁平字段：

| 字段 | 类型 | 上限 | 必填 | 门户上出现在哪 |
|------|------|------|------|---------------|
| `name` | 字符串 | 40 | 是 | 卡片名称、地图标点 |
| `locale` | `zh-CN` / `zh-TW` / `en` | — | 否 | 门户不上屏。实例用它决定访客第一次打开时的界面语言 |
| `tagline` | 字符串 | 60 | 否 | 卡片的一句话 |
| `intro` | 字符串 | 800 | 否 | 卡片正文 |
| `logo` | https 地址 | 300 | 否 | 卡片徽记 |
| `owner` | 字符串 | 40 | 否 | 卡片页脚的主理人 |
| `contact` | 字符串 | 120 | 否 | 只存在副本里，不直接上屏 |
| `region` | 两位国家码或 `GLOBAL` | 2 | 否 | 区域分组与地图定位；有出口 IP 观测值时以观测值为准，见 `HUB.md` 第 4 节 |
| `timezone` | IANA 名 | 40 | 否 | 卡片上的当地钟点；缺省时按出口 IP 的国家推一个并标注，见 `HUB.md` 第 4 节 |
| `tags` | 字符串数组 | 9 个 × 16 | 否 | 卡片标签与标签筛选 |

要点：

- **没有多语种文案映射**：主理人用哪种语种写，门户就显示哪种。中枢不翻译，也不按界面语种挑一份。`locale` 不是文案语种，是实例界面的默认语言，门户只校验取值。
- `tags` 是自由文本：不预设词表、不按语义合并、不翻译；只做去空白、忽略大小写去重、保留主理人排的顺序。
- `logo` 是 https 绝对地址。自述区里的图片只存地址，不进中枢的二进制。
- `region` 是主理人写的**声明**，不是中枢认定的位置。门户对位置的显示以隧道对端的出口 IP 为准（GeoIP，只有国家码）；声明值在没有观测时兜底，例如实例离线或中枢不在入口主机上。
- 空的字符串不要写：清掉一项就整键省略。不认识的键只丢那一个字段，不拒整份（字段表见 `ops/profile-schema.mjs` 的 `SITE_FIELDS`）。

### 4.3 取回与缓存

构建时 `ops/fetch-profile.mjs` 对每个 `status: active` 的条目取 `url` + `/api/federation/profile`：

- 校验 `formatVersion`、`issued.id` 等于清单 id、`issued.url` 与清单 `url` 同主机；
- 自述区过 `cleanSite`（`ops/profile-schema.mjs`）：只有缺 `name` 才整份丢弃、保留上一份；其余问题只丢那一个字段，能用的字段照收；
- 响应上限 64KB，带 ETag，`304` 视为未变化；
- 写 `var/profiles/{id}.json`，带 `fetchedAt` 与 `source`；取不到时不清旧文件。

门户只用这份副本：缺字段时用签发区字段与兜底文案补齐，不会因此把条目算成 down（那是 L2 的事）。

**升级顺序：先实例，后门户。** 取回时 `formatVersion` 不是 2 的响应会被整份拒绝、保留上一份副本；没有 `site` 的副本门户对这条只显示 id。`deploy-hub.sh` 前的 `ops/verify-hub-data.mjs` 会把「有签发区但没有自述区名称」判成问题并挡住发布，正是为了让这个顺序显式发生。

**新增自述区字段时反过来：先中枢，后实例。** `cleanSite` 只收 `SITE_FIELDS` 里的键，不认识的键会被丢掉、不拒整份。`locale` 就是这样加进来的：中枢的 `SITE_FIELDS` 先收下它，实例再开始写；顺序反了不会崩，但门户上这个站点的语种会一直用兜底值，只在 `var/` 里留几条问题记录。

### 4.4 规则

- 探测地址由 `url` 推出，不单独登记；`statsUrl`、`cardsUrl` 决定中枢还拉什么数据，字段为空即跳过，不报错。
- `tier` 只影响展示徽章，不影响排序，不参与评级或分成。
- 示范条目可以标 `tier: demo`，不计入实例统计。
- 页面按 `tier`、再按 `since` 排序，顺序稳定。
- 区域只用于分组浏览，不参与排序，不影响收录。
- 清单必须通过 `ops/validate-instances.mjs` 才发布。

### 4.5 接入形态

接入只有一种，身份就是 `url` 本身，没有第二根轴：

| `federation.json` 的 `mode` | 身份 | 入口与隧道 |
|------|------|------------|
| `subdomain` | `https://<标签>.xknot.si`，由中枢签发 | 入口托管静态页，`/api` 经 SSH 反向隧道回源；`tunnel` 必填 |

`mode` 字段保留，取值只有 `subdomain`。探测地址恒为 `url` + `/api/health`。名册 `host` 与清单 `url` 的主机名必须一致，并且都落在 `xknot.si` 下。

已经有自有域名的站点不在这里登记：它自己就是入口，不需要签发、不需要跳转。这类站点进不了清单，也不参与联邦探测。

`status: pending` 是收录与验收之间的状态，不是另一种接入形态：条目已在清单里，但不探测、不上门户；`/api/health` 验收通过后改成 `active`。换机器、换 IP 只改 DNS 与入口配置，`url` 不变。

## 5. L2：运行状态

### 5.1 端点

| 端点 | 频率 | 缓存 | 内容 |
|------|------|------|------|
| `/api/health` | 按需（构建时） | `no-store` | `ok`、`version`、`service`、`instance` |

Knot 实例提供 `GET /api/health`，返回 `{ ok: true, service, version }`。中枢直接使用该端点，实例侧无需改动。Knot 部署层还会附上 `release`、`commit`、`builtAt` 供发布脚本核对版本，中枢不读这几个字段。

接入联邦的实例另带 `instance`（接入件里的 `XKNOT_INSTANCE_ID`），例如 `{ ok: true, service: "knot-backend", version: "0.7.0", instance: "wang" }`。中枢用它核对「这个域名后面是不是清单里的那个实例」；不带这一项的实例照常按 `ok` 判活。

### 5.2 探测判定

- 地址恒为 `url` + `/api/health`，由 `ops/probe-target.mjs` 推出；清单 `status: active` 才探，`pending` / `suspended` / `retired` 不探。
- 方法 `GET`，超时 5 秒，不跟随重定向。
- 只接受 `https`。非 https 判 `unknown`。
- 成功：HTTP 200，响应体是 JSON，且 `ok === true`。
- 带了 `instance` 但与清单 id 不一致：判 `down`，`error` 记 `instance_mismatch`。
- 不读实例的库，不带 Cookie，不带凭据。

### 5.3 状态

| 状态 | 判定 | 展示 |
|------|------|------|
| `up` | 成功且 ≤2 秒 | 绿点 |
| `degraded` | 成功但 >2 秒 | 黄点 |
| `down` | 失败 | 红点 |
| `unknown` | 未探测，或清单 `status` 还是 `pending` | 灰点 |

探测失败保留 `lastOkAt`，只把 `status` 改成 `down`，页面显示「上次正常：3 小时前」。

### 5.4 连续断连

`ops/watch-health.mjs` 每 15 分钟跑一次探测，用 `downSince` 与 `notified` 记录连续时长，并按下面的线处理：

| 条件 | 动作 |
|------|------|
| `down` 连续 24 小时 | 给实例 `contact` 寄提醒 |
| `down` 连续 7 天 | 寄断连通知，门户不展示该条目（`hiddenAt` / `hiddenReason`） |
| 任一探测 `up` / `degraded` | 清空 `downSince` 与隐藏标记，条目自动回到门户 |
| `status` 仍为 `pending` 且 `since` 已 14 天 | 内部提醒运营方 |
| `status` 仍为 `pending` 且 `since` 已 30 天 | 门户暂时隐藏 |

「从未接通」只看清单状态：`status: pending` 的条目按 `since` 起算，14 天内部提醒、30 天暂时隐藏。已改为 `active` 但探不到的走上面的 `down` 规则，不混用。

隐藏只影响 `buildHubData` 输出的 `health.hidden`，**不改 `instances.json`**。每条通知在 `notified` 里记一次，重复运行不会重复发信。

### 5.5 结果文件

写到 `xknot.si/var/health.json`，门户只读这一份：

```json
{
  "checkedAt": "2026-10-19T02:30:00.000Z",
  "instances": {
    "wang": {
      "status": "up",
      "httpStatus": 200,
      "latencyMs": 137,
      "version": "0.7.0",
      "lastOkAt": "2026-10-19T02:30:00.000Z",
      "since": "2026-10-19T02:30:00.000Z",
      "checks": 1,
      "ok": 1,
      "error": null,
      "downSince": null,
      "notified": {},
      "hiddenAt": null,
      "hiddenReason": null
    }
  }
}
```

- `checks` 和 `ok` 从 `since` 起累计，用于计算可用率。不存逐次历史。
- 文件是唯一状态，删除后条目回到 `unknown`。
- 写入方式：临时文件 + rename。

### 5.6 活动数据

伙伴可选暴露 `statsUrl`，只提供计数。中枢在构建时拉取，写 `var/stats/{id}.json`，门户只读这一份；缺文件显示「未公开」。

```json
{
  "generatedAt": "2026-10-19T02:00:00.000Z",
  "posts": { "total": 1234, "last24h": 12, "last7d": 80 },
  "accounts": { "total": 300, "last7d": 18 },
  "authors": { "active7d": 45 }
}
```

- 只有计数，没有昵称、邮箱、头像、正文和记录 id。
- 缺 `statsUrl` 显示「未公开」，不显示 0。
- 自报数字只做展示，不参与排序、评级或分成。
- 只收窗口值，不收日序列。

字段约束：

| 字段 | 约束 |
|------|------|
| `generatedAt` | 可空，ISO 时间；作为「伙伴更新于」 |
| `posts.total` / `posts.last24h` / `posts.last7d` | 可空，非负整数 |
| `accounts.total` / `accounts.last7d` | 可空，非负整数 |
| `authors.active7d` | 可空，非负整数 |
| 未知字段 | 忽略，不进 `hub.json` |

至少给一个认识的计数，否则整份作废。拉取由 `ops/fetch-stats.mjs` 执行：只允许 `https`，不跟随重定向，超时 5 秒，响应体上限 32KB，解析 DNS 后拒绝回环、私有网段和云元数据地址；失败时保留上一份。支持 `ETag` / `If-None-Match`。

### 5.7 入口流量（中枢观测，不属契约）

中枢在入口 nginx 的访问日志里看到每个子域的请求与字节，聚合成 `var/traffic/{id}.json`。这一项**不需要实例配合，也不进任何接口**：

- 实例不报数、不埋点，接入件与 `/api/*` 都不变。
- 只给中枢控制台看，不写 `hub.json`、不进成员入口。对外公开某个站点的流量要主理人另行同意。
- 中枢与入口不同机时这一项整段不生效，其余契约照旧。

字段、保留期与盲区见 [HUB.md](HUB.md) 第 11 节。

## 6. L3：热点橱窗
伙伴登记一个 URL（`cardsUrl`），内容发布在自己的站点，中枢在构建时取回。

### 6.1 定位

| 橱窗 | 信息流 |
|------|--------|
| 固定 6 张，全量替换 | 无限下拉 |
| 伙伴自己挑 | 平台按算法排 |
| 只能跳回原站 | 可在中枢读完 |
| 过期就隐藏 | 永久沉淀 |
| 中枢免审，整组可下架 | 中枢承担内容责任 |

### 6.2 拉取

```
GET https://travel.xknot.si/.well-known/knot-cards.json
Accept: application/json
```

响应体是固定封装。中枢取到即覆盖上一份，取不到保留上一份。实现是 `ops/fetch-cards.mjs`，落盘为 `var/cards/{id}.json`。

```json
{
  "formatVersion": 1,
  "generatedAt": "2026-10-19T02:00:00.000Z",
  "cards": [
    {
      "id": "c-2026-10-19-kyoto",
      "lang": "zh-CN",
      "title": "京都的秋天该怎么走",
      "summary": "一条不赶时间的路线。",
      "body": "## 第一天\n先到南禅寺……",
      "url": "https://travel.xknot.si/?id=0f3c",
      "images": [
        {
          "url": "https://travel.xknot.si/api/web/uploads/abc",
          "alt": "红叶",
          "width": 1200,
          "height": 800
        }
      ],
      "publishedAt": "2026-10-18T09:00:00.000Z",
      "tags": ["日本", "秋季"]
    }
  ]
}
```

### 6.3 约束

| 项 | 约束 |
|----|------|
| `cards` | 0–6 条。`[]` 表示清空；每次拉取全量覆盖，不追加 |
| `formatVersion` | 整数，当前只认 `1`；与实例版本解耦 |
| `id` | 实例内唯一，≤64 字符 |
| `lang` | 可空，BCP 47，卡片自身语言；省略时不标注 |
| `title` | 必填，≤80 字 |
| `url` | 必填，https，指向该实例自己的主机 |
| `summary` | 可空，≤160 字 |
| `body` | 可空，≤4000 字符，MD 子集：标题、列表、链接、引用、粗体、代码。禁 HTML、脚本、`javascript:` 与 `data:` |
| `images` | 可空，≤3 张。https 绝对地址，主机与 `url` 相同或为其子域 |
| `images[].width` / `height` | 必填，正整数 |
| `publishedAt` | 可空，ISO 时间 |
| `tags` | 可空，≤5 个短词 |
| 响应体 | ≤256KB |
| 拉取时机 | 构建时一次。支持 `ETag` / `If-None-Match` |
| 清空 | 发布 `{"formatVersion":1,"cards":[]}`，下一次构建即清空 |

最小可用的一条只有 `title` 和 `url`。伙伴不维护封装时，可以只给一个指向自己热点列表页的地址，中枢按一条外链渲染。

不合格的卡片逐条丢掉，全部不合格时整份作废、保留上一份。HTML 标签在落盘前被剥掉，
正文不进门户，页面只渲染标题、摘要、语言与跳转地址。

`cardsUrl` 与 `statsUrl` 是公开只读地址。中枢不带凭据，需要私密数据时不接入。

### 6.4 图片热链

中枢不存图片，只存 URL：

- 节省存储、带宽，避免镜像版权风险。
- 伙伴不可达时显示占位块，不撑破布局。
- 中枢保留整组下架开关。

整组下架是 L3 的治理手段：中枢不逐条审核，出现问题时整组移除。

### 6.5 缓存与失效

- 取到即原子覆盖 `var/cards/{id}.json`，取不到保留上一份。
- 页面显示「更新于 X」。
- 超过 7 天标灰，超过 30 天整组隐藏。读取时判断，不设定时清理。
- 中枢不存历史版本和图片。
- 伙伴改写后，下一次构建同步；整组下架时直接删除文件。

### 6.6 安全

拉取地址来自仓库清单，仍按不可信地址处理：

- 只允许 `https`，禁止 URL 中的用户名和密码。
- 不跟随重定向，超时 5 秒，响应体上限 256KB。
- 解析 DNS 后拒绝回环、私有网段、链路本地和云元数据地址。清单由 worker 写入，运行时仍执行同一套检查。
- 不带 Cookie 和凭据。
- 落盘前做白名单清洗：剥掉 HTML 标签，丢弃危险协议，`body` 只渲染 MD 子集。
- 拉取在构建步骤内运行，失败时保留上一次的 `var/cards/`。

## 7. 委托发信

联邦里只有一张通过验证的发信地址。实例量小、域名新，自己配 SMTP 容易进垃圾箱；
可以把通知信交给中枢代发。这是三层信息之外唯一的一项服务，也是中枢唯一的写入口。

**默认开通。** 凭据由运营方在生成接入件时签发，随接入件一次交到实例手里；
实例用它发信即可，不需要自己配 SMTP，也不需要另外申请。中枢按实例保留一个开关，
可以随时暂停或恢复受理（第 7.2 节）。

它**不写中枢的清单与快照**：不改 `instances.json`、不写快照、不存正文，只在 `relay_log` 里记一条不含地址与正文的记录。

### 7.1 为什么由中枢发

- 发信信誉按域名累积。分散到每个实例，等于每家都从零开始。
- 收信方只看发信域。一张已验证地址比十张新地址更容易送达。
- 实例不必持有 SMTP 口令，也不必在防火墙上开 465 / 587。

代价是收件人看到的发信人是中枢的地址，回信要靠 `Reply-To` 回到实例。

### 7.2 凭据与开关

- 一份凭据绑定一个实例；`relay_tokens` 只存令牌的 SHA-256。
- 明文只在签发时打印一次，写进实例的环境变量。
- 吊销可以按凭据 id，也可以按实例 id 一次吊销该实例的全部凭据。
- 实例必须仍在清单里且 `status: active`；下架或状态不是 `active` 时请求被拒。
- 每份凭据有自己的 24 小时额度，默认 50 封，上限受中枢配置约束。

**三道开关，分开表达三件事。**

| 开关 | 范围 | 怎么用 | 实例看到 | 可逆 |
|------|------|--------|----------|------|
| `/admin` 的「发信总闸」 | 中枢全部发信 | 控制台点一下，落库、立刻生效 | 代发 `503 relay_unavailable` | 再点一下即恢复 |
| `XKNOT_RELAY_ENABLED=0` | 中枢全部实例 | 中枢环境变量；出事时一键停 | `503 relay_unavailable` | 改回来即恢复 |
| `relay-disable <instance>` | 单个实例 | 运营命令；记原因 | `403 relay_disabled` | `relay-enable` 即恢复，凭据不动 |
| `relay-revoke` | 单个实例 | 凭据泄露、退出联邦 | `401 token_revoked` | **不可逆**，要重签并让实例换文件 |

控制台那个总闸管的是**整个中枢发不发信**：伙伴信、内部告警、成员登录码与委托发信一起停。
它落进 `settings` 表（`mail=off`），不写配置、不改环境变量、不用重启；清掉这一行就回到默认。
环境变量 `XKNOT_RELAY_ENABLED=0` 是另一道、只管代发的闸：它不锁控制台，总闸开着时面板会说明
「代发仍返回 503」，两件事各说各的，不互相冒充。

暂停与吊销是两件事：**暂停只停受理**，凭据、额度与历史记录原样留着，打开就继续用；
**吊销是让那把钥匙作废**，实例必须换一份新接入件才能再发信。日常限流、退信率升高用暂停，
凭据泄露才用吊销。总闸关着的时候 `admin-cli notify / handoff / live` 也会直接拒绝，
免得「界面上停着、终端里又发出去一封」。

```bash
cd xknot.si
node server/admin-cli.mjs relay-disable cpswang --note "退信率升高"
node server/admin-cli.mjs relay-enable cpswang
```

**实例侧要不要走代发，实例自己决定**：环境里有 `XKNOT_HUB_ORIGIN` 与 `XKNOT_HUB_RELAY_TOKEN`
就交给中枢，没有就走自己的 SMTP。中枢不预先通知，只在收到请求时按上表拒绝。

**一处必须知道的取舍。** 实例把委托发信排在本地 SMTP 之前，且这个选择在进程启动时定下：
一旦手里有凭据，中枢停掉以后它不会退回本地 SMTP，只会报发信失败。所以**对一台没有配 SMTP 的实例，
暂停等于它的登录密钥寄不出去**（XKnot 的登录只有邮箱验证码一条路）。运营上只有两条路：
要么确认该实例自己有 SMTP 再停，要么接受它暂时不能登录。这不是实现缺陷，是「端侧不改代码」的代价。

签发、查看与吊销：

```bash
cd xknot.si
node server/admin-cli.mjs relay-token wang --label "登录提醒" --daily 50
node server/admin-cli.mjs relay-tokens
node server/admin-cli.mjs relay-revoke wang
node server/admin-cli.mjs relay-log 50
```

实例侧只配两项：中枢地址与凭据。发信地址是协议常量，由中枢地址推导
（`<XKNOT_HUB_ORIGIN>/api/federation/mail`），不需要另填；只有换入口时才写 `XKNOT_HUB_RELAY_URL`。

```bash
XKNOT_HUB_ORIGIN=https://xknot.si
XKNOT_HUB_RELAY_TOKEN=xkr_wang_...
```

这两项只管委托发信；**接入件**里还有实例 id、中枢地址与签发快照，完整键表见第 7.4 节。一次生成整份：

```bash
node server/admin-cli.mjs access <申请编号> --id wang --out /tmp/wang-access.env
```

`access` 默认签发一份委托发信凭据并写进接入件；确实要一份纯 SMTP 的接入件时才加 `--no-relay`。

### 7.3 接口

| 方法与路径 | 鉴权 | 说明 |
|------------|------|------|
| `POST /api/federation/mail` | `Authorization: Bearer <token>` | 送一封纯文本通知 |
| `GET /api/federation/mail` | 同上 | 查 24 小时额度 |

只有这两条。凭据的签发与暂停都在中枢命令行上，不开放给案例键或网页会话。

请求体：

```json
{
  "to": "lin@example.com",
  "subject": "登录提醒",
  "text": "点开这个链接继续：https://wang.xknot.si/login/8f3c",
  "replyTo": "support@wang.xknot.si",
  "idempotencyKey": "login-8f3c"
}
```

| 字段 | 约束 |
|------|------|
| `to` | 必填。单个裸地址，不带显示名，≤254 字符 |
| `subject` | 必填，≤120 字，不允许换行 |
| `text` | 必填，纯文本，≤4000 字，不允许 `\r` 与 NUL |
| `replyTo` | 可空。必须落在实例自己的域名（`url` 或 `contact` 的主机及其子域）；空时用 `contact` |
| `idempotencyKey` | 可空，≤64 位 `A-Za-z0-9._:-`；24 小时内同键只发一次 |

成功：

```json
{ "ok": true, "delivery": { "id": 42, "at": "2026-10-19T02:31:00.000Z", "toDomain": "example.com" } }
```

同一个幂等键重试时返回 `{"ok":true,"duplicate":true,...}`，不会再寄一次。若第一次请求仍在发信途中，重试会带 `"pending": true`；额度已先占用，等原请求结束后再查额度即可。

额度查询：

```json
{
  "instance": "wang",
  "token": { "label": "登录提醒", "dailyLimit": 50 },
  "quota": { "windowHours": 24, "used": 12, "limit": 50, "remaining": 38 }
}
```

错误码：

| 状态 | `error` | 含义 |
|------|---------|------|
| 400 | `invalid` | 字段错误，`fields` 给出字段码 |
| 400 | `bad_json` | 请求体不是 JSON |
| 401 | `missing_token` / `invalid_token` / `token_revoked` | 凭据缺失、无效或已吊销 |
| 403 | `instance_not_listed` / `instance_inactive` | 实例不在清单里，或状态不是 `active` |
| 403 | `relay_disabled` | 该实例的委托发信被暂停；凭据仍然有效，恢复后可以继续用 |
| 413 | `too_large` | 请求体超过 16KB |
| 429 | `rate_limited` | 单凭据每分钟 6 封，或全站每小时 240 封 |
| 429 | `quota_exceeded` | 24 小时额度用完 |
| 502 | `smtp_failed` | 中枢的 SMTP 拒绝或超时；可以用同一个幂等键重试 |
| 503 | `relay_unavailable` | 中枢没有配 SMTP，或 `/admin` 的发信总闸、`XKNOT_RELAY_ENABLED=0` 任一把关了 |

### 7.4 接入件

接入件是中枢交给实例的唯一一份凭证文件：**env 格式，写下表这些键，值只有中枢能签**。
它是契约，不是某个实现的配置模板——实例存成什么文件名、放哪个目录、用什么工具读，
都由实例自己决定；中枢只规定键名和语义（`knot-platform` 的约定是 `sites/<站点>/xknot.env`）。

| 键 | 必填 | 语义 |
|----|------|------|
| `XKNOT_INSTANCE_ID` | 是 | 清单里的实例 id，小写字母/数字/短横线 |
| `XKNOT_HUB_ORIGIN` | 是 | 中枢地址，如 `https://xknot.si` |
| `XKNOT_HUB_ISSUED_AT` | 是 | 签发日期 `YYYY-MM-DD`，取签发时清单里的 `since`，只作记录 |
| `XKNOT_ISSUED_URL` | 是 | 签发时清单里的站点地址，只作记录 |
| `XKNOT_ISSUED_AT` | 是 | 与 `XKNOT_HUB_ISSUED_AT` 同值 |
| `XKNOT_TIER` | 是 | 签发时的档位（`free` / `paid` / `demo`），只作记录 |
| `XKNOT_STATUS` | 是 | 签发时的状态（`pending` / `active`），只作记录 |
| `XKNOT_HUB_RELAY_TOKEN` | 否 | 委托发信凭据；默认签发，用 `--no-relay` 生成时没有这一项 |
| `XKNOT_HUB_RELAY_URL` | 否 | 委托发信地址，中枢不签发：缺省由 `XKNOT_HUB_ORIGIN` 推导，只有换入口时实例自己加 |

`XKNOT_ISSUED_URL`、`XKNOT_ISSUED_AT`、`XKNOT_TIER`、`XKNOT_STATUS` 是签发时的快照，便于实例侧核对；
清单之后怎么变，这份文件都不跟着改，也不拿来判在线。

规则：

- 生成：`node server/admin-cli.mjs access <申请编号> --id <instance> [--no-relay] --out <文件>`，
  只发给已通过的申请；默认带一份委托发信凭据。
- 写入：实例用既有的接入件写入路径落盘（`knot-platform` 是 `join-xknot.sh --payload`），
  然后重启 Backend 让它生效。**节点侧不需要为此改任何代码或脚本**——它本来就从环境里读这两项。
- 传输：一次性领取，`0600`，不进聊天、不进邮件正文、不进版本库。
- 存放：实例自己保存；不接入联邦的实例不需要这份文件，功能照常。
- 范围：**只含接入**。域名、端口、入口主机、隧道账号、静态文件归属属于部署拓扑，
  由实例的部署方案自己记录，中枢不签发、不校验。
- 重领：同一实例再签一次会吊销该实例上旧的委托发信凭据（`relay-revoke` 之外没有单独回收，
  所以不要留旧件）；中枢地址与站点地址不变，其余键按当时的清单重写。
- 失配：实例只用自己最新那份文件；拼两份用会拿旧凭据发信，中枢按 `token_revoked` 拒绝。

实例用 `XKNOT_INSTANCE_ID` 在 `/api/health` 里报出 `instance`，中枢核对它是否等于清单里的 id，
不一致判 `down`（见第 5 节）。

### 7.5 边界

- 只发纯文本：不收 HTML、附件、多收件人、抄送与密送。
- 发信人恒为中枢配置的 `MAIL_FROM`，实例不能覆盖；`Reply-To` 必须落在实例自己的域名。
- 不存正文、完整收件地址与主题；日志只留实例、收件域名、地址哈希、主题长度和结果。
- 每次发信额外带 `X-XKnot-Instance: <id>`，便于收信方与中枢对账。
- 中枢不做退信处理，也不代管订阅。退信率和投诉率由实例自己控制。
- 中枢可以随时暂停或吊销凭据；两者都不影响实例的其他功能，只是发信被拒。

### 7.6 滥用与处置

| 现象 | 动作 |
|------|------|
| 单个实例退信率升高 | `relay-disable <instance>` 先停住（可恢复）；确认原因后再决定调低 `--daily` 还是吊销 |
| 收到垃圾邮件投诉 | 立即 `relay-disable`，再 `relay-revoke` 并下架；同时删 L3 缓存 |
| 凭据泄露 | `relay-revoke`（不可逆），重新 `access` 签一份并让实例换文件 |
| 收件人回复无人处理 | 检查实例的 `contact` 与 `replyTo`，回信应落到实例自己的信箱 |

`relay_log` 默认保留 30 天：启动时清理一次，之后每 6 小时清理更早的记录；`pending` 每分钟检查一次，超过 15 分钟仍是 `pending` 的占位视为进程在发信途中退出，直接回收，不再占用额度，也不会一直挡住同一个幂等键。

## 8. 安全与隐私

- 中枢只访问清单中的地址。加入申请只收子域标签与站点信息，接收时不解析、不抓取；只有申请通过、写进清单并验收之后，构建时才探测。
- 探测与拉取在解析 DNS 后拒绝回环、私有网段、链路本地和云元数据地址。
- 写入路径只有两条：`POST /api/applications`（只收表单字段，不存文件，不回显 HTML，字段有长度上限与蜜罐）和 `POST /api/federation/mail`（Bearer 凭据、纯文本、独立额度、不留正文）。凭据的签发、暂停与吊销都只在中枢命令行上，没有对应的 HTTP 入口。
- 委托发信与浏览器会话完全隔离：不读 Cookie，不接受 `Origin` 跨站的 POST 复用会话。
- 控制台需要管理员账号和会话；账号由命令行建立，口令用 scrypt 加盐存储，会话 Cookie 为 `HttpOnly`、`SameSite=Strict`。
- 门户不执行伙伴脚本，不嵌 iframe。外链带 `rel="noopener noreferrer"`。
- 中枢不保存用户表、作者目录和个体访问画像；申请记录只存站点信息、联系邮箱和哈希后的来源地址；发信记录只存收件域名与地址哈希。
- `.si` 在欧盟境内。M2 上线前完成一次 GDPR 评估，重点检查自报计数能否反推个体，以及发信日志的最小化。

## 9. 归属与许可

- 代码以 Apache-2.0 发布，版权人 PaulWang，署名见 `NOTICE`。
- `xknot.si` 及其下签发的子域归 PaulWang 所有，不随代码授权。
- 许可证不授予商标使用权。`Knot`、`xknot`、`xknot.si` 的名称和标识归 PaulWang 所有。
- 收录不改变归属。伙伴的站点、内容和用户属于伙伴。

## 10. 收录与下架

加入是申请制：主理人在自己站点的 `/admin` 里提交，平台当场核对并**自动通过**、签发子域；随后常驻 worker 自动写进清单并接通。通过不是自动入驻，也不改变实例自治。

| 阶段 | 发生什么 |
|------|----------|
| 提交 | 主理人在实例 `/admin` 的「接入 XKnot」里填子域标签与联系邮箱，由实例代交 `POST /api/applications`，字段为子域标签、名称、简介、运营者、邮箱、区域、时区、标签；也可以直接调中枢接口。`mode` 只接受 `subdomain`、`domain` 必须为空，带了别的值返回 `not_supported` |
| 查标签 | 提交前先问 `GET /api/subdomains/check?label=`。少于 6 位的标签不签，保留名与已占用的不签；不通过时给出候选 |
| 自动通过 | 平台校验字段并查重，通过即把申请写成 `approved`（`reviewed_by=auto`），没有待审队列 |
| 通知 | 立刻寄批准信给申请人，并给运营方寄一封新成员提醒 |
| 写清单 | 常驻 worker（`server/provision.mjs`）自动跑 `publish`：分配隧道账号与端口，把 `instances.json` 条目（`status: pending`）与 `federation.json` 同名成员一起写入；命令行 `publish` 只用于例外重跑 |
| 上线 | 隧道接通、`/api/health` 通过后，worker 把 `status` 改成 `active` 并当场重算门户快照，条目出现在地图与目录里 |

| 情形 | 动作 |
|------|------|
| 新伙伴 | 提交即通过 → worker 写清单（`pending`）→ 自动前置与接通 → 验收通过改 `active` → 快照自动重算 |
| 改名 | 修改对应条目 |
| 换 IP | 伙伴提交变更；只改 DNS 与入口配置，`url` 不动 |
| 换标签 | 换 `url` 与名册 `host`，重新签发；旧子域回收，不做 301 过渡 |
| 长期失联 | 24 小时提醒，7 天从门户暂时隐藏（条目不删）；恢复探测后自动回来 |
| 30 天仍未接通 | 从门户暂时隐藏，由人跟进或回收子域 |
| 违法、欺诈、冒充、商标侵权 | 从清单删除，L3 整组下架并删除缓存 |
| 伙伴退出 | 删除条目，删除 L3 缓存，回收子域 |

申请通过或撤回都不影响站点本身；申请人可以修正信息后重新提交。中枢不托管内容，下架只影响入口，不影响伙伴站点的数据。
