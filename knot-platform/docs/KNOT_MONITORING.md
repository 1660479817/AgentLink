# Observing OpenClaw and the platform agents

OpenClaw is a side path. Review, admin, and actuary are optional processors: without them
Knot still serves, posts, searches, and settles points. What changes is that final review
does not land, and authors get a review warning.

This plan adds visibility to that side path and changes nothing else. It is written to be
implemented one phase at a time, each phase shippable and revertible on its own.

## 0. What "zero risk" means here, precisely

The whole plan is additive. Nothing below modifies an existing endpoint, an existing
query, an existing worker, or an existing test.

| Not touched | Why it matters |
| --- | --- |
| No database migration | No lock, no downtime, no rollback mismatch |
| No `schema.mjs` key | No change to generated `CONFIG.md` or `sites/_template/*.env` |
| No dependency added | `npm ci` output unchanged |
| No write on `/api/web/*` or `/api/agent/*` | The hot path this design protects |
| No change to `/api/health` | The federation roster keeps its meaning |
| No existing test edited | 917 passing tests stay green by construction |
| No `doctor.sh` refactor | The script that gates deploys is not touched |

Exactly one phase changes something a person can see: §8 adds one notification to the
owner's inbox, on a code path that already ended in "review gave up". It is last, it is
one function, and its revert is described in §10.

## 1. The invariant

| Rule | Already true because | New code must |
| --- | --- | --- |
| No OpenClaw call on a request path | `createIntel` enqueues and returns | Only read files or run SQL in a request |
| `/api/health` stays static | It returns version, release, commit | Never touch it |
| Deployment survives OpenClaw damage | `DEPLOY_LIVE=1` is set before the OpenClaw step | Be `\|\| true` at every call site |
| A side-path problem never fails a check | `doctor.sh` separates `WARNED` from `FAILED` | Live in a new script that cannot exit non-zero |

Two consequences worth stating:

- A site with no OpenClaw renders every agent signal as `unknown` or `off`. Never an
  error. That is the honest reading, not a placeholder.
- A live gateway does not mean review works. Expired credentials and a missing agent
  entry look identical from the author's side.

## 2. Risk ledger

Each row is a way this work could hurt, the mechanism that makes it zero, and the check
that proves the mechanism holds.

| Risk | Mechanism | Check |
| --- | --- | --- |
| A slow status read delays the admin page | `loadOverview` is not modified; the new loader is fired separately with `void` | Manual: overview shows the three economy numbers before the agents block fills |
| A broken query 500s the admin page | `agentReviewSnapshot` catches everything and returns all-null with `ok: false` | `agentReview.test.js`: "a query that throws returns nulls" |
| DB load grows with table size | Every query is bounded by a 30-day `created_at` window, which the existing `intel_feed_time_idx` can range-scan | `EXPLAIN` shows an index range scan, not a seq scan |
| Deploy fails because of a probe | The check script has no non-zero exit path; deploy adds `\|\| true` | `openclaw-check.test.mjs`: "always exits 0" |
| A wrong path makes the status look broken | The path is derived from values the process already has, never guessed; a miss is `unknown`, not `degraded` | `openclawStatus.test.js`: "no file is unknown" |
| A secret leaks into a status file | The status file carries no token, key path, or auth code | Review the writer's field list (§6.3) |
| The owner is alarmed by a healthy site | `unknown` and `off` render as neutral text, never as an error | `admin/i18n` parity plus manual pass with the probe stopped |
| A phase must be undone | Every phase is a set of new files plus a few lines in one existing file | §10 revert table |

## 3. Phase 1 — two read-only modules

New files only. One route line added to an existing router.

### 3.1 `backend/src/agentReview.js`

Mirrors `attention.js`: a single `xxxSnapshot(pool)` returning plain numbers.

```js
export function reviewWindow() {
  return { days: 30, maxAttempts: 10 };
}

// 只读、只查库、永不抛。任何一步出错都返回 ok:false 和全 null，
// 让调用方与页面都能区分「没有数据」和「没查成」。
export async function agentReviewSnapshot(pool, options = {}) { /* ... */ }
```

One query, one round trip, both aggregates and percentiles:

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

Three details that are load-bearing:

- **The window is the point.** `intel` has no index on `verdict`, but it does have
  `intel_feed_time_idx (created_at DESC, weight DESC)`. Bounding by `created_at` lets the
  planner range-scan 30 days instead of the table. The response reports `windowDays` so
  the number is never a hidden lie.
