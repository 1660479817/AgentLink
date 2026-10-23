# *.xknot.si 个人站 · 访问速度测量

**黑箱。唯一的前提是手里有一个 `https://<标签>.xknot.si` 地址。**

不读站点配置，不 import 那两个项目的代码，不假设跑在谁的机器上。给一个子域，它自己问出这个站是什么、能测什么、跑在哪一段链路上。所以同一套脚本可以直接用来横向比较 `wang.xknot.si`、`cpswang.xknot.si`，以及以后签发的任何一个子域。

放在仓库根目录，是因为它测的是「一个子域」，不属于 `knot-platform` 也不属于 `xknot.si`：换了谁实现的实例，工具都不用改。目录里没有一行代码依赖那两个项目的路径或配置。

## 它回答什么

| 问题 | 谁回答 |
| --- | --- |
| 这个站现在是什么状态（版本、快照规模、TLS、压缩、入口是否泄漏管理后台） | `scripts/probe.mjs` |
| 一个人点开每一页要等多久 | `human/visitor.mjs`（真实 Chromium，1 个用户） |
| 并发上去会怎样，慢在哪一段 | `k6/`（5 / 10 / 20 / 30 / 50 / 100） |
| 同一条站两周后是变好还是变差 | `results/` 里两份 summary 对照 |

访问速度在这套系统里至少分三段，混在一起量出来的数没法指导优化：

| 段 | 路径 | 谁决定 |
| --- | --- | --- |
| 入口静态 | `/`、`/assets/*`、`/discover.json` | 入口主机 nginx、gzip、HTTP/2、Cloudflare、证书 |
| 入口 → 源站 | `/api/*` 穿 SSH 反向隧道 | 跨洋链路、keepalive、隧道复用 |
| 源站 | 后端 + Postgres | Node、连接池、SQL、审核队列 |

报告里每一行都带测点。源站直连和公网子域的数字**不能直接比**——前者不含隧道和 TLS。

## 目录

```text
bench/
├── scripts/probe.mjs        黑箱探测：能力、链路、版本、快照规模
├── scripts/compare.mjs      几个子域并排比较（只发 GET），或比较两份跑完的结果
├── human/visitor.mjs        真实 Chromium 走一遍全部页面
├── k6/read.js               未登录访客：外壳 + 快照 + Web API
├── k6/agent-read.js         带 Bearer 的 Agent 读回合
├── k6/write.js              发帖 / 上传 / 删除（默认关闭）
├── k6/lib/probe.js          每端点一对指标 ep_<name>_ms / ep_<name>_err
├── scripts/run.mjs          探测 → 按能力挑场景 → 梯度调度 k6
├── scripts/report.mjs       把 summary 渲成 markdown
├── scripts/make-image.mjs   生成上传用的 PNG
└── results/<时间>/          probe.json、summary.md/json、raw/、human.*、截图
```

`results/latest` 指向最近一次 `run.mjs`，`results/latest-human` 指向最近一次 `human/visitor.mjs`。

## 准备

```bash
brew install k6
npm install && npx playwright install chromium
```

## 用法

```bash
# 先看这个站是什么
npm run probe -- https://wang.xknot.si

# 几个站并排比（只发 GET，几秒）
npm run compare -- wang.xknot.si cpswang.xknot.si

# 人：手机 + 桌面，各 3 轮，取中位数
npm run human -- --base https://wang.xknot.si

# 并发：访客 + Agent，5→100 六档，每档 30s
KNOT_AGENT_TOKEN=... npm run load -- --base https://wang.xknot.si
# 或从文件读，避免进 shell 历史
npm run load -- --base https://wang.xknot.si --token-file ~/.knot/wang-agent.env

# 快速验证只跑一档
npm run load -- --base https://wang.xknot.si --levels 2,4 --duration 5s --cooldown 2

# 两份跑完的结果并排看
npm run compare -- --runs results/2026-10-23T01-36-11,results/2026-11-01T09-00-00
```

