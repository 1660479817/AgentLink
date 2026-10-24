import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  accumulate,
  emptyAggregate,
  finalizeAggregate,
  hostMapOf,
  logFiles,
  MAX_KEYS,
  mergeTraffic,
  parseLine,
  run,
  upstreamMs,
} from "./traffic.mjs";

const line = (overrides = {}) =>
  JSON.stringify({
    at: "2026-10-21T10:00:00+08:00",
    host: "wang.xknot.si",
    status: 200,
    method: "GET",
    uri: "/",
    bytes: 1024,
    requestTime: 0.042,
    upstreamTime: "-",
    cache: "",
    ip: "203.0.113.7",
    ua: "Mozilla/5.0 (Macintosh)",
    ref: "",
    ...overrides,
  });

test("parseLine: 一行 JSON 归一化，坏行返回 null", () => {
  const row = parseLine(line());
  assert.equal(row.host, "wang.xknot.si");
  assert.equal(row.date, "2026-10-21");
  assert.equal(row.bytes, 1024);
  assert.equal(row.requestMs, 42);
  assert.equal(row.upstreamMs, null);

  assert.equal(parseLine("not json"), null);
  assert.equal(parseLine(""), null);
  // 没有 host 或日期不是 ISO 的，一律丢掉。
  assert.equal(parseLine(line({ host: "" })), null);
  assert.equal(parseLine(line({ at: "" })), null);
});

test("upstreamMs: 多次回源取第一个数，'-' 当没有", () => {
  assert.equal(upstreamMs("0.128"), 128);
  assert.equal(upstreamMs("0.1, 0.2"), 100);
  assert.equal(upstreamMs("-"), null);
  assert.equal(upstreamMs(""), null);
  assert.equal(upstreamMs("bad"), null);
});

test("accumulate: 清单外的 host 只计数，不建节点", () => {
  const agg = emptyAggregate();
  const hostToId = hostMapOf({
    instances: [{ id: "wang", url: "https://wang.xknot.si" }],
  });
  assert.ok(accumulate(agg, parseLine(line()), hostToId));
  assert.equal(accumulate(agg, parseLine(line({ host: "evil.xknot.si" })), hostToId), null);
  assert.deepEqual([...agg.unknownHosts.entries()], [["evil.xknot.si", 1]]);
  assert.deepEqual([...agg.byId.keys()], ["wang"]);
});

test("accumulate: 304 的 0 字节仍算一次请求，缓存与状态各自归类", () => {
  const agg = emptyAggregate();
  const hostToId = hostMapOf({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] });
  accumulate(agg, parseLine(line({ status: 304, bytes: 0 })), hostToId);
  accumulate(agg, parseLine(line({ status: 200, cache: "HIT" })), hostToId);
  accumulate(agg, parseLine(line({ status: 500, cache: "MISS" })), hostToId);
  accumulate(agg, parseLine(line({ status: 404, cache: "BYPASS" })), hostToId);

  const [day] = finalizeAggregate(agg).get("wang");
  assert.equal(day.requests, 4);
  assert.equal(day.bytes, 3072);
  assert.deepEqual(day.status, { "1xx": 0, "2xx": 1, "3xx": 1, "4xx": 1, "5xx": 1, other: 0 });
  assert.deepEqual(day.cache, { hit: 1, miss: 1, bypass: 1, none: 1 });
});

test("finalizeBucket: 延迟取 p50/p95/max，爬虫占比与去重是近似值", () => {
  const agg = emptyAggregate();
  const hostToId = hostMapOf({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] });
  for (let i = 0; i < 10; i += 1) {
    accumulate(
      agg,
      parseLine(line({ requestTime: 0.01 * (i + 1), ip: `203.0.113.${i}`, ua: i === 0 ? "Googlebot/2.1" : "Mozilla/5.0" })),
      hostToId
    );
  }
  const [day] = finalizeAggregate(agg).get("wang");
  assert.equal(day.latency.samples, 10);
  assert.equal(day.latency.p50, 50);
  assert.equal(day.latency.p95, 100);
  assert.equal(day.latency.max, 100);
  assert.equal(day.uniqueApprox, 10);
  assert.equal(day.botShare, 0.1);
  // 同一路径重复出现只留一条，按次数排。
  assert.deepEqual(day.topPaths, [{ path: "/", requests: 10 }]);
});

