# 观测 OpenClaw 与平台智能体

OpenClaw 是一条旁路。评审员、管理员、精算师都是可选的处理者：它们不在，Knot 照样服务、
发帖、检索、结算；变化的只是终审不落地、作者收到一条审核警告。

这份规划只给这条旁路加可见度，别的一概不动。按阶段实施，每一阶段都能单独上线、单独回退。

## 0. 「零风险」在这里的确切含义

整份规划是纯增量。下面这些东西一个都不改：现有端点、现有查询、现有后台循环、现有测试。

| 不动的东西 | 为什么重要 |
| --- | --- |
| 不加数据库迁移 | 不锁表、不停机、回滚不用担心库与代码不一致 |
| 不加 `schema.mjs` 键 | `CONFIG.md` 与 `sites/_template/*.env` 都不用重新生成 |
| 不加依赖 | `npm ci` 的产物不变 |
| `/api/web/*` 与 `/api/agent/*` 上不新增写 | 这条热路径正是整套设计要保住的 |
| 不改 `/api/health` | 联邦名册的含义保持不变 |
| 不修改任何现有测试 | 现在通过的 917 个测试按构造继续通过 |
| 不重构 `doctor.sh` | 决定部署能不能上线的那份脚本，一个字符都不动 |

只有一个阶段会改变人能看到的东西：§8 给主人的信箱加一条通知，而它落在「终审已放弃」
这条本来就已经走到的路径上。它排在最后，只改一个函数，回退办法见 §10。

## 1. 不变量

| 约束 | 现在成立的原因 | 新代码必须 |
| --- | --- | --- |
| 请求路径上没有 OpenClaw 调用 | `createIntel` 入队就返回 | 请求里只读文件或只查库 |
| `/api/health` 保持静态 | 只回版本、发布包、提交 | 一行都不碰 |
| 部署扛得住 OpenClaw 坏掉 | `DEPLOY_LIVE=1` 在 OpenClaw 那一步之前就置上了 | 每个调用点都带 `\|\| true` |
| 旁路问题不能让检查失败 | `doctor.sh` 把 `WARNED` 与 `FAILED` 分开 | 放在一份不可能非零退出的新脚本里 |

有两条后果要写明：

- 完全没装 OpenClaw 的站点，每个智能体信号都显示成 `unknown` 或 `off`，绝不显示成错误。
  这是诚实，不是占位。
- Gateway 活着不等于审核能用。凭据过期和 agent 条目掉了，从作者那边看完全一样。

## 2. 风险台账

每一行是一种伤害方式、让它成为零的机制、以及证明该机制成立的检查。

| 风险 | 机制 | 检查 |
| --- | --- | --- |
| 状态读得慢，拖住管理页 | 不改 `loadOverview`；新加载器单独用 `void` 发起 | 手工：概览先出三个经济数字，智能体块随后填上 |
| 查询写坏了，管理页 500 | `agentReviewSnapshot` 全兜，返回 `ok:false` 加全 null | `agentReview.test.js`：「查询抛错时返回 null」 |
| 库的负担随表变大 | 每条查询都按 30 天 `created_at` 窗口收边，现有 `intel_feed_time_idx` 能范围扫 | `EXPLAIN` 显示索引范围扫，不是全表扫 |
| 探测把部署弄挂 | 检查脚本没有非零退出路径；部署再加 `\|\| true` | `openclaw-check.test.mjs`：「永远退出 0」 |
| 路径推错，状态看起来像坏了 | 路径从进程已有的值推，从不猜；推不出是 `unknown`，不是 `degraded` | `openclawStatus.test.js`：「没有文件就是 unknown」 |
| 密钥漏进状态文件 | 状态文件不带令牌、不带私钥路径、不带授权码 | 逐条核对 §6.3 的字段清单 |
| 站点好好的，却把主人吓一跳 | `unknown` 与 `off` 画成中性文字，绝不画成错误 | `admin/i18n` 一致性，加一次「停掉探测」的手工过一遍 |
| 某一阶段要撤回 | 每个阶段都是若干新文件，加现有文件里的几行 | §10 的回退表 |

## 3. 阶段一：两个只读模块

