import assert from "node:assert/strict";
import test from "node:test";
import { economyReport, economySnapshot } from "./actuary.js";
import { PLATFORM_USER_ID } from "./points.js";

function poolReturning({ total, platform }) {
  const calls = [];
  return {
    calls,
    pool: {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [{ total: String(total), platform: String(platform) }],
        };
      },
    },
  };
}

test("issued is the whole balance; platform holdings split off circulation", async () => {
  // 发行 300，平台持有 120，流通 180。
  const snapshot = await economySnapshot(poolReturning({ total: 300, platform: 120 }).pool);
  assert.deepEqual(snapshot, { issued: 300, circulating: 180, platform: 120 });
});

test("signup and admin grants both count as issuance", async () => {
  // 200 开户赠送 + 50 管理员发放 = 发行 250；下载服务费 1 进平台，流通 249。
  const snapshot = await economySnapshot(poolReturning({ total: 250, platform: 1 }).pool);
  assert.equal(snapshot.issued, 250);
  assert.equal(snapshot.circulating, 249);
  assert.equal(snapshot.platform, 1);
  assert.equal(snapshot.issued, snapshot.circulating + snapshot.platform);
});

test("a grant-only platform still reads the grant as issuance", async () => {
  // 只有管理员发放 50，没有开户赠送：发行不能比流通小。
  const snapshot = await economySnapshot(poolReturning({ total: 50, platform: 0 }).pool);
  assert.deepEqual(snapshot, { issued: 50, circulating: 50, platform: 0 });
});

test("an empty platform reads zeros", async () => {
  const snapshot = await economySnapshot(poolReturning({ total: 0, platform: 0 }).pool);
  assert.deepEqual(snapshot, { issued: 0, circulating: 0, platform: 0 });
});

test("the platform row is the one it reads, and the ledger is not consulted", async () => {
  const { calls, pool } = poolReturning({ total: 1, platform: 0 });
  await economySnapshot(pool);
  assert.deepEqual(calls[0].params, [PLATFORM_USER_ID]);
  assert.match(calls[0].sql, /SUM\(points_balance\)/);
  assert.equal(calls[0].sql.includes("point_ledger"), false);
});

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
}

test("economy report prices a point in USD from the fixed platform rate", () =>
  withEnv({ KNOT_POINT_USD_CENTS: "1", KNOT_RECHARGE_USD: "0", KNOT_MONTHLY_OPEX_USD: "10000" }, async () => {
    // 每积分 1 美分 = 0.01 美元。
    const report = await economyReport(poolReturning({ total: 200000, platform: 2000 }).pool);
    assert.equal(report.currency, "USD");
    assert.equal(report.fiatPerPoint, 0.01);
    assert.equal(report.platformUsd, 20);
    assert.equal(report.rechargeUsd, 0);
    assert.equal(report.monthlyOpexUsd, 10000);
    assert.equal(report.breakeven, false);
    assert.equal(report.stage, "seeding");
  }));

test("the platform reaches breakeven once recharge covers monthly opex", () =>
  withEnv({ KNOT_POINT_USD_CENTS: "100", KNOT_RECHARGE_USD: "10000", KNOT_MONTHLY_OPEX_USD: "10000" }, async () => {
    // 每积分 1 美元，累计充值 1 万 = 月开支，正好平衡。
    const report = await economyReport(poolReturning({ total: 100, platform: 0 }).pool);
    assert.equal(report.fiatPerPoint, 1);
    assert.equal(report.breakeven, true);
    assert.equal(report.stage, "breakeven");
  }));

test("a growing platform has recharge below opex", () =>
  withEnv({ KNOT_RECHARGE_USD: "3000", KNOT_MONTHLY_OPEX_USD: "10000" }, async () => {
    const report = await economyReport(poolReturning({ total: 0, platform: 0 }).pool);
    assert.equal(report.breakeven, false);
    assert.equal(report.stage, "growing");
  }));