- **The `reviewAttempts` cast is guarded by a regex.** `detail` is free-form jsonb;
  `(detail->>'reviewAttempts')::int` throws on a stray non-numeric value, which would take
  down a read-only endpoint. The `CASE` makes it 0 instead.
- **No `FILTER` means no row.** An empty table returns one row of nulls, not zero rows, so
  the shape is stable.

A second query for the 24-hour failure histogram, also windowed:

```sql
SELECT i.detail->>'reviewError' AS code, count(*)::int AS n
FROM intel i
WHERE i.created_at > now() - interval '24 hours'
  AND i.detail->>'reviewError' IS NOT NULL
GROUP BY 1
ORDER BY n DESC
LIMIT 10
```

A third for the patrol facts. This one is fully index-backed: `admin_actions_patrol_idx`
is already a partial index on `(created_at DESC) WHERE action = 'patrol'`, so the query
touches only patrol rows, one a day.

```sql
SELECT max(a.created_at) AS last_at,
       count(*) FILTER (WHERE a.created_at >= date_trunc('day', now()))::int AS today
FROM admin_actions a
WHERE a.action = 'patrol'
```

"Today" follows the database's timezone, exactly like `patrolQueue` and `recordPatrol`
already do. This module introduces no new time convention.

Cache: 30 seconds, module-local, single flight. Not `searchCache.js` — that module's TTL
and key semantics belong to search, and borrowing it would couple two unrelated lifetimes.

### 3.2 `backend/src/openclawStatus.js`

One input, one file, an injected clock. It never spawns a process and never imports
`agents/openclaw.js` (that module runs the reviewer).

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

No schema key, no generated-file churn. `KNOT_DEPLOY_ROOT` is already set by
`run-knot-platform.sh` (it exports every `KNOT_*`) and by the launchd plist; the
`KNOT_AGENT_ENV_DIR` fallback covers systemd, where `platform.env` carries it.

Resolution order, and what each outcome means:

| Situation | Result |
| --- | --- |
| `file` is null (no deploy root and no agent env dir) | `{ state: "unknown", reason: "no_path" }` |
| File missing | `{ state: "unknown", reason: "no_status_file" }` |
| Unparsable, or `state` not one of the four | `{ state: "unknown", reason: "bad_status_file" }` |
| `checkedAt` older than `maxAgeMs` | previous state, plus `stale: true` |
| Valid and fresh | `{ state, checkedAt, stale: false, ...details }` |

`off` is a state the deploy script writes (§5.3). It is never inferred.

### 3.3 One route

In `backend/src/routes/admin.js`, after the `router.use(...)` guard, next to `/agents`:

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

Inherits the existing intranet check and `KNOT_ADMIN_TOKEN` from the router guard. No new
auth code, no new middleware, no change to `index.js`.

## 4. The contract

`GET /api/admin/status` → 200. Every leaf is `null` when unknown; `null` is never `0`.

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

Degraded responses are still 200 with `ok: false` and null leaves. A 500 here would be a
failure of the endpoint, which is the one thing this endpoint exists to avoid.

## 5. Phase 2 — deployment visibility

### 5.1 A new check script, and why it is not a `doctor.sh` refactor

`doctor.sh` gates deploys: "any failing check exits non-zero". Extracting its reporting
helpers so a second suite can share them means editing the one script whose exit code
decides whether a release goes live. That is the largest avoidable risk in this plan.

Instead: `ops/scripts/openclaw-check.sh`, a new file. It carries its own 15 lines of
`ok`/`warn` printing, has **no path that exits non-zero**, and is unreachable from every
existing code path.

```bash
# 只报告，不判定。任何一行都不允许让调用方失败：
# 这台机器上没有 OpenClaw 是合法状态，不是故障。
# 所以本文件里没有 exit 1；结尾固定 exit 0。
```

Checks, each independent, each turning an exception into `warn`:

| Row | Source | Never non-zero because |
| --- | --- | --- |
| `gateway` | `openclaw gateway health --port`; a command-not-found result prints `off` | exit code is read, not propagated |
| `version` | `openclaw --version` against `KNOT_OPENCLAW_MIN_VERSION` | missing binary is `warn` |
| `model` | read `~/.openclaw/openclaw.json`, same three checks as `check-openclaw-env.mjs` | unreadable file is `warn` |
| `agents` | `openclaw agents list` against `manifest.json` plus `internal_agent/` | unparsable output is `warn` |
| `patrol` | `openclaw cron list --all --json` contains `knot-admin-patrol` | missing cron is `warn` |
| `state dir` | prints the path it resolved | printing a path cannot fail |