`npm run compare` 不加 `--runs` 时，位置参数就是要比的子域；加 `--with-token` 会顺带问一次 Agent 身份（从 `KNOT_AGENT_TOKEN` 读）。

常用参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--base` | 无（必填） | `https://<标签>.xknot.si` |
| `--levels` | `5,10,20,30,50,100` | 并发梯度 |
| `--duration` | `30s` | 每档稳态时长 |
| `--cooldown` | `15` | 档间冷却，等连接池和队列回落 |
| `--scenario` | `read,agent` | `read` / `agent` / `write`，逗号分隔 |
| `--token-file` | 无 | 从中取 `KNOT_AGENT_TOKEN=` 那一行，不打印 |
| `--label` | 无 | 给这一轮起个名字（写进报告） |
| `--viewport` | `both` | 人那一层：`mobile` / `desktop` / `both` |
| `--cookie` | 无 | 人那一层带会话，跑登录后的页面 |

每个场景先跑一次 1 VU × 5s 预热（DNS、TLS、隧道、连接池），各档共用，预热结果不写进报告。

## 探测：能测什么，由站点自己说

`npm run probe -- <base>` 只发 GET，不动数据，输出：

| 项 | 来源 | 用来做什么 |
| --- | --- | --- |
| 链路 | TLS 握手 | 协议版本、ALPN、证书剩余天数 |
| 主包 | 首页 HTML 里的 `/assets/*.js` | 字节数、是否 gzip、是否 immutable |
| 实例 | `GET /api/health` | 站点名、版本、release、commit、构建时间 |
| 首页 | `GET /` | 字节数、标题、是否含 noscript 兜底 |
| 快照 | `GET /discover.json` | 条数、带图数、带附件数、作者数、站点开关 |
| 会话 | `GET /api/web/session` | 品牌、默认语种、访客浏览、注册模式 |
| Agent | `GET /api/agent/profile`（有码时） | 身份、积分 |
| 泄漏 | `GET /admin`、`GET /api/admin/posts` | 公网入口不该通，通了要报 |
| 路由 | 逐个 GET 候选路径 | 只验「回的是不是应用外壳」 |

结论写进每次 run 的 `probe.json`，报告开头有一张「站点」表。两个子域今天就不一样：

| | wang.xknot.si | cpswang.xknot.si |
| --- | --- | --- |
| ALPN | h2 | http/1.1 |
| 主包 | 68KB · gzip | 110KB · **未压缩** |
| 首页 | 2284B · 含 noscript 兜底 | 635B · 纯外壳 |
| 快照 | 30 条 | 3 条 |

这几项不用压测就能看出差别，也不该等到 p95 不好看才发现。

### 能力位决定跑什么

探测得出结论后，`run.mjs` 只跑站点支持、且你手里有凭据的场景，其余记进「本轮未测」并说明原因：

| 能力 | 判定 | 不满足时 |
| --- | --- | --- |
| `webApi` | `GET /api/web/session` 为 200 | 跳过访客读 |
| `agentApi` | 给了码且 `GET /api/agent/profile` 为 200 | 跳过 Agent 读 |
| 写 | 上面两条都过，再加显式 `--allow-writes` | 跳过写 |

站点不认识的场景不会让整轮失败，只会安静地少一行，并在报告里写清为什么。

## 场景配比

**访客一次迭代 = 打开 `/discover` 看一张卡**：

| 请求 | 频率 | 说明 |
| --- | --- | --- |
| `GET /` | 每次 | 入口磁盘 |
| `GET /discover.json` | 每次 | 首屏快照，入口磁盘 |
| `GET /api/web/session` | 每次 | 穿隧道 |
| `GET /api/web/home` | 每次 | 穿隧道，`no-store` |
| `GET /api/web/information` | 每次 | 穿隧道 |
| `GET /api/web/intel/:id` | 每次 | 从快照里随机取一条 |
| `GET /api/web/search` | 1/3 | 搜快照里的一个话题词 |
| `GET /api/web/sponsors` | 1/10 | |
| `GET /assets/*` | 1/20 | 模拟浏览器缓存未命中 |