只加新文件。现有路由里加一行。

### 3.1 `backend/src/agentReview.js`

与 `attention.js` 同构：一个 `xxxSnapshot(pool)`，返回纯数字。

```js
export function reviewWindow() {
  return { days: 30, maxAttempts: 10 };
}

// 只读、只查库、永不抛。任何一步出错都返回 ok:false 和全 null，
// 让调用方与页面都能区分「没有数据」和「没查成」。
export async function agentReviewSnapshot(pool, options = {}) { /* ... */ }
```

一条查询、一次往返，聚合与分位数一起取：

```sql
SELECT
  max(i.updated_at) FILTER (WHERE i.verdict IN ('passed','rejected')) AS last_success_at,
  count(*) FILTER (WHERE i.verdict = 'pending')::int                   AS pending_count,
  min(i.created_at) FILTER (WHERE i.verdict = 'pending')               AS pending_oldest,
  count(*) FILTER (
    WHERE i.verdict = 'pending'
      AND CASE WHEN i.detail->>'reviewAttempts' ~ '^[0-9]+$'
               THEN (i.detail->>'reviewAttempts')::int ELSE 0 END >= $2
  )::int                                                               AS gave_up,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))
    FILTER (WHERE i.verdict IN ('passed','rejected'))                   AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))
    FILTER (WHERE i.verdict IN ('passed','rejected'))                   AS p95
FROM intel i
WHERE i.created_at > now() - make_interval(days => $1)
```

三处细节是承重的：

- **窗口就是要点。** `intel` 上 `verdict` 没有索引，但有
  `intel_feed_time_idx (created_at DESC, weight DESC)`。按 `created_at` 收边，规划器就能
  范围扫 30 天，而不是扫整张表。响应里带 `windowDays`，这个数字就不会是一个隐形的谎。
- **`reviewAttempts` 的转型有正则兜着。** `detail` 是自由 jsonb，
  `(detail->>'reviewAttempts')::int` 碰到一个非数字就抛，而那会把一个只读端点打挂。
  `CASE` 让它变成 0。
- **没有 `FILTER` 匹配时返回的是一行 null，不是零行。** 空表下形状依然稳定。

第二条查询取近 24 小时的失败码直方图，同样收边：

```sql
SELECT i.detail->>'reviewError' AS code, count(*)::int AS n
FROM intel i
WHERE i.created_at > now() - interval '24 hours'
  AND i.detail->>'reviewError' IS NOT NULL
GROUP BY 1
ORDER BY n DESC
LIMIT 10
```

第三条取巡查事实。这一条完全走索引：`admin_actions_patrol_idx` 本来就是
`(created_at DESC) WHERE action = 'patrol'` 上的部分索引，所以只碰巡查行，一天一行。

```sql
SELECT max(a.created_at) AS last_at,
       count(*) FILTER (WHERE a.created_at >= date_trunc('day', now()))::int AS today
FROM admin_actions a
WHERE a.action = 'patrol'
```

「今日」跟数据库时区走，与 `patrolQueue`、`recordPatrol` 现在的做法完全一致。这个模块
不引入任何新的时间约定。

缓存：30 秒，模块内，单飞。不用 `searchCache.js`——那个模块的 TTL 与键语义属于检索，
借用它会把两条互不相干的生命周期绑在一起。

### 3.2 `backend/src/openclawStatus.js`

一个入参、一个文件、时钟由外部注入。它不起进程，也不 import `agents/openclaw.js`
（那个模块是拉起评审员的）。

```js
// 状态文件的位置不新增配置键：进程里已经有部署根，或者能从授权码目录推出来。
// 推不出来就是 null，读不到就是 unknown——两种情况都不该让任何人以为站点坏了。
export function statusFilePath(env = process.env) {
  const root = String(env.KNOT_DEPLOY_ROOT || "").trim();
  if (root) return path.join(root, "var", "run", "openclaw-status.json");
  const envDir = String(env.KNOT_AGENT_ENV_DIR || "").trim();
  // <部署根>/sites/<站点>/agents → 上三级是部署根，与 profileFilePath 同一种推法。
  if (envDir) return path.join(envDir, "..", "..", "..", "var", "run", "openclaw-status.json");
  return null;
}

export async function readOpenclawStatus({ file, now = Date.now(), maxAgeMs = 3 * 300_000 }) { /* ... */ }
```