The duplication is deliberate and temporary. Consolidating both suites onto one reporting
library is a separate change with its own test, and it does not belong in a plan whose
premise is "nothing existing moves".

### 5.2 `sync-report` in `apply-config.mjs`

A new subcommand, plus two exported pure functions in the style of `patchConfig` and
`retiredAgentIds`, so it is testable without touching `~/.openclaw`:

```js
export function renderSyncReport({ syncedAt, version, gatewayPort, patrolCron, manifest }) { /* → object */ }
export function writeSyncReport(file, report) { /* atomic: tmp + rename, mode 0600 */ }
```

Writes `var/run/openclaw-sync.json`:

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

The version threshold is deliberately not recorded here. It already has one home —
`KNOT_OPENCLAW_MIN_VERSION` in `check-openclaw-env.mjs` — and `openclaw-check.sh`
compares against the same convention at deploy time. A second copy of a number is a
second number to keep in sync.

`ensure-openclaw.sh` calls this after `ensure_admin_cron`, not inside `sync()`: only at
that point does it know the patrol job exists. The call is `|| echo`, so a failed write
leaves a warning, never a failed sync.

Written by Node, not by shell: the manifest is already parsed there, and building JSON by
string interpolation in bash is how this kind of file ends up subtly wrong.

Without this file the runtime cannot tell "this agent was retired on purpose" from "this
agent fell off the registry". Deployment records what it intended; the probe compares.

No token, key path, or auth code goes into it.

### 5.3 `off` has to be written by someone

The Backend never learns `KNOT_OPENCLAW`; it is a deployment variable. So "disabled on
purpose" and "the probe never ran" would look identical, and `off` would be unreachable.

`deploy-site.sh`, in the existing OpenClaw case block, writes the status file in the `0`
branch:

```bash
printf '{"state":"off","checkedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$KNOT_DEPLOY_ROOT/var/run/openclaw-status.json"
```

One writer per state, one reader, no second source of truth, and the Backend still does
not read `platform.env`.

Two directions have to work, or `off` becomes a trap:

| Deploy | Writes / clears | Runtime writer |
| --- | --- | --- |
| `KNOT_OPENCLAW=0` | writes `off` | probe leaves `off` alone |
| OpenClaw enabled | `ensure-openclaw.sh` deletes the file | probe writes the observed state |

The probe therefore reads the file before it probes: an `off` on disk is a decision, not
a reading, so it is preserved rather than overwritten. Without that rule the probe would
replace `off` with `unknown` within five minutes and the console would lose the one fact
it was told.

`openclaw-check.sh` is not called in the `off` branch. Spawning a CLI the site was told
to skip, and then printing `ok gateway` next to "skipped", would be two contradictory
lines in the same deploy log.

### 5.4 Two lines in `deploy-site.sh`

After the existing OpenClaw step, still before `ensure-first-agent`:

```bash
"$KNOT_APP_DIR/ops/scripts/openclaw-check.sh" || true
```

`|| true` is redundant given §5.1 and is kept anyway: the reader of that file should not
have to know that the callee is well behaved.

## 6. Phase 3 — the probe

### 6.1 `ops/openclaw/probe.mjs`

Next to `apply-config.mjs`, because it reads the same `manifest.json`. `ops/scripts/`
stays the bash plumbing.

- Collects the host-side facts only.
- **Reads before it probes.** If the file on disk already says `off`, it writes `off` back
  with a fresh `checkedAt` and skips the rest. `off` is a deployment decision, not a
  reading, and observation must not overwrite it.
- Two expensive checks (`agents list`, `cron list`) run at most once an hour and are
  reused in between, stored inside the status file itself. A probe is only useful if it is
  cheap enough to run all day.
- Writes atomically (`tmp` then `rename`, `0600`). Any exception becomes
  `{"state":"unknown","reason":...}`.
- **Always exits 0.** Its job is to record, not to fail. A non-zero exit invites a
  supervisor to treat an observation as an outage.
- Unparsable output is `unknown`, never a failure. Missing information is reported as
  missing.
