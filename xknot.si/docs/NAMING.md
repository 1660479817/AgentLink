# XKnot 联邦 · 名称约定

适用于文档、界面、代码标识、伙伴协议和对外宣传。

实例层的命名文件是 [AGENT_NAMING.md](../../knot-platform/docs/AGENT_NAMING.md)，只管 Agent 分类。本文管联邦层的概念名，两者不重叠。

## 0. 定名

| 项 | 写法 |
|----|------|
| 网络名 | **XKnot**（中英文同名，`X` 与 `K` 大写） |
| 域名 | `xknot.si`（一律小写，不加 `www`） |
| 中文名 | **XKnot 联邦** |
| 英文名 | **XKnot Federation** |
| 中文一句话 | XKnot 联邦 —— 面向 AI 与 Agent 时代的去中心化分布式信息网络 |
| 英文一句话 | XKnot Federation — a decentralized, distributed information network for the AI and Agent era. |

`XKnot` 与中文之间留一个空格，写作「XKnot 联邦」，不写「XKnot联邦」。破折号用「——」，不用单个 `-`。

**XKnot 与 Knot 分工。** `XKnot` 指这张网络和它的品牌；`Knot` 只指部署一个实例所用的软件（`knot-platform`）与「基于 Knot」的署名。实例自身仍叫 Knot 实例，不写成「XKnot 实例」。

## 1. 联邦的含义

联邦指**成员各有主权**。每个实例有自己的库、账号、积分和审核，中枢无权替它决定什么。

实例之间不直接通信，也不互相鉴权。每个实例只与中枢打交道，中枢只读。

> 联邦指成员自治，不指成员互通。

对应的英文名是 XKnot Federation，不是 XKnot Alliance。

## 2. 三条总规则

1. **一名一义。** 一个中文名只对应一个概念，一个英文名也只有一个意思。同义不同名（"中枢 / 门户 / 中心"）全部禁止。
2. **中文说中文，英文说英文。** 中文句子里用中文名，英文句子里用英文名。中文里不夹杂 `hub`、`showcase`。
3. **专有名词不译。** `XKnot`、`Knot`、`AgentLink`、`xknot.si`、`Agent`、`kMeta`、`wish`、`wishRespond`、`post`、`fastpost` 原样保留。`Agent` 不译成「智能体」。

排版规则：

- 中文与西文、数字之间留一个空格：「每 15 分钟」「6 张卡片」「基于 Knot」。
- 中文用全角标点，英文用半角；引号用「」。

## 3. 联邦层术语

口诀：**档案、状态、橱窗。** 三层各一个词，口头说「他只给了档案，没开状态和橱窗」就够了。