不加 schema 键，不碰生成物。`KNOT_DEPLOY_ROOT` 已经由 `run-knot-platform.sh`（它把每个
`KNOT_*` 都导出了）和 launchd plist 给到进程；`KNOT_AGENT_ENV_DIR` 这条退路覆盖 systemd，
因为 `platform.env` 里带着它。

解析顺序，以及每种结果的含义：

| 情形 | 结果 |
| --- | --- |
| `file` 为 null（既没有部署根也没有授权码目录） | `{ state: "unknown", reason: "no_path" }` |
| 文件不存在 | `{ state: "unknown", reason: "no_status_file" }` |
| 解析不了，或 `state` 不在四个取值里 | `{ state: "unknown", reason: "bad_status_file" }` |
| `checkedAt` 比 `maxAgeMs` 更早 | 沿用上次的状态，另加 `stale: true` |
| 有效且新鲜 | `{ state, checkedAt, stale: false, ...details }` |

`off` 是由部署脚本写下的状态（§5.3），从不靠推断。

### 3.3 一条路由

`backend/src/routes/admin.js`，放在 `router.use(...)` 那道门之后，挨着 `/agents`：

```js
router.get("/status", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  // 两块各自兜住：一块查不了，另一块的数照样出来。
  const [review, patrol] = await Promise.all([
    agentReviewSnapshot(pool).catch(() => null),
    patrolFacts(pool).catch(() => null),
  ]);
  const openclaw = await readOpenclawStatus({ file: statusFilePath() }).catch(() => null);
  res.json({ review, patrol, openclaw });
});
```

内网检查与 `KNOT_ADMIN_TOKEN` 都由路由现有的那道门提供。不加新的鉴权代码，不加中间件，
不改 `index.js`。

## 4. 契约

`GET /api/admin/status` → 200。未知的叶子一律是 `null`，`null` 永远不等于 `0`。

```json
{
  "review": {
    "ok": true,
    "windowDays": 30,
    "maxAttempts": 10,
    "lastSuccessAt": "2026-10-26T03:18:00.000Z",
    "pending": { "count": 2, "oldestMinutes": 47 },
    "gaveUp": 0,
    "latencySeconds": { "p50": 8.1, "p95": 41.7 },
    "errors24h": [{ "code": "agent_timeout", "count": 3 }]
  },
  "patrol": { "ok": true, "lastAt": "2026-10-26T01:00:00.000Z", "today": 1 },
  "openclaw": {
    "state": "degraded",
    "checkedAt": "2026-10-26T04:05:00.000Z",
    "stale": false,
    "version": "2026.10.1",
    "gateway": { "ok": true, "port": 18789 },
    "model": { "configured": false },
    "agents": { "expected": 3, "registered": 3, "missing": [] },
    "cron": { "patrol": "ok" }
  }
}
```

降级响应仍然是 200，带 `ok: false` 与 null 叶子。这里返回 500 才是端点的失败，而避免
这一点正是这个端点存在的理由。

## 5. 阶段二：部署可见

### 5.1 新检查脚本，以及为什么不去重构 `doctor.sh`

`doctor.sh` 决定部署的成败：「任何一项不过就以非零退出」。把它的报告工具抽出来给第二套
检查共用，等于去改那份决定版本能不能上线的脚本。这是整份规划里最大、也最容易避免的风险。

所以：新文件 `ops/scripts/openclaw-check.sh`。它自带 15 行 `ok`/`warn` 打印，**没有任何
非零退出的路径**，而且从现有代码一处也到不了它。

```bash
# 只报告，不判定。任何一行都不允许让调用方失败：
# 这台机器上没有 OpenClaw 是合法状态，不是故障。
# 所以本文件里没有 exit 1；结尾固定 exit 0。
```

每一项独立，每个异常都变成 `warn`：