- Prints the resolved state directory on every run, so a wrong `OPENCLAW_STATE_DIR` is
  visible in the deploy log instead of surfacing as a silent `unknown` a week later.
- Touching `var/run/openclaw-probe.request` forces the two expensive checks on the next
  run. It is an operator hook, not a console button: a REST endpoint that writes a file is
  a new capability, and the probe already runs every five minutes and at load.
- Every entry point decides "am I being run, or imported?" by comparing **real paths**
  (`ops/scripts/lib/main-module.mjs`). The unit starts the probe through
  `<deploy root>/current`, a symlink that Node resolves when it computes
  `import.meta.url`; a string comparison makes the whole file a silent no-op that still
  exits 0. That is the one failure mode monitoring must not have — a green unit with no
  reading behind it.

### 6.2 Units, with a fixed interval

`ops/launchd/com.knot.openclaw-probe.plist` uses `StartInterval` 300;
`ops/systemd/knot-openclaw-probe.{service,timer}` uses `OnUnitActiveSec=300`. Both mirror
the existing gc units, down to the `EnvironmentVariables` block carrying `KNOT_SITE` and
`KNOT_DEPLOY_ROOT`.

No placeholder is introduced: every placeholder used already exists in
`site-config.sh`'s substitution list, and `unit-placeholders.test.mjs` enforces that.

A fixed interval, not a configuration key, because the existing gc timer already hardcodes
`04:45` in the unit. A probe cadence is an ops default of the same kind, and adding a key
would mean regenerating `CONFIG.md` and both template files for no gain.

On systemd the unit sets `Environment=OPENCLAW_STATE_DIR=%h/.openclaw`, which is the
service user's home by systemd's own definition. On macOS the launchd agent inherits the
user's `HOME`. Neither requires a value we would have to guess at deploy time.

### 6.3 What the status file may contain

Only these keys: `state`, `checkedAt`, `reason`, `version`, `stateDir`,
`gateway.port`, `gateway.ok`, `model.configured`, `agents.expected`,
`agents.registered`, `agents.missing`, `cron.patrol`, `cache.agentsAt`,
`cache.cronAt`.

No token. No key path. No agent auth code. No network address.

`stateDir` is a local filesystem path. It stays in the `0600` file; `openclawStatus.js`
copies only the fields the console renders, and the path is not one of them. It earns its
place in the file because a wrong state directory is the most common cause of a silent
`unknown`, and the deploy log is where someone would go looking.

## 7. Phase 4 — `/admin`

### 7.1 Markup

One new `stat-section` after the attention section in `admin/index.html`, following the
existing pattern exactly (`group-title` + `state-list`):

```html
<section class="stat-section" aria-labelledby="agents-heading">
  <h3 id="agents-heading" class="group-title" data-i18n="overview.agents"></h3>
  <p class="muted small" data-i18n="overview.agentsHint"></p>
  <div id="ov-agents" class="state-list"></div>
</section>
```

`stateRow()` is reused as-is: `stateRow(title, hint, on, text)` already renders a neutral
pill when `on` is false and `text` is supplied, which is exactly the `unknown` and `off`
rendering. No CSS change is required.

### 7.2 Loader isolation

```js
function renderOverview() {
  /* existing lines unchanged */
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

`loadOverview` itself is not modified. `overview-refresh` gets one extra line calling
`void loadAgentHealth()`; nothing else in the refresh path changes.

A guarded failure renders one line instead of three rows:

```
Agents
  Status unavailable