| 中文 | 英文 | 标识 | 定义 | 不要写 |
|------|------|------|------|--------|
| XKnot 联邦 | XKnot Federation | — | 所有实例的集合，以 `xknot.si` 为入口 | Knot 生态平台、XKnot 联盟 |
| 中枢 | hub | `hub` | `xknot.si` 上的只读入口服务 | 中心、总站、主站、聚合平台 |
| 实例 | instance | `instance` | 一套独立部署的 Knot，有自己的库和账号 | 节点、子站、分站、租户 |
| 伙伴 | partner | `partner` | 运营一个实例的主体 | 商户、加盟商、客户 |
| 运营方 | operator | `operator` | 对外署名的运营主体 | 站长、厂商 |
| 主理人 | owner | `owner` | 具体负责该实例的人 | 管理员、负责人 |
| 站点档案 | site profile | L1 | 人写在清单里的身份信息 | 资料、简介页、商家信息 |
| 实例清单 | instance manifest | `instances.json` | 唯一的实例登记文件 | 注册表、数据库 |
| 运行状态 | runtime status | L2 | 中枢探测到的健康与版本 | 监控、埋点 |
| 健康探测 | health probe | `check-health` | 定时 GET 实例的 `/api/health` | 心跳、巡检（巡检另有其义） |
| 健康点 | health dot | — | 页面上表示状态的圆点 | 指示灯、信号 |
| 热点橱窗 | showcase | L3 | 伙伴自己发布、中枢定时取回的固定 6 张卡片 | 信息流、推荐流、广场、热榜 |
| 橱窗卡片 | showcase card | `card` | 橱窗里的一条，必须有跳回原站的链接 | 帖子、情报、文章 |
| 橱窗拉取 | showcase fetch | `fetch-cards` | 定时 GET 伙伴的 `cardsUrl` | 同步、灌入、上报 |
| 活动数据拉取 | stats fetch | `fetch-stats` | 定时 GET 伙伴的 `statsUrl` | 埋点、统计上报 |
| 委托发信 | mail relay | `relay` | 实例把一封通知交给中枢的 SMTP 送出 | 代发、转发邮件、邮件网关 |
| 发信凭据 | relay token | `relayToken` | 中枢签给实例的令牌，可单独吊销 | API Key、密钥 |
| 发信额度 | relay quota | `dailyLimit` | 一份凭据 24 小时内的发信上限 | 限额、配额 |
| 发信记录 | relay log | `relay_log` | 只记收件域名与结果，不存正文 | 邮件日志、发信历史 |
| 收录 | listing | `listed` | 把实例写进清单 | 入驻、上架、签约 |
| 下架 | delist | `delisted` | 从清单删除，中枢不再展示 | 封禁、关闭、撤下 |
| 示范入口 | demo entry | `tier: demo` | 只做 301 的官方示范地址 | 样板站 |
| 旗舰 | flagship | — | 自营的主力实例 | 主站、总站 |
| 门户 | portal | `portal` | 中枢里的那一页 | 首页、官网 |
| 跳转 | redirect | `redirect` | 301 到真实站点 | 反向代理、转发 |
| 语种 | locale | `locale` | 页面语言的标识，如 `zh-CN` | 语言包、语系 |
| 区域 | region | `regions` | 实例服务对象所在的国家或地区 | 大区、片区、机房位置 |

### 两组容易混的词

- **下架**（中枢）与 **撤下**（实例）。实例里管理员撤下一条内容，用「撤下」；中枢把整个实例从清单删除，用「下架」。
- **运行状态**（L2，中枢探测出来的）与 **健康状态**（实例自己的 `/api/health` 返回的）。页面上的东西叫「健康点」，接口返回的叫「健康状态」。

## 4. 状态值

JSON 里永远是英文小写；界面上显示本地文案。

| JSON | 中文 | 含义 |
|------|------|------|
| `up` | 正常 | 探测成功，2 秒内返回 |
| `degraded` | 迟缓 | 探测成功，但超过 2 秒 |
| `down` | 中断 | 探测失败 |
| `unknown` | 未知 | 还没探过，或没给 `healthUrl` |
| `active` | 运营中 | 实例状态 |
| `suspended` | 暂停 | 实例状态，保留清单条目不探测 |
| `retired` | 已退役 | 实例状态，等待移除 |

`demo`、`partner`、`community` 是分级值，同样小写，不翻译。

## 5. 代码标识

概念名改动时，代码标识不动。这是契约。

| 位置 | 规则 | 例 |
|------|------|----|
| JSON 字段 | camelCase | `healthUrl`、`cardsUrl`、`formatVersion` |
| 文件名 | kebab-case | `check-health.mjs`、`build-hub-data.mjs` |
| 实例 `id` | 小写 kebab，2–32 位 | `wang`、`travel`、`ai` |
| 状态值 | 小写 | `up`、`active` |
| 环境变量 | 大写蛇形，前缀 `KNOT_` 或 `XKNOT_` | `XKNOT_HUB_DIR` |
| 目录 | 小写，无空格 | `xknot.si/`、`docs/`、`ops/` |
| 域名 | 全小写 | `xknot.si`、`wang.xknot.si` |

英文概念名的大小写：正文用小写（`the hub`、`an instance`），标题、表格表头和图表标签用首字母大写（`Hub`、`Instance`）。同一份文档只用一种。

## 6. 禁用词与替换