| 行 | 来源 | 为什么不会非零 |
| --- | --- | --- |
| `gateway` | `openclaw gateway health --port`；命令不存在时打 `off` | 读退出码，不往外传 |
| `version` | `openclaw --version` 与 `KNOT_OPENCLAW_MIN_VERSION` 比对 | 没有二进制就是 `warn` |
| `model` | 读 `~/.openclaw/openclaw.json`，判断同 `check-openclaw-env.mjs` 那三条 | 文件读不了就是 `warn` |
| `agents` | `openclaw agents list` 与 `manifest.json` 加 `internal_agent/` 比对 | 输出解析不了就是 `warn` |
| `patrol` | `openclaw cron list --all --json` 里有没有 `knot-admin-patrol` | 缺任务就是 `warn` |
| `state dir` | 打印它解析到的路径 | 打印一个路径不可能失败 |

这份重复是有意的、临时的。把两套检查合并到一个报告库上，是另一件带自己测试的改动，不该
塞进一份前提是「现有东西一律不动」的规划里。

### 5.2 `apply-config.mjs` 的 `sync-report`

新增一个子命令，加两个纯导出函数，风格对齐 `patchConfig` 与 `retiredAgentIds`，于是不必
写进 `~/.openclaw` 就能测：

```js
export function renderSyncReport({ syncedAt, version, gatewayPort, patrolCron, manifest }) { /* → object */ }
export function writeSyncReport(file, report) { /* 原子写：tmp + rename，权限 0600 */ }
```

写 `var/run/openclaw-sync.json`：

```json
{
  "syncedAt": "2026-10-26T04:00:00Z",
  "openclawVersion": "2026.10.1",
  "gatewayPort": 18789,
  "agents": ["knot-intel", "knot-admin", "knot-actuary"],
  "skills": { "knot-intel": ["knot-employee", "knot-intel"] },
  "patrolCron": "knot-admin-patrol"
}
```

版本门槛刻意不记在这里。它已经有一个家——`check-openclaw-env.mjs` 里的
`KNOT_OPENCLAW_MIN_VERSION`——而 `openclaw-check.sh` 在部署时按同一个约定比对。
同一个数字存两份，就是两个数字要同步。

`ensure-openclaw.sh` 在 `ensure_admin_cron` 之后调用它，而不是在 `sync()` 里：
只有到那一刻它才知道巡查任务在与不在。调用带 `|| echo`，写失败只留一条警告，
绝不让这次同步失败。

由 Node 写，不由 shell 写：清单本来就在那里解析过了，而在 bash 里拼 JSON 正是这类文件
最后微妙地写坏的方式。

没有这份文件，运行时无法区分「这个 agent 是故意下线的」和「这个 agent 掉了」。部署记下
它想要什么，探测负责比对。

不写令牌、不写私钥路径、不写任何授权码。

### 5.3 `off` 得有人写

Backend 永远不知道 `KNOT_OPENCLAW`，它是部署期变量。于是「明确关闭」和「探测从没跑过」
看起来一样，`off` 根本到不了。

`deploy-site.sh` 在现有的 OpenClaw case 块里，`0` 那一支写状态文件：

```bash
printf '{"state":"off","checkedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$KNOT_DEPLOY_ROOT/var/run/openclaw-status.json"
```

每种状态一个写者、一个读者，不引入第二个真相源，Backend 也不必去读 `platform.env`。

两个方向都得成立，否则 `off` 会变成陷阱：

| 部署 | 写 / 清 | 运行时写者 |
| --- | --- | --- |
| `KNOT_OPENCLAW=0` | 写 `off` | 探测原样保留 `off` |
| OpenClaw 开启 | `ensure-openclaw.sh` 删掉这个文件 | 探测写入观测到的状态 |

所以探测在动手之前先读文件：磁盘上的 `off` 是一个决定，不是一次读数，因此要保留而不是
覆盖。没有这条规则，探测会在五分钟内把 `off` 换成 `unknown`，控制台就丢掉了它唯一被
告知过的那件事。

`off` 那一支不调 `openclaw-check.sh`。去拉起一个站点明确说过要跳过的 CLI，然后在
「已跳过」旁边打印一行 `ok gateway`，只会让同一个部署日志自相矛盾。

### 5.4 `deploy-site.sh` 里的两行

在现有 OpenClaw 那一步之后、`ensure-first-agent` 之前：