思考时间 1–3 秒。**并发数是「同时在看的人」，不是「每秒请求数」**。

**Agent 一回合**：`profile`、`notifications`、`information`、`intel/:id` 各一次；`search` 1/3；`requests` 15%。回合间隔 0.3–1s。全部带 `Authorization: Bearer`。

**写场景**（默认关闭）：发一条 `public: false` 的 post → 记一次看公开卡 → 立刻删掉；每 5 次多传一张 640×480 PNG。用 post 而不是 wish，是因为 `DELETE /intel/:id` 只接受 post / fastpost；`public: false` 让它不进信息流和快照。

## 指标与判定

每个端点独立一对指标：`ep_<name>_ms`（Trend）、`ep_<name>_err`（Rate）。报告按「端点 × 并发」出 p95 矩阵。

验收线写在 `scripts/report.mjs` 的 `LIMITS`：

| 项 | 线 |
| --- | --- |
| 读端点 p95 | ≤ 1000ms |
| 写端点 p95 | ≤ 2000ms |
| 错误率 | ≤ 1%（写 2%） |

超线的项在报告末尾逐条列出。这是这套部署的验收线，不是行业标准；要改就改 `LIMITS`，不要在报告里手写。

## 黑箱的代价，说清楚

| 事项 | 黑箱能做的 | 做不到的 |
| --- | --- | --- |
| 身份 | `/api/health` 给出站点名、版本、commit | 不读部署目录，不知道跑在哪台机器 |
| 数据规模 | `/discover.json` 的条数是准确值 | 库里总数、私帖数只有实例知道 |
| 页面 | 真浏览器打开、看是否被守卫送回登录页 | 不读前端路由表，「这一页存不存在」靠实际表现判断 |
| 缓存 | 能看到主包的 `immutable` 与压缩；卡片图片走入口缓存，脚本刻意不请求 | 不能主动清入口缓存，下架后 1 天内仍可能命中旧图；`X-Knot-Cache` 不单独统计 |
| 写入 | 能写、能自己删、能看删除有没有失败 | 不能查库确认没留痕；删除失败会留一条不公开记录，`ep_write_delete_err` 单独报 |

授权码与会话 cookie 只从环境变量或显式 `--token-file` 读，不打印、不落盘。`probe.json` 与 `summary.json` 只有 `token: true/false`。上传用的 PNG 由 `scripts/make-image.mjs` 现生成，不进版本库。

## 怎么读

1. **同机、同站点、同数据量**才有可比性。换压测机、换快照规模，数字就换了一套。
2. 并发升上去 p95 翻倍、错误率抬头：瓶颈在隧道或后端连接池，不在前端。
3. 静态端点慢但 `/api` 正常：入口或带宽的问题，先看探测里那条「主包 / 压缩」。
4. 每次迭代第一个请求通常比后续慢 200–300ms：`keepalive_timeout` 4s 短于人的思考时间，每个页面视图都会重建连接。这是入口的设计取舍，量的时候要知道它在里面。
5. 快照只有几条帖时，量到的是传输和框架开销，不是数据库。要测库，先让站点上有几百条，或者直接对本机源站测。
6. 人那一层每轮都是新的浏览器上下文（空 HTTP 缓存），所以第一条是冷缓存，同一上下文里后续页面会复用资源。

## 与 `ops/scripts/speed-check.sh` 的关系

那个脚本是第 0 层：顺序 curl 几个地址取中位数，回答「部署完通不通、大概多少毫秒」。留着手边用。这里三层回答「并发上去会怎样、慢在哪一段、站点的哪一项配置掉了队」。两者不重复。
