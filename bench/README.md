# *.xknot.si personal sites · access speed measurement

**Black box. The only premise is that you hold a `https://<label>.xknot.si` address.**

It reads no site config, imports neither project's code, and assumes nothing about whose machine it runs on. Give it a subdomain and it finds out on its own what this site is, what it can measure, and which hop of the path it runs over. So the same scripts can directly cross-compare `wang.xknot.si`, `cpswang.xknot.si`, and any subdomain issued in the future.

It lives at the repo root because what it measures is "one subdomain", belonging to neither `knot-platform` nor `xknot.si`: no matter who implements the instance, the tool needs no change. Not a single line in this directory depends on the paths or configs of those two projects.

## What it answers

| Question | Who answers |
| --- | --- |
| What state is this site in right now (version, snapshot size, TLS, compression, whether the entry leaks the admin backend) | `scripts/probe.mjs` |
| How long one person waits to open each page | `human/visitor.mjs` (real Chromium, 1 user) |
| What happens as concurrency rises, and which hop is slow | `k6/` (5 / 10 / 20 / 30 / 50 / 100) |
| Whether the same site got better or worse two weeks later | two summaries in `results/` compared side by side |

Access speed in this system is at least three hops; numbers mixed together can't guide optimization:

| Hop | Path | Decided by |
| --- | --- | --- |
| Entry static | `/`, `/assets/*`, `/discover.json` | entry-host nginx, gzip, HTTP/2, Cloudflare, certificates |
| Entry → origin | `/api/*` through the SSH reverse tunnel | cross-ocean link, keepalive, tunnel reuse |
| Origin | backend + Postgres | Node, connection pool, SQL, review queue |

Every line in the report carries its measurement point. Numbers from origin-direct and public-subdomain **cannot be compared directly** — the former has no tunnel and no TLS.

## Directory

```text
bench/
├── scripts/probe.mjs        black-box probe: capabilities, path, version, snapshot size
├── scripts/compare.mjs      compare several subdomains side by side (GET only), or compare two finished runs
├── human/visitor.mjs        a real Chromium walks all pages
├── k6/read.js               unauthenticated visitor: shell + snapshot + Web API
├── k6/agent-read.js         an Agent read round with Bearer
├── k6/write.js              post / upload / delete (off by default)
├── k6/lib/probe.js          one metric group per endpoint ep_<name>_ms / _err / _throttled / _bad_body
├── lib/                     shared by k6 and scripts: static-asset regex, origin-direct detection, CLI arg parsing
├── scripts/run.mjs          probe → pick scenarios by capability → schedule k6 by gradient
├── scripts/report.mjs       render the summary into markdown
├── scripts/make-image.mjs   generate the PNG for upload
└── results/<time>/          probe.json, summary.md/json, raw/, human.*, screenshots
```

`results/latest` points at the most recent `run.mjs`; `results/latest-human` points at the most recent `human/visitor.mjs`.

`lib/` is the part shared by k6 and the node scripts: `assets.js` extracts the built asset addresses from index.html, `net.mjs` decides "is this origin-direct", `cli.mjs` parses command-line args. When a value is missing after a `--name`, these scripts exit with code 2 instead of substituting a default — otherwise that round's numbers aren't what its parameters claim.

## Prepare

```bash
brew install k6
npm install && npx playwright install chromium
```

## Usage

```bash
# First see what this site is
npm run probe -- https://wang.xknot.si

# Compare several sites side by side (GET only, a few seconds)
npm run compare -- wang.xknot.si cpswang.xknot.si

# Human: mobile + desktop, 3 rounds each, take the median
npm run human -- --base https://wang.xknot.si

# Concurrency: visitor + agent, six tiers from 5→100, 30s per tier
KNOT_AGENT_TOKEN=... npm run load -- --base https://wang.xknot.si
# or read from a file, to keep it out of shell history
npm run load -- --base https://wang.xknot.si --token-file ~/.knot/wang-agent.env

# One identity per VU: search throttling is per person; sharing one cookie / one code turns into mass 429s
npm run load -- --base https://wang.xknot.si --cookies-file ~/.knot/cookies.txt
npm run load -- --base https://wang.xknot.si --scenario agent --token-file ~/.knot/agent-tokens.txt

# Quick check, one tier only
npm run load -- --base https://wang.xknot.si --levels 2,4 --duration 5s --cooldown 2

# Two finished runs side by side
npm run compare -- --runs results/2026-10-23T01-36-11,results/2026-11-01T09-00-00
```

`npm run compare` without `--runs`: the positional args are the subdomains to compare; adding `--with-token` also asks once for an Agent identity (read from `KNOT_AGENT_TOKEN`).

Common args:

| Arg | Default | Notes |
| --- | --- | --- |
| `--base` | none (required) | `https://<label>.xknot.si` |
| `--levels` | `5,10,20,30,50,100` | concurrency gradient |
| `--duration` | `30s` | steady-state duration per tier |
| `--cooldown` | `15` | cooldown between tiers, waiting for pools and queues to settle |
| `--scenario` | `read,agent` | `read` / `agent` / `write`, comma-separated |
| `--token-file` | none | one Agent auth code per line (`KNOT_AGENT_TOKENS` is synonymous, newline or comma separated); when a single one, all VUs share it |
| `--cookies-file` | none | one Cookie header per line, distributed round-robin by VU; `BENCH_COOKIES` also works |
| `--identity` | `shared` | `xff`: one `X-Forwarded-For` per VU, only effective against origin-direct or a proxy that trusts and forwards XFF |
| `--label` | none | name this round (written into the report) |
| `--viewport` | `both` | the human layer: `mobile` / `desktop` / `both` |
| `--cookie-file` | none | the human layer carries a session (one line `knot_sid=...`), runs logged-in pages |
| `--cookie` | none | same, but the session shows up in `ps` and shell history; only for ad-hoc debugging |

Each scenario first runs a 1 VU × 5s warm-up; warm-up results are not written to the report. What it warms is the server side (cache, connection pool, tunnel) and the entry host's session cache, **not client connections**: each tier is a fresh k6 process and all keep-alive connections are rebuilt, so each tier still has a batch of cold-connection samples mixed into p95. The only way to eliminate that is to put all tiers into one k6 process (stages of one scenario), which then loses inter-tier cooldown and per-tier failure isolation.

## Probe: what can be measured is told by the site itself

`npm run probe -- <base>` sends GET only, changes no data, and outputs:

| Item | Source | What it's for |
| --- | --- | --- |
| Path | TLS handshake | protocol version, ALPN, certificate days remaining |
| Main bundle | the `/assets/*.js` in the home HTML | byte size, whether gzip, whether immutable |
| Instance | `GET /api/health` | site name, version, release, commit, build time |
| Home | `GET /` | time to first byte, total download bytes, title, whether it has a noscript fallback |
| Snapshot | `GET /discover.json` | item count, with-image count, with-attachment count, author count, site switches |
| Session | `GET /api/web/session` | brand, default locale, guest browsing, registration mode |
| Agent | `GET /api/agent/profile` (with code) | identity, credits |
| Leak | `GET /admin`, `GET /api/admin/posts` | the public entry shouldn't pass these through; if it does, report it |
| Routes | candidate paths one by one with GET | only check "does it return the app shell" |

Conclusions are written into each run's `probe.json`; the report opens with a "Site" table. Two subdomains differ today:

| | wang.xknot.si | cpswang.xknot.si |
| --- | --- | --- |
| ALPN | h2 | http/1.1 |
| Main bundle | 68KB · gzip | 110KB · **uncompressed** |
| Home | 2284B · has noscript fallback | 635B · pure shell |
| Snapshot | 30 items | 3 items |

These items show the difference without any load test, and shouldn't wait until the p95 looks bad to be discovered.

### Capability bits decide what runs

After the probe concludes, `run.mjs` runs only scenarios the site supports and for which you hold credentials; the rest go into "not tested this round" with the reason:

| Capability | Criterion | When unmet |
| --- | --- | --- |
| `webApi` | `GET /api/web/session` is 200 | skip guest reads |
| `agentApi` | code provided and `GET /api/agent/profile` is 200 | skip Agent reads |
| write | the two above pass, plus explicit `--allow-writes` | skip writes |

A scenario the site doesn't recognize won't fail the whole round; it just quietly loses a line, with the reason written in the report.

## Scenario mix

**One visitor iteration = opening `/discover` to view one card**:

| Request | Frequency | Notes |
| --- | --- | --- |
| `GET /` | every time | entry disk |
| `GET /discover.json` | every time | first-screen snapshot, entry disk |
| `GET /api/web/session` | every time | through the tunnel |
| `GET /api/web/home` | every time | through the tunnel, `no-store` |
| `GET /api/web/information` | every time | through the tunnel |
| `GET /api/web/intel/:id` | every time | pick one at random from the snapshot |
| `GET /api/web/search` | 1/3 | search one topic word from the snapshot |
| `GET /api/web/sponsors` | 1/10 | |
| `GET /assets/*` | 1/20 | simulate a browser cache miss |

Think time 1–3 seconds. **The concurrency number is "people watching at the same time", not "requests per second".**

This request set is not read-only on the server: card detail writes `intel_reads` (deduped per person per card), search writes `search_events` (cache hits still counted, not deduped). The measured p95 includes the cost of these INSERTs; to look at the query alone, test against an account with no read records or an empty database.

**One Agent round**: `profile`, `notifications`, `information`, `intel/:id` once each; `search` 1/3; `requests` 15%. Round interval 0.3–1s. All with `Authorization: Bearer`.

**Write scenario** (off by default): post one `public: false` post → view one public card → delete it immediately; every 5th time also upload a 640×480 PNG. Using post instead of wish is because `DELETE /intel/:id` only accepts post / fastpost; `public: false` keeps it out of the feed and snapshot.

## Identity and throttling

Search throttling is "120 per person per minute": visitors by account or IP, agents by account. In a load test, when all VUs share one egress IP or one auth code, they are effectively one person; once the previous tier exhausts the quota, the next tier becomes a wall of 429s, looking like "intermittent errors". So:

- Public entry: use `--cookies-file` to give each VU a login cookie. The entry nginx appends the real IP to the right of `X-Forwarded-For`; forging XFF from the public internet won't change identity.
- Origin-direct: `--identity xff` gives each VU a `198.18.x.x` (RFC 2544 benchmark range), never touching real users.
- Agent: `--token-file` one auth code per line (`KNOT_AGENT_TOKEN=...` or a bare code), or `KNOT_AGENT_TOKENS` (newline/comma separated). If there are fewer identities than the max concurrency, the script warns before starting.

429 is not a service error: `ep_<name>_throttled` is recorded separately, and both `ep_<name>_err` and `ep_<name>_ms` exclude it; the report has a "throttle rate" column. When the throttle rate is non-zero, first check whether identities are separated, then the instance's `KNOT_SEARCH_RATE_PER_MIN`.

## Metrics and verdicts

Each endpoint has four independent metrics: `ep_<name>_ms` (Trend, only un-throttled requests), `ep_<name>_err` (Rate, excluding 429), `ep_<name>_throttled` (Rate, 429 share), `ep_<name>_bad_body` (Rate, 2xx but the body doesn't match expectations, a subset of `_err`); plus `served_ms` aggregating all requests actually served. The report produces a p95 matrix by "endpoint × concurrency".

Success isn't just the status code: endpoints declaring `expect: "json"` require `Content-Type` to contain json, to parse as an object, and to have no `error` field. The entry maintenance page, the SPA fallback page, and `200 {"error": …}` are all recorded as failures, listed separately in the report as "body didn't match expectations". Static endpoints (`/`, `/assets/*`) still look only at the status code.

The acceptance lines are in `scripts/report.mjs`'s `LIMITS`:

| Item | Line |
| --- | --- |
| Read endpoint p95 | ≤ 1000ms |
| Write endpoint p95 | ≤ 2000ms |
| Error rate | ≤ 1% (writes 2%) |

Items over the line are listed one by one at the end of the report. These are this deployment's acceptance lines, not an industry standard; to change them, change `LIMITS`, don't hand-edit the report.

`run.mjs` has only three exit codes; don't treat 0 as "all passed":

| Exit code | Meaning |
| --- | --- |
| 0 | all tiers ran, no over-line items, write scenario left no records |
| 1 | some tier failed (including k6 exit 0 but no export file written), or the write scenario left records; k6 not found is also 1 |
| 2 | bad arguments (missing `--base`, no value after `--name`) |

Over-line items themselves don't change the exit code — the verdict is written in the report, `LIMITS` is this deployment's standard, and a CI that wants to gate should read `summary.json` itself.

## The price of a black box, stated plainly

| Matter | What the black box can do | What it can't |
| --- | --- | --- |
| Identity | `/api/health` gives site name, version, commit | doesn't read the deploy directory, doesn't know which machine it runs on |
| Data scale | the item count in `/discover.json` is exact | the DB total and private-post count are known only to the instance |
| Pages | a real browser opens and sees whether it's bounced back to login | doesn't read the front-end route table; "does this page exist" is judged by actual behavior |
| Cache | can see the main bundle's `immutable` and compression; card images go through the entry cache, the script deliberately doesn't request them | can't actively clear the entry cache; within 1 day of takedown the old image may still hit; `X-Knot-Cache` isn't counted separately |
| Writes | can write, can delete its own, can see whether deletion failed | can't check the DB to confirm no trace; a failed deletion leaves one private record, reported separately as `ep_write_delete_err` |

Auth codes and session cookies are read only from environment variables or explicit `--token-file` / `--cookies-file` / `--cookie-file`, never printed, never written to disk. `scripts/probe.mjs --token` and `human/visitor.mjs --cookie` still work, but the session shows up in `ps` and shell history — don't treat them as the regular way. `probe.json` and `summary.json` contain only `token: true/false` and identity counts. The PNG for upload is generated on the spot by `scripts/make-image.mjs` and does not enter version control.

## How to read

1. Only **same machine, same site, same data volume** is comparable. Change the load machine or the snapshot size and the numbers are a different set.
2. Concurrency up, p95 doubles, error rate rises: the bottleneck is the tunnel or the backend pool, not the front end.
3. Static endpoints slow but `/api` fine: an entry or bandwidth problem; first look at the "main bundle / compression" line in the probe.
4. The first request of each iteration is usually 200–300ms slower than the rest: `keepalive_timeout` 4s is shorter than human think time, so every page view rebuilds the connection. This is the entry's design tradeoff; know that it's in there when measuring.
5. When the snapshot has only a few posts, what you measure is transfer and framework overhead, not the database. To test the DB, first put a few hundred posts on the site, or measure against the local origin directly.
6. The human layer starts a new browser context each round (empty HTTP cache), so the first request is a cold cache; subsequent pages in the same context reuse resources.

## Relation to `ops/scripts/speed-check.sh`

That script is layer 0: curl a few addresses in sequence and take the median, answering "does it pass after deploy, and roughly how many milliseconds". Keep it on hand. These three layers here answer "what happens as concurrency rises, which hop is slow, and which config of the site fell behind". The two don't overlap.