```bash
"$KNOT_APP_DIR/ops/scripts/openclaw-check.sh" || true
```

按 §5.1，`|| true` 是多余的，但仍然留着：读这个文件的人不必先知道被调用方是守规矩的。

OpenClaw 这一步最后还多一句 `openclaw_probe_now`：把探测单元立刻拉起一次。单元在同一轮
部署里先装好，`RunAtLoad` / `start` 已经跑过一次；但 `ensure-openclaw.sh` 在它之后执行，
会清掉 `off` 标记，而下一次定时探测最多还在五分钟之后。没有这一句，每次部署完控制台都
要空等那五分钟，看起来像探测坏了，而它其实只是还没跑。`probe-freshness.test.mjs` 守住
两半：只有写着 `off` 时才清标记，以及每个执行同步的分支都补一次探测。

## 6. 阶段三：探测

### 6.1 `ops/openclaw/probe.mjs`

与 `apply-config.mjs` 同住，因为它读同一份 `manifest.json`。`ops/scripts/` 仍是 bash
管道的地盘。

- 只收宿主侧的事实。
- **先读再探**：磁盘上已经是 `off` 就原样写回（只更新 `checkedAt`）并跳过其余检查。
  `off` 是部署的决定，不是一次读数，探测不该用观测值把它盖掉。
- 两项贵的检查（`agents list`、`cron list`）最多一小时一次，中间复用结果，结果就存在
  状态文件里。探测只有便宜到可以整天跑，才有存在的意义。
- 原子写（先 `tmp` 再 `rename`，`0600`）。任何异常写成
  `{"state":"unknown","reason":...}`。
- **永远退出 0。** 它的职责是记录，不是失败；非零退出会诱使监管进程把一次观测当成一次
  故障。
- 解析不了一律是 `unknown`，绝不记成失败。信息缺失就报成信息缺失。
- 每次运行都打印它解析到的 state 目录，于是写错的 `OPENCLAW_STATE_DIR` 在部署日志里就
  看得见，而不是一周后表现为一个沉默的 `unknown`。
- 触碰 `var/run/openclaw-probe.request` 会让它下一轮把两项贵的检查重跑一次。这是给运维
  的钩子，不是控制台的按钮：一个为了省一次等待就写文件的 REST 端点，是一项新能力，
  而探测本来就每五分钟跑一次、装载时也跑一次。
- 每个入口都用**真实路径**判断「我是被执行，还是被 import」（见
  `ops/scripts/lib/main-module.mjs`）。单元通过 `<部署根>/current` 拉起探测，而 node
  在算 `import.meta.url` 时已经把那条软链解开；用字符串比路径，整个文件就变成一个
  静默的空操作、退出码还是 0。监测最不能有的就是这种失败：单元是绿的，背后没有读数。

### 6.2 单元，用固定间隔

`ops/launchd/com.knot.openclaw-probe.plist` 用 `StartInterval` 300；
`ops/systemd/knot-openclaw-probe.{service,timer}` 用 `OnUnitActiveSec=300`。两者都照现有
gc 单元的样子写，连 `EnvironmentVariables` 里那两个 `KNOT_SITE`、`KNOT_DEPLOY_ROOT` 都
一样。

不引入新占位符：用到的每一个都已经在 `site-config.sh` 的替换表里，
`unit-placeholders.test.mjs` 会强制这一点。

用固定间隔而不是配置键，因为现有的 gc timer 本来就把 `04:45` 写死在单元里。探测节奏是
同一类运维缺省值，加一个键意味着为了没有收益的东西重新生成 `CONFIG.md` 和两份模板。

systemd 那边单元写 `Environment=OPENCLAW_STATE_DIR=%h/.openclaw`，这是 systemd 自己定义
的服务用户家目录。macOS 的 launchd agent 直接继承用户 `HOME`。两者都不需要我们猜一个
部署期取值。

### 6.3 状态文件允许出现的内容

只有这些键：`state`、`checkedAt`、`reason`、`version`、`stateDir`、`gateway.port`、
`gateway.ok`、`model.configured`、`agents.expected`、`agents.registered`、
`agents.missing`、`cron.patrol`、`cache.agentsAt`、`cache.cronAt`。

