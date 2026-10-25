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
| 中枢主机 | hub host | — | 跑中枢的那台机器，主机名固定 `xknot.si` | 云端、云主机、边缘机 |
| 实例 | instance | `instance` | 一套独立部署的 Knot，有自己的库和账号 | 节点、子站、分站、租户 |
| 实例主机 | instance host | — | 跑实例 Backend、数据库与上传目录的那台机器 | 平台机、业务机 |
| 公网入口 | public entry | `entry` | 给实例域名用的 nginx：证书、静态 WebUI、`/api` 反代 | 边缘、边缘入口、代理层 |
| 入口主机 | entry host | — | 跑公网入口的那台机器 | 边缘主机、边缘机、CDN 节点 |
| 回源隧道 | reverse tunnel | `tunnel` | 实例主动连出的 SSH 反向隧道，把入口的回环端口接到实例 | 端口映射、穿透隧道 |
| 伙伴 | partner | `partner` | 运营一个实例的主体 | 商户、加盟商、客户 |
| 运营方 | operator | `operator` | 对外署名的运营主体 | 站长、厂商 |
| 主理人 | owner | `owner` | 具体负责该实例的人 | 管理员、负责人 |
| 站点档案 | site profile | L1 | 中枢写的签发区 + 主理人写的自述区 | 资料、简介页、商家信息 |
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
| 收录 | listing | `listed` | 把实例写进清单 | 入驻、签约（「上架」归店面） |
| 下架 | delist | `delisted` | 从清单删除，中枢不再展示 | 封禁、关闭、撤下 |
| 接入形态 | access mode | `mode` | 只有 `subdomain`：中枢签发子域 + 入口隧道 | 类型、方案 |
| 待验收 | pending | `status: pending` | 已写进清单，`/api/health` 还没通过 | 未上线 |
| 示范入口 | demo entry | `tier: demo` | 官方示范条目 | 样板站 |
| 旗舰 | flagship | — | 自营的主力实例 | 主站、总站 |
| 门户 | portal | `portal` | 中枢里的那一页 | 首页、官网 |
| 语种 | locale | `locale` | 页面语言的标识，如 `zh-CN` | 语言包、语系 |
| 区域 | region | `region` | 实例所在的国家或地区（机器在哪） | 大区、片区、服务对象所在地 |

### 店面与橱窗不是一回事

两个不同的陈列，在两个不同的地方。不许共用同一个词。

| 中文 | English | 标识 | 在哪 | 不要写 |
|------|------|------|------|--------|
| 店面 | store | `store` | 实例里，`/store` | 市场、广场、商城 |
| 商品 | item | `item` | 货架上，有标价 | 帖子、产品（`post` 永远不是商品） |
| 求购 | wish | `wish` | 货架上，没有标价 | 需求、询价 |
| 应征 | response | `wishRespond` | 针对一条求购的报价 | 报价单、投标 |
| 订单 | order | `order` | 一次完成的成交 | 流水（流水另有其表） |
| 在售 | on sale | `on_sale` | 货架上的一条店面记录 | 收录（那是中枢） |
| 撤下 | withdrawn | `withdrawn` | 主理人从货架撤下 | 下架（只用于中枢） |

判断方法：橱窗是中枢展示伙伴发布的 6 张卡；店面是主理人在一个实例里卖的东西。帖子是内容，不是货。

### 两组容易混的词

- **下架**（中枢）与 **撤下**（实例）。实例里管理员撤下一条内容，用「撤下」；中枢把整个实例从清单删除，用「下架」。
- **运行状态**（L2，中枢探测出来的）与 **健康状态**（实例自己的 `/api/health` 返回的）。页面上的东西叫「健康点」，接口返回的叫「健康状态」。

### 机器与角色

**角色是职责，机器是硬件。** 一台机器可以同时是中枢主机和入口主机，当前部署就是这样；但配置归属仍按角色分：中枢的归 `xknot.si/ops/`，实例自己的归 `knot-platform/sites/<站点>/`。