test("mergeTraffic: 本次日志覆盖同一天，日志里没有的旧日期保留，只留最近 N 天", () => {
  const previous = {
    days: [
      { date: "2026-10-18", requests: 5 },
      { date: "2026-10-19", requests: 7 },
    ],
  };
  const next = mergeTraffic(previous, [{ date: "2026-10-19", requests: 99 }], {
    id: "wang",
    host: "wang.xknot.si",
    days: 2,
    now: new Date("2026-10-21T00:00:00Z"),
  });
  assert.deepEqual(
    next.days.map((day) => [day.date, day.requests]),
    [
      ["2026-10-19", 99],
      ["2026-10-18", 5],
    ]
  );
  assert.equal(next.updatedAt, "2026-10-21T00:00:00.000Z");
});

test("run: 读日志写 var/traffic/{id}.json；没有日志时安静跳过", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const instancesPath = path.join(dir, "instances.json");
  await writeFile(
    instancesPath,
    JSON.stringify({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] })
  );
  const logPath = path.join(dir, "knot-access.log");
  await writeFile(
    logPath,
    [
      line(),
      line({ uri: "/api/health", bytes: 200, upstreamTime: "0.01" }),
      line({ host: "unknown.xknot.si" }),
      "garbage",
    ].join("\n") + "\n"
  );

  const outDir = path.join(dir, "traffic");
  const result = await run({ logPath, outDir, instancesPath, now: () => new Date("2026-10-21T12:00:00Z") });
  assert.equal(result.written.length, 1);
  assert.equal(result.badLines, 1);
  assert.equal(result.dataDir, dir);
  assert.deepEqual(result.unknownHosts, { "unknown.xknot.si": 1 });

  const saved = JSON.parse(await readFile(path.join(outDir, "wang.json"), "utf8"));
  assert.equal(saved.host, "wang.xknot.si");
  assert.equal(saved.days[0].requests, 2);
  assert.equal(saved.days[0].upstream.requests, 1);

  const skipped = await run({
    logPath: path.join(dir, "missing.log"),
    outDir,
    instancesPath,
  });
  assert.equal(skipped.skipped, "no_log");
});

test("accumulate: 路径与 referer 的键数有上限，总量照常计", () => {
  const agg = emptyAggregate();
  const hostToId = hostMapOf({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] });
  for (let i = 0; i < MAX_KEYS + 500; i += 1) {
    accumulate(agg, parseLine(line({ uri: `/x${i}`, ref: `https://r${i}.test/` })), hostToId);
  }
  const bucket = agg.byId.get("wang").values().next().value;
  // 表有上限，但请求数与 topPaths 仍然是对的：扫描器撑不大这轮聚合的内存。
  assert.equal(bucket.paths.size, MAX_KEYS);
  assert.equal(bucket.referers.size, MAX_KEYS);
  assert.equal(bucket.requests, MAX_KEYS + 500);
});

test("mergeTraffic: days 不合法时按默认保留期，不把历史一次清空", () => {
  const previous = { days: [{ date: "2026-10-18", requests: 5 }] };
  const next = mergeTraffic(previous, [], { id: "wang", host: "wang.xknot.si", days: Number.NaN });
  assert.deepEqual(next.days.map((day) => day.date), ["2026-10-18"]);
});

test("run: --days 非法时抛错，已有历史保持原样", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const instancesPath = path.join(dir, "instances.json");
  await writeFile(instancesPath, JSON.stringify({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] }));
  const logPath = path.join(dir, "knot-access.log");
  await writeFile(logPath, `${line()}\n`);
  const outDir = path.join(dir, "traffic");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "wang.json"),
    JSON.stringify({ id: "wang", days: [{ date: "2026-10-19", requests: 1 }] })
  );

  await assert.rejects(() => run({ logPath, outDir, instancesPath, days: Number.NaN }), /--days/);
  const saved = JSON.parse(await readFile(path.join(outDir, "wang.json"), "utf8"));
  assert.deepEqual(saved.days.map((day) => day.date), ["2026-10-19"]);
});