没有令牌、没有私钥路径、没有授权码、没有网络地址。

`stateDir` 是一个本机路径。它留在权限 `0600` 的文件里；`openclawStatus.js` 只拷贝控制台
要显示的那几个字段，路径不在其中。它值得写进文件，因为写错的 state 目录是沉默
`unknown` 最常见的原因，而部署日志正是人会去翻的地方。

## 7. 阶段四：`/admin`

### 7.1 标记

`admin/index.html` 里，在注意力那一节之后加一个 `stat-section`，严格照现有写法
（`group-title` 加 `state-list`）：

```html
<section class="stat-section" aria-labelledby="agents-heading">
  <h3 id="agents-heading" class="group-title" data-i18n="overview.agents"></h3>
  <p class="muted small" data-i18n="overview.agentsHint"></p>
  <div id="ov-agents" class="state-list"></div>
</section>
```

`stateRow()` 原样复用：`stateRow(title, hint, on, text)` 在 `on` 为 false 且给了 `text`
时，画的正好是一枚中性胶囊，也就是 `unknown` 与 `off` 需要的渲染。不用改 CSS。

### 7.2 加载器隔离

```js
function renderOverview() {
  /* 现有几行不动 */
  void loadAgentHealth();   // 单独发起：状态慢或坏不能拖住上面三个数
}

async function loadAgentHealth() {
  // 这个端点坏掉不该在概览上弹 toast：它本来就是「有多少就先说多少」。
  // 所以自己 try/catch，失败就把这一块画成 unknown。
  try {
    state.agentHealth = await api("/status");
  } catch (error) {
    if (handleAuth(error)) return;
    state.agentHealth = null;
  }
  renderAgentHealth();
}
```

`loadOverview` 本身不改。`overview-refresh` 只多一行 `void loadAgentHealth()`，刷新路径
其余部分不动。

被兜住的失败只剩一行，不再是三行：

```
智能体
  状态读不到
```

三行，不是四行。精算师没有独立信号：它只在主人采纳价格提案时才写东西，
所以任何「最后活动」都会是编出来的。只读的外部 Agent 没有在线状态，这套设计不替它造一个。

每行的状态与判定：

| 行 | 正常 | 需要看看 |
| --- | --- | --- |
| OpenClaw 宿主 | 探测报 `ok` | `degraded`：网关不通、模型未配置、少了 Agent、或缺巡查任务 |
| 评审员 | 有效终审过、没有老化的积压 | 重试已放弃、窗口内没有成功、或积压最久超过一刻钟 |
| 管理员 | 36 小时内有巡查 | 没有巡查，或超过 36 小时没有 |

一刻钟这个阈值是因为比它年轻的积压只是正常排队。再短一点，每一次提交都会变成一次告警。

### 7.3 三份字典都要加的键

`overview.agents`、`overview.agentsHint`、
`agents.openclaw`、`agents.reviewer`、`agents.admin`、
`agents.ok`、`agents.warn`、`agents.off`、`agents.unknown`、
`agents.offHint`、`agents.reason`、`agents.gatewayHint`、
`agents.reviewHint`、`agents.oldest`、`agents.gaveUp`、
`agents.patrolHint`、`agents.unavailable`。

三份文件不一致、某一份漏了占位符、或者 `admin.js` 里又冒出硬编码中文时，
`admin/i18n.test.mjs` 都会失败。

这一阶段不加顶部告警条。在阈值真正跑过一段时间之前就加，只会教会主人忽略它。

## 8. 阶段五：读路径之外的两处改动

都只动一个文件加几行，而且它们是整份规划里唯一可见的行为变化。

### 8.1 通知主人，不只通知作者

`notifyReviewGaveUp` 往 `intel.account_id` 写一条，正文以「请联系管理员处理」结尾。
作者对它无能为力。

给主人加一条，`kind: "agent_review_stalled"`，按 `attempts` 水位去重。让它安全的几条设计
约束：

- 只在已经走到「放弃重试」的路径上执行，那条路径本来就少。
- 解析不到主人就什么都不做，也不抛。测试里那些假 pool 对这条查询都返回空行，所以什么都
  不会坏。