| 不写 | 原因 | 改写成 |
|------|------|--------|
| 节点 | 暗示点对点网络 | 实例 |
| 租户 | 暗示多租户共用一套部署 | 实例 |
| 子站、分站 | 暗示从属副本 | 实例 |
| 中心、总站 | 与「成员自治」相反 | 中枢 |
| 平台 | 中枢是入口 | 中枢；说 Knot 本身时用「实例」 |
| 信息流、推荐流 | L3 是橱窗 | 橱窗 |
| 聚合平台 | 中枢不聚合内容 | 中枢 |
| 入驻、上架 | 暗示审批和货架 | 收录 |
| 同步、上报 | 暗示伙伴向中枢写入 | 拉取 |

## 7. 语种与区域

语种标记是代码，不译。区域分组的名字是展示文案，要译。

| 项 | 规则 | 例 |
|----|------|----|
| 语种标记 | BCP 47，代码里原样 | `en`、`zh-CN`、`zh-TW` |
| 语种自称 | 用本地写法，不译 | `English`、`简体中文`、`繁體中文` |
| 默认语种 | `en` | 中枢默认英文 |
| 国家代码 | ISO 3166-1 alpha-2，大写 | `SG`、`SI`、`JP` |
| 区域分组 | 小写 kebab，作为文案键 | `east-asia`、`southeast-asia` |
| 时区 | IANA | `Asia/Singapore`，不写 `GMT+8` |

区域分组的中英对照：

| 键 | 中文 | English |
|----|------|---------|
| `global` | 全球 | Global |
| `east-asia` | 东亚 | East Asia |
| `southeast-asia` | 东南亚 | Southeast Asia |
| `south-asia` | 南亚 | South Asia |
| `central-asia` | 中亚 | Central Asia |
| `middle-east` | 中东 | Middle East |
| `europe` | 欧洲 | Europe |
| `north-america` | 北美 | North America |
| `latin-america` | 拉美 | Latin America |
| `africa` | 非洲 | Africa |
| `oceania` | 大洋洲 | Oceania |
| `other` | 其他 | Other |

三处易错：

- **「区域」不是「地区」。** `regions` 指服务对象所在的国家或地区，不指服务器位置，也不用「大区」「片区」。
- **「中文」要分简繁。** 不单独写 `zh`；页面显示 `简体中文` / `繁體中文`。
- **`Agent` 不译。** 英文句子里的 `agent` 可小写；术语「Agent 时代」保持大写 A。

## 8. 标准句子

对外介绍和伙伴沟通时用下面这几句，避免各写各的。

**一句话**

> XKnot 联邦是一个以 `xknot.si` 为入口的信息网络。成员各自部署、各自运营，中枢只做入口。

> XKnot Federation is an information network entered at xknot.si. Members deploy and operate their own instances; the hub is an entry point only.

**边界**

> 中枢只读：站点档案、运行状态、热点橱窗都由中枢主动取，没有数据写入口。委托发信是唯一例外——只送信，不留内容。

> The hub is read-only: site profiles, runtime status and showcases are fetched by the hub. Delegated mail is the only exception: it sends a message, it keeps no content.

**归属**

> 实例的内容、账号和积分属于伙伴。中枢不托管，也不参与运营和收费。

**署名**

> Based on Knot

伙伴可以在自己的站点写「基于 Knot」。官方认证、`XKnot 联邦官方`、`Powered by XKnot` 和 `xknot.si` 子域由权利人签发。

## 9. 示例

正确：

> 伙伴把橱窗发布在自己的站点，中枢在构建时取一次。
> 这个实例的健康点是中断，上次正常在 3 小时前。
> 本季度新增两个实例，一个给了档案和状态，另一个还只有档案。

错误与原因：

| 写法 | 问题 |
|------|------|
| 伙伴把内容推送到中枢的聚合平台 | 中枢不接收推送，也不聚合 |
| 中枢数据库里只有一张实例表 | 中枢没有数据库 |
| 这个节点挂了 | 应用「实例」；「挂」应写「中断」 |
| 我们入驻了 XKnot 联邦 | 用「收录」；收录是登记，不是审批 |
| 打开信息流看六条热榜 | L3 是橱窗，固定 6 张，没有榜 |
| 智能体时代的信息网络 | `Agent` 不译 |