test("run: 清单里的 id 拼不进目录，界外文件不会被写", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const instancesPath = path.join(dir, "instances.json");
  await writeFile(
    instancesPath,
    JSON.stringify({
      instances: [
        { id: "wang", url: "https://wang.xknot.si" },
        { id: "../../evil", url: "https://evil.xknot.si" },
      ],
    })
  );
  const logPath = path.join(dir, "knot-access.log");
  await writeFile(logPath, `${line()}\n${line({ host: "evil.xknot.si" })}\n`);

  const outDir = path.join(dir, "traffic");
  const result = await run({ logPath, outDir, instancesPath });
  assert.deepEqual(result.written.map((item) => item.id), ["wang"]);
  await assert.rejects(readFile(path.join(dir, "evil.json"), "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(dir, "traffic", "..", "..", "evil.json"), "utf8"), /ENOENT/);
});

test("run: 下架实例的聚合被清掉，无流量实例也按保留期裁剪", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const instancesPath = path.join(dir, "instances.json");
  await writeFile(
    instancesPath,
    JSON.stringify({
      instances: [
        { id: "wang", url: "https://wang.xknot.si" },
        { id: "cpswang", url: "https://cpswang.xknot.si" },
      ],
    })
  );
  const outDir = path.join(dir, "traffic");
  await mkdir(outDir, { recursive: true });
  // cpswang 这次没有任何日志：上次留下的天数超过保留期，只有写出一次才会被裁剪。
  await writeFile(
    path.join(outDir, "cpswang.json"),
    JSON.stringify({
      id: "cpswang",
      days: [
        { date: "2026-09-03", requests: 3 },
        { date: "2026-09-02", requests: 2 },
        { date: "2026-09-01", requests: 1 },
      ],
    })
  );
  // gone 已经从清单删掉。
  await writeFile(path.join(outDir, "gone.json"), JSON.stringify({ id: "gone", days: [] }));

  const logPath = path.join(dir, "knot-access.log");
  await writeFile(logPath, `${line()}\n`);
  await run({ logPath, outDir, instancesPath, days: 1, now: () => new Date("2026-10-21T12:00:00Z") });

  const trimmed = JSON.parse(await readFile(path.join(outDir, "cpswang.json"), "utf8"));
  assert.deepEqual(trimmed.days.map((day) => day.date), ["2026-09-03"]);
  await assert.rejects(readFile(path.join(outDir, "gone.json"), "utf8"), /ENOENT/);
});

test("logFiles: 带上最近三天的轮转档，跳过过旧与无关文件", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const logPath = path.join(dir, "knot-access.log");
  const older = path.join(dir, "knot-access.log-20261020");
  const gz = path.join(dir, "knot-access.log.1.gz");
  const stale = path.join(dir, "knot-access.log-20250101");
  for (const file of [logPath, older, gz, stale, path.join(dir, "other.log")]) {
    await writeFile(file, "");
  }
  const now = new Date("2026-10-22T02:00:00Z");
  await utimes(older, new Date("2026-10-21T00:00:00Z"), new Date("2026-10-21T00:00:00Z"));
  await utimes(gz, new Date("2026-10-21T12:00:00Z"), new Date("2026-10-21T12:00:00Z"));
  await utimes(stale, new Date("2025-01-02T00:00:00Z"), new Date("2025-01-02T00:00:00Z"));

  const files = await logFiles(logPath, { now });
  assert.deepEqual(files.map((file) => path.basename(file)), [
    "knot-access.log-20261020",
    "knot-access.log.1.gz",
    "knot-access.log",
  ]);
});