- `NOTICE_GROUPS` 必须加上这个 kind。`SYSTEM_KINDS` 从那张表推出，用来过滤「最新几条」
  的子查询，没登记的 kind 会计数但永远不出现在列表里。
- `web/src/noticeText.js` 要有一个 case，否则主人看到的是一条通用正文。
- 不带 `href`：管理后台在内网地址上，挂在站点页面上的链接只会是一扇打不开的门。
  正文直接说去哪个栏目看。
- `account.js` 加 `ownerId(pool)`，`listAgents` 改用它，而不是把
  `SELECT id FROM accounts WHERE role = 'owner' LIMIT 1` 内联第三遍。

### 8.2 给 `main` 的说明

`main` 是 OpenClaw 自己的默认 agent。这一节不碰 `channels`、`auth`、`gateway.auth` 和
onboarding；它也是整份规划里唯一写到仓库管理的文件之外的地方，所以自带护栏。

`apply-config.mjs` 增加 `main-brief`，实现为纯函数（`renderBrief(values)`、
`patchAgentsBrief(existing, block)`），于是不必有 `~/.openclaw` 就能测：

- 工作区从 `config.agents.entries[id].workspace` 解析，其次 `bindings`，再次一个已经存在
  的 `workspace-<id>` 目录。从不假设 `workspace-main`，从不创建目录。
- 写 `KNOT.md`（我们自己的文件）。
- 只在 `AGENTS.md` 本来存在时，往它里面追加受控块。第一次写之前，如果备份还不存在，存一份
  `AGENTS.md.knot-before-brief`。任何东西都不删。
- `--dry-run` 打印解析到的工作区、要追加的块、以及是否会建备份，一个字节都不写。部署时
  直接跑（不是静默跑），日志里就能看到发生了什么。
- 工作区解析不到、或 `AGENTS.md` 不存在：告警并跳过，退出 0。

受控块：

```markdown
<!-- knot:begin -->
## Knot
Read KNOT.md in this workspace: it maps the deployment root, where code, config,
data and logs live, and which read-only commands are safe. You do not administer
the site; knot-admin does. You are a side path: if you are down the site still runs.
<!-- knot:end -->
```

`KNOT.md` 的内容，同步时用真实取值渲染，只写路径，不写任何密钥、令牌或内网地址：

1. **目录地图**：部署根、`current`、`releases/`、`sites/<站点>/`、`var/uploads`、
   `var/log/*.log`、`var/run/*.json`、`~/.openclaw/workspace-*`，并写明 `sites/` 在发布包
   外面、升级和回滚都不动它。
2. **可以跑什么**：只读命令。`doctor.sh --site <站点>`、`openclaw-check.sh`、
   `curl 127.0.0.1:<端口>/api/health`、`openclaw agents list`、`openclaw gateway health`、
   `openclaw cron list`。
3. **不可以做什么**：读 `platform.env`、`xknot.env`、`tunnel.env`、`agents/*.local.env`、
   `.admin-token`、`openclaw.json`；跑 deploy、reset、恢复备份；写数据库；替主人删帖或
   禁言；把本机路径贴进对话。
4. **路由与说话方式**：502 看隧道那两项；审核不动看 `/admin` 的智能体块。以及：说「站点
   挂了」之前先读 `/api/health`。最常见的错是把评审员死了说成站点死了。

## 9. 测试

下面每个文件都是新的，每个测试都能在没有 OpenClaw、没有真库、没有 `~/.openclaw` 的情况下
跑。