**「入口」这个词按范围分两处，不合并：**

- `knot-platform/ops/entry/` — **可复用的入口软件**：nginx conf 模板、缓存片段、sshd 隧道模板、渲染与推送脚本。任何实例都用这一份。
- `xknot.si/ops/entry/` — **中枢为某个已签发子域装的那一份**：具体域名的 conf 与接通 runbook。它是签发记录，不是软件，只有中枢工作人员会改。

判断方法：换个实例还能用 → 实例侧；写死了某个子域 → 中枢侧。

**「边缘」这个词已经退休。** 它既像 CDN 边缘节点，又常在物理上和中枢同机，读者分不清说的是中枢还是入口。写入口主机就写「入口主机」，写中枢就写「中枢主机」。完整的概念图与归属见 [docs/concepts.md](../../docs/concepts.md)。

## 4. 状态值

JSON 里永远是英文小写；界面上显示本地文案。

**两条轴，两个名字。它们不合并，也不共用取值。**

*决定* —— `status`：中枢对这个实例在不在服务的裁定。探不探、列不列、代不代理，都看它。只写在 `instances.json`。

| JSON | 中文 | 含义 |
|------|------|------|
| `pending` | 待验收 | 已收录、未验收：不探测，不上门户 |
| `active` | 运营中 | 已验收、在服务 |
| `suspended` | 暂停 | 保留清单条目，不探测，不上门户 |
| `retired` | 已退役 | 等待从清单移除 |

*观测* —— `health`：中枢上次敲门看到的结果。绝不写回 `status`，也不是任何决定。

| JSON | 中文 | 含义 |
|------|------|------|
| `up` | 正常 | 探测成功，2 秒内返回 |
| `degraded` | 迟缓 | 探测成功，但超过 2 秒 |
| `down` | 中断 | 探测失败 |
| `unknown` | 未知 | 还没有观测结果 |

控制台上「待验收」「未探测」这类徽章是两轴压出来的**投影**，只用于显示，不是第三套词表，也不属于任何契约。

## 4a. 分级值

`demo`、`free`、`paid` 是分级值，同样小写，不翻译。分级是**展示名次**：只决定门户里的先后，别的不影响。它不决定功能、额度或价格，也不由 `role` 推出来。

| JSON | 中文 | 含义 |
|------|------|------|
| `demo` | 示例 | 官方样板条目，不是伙伴站点 |
| `free` | 免费 | 免费档 |
| `paid` | 收费 | 收费档 |

`founder` 与 `partner` 是**角色**（`federation.json`），永远不是分级。角色是「在这个联邦里是谁」，分级是「这条档案排第几」。两份文件互不约束。

## 5. 代码标识

概念名改动时，代码标识不动。这是契约。

| 位置 | 规则 | 例 |
|------|------|----|
| JSON 字段 | camelCase | `statsUrl`、`cardsUrl`、`formatVersion` |
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
| 边缘、云端边缘、边缘主机、边缘机 | 既像 CDN 边缘节点，又常和中枢同机，读者分不清指谁 | 入口主机（nginx 那台）；说中枢自己时用「中枢主机」 |
| 租户 | 暗示多租户共用一套部署 | 实例 |
| 子站、分站 | 暗示从属副本 | 实例 |
| 中心、总站 | 与「成员自治」相反 | 中枢 |
| 平台 | 中枢是入口 | 中枢；说 Knot 本身时用「实例」 |
| 信息流、推荐流 | L3 是橱窗 | 橱窗 |
| 聚合平台 | 中枢不聚合内容 | 中枢 |
| 入驻 | 暗示审批 | 收录 |
| 市场、广场、商城、出售区 | 暗示很多家店的市场；一个 Knot 实例是一家店，一个主理人 | 店面 store；商品 item |
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

- **「区域」不是「地区」。** `region` 指实例所在的国家或地区，即机器在哪，不是服务对象所在地，也不用「大区」「片区」。门户显示的区域以出口 IP 为准。
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