test("run: 轮转后的 .gz 归入各自的日期，不丢跨零点的请求", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const instancesPath = path.join(dir, "instances.json");
  await writeFile(instancesPath, JSON.stringify({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] }));
  const logPath = path.join(dir, "knot-access.log");
  const rotated = path.join(dir, "knot-access.log-20261021.gz");
  await writeFile(rotated, gzipSync(`${line({ at: "2026-10-21T23:59:00+08:00" })}\n`));
  await writeFile(logPath, `${line({ at: "2026-10-22T00:01:00+08:00" })}\n`);

  const outDir = path.join(dir, "traffic");
  const result = await run({ logPath, outDir, instancesPath, now: () => new Date("2026-10-22T02:00:00Z") });
  assert.equal(result.files, 2);

  const saved = JSON.parse(await readFile(path.join(outDir, "wang.json"), "utf8"));
  assert.deepEqual(
    saved.days.map((day) => [day.date, day.requests]),
    [
      ["2026-10-22", 1],
      ["2026-10-21", 1],
    ]
  );
});

test("run: 日志轮转后，只剩今天的行，旧日期从上次结果里延续", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const instancesPath = path.join(dir, "instances.json");
  await writeFile(instancesPath, JSON.stringify({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] }));
  const outDir = path.join(dir, "traffic");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "wang.json"),
    JSON.stringify({
      id: "wang",
      host: "wang.xknot.si",
      updatedAt: "2026-10-20T00:00:00.000Z",
      days: [{ date: "2026-10-19", requests: 40 }],
    })
  );

  const logPath = path.join(dir, "knot-access.log");
  await writeFile(logPath, `${line({ at: "2026-10-20T01:00:00+08:00" })}\n`);
  await run({ logPath, outDir, instancesPath, now: () => new Date("2026-10-20T02:00:00Z") });

  const saved = JSON.parse(await readFile(path.join(outDir, "wang.json"), "utf8"));
  assert.deepEqual(
    saved.days.map((day) => day.date),
    ["2026-10-20", "2026-10-19"]
  );
});

test("run: 日志在但一份都读不到时以失败退出，不拿昨天的数字当今天", async (t) => {
  // 2026-10-24 的现场：logrotate 把 knot-access.log 建成 0640 nginx:root，
  // 聚合以 ec2-user 跑，每小时 EACCES 一次。原来只是 log 一行、以 0 退出，
  // 于是把上一份聚合重写一遍，控制台看着正常，当天数据一条没进。
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const instancesPath = path.join(dir, "instances.json");
  await writeFile(instancesPath, JSON.stringify({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] }));
  // 存在，但读不开：拿目录当日志文件，读它是 EISDIR。
  const logPath = path.join(dir, "knot-access.log");
  await mkdir(logPath, { recursive: true });

  const outDir = path.join(dir, "traffic");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "wang.json"),
    JSON.stringify({ id: "wang", host: "wang.xknot.si", days: [{ date: "2026-10-20", requests: 9 }] })
  );

  const logged = [];
  await assert.rejects(
    () => run({ logPath, outDir, instancesPath, log: (line) => logged.push(line) }),
    /一份访问日志都读不到/
  );
  assert.match(logged.join("\n"), /读取失败/);
  // 上一次的聚合原样留着，没有被「本次 0 条」覆盖。
  const saved = JSON.parse(await readFile(path.join(outDir, "wang.json"), "utf8"));
  assert.deepEqual(saved.days, [{ date: "2026-10-20", requests: 9 }]);
});

test("run: 没有日志文件仍然安静跳过（入口还没装访问日志）", async (t) => {
  // 与上一条相反：文件根本不在，是「还没装」，不是「读不了」。
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-traffic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const instancesPath = path.join(dir, "instances.json");
  await writeFile(instancesPath, JSON.stringify({ instances: [{ id: "wang", url: "https://wang.xknot.si" }] }));
  const result = await run({ logPath: path.join(dir, "nope.log"), outDir: path.join(dir, "t"), instancesPath });
  assert.equal(result.skipped, "no_log");
});