| 文件 | 用例 |
| --- | --- |
| `backend/src/agentReview.test.js` | 空表返回一行 null；全是 pending；达到重试上限；`detail` 为 null；`reviewAttempts` 非数字不抛；查询抛错返回 `ok:false` 加全 null；第二次调用走缓存不发第二次查询 |
| `backend/src/openclawStatus.test.js` | `statusFilePath` 在有无 `KNOT_DEPLOY_ROOT`、有无 `KNOT_AGENT_ENV_DIR` 下的四种结果；没有文件；解析不了；`state` 取值不认识；`off`；新鲜的 `degraded`；正好卡在年龄边界；超过边界 |
| `backend/src/routes/adminStatus.test.js` | 两个模块都失败时返回 200 与 null；无令牌 401；非内网被拒；`Cache-Control: no-store` |
| `ops/scripts/openclaw-check.test.mjs` | 没有二进制 → `off` 行、退出 0；Gateway 挂了 → 退出 0；`agents list` 解析不了 → 退出 0；断言脚本里没有 `exit 1` |
| `ops/openclaw/apply-config.test.js`（扩充） | `renderSyncReport` 的形状；`writeSyncReport` 原子且 `0600`；`renderBrief` 取值；`patchAgentsBrief` 只替换标记区；没有标记时只追加一次；`AGENTS.md` 缺失时不写 |
| `ops/openclaw/probe.test.mjs` | 注入 runner 加临时目录：装了与没装；Gateway 好与坏；少一个 agent；列表解析不了；写文件失败；每种都退出 0；经由软链调用时仍然落盘、仍然把结论打出来 |
| `ops/scripts/direct-run.test.mjs` | `ops/` 与 `backend/scripts/` 下没有脚本用未解析的路径判断「直接执行」；六个随包发布的命令行都走同一份实现 |
| `backend/src/intel.test.js`（扩充） | 每个水印只给主人一条；没有主人时返回 false 而不是抛；作者就是主人时不再发第二遍；没有错误码时 data 里是 null |
| `web/src/noticeText.test.js`（扩充） | 停止重试的通知渲染出次数、最后一次失败与「站点没事」的尾句；次数不是数字时退回库里的原文 |
| `admin/i18n.test.mjs`（现有） | 自动覆盖新键 |

值得留成测试的结构检查：

- `openclawStatus.js` 不 import `agents/openclaw.js`。
- `/api/agent/*` 的处理里没有新增 `INSERT` 或 `UPDATE`。
- `deploy-site.sh` 的 OpenClaw 那一步与新检查调用都容忍失败。

## 10. 上线与回退

| 阶段 | 怎么上 | 怎么退 |
| --- | --- | --- |
| 一 | 正常发版；没人读它之前这个端点就是静的 | 删两个文件与路由里那一段 |
| 二 | 正常发版 | 删 `openclaw-check.sh`、部署里两行、`sync-report` 一支 |
| 三 | 装单元，全部 `\|\| true` | 卸单元、删 `var/run/openclaw-status.json`；页面退回 `unknown` |
| 四 | 跟着页面发；纯静态文件 | 回退 `index.html` 与一个加载器 |
| 五 | 先通知，再说明 | 通知：删调用与 `notifyOwnerReviewStalled`、`NOTICE_GROUPS` 里那个 kind、以及三份字典里的键；说明：还原 `AGENTS.md.knot-before-brief`，删掉 `KNOT.md` 与那段块，并去掉 `ensure-openclaw.sh` 里的 `main-brief` 调用 |

阶段一、二上线后，在真站点上查一次：

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/api/admin/status | head -c 400
./ops/scripts/openclaw-check.sh; echo "exit=$?"          # 必须是 0
```

探测装了但被停掉时，页面必须显示 `unknown`、而且不弹横幅。这是整份规划里最重要的一次
手工检查：监测的失败方式，是它自己喊狼来了。

## 11. 不做

- 不引 Prometheus、Grafana 或任何外部服务。
- 不往 `/api/health` 塞 OpenClaw 字段，也不让它影响联邦名册。
- 不在请求处理里同步调 CLI。
- 不加在线列、不在 Agent 请求路径上写库；只读的外部 Agent 没有在线信号，这是有意的。
- 不为监测新起一个查库的常驻进程。审核那几个数在进程里算足够便宜。
- 任何阶段都不加配置键、不加迁移。
- 不因为探测失败而让部署失败、回滚或停站。
- 不整份替换 `main` 的 `AGENTS.md`，只动受控块，且先留一次备份。
- 不做自测按钮（那是一次业务写入，要单独决定）、不做每日摘要邮件（邮件只用于登录密钥
  和用户寄给主理人的建议与投诉，本来就不是通知渠道；登录密钥还可能经中枢代发）、
  暂不做顶部告警条。