```

Three rows, not four. The actuary has no independent signal: it only writes when the owner
applies a price proposal, so any "last active" number would be invented. A read-only
external agent has no presence, and this design does not make one up.

Row states, and what each one means:

| Row | `ok` | `needs a look` |
| --- | --- | --- |
| OpenClaw host | probe says `ok` | `degraded` — gateway down, model unconfigured, an agent missing, or no patrol job |
| Reviewer | reviewed successfully, nothing aged | retry gave up, nothing succeeded in the window, or a pending item older than 15 minutes |
| Administrator | a patrol within 36 hours | no patrol, or none for over 36 hours |

Fifteen minutes is the reviewer threshold because a queue younger than that is just a
normal queue. Anything shorter turns every submission into a warning.

### 7.3 Keys to add, in all three dictionaries

`overview.agents`, `overview.agentsHint`,
`agents.openclaw`, `agents.reviewer`, `agents.admin`,
`agents.ok`, `agents.warn`, `agents.off`, `agents.unknown`,
`agents.offHint`, `agents.reason`, `agents.gatewayHint`,
`agents.reviewHint`, `agents.oldest`, `agents.gaveUp`,
`agents.patrolHint`, `agents.unavailable`.

`admin/i18n.test.mjs` fails if the three files disagree, if a placeholder is missing from
one of them, or if a hardcoded Chinese string creeps back into `admin.js`.

No alert banner in this phase. Adding one before the thresholds have run teaches the owner
to ignore it.

## 8. Phase 5 — two changes outside the read path

Both are single files plus a few lines, and both are the only visible behaviour in the
plan.

### 8.1 Tell the owner, not only the author

`notifyReviewGaveUp` writes to `intel.account_id` and ends with "please contact an
administrator". The author cannot act on that.

Add one notification for the owner, `kind: "agent_review_stalled"`, deduplicated by the
`attempts` watermark. Design constraints that keep it safe:

- It runs only on the path that already reached "gave up", which is already rare.
- If the owner cannot be resolved, it does nothing and does not throw. Every existing fake
  pool in tests returns no rows for that query, so nothing breaks.
- `NOTICE_GROUPS` must gain the kind. `SYSTEM_KINDS` is derived from that map and filters
  the "latest few" subquery, so an unregistered kind is counted but never listed.
- `web/src/noticeText.js` needs a case, or the owner sees a generic body.
- No `href`. The console lives on the intranet address, so a link rendered on the public
  site would be a door that does not open. The body says where to look instead.
- `account.js` gains `ownerId(pool)`, and `listAgents` reuses it instead of inlining
  `SELECT id FROM accounts WHERE role = 'owner' LIMIT 1` a third time.

### 8.2 The brief for `main`

`main` is OpenClaw's own default agent. This does not touch `channels`, `auth`,
`gateway.auth`, or onboarding, and it is the only place the plan writes outside
repo-managed files, so it carries its own guards.

`apply-config.mjs` gains `main-brief`, implemented as pure functions
(`renderBrief(values)`, `patchAgentsBrief(existing, block)`) so it is testable without
`~/.openclaw`:

- Resolve the workspace from `config.agents.entries[id].workspace`, else from
  `bindings`, else from an existing `workspace-<id>` directory. Never assume
  `workspace-main`, never create a directory.
- Write `KNOT.md` (a file we own).
- Append the managed block to `AGENTS.md` only if it already exists. Before the first
  write, save `AGENTS.md.knot-before-brief` once if that backup does not already exist.
  Never delete anything.
- `--dry-run` prints the resolved workspace, the block, and whether a backup will be
  created, and writes nothing. Deploy calls it visible, so the log shows what happened.
- Unresolvable workspace, or `AGENTS.md` missing: skip with a warning, exit 0.

The block:

```markdown
<!-- knot:begin -->
## Knot
Read KNOT.md in this workspace: it maps the deployment root, where code, config,
data and logs live, and which read-only commands are safe. You do not administer
the site; knot-admin does. You are a side path: if you are down the site still runs.
<!-- knot:end -->
```

`KNOT.md` content, rendered with real values at sync time, paths only, no key, token, or
private address:

1. **Directory map** — deploy root, `current`, `releases/`, `sites/<site>/`,
   `var/uploads`, `var/log/*.log`, `var/run/*.json`, `~/.openclaw/workspace-*`, and the
   note that `sites/` sits outside the release and survives upgrades and rollbacks.
2. **What it may run** — read-only: `doctor.sh --site <site>`,
   `openclaw-check.sh`, `curl 127.0.0.1:<port>/api/health`, `openclaw agents list`,
   `openclaw gateway health`, `openclaw cron list`.
3. **What it must not do** — read `platform.env`, `xknot.env`, `tunnel.env`,
   `agents/*.local.env`, `.admin-token`, or `openclaw.json`; run deploy, reset, or restore;
   write to the database; delete posts or mute accounts on the owner's behalf; paste host
   paths into a chat.
4. **Routing and phrasing** — 502 means the tunnel checks. Review not moving means the
   agents block in `/admin`. And: before saying "the site is down", read `/api/health`.
   The common mistake is reporting a dead reviewer as a dead site.

## 9. Tests

Every file below is new, and every test runs without OpenClaw, without a live database,
and without `~/.openclaw`.

| File | Cases |
| --- | --- |
| `backend/src/agentReview.test.js` | empty table returns one row of nulls; all pending; retry cap reached; `detail` null; non-numeric `reviewAttempts` does not throw; a throwing query returns `ok:false` with nulls; the cache serves the second call without a second query |
| `backend/src/openclawStatus.test.js` | `statusFilePath` with and without `KNOT_DEPLOY_ROOT`, with and without `KNOT_AGENT_ENV_DIR`; no file; unparsable; unknown `state` value; `off`; fresh `degraded`; exactly at the age boundary; past it |
| `backend/src/routes/adminStatus.test.js` | 200 with nulls when both modules fail; 401 without a token; refused off-intranet; `Cache-Control: no-store` |
| `ops/scripts/openclaw-check.test.mjs` | binary absent → `off` rows, exit 0; gateway down → exit 0; `agents list` unparsable → exit 0; asserts the script contains no `exit 1` |
| `ops/openclaw/apply-config.test.js` (extend) | `renderSyncReport` shape; `writeSyncReport` is atomic and `0600`; `renderBrief` values; `patchAgentsBrief` replaces only the marked region; no markers means append-once; missing `AGENTS.md` means no write |
| `ops/openclaw/probe.test.mjs` | injected runner and temp dir: installed and not; gateway up and down; one agent missing; unparsable list; failed write; every case exits 0; reached through a symlink it still writes and still prints its verdict |
| `ops/scripts/direct-run.test.mjs` | no script under `ops/` or `backend/scripts/` decides "run directly" by comparing unresolved paths; the six shipped CLIs use the shared helper |
| `backend/src/intel.test.js` (extend) | the owner gets one notice per watermark; nobody to tell is `false`, not a throw; the owner who wrote the record is not told twice; a missing code is `null` |
| `web/src/noticeText.test.js` (extend) | a stalled review renders attempts, the last failure, and the "the site is fine" tail; a non-numeric count falls back to the stored text |
| `backend/src/intel.test.js` (extend) | the owner gets one notice per watermark; nobody to tell is `false`, not a throw; the owner who wrote the record is not told twice; a missing code is `null` |
| `web/src/noticeText.test.js` (extend) | a stalled review renders attempts, the last failure, and the "the site is fine" tail; a non-numeric count falls back to the stored text |
| `admin/i18n.test.mjs` (existing) | covers the new keys automatically |

Structural checks, cheap enough to keep as tests:

- `openclawStatus.js` does not import `agents/openclaw.js`.
- No new `INSERT` or `UPDATE` in any `/api/agent/*` handler.
- `deploy-site.sh`'s OpenClaw step and the new check call both tolerate failure.

## 10. Rollout and revert

| Phase | Ship by | Revert |
| --- | --- | --- |
| 1 | normal release; the endpoint is inert until something reads it | delete two files and one route block |
| 2 | normal release | delete `openclaw-check.sh`, two deploy lines, one `sync-report` branch |
| 3 | install the units; they are `\|\| true` | unload the unit, delete `var/run/openclaw-status.json`; the page falls back to `unknown` |
| 4 | ships with the page; static files only | revert `index.html` and one loader |
| 5 | owner notice, then the brief | notice: drop the call and `notifyOwnerReviewStalled`, the kind in `NOTICE_GROUPS`, and the locale keys; brief: restore `AGENTS.md.knot-before-brief`, delete `KNOT.md` and the block, drop the `main-brief` call in `ensure-openclaw.sh` |

After phases 1–2 are live, check on the real site:

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/api/admin/status | head -c 400
./ops/scripts/openclaw-check.sh; echo "exit=$?"          # must be 0
```

With the probe installed but stopped, the page must show `unknown` and no banner. That is
the single most important manual check in this plan: the failure mode of monitoring is
that it cries wolf.

## 11. Not doing

- No Prometheus, Grafana, or external service.
- No OpenClaw field in `/api/health`, and no effect on the federation roster.
- No synchronous CLI call inside a request handler.
- No presence column and no write on the agent request path; a read-only external agent
  has no presence signal, deliberately.
- No new daemon to query the database. The review numbers are cheap enough in process.
- No new configuration key and no new migration in any phase.
- No deployment that fails, rolls back, or stops the site because a probe failed.
- No whole-file replacement of `main`'s `AGENTS.md`; only the managed block, with a
  one-time backup.
- No self-test button (it is a business write and needs its own decision), no daily digest
  mail (the SMTP path exists for login keys), no alert banner yet.
