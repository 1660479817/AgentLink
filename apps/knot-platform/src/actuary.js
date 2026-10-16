import { clearPriceOverride, economyConfig, installPriceOverride, PLATFORM_USER_ID } from "./points.js";

// 第一期只要三个数：发行、流通、平台。
//
// 发布服务费、下载付款都写两行，内部零和，不改变总余额；
// 开户赠送和管理员发放单边加钱。所以总余额就是平台发出去的积分，
// 其中一部分留在用户手里（流通），一部分被平台收回（平台余额）。
//
//   发行   = Σ 余额
//   流通   = Σ 余额 − 平台余额
//   平台   = 平台余额
//
// 三者满足 发行 = 流通 + 平台。
export async function economySnapshot(pool) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(points_balance) FROM users), 0)::bigint AS total,
       COALESCE((SELECT points_balance FROM users WHERE id = $1), 0)::bigint AS platform`,
    [PLATFORM_USER_ID]
  );
  const total = Number(rows[0].total);
  const platform = Number(rows[0].platform);
  return {
    issued: total,
    circulating: total - platform,
    platform,
  };
}

// 第二期：只充值、不兑出。钱单向流入，平台没有兑付义务。
//
// 汇率是平台定价：每积分多少美元，由 KNOT_POINT_USD_CENTS 固定（可随时改配置调价）。
//
// 盈亏平衡是现金流模型：
//   平台收到的钱 = 累计充值（rechargeUsd）
//   平台花的钱   = 运营开支（monthlyOpexUsd）
//   盈亏平衡     = 累计充值 ≥ 月运营开支
//
// 消费券（开户赠送）是平台的获客成本，体现在「发行」里，不占现金。
//
// 阶段：
//   seeding    — 累计充值 0，靠消费券拉新
//   growing    — 有充值但还没覆盖月开支
//   breakeven  — 累计充值 ≥ 月开支，里程碑达成
//   （scaling「扩展期」要月净流入 > 0，第三期有月流水后再判）
export async function economyReport(pool) {
  const { issued, circulating, platform } = await economySnapshot(pool);
  const { pointUsdCents, rechargeUsd, monthlyOpexUsd } = economyConfig();
  const fiatPerPoint = pointUsdCents / 100;
  const breakeven = rechargeUsd >= monthlyOpexUsd;
  const stage = rechargeUsd === 0 ? "seeding" : breakeven ? "breakeven" : "growing";
  return {
    issued,
    circulating,
    platform,
    currency: "USD",
    fiatPerPoint,
    rechargeUsd,
    monthlyOpexUsd,
    // 平台持有积分折合的美元（虚拟收入）：平台收回的积分按汇率计价。
    platformUsd: platform * fiatPerPoint,
    breakeven,
    stage,
  };
}

// 精算师负责的价格表。单条记录的标价仍由作者写。
// 提议先落在 price_proposals，主人同意后才写入 economy_policy，并盖过环境变量。
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEDULE_FIELDS = [
  { key: "defaultPrice", column: "default_price", max: 100_000 },
  { key: "priceMin", column: "price_min", max: 100_000 },
  { key: "priceMax", column: "price_max", max: 100_000 },
  { key: "publishServiceFeePerMb", column: "publish_service_fee_per_mb", max: 1_000 },
  { key: "downloadServiceFeePerMb", column: "download_service_fee_per_mb", max: 1_000 },
  { key: "serviceFeeCap", column: "service_fee_cap", max: 100_000 },
  { key: "pointUsdCents", column: "point_usd_cents", max: 100_000 },
];

const SCHEDULE_COLUMNS = SCHEDULE_FIELDS.map((field) => field.column).join(", ");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function parsePriceSchedule(body) {
  const source = body && typeof body === "object" ? body : {};
  const schedule = {};
  for (const field of SCHEDULE_FIELDS) {
    const raw = source[field.key];
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!/^(0|[1-9]\d*)$/.test(text)) throw fail("bad_price");
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value > field.max) throw fail("bad_price");
    schedule[field.key] = value;
  }
  if (schedule.priceMax < schedule.priceMin) throw fail("bad_price");
  if (schedule.defaultPrice < schedule.priceMin || schedule.defaultPrice > schedule.priceMax) throw fail("bad_price");
  return schedule;
}

function scheduleFromRow(row) {
  return Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field.key, Number(row[field.column])]));
}

export function envPriceSchedule() {
  const config = economyConfig();
  return Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field.key, config[field.key]]));
}

function proposalView(row) {
  return { id: row.id, ...scheduleFromRow(row), createdAt: row.created_at };
}

async function withClient(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // 已经回滚过时再回滚会失败，原错误仍然抛出。
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function loadEconomyPolicy(pool) {
  const { rows } = await pool.query(`SELECT ${SCHEDULE_COLUMNS} FROM economy_policy WHERE id = 1`);
  if (!rows.length) {
    clearPriceOverride();
    return null;
  }
  const schedule = scheduleFromRow(rows[0]);
  installPriceOverride(schedule);
  return schedule;
}

export async function priceSchedule(pool) {
  const { rows } = await pool.query(`SELECT ${SCHEDULE_COLUMNS} FROM economy_policy WHERE id = 1`);
  const pending = await pool.query(
    `SELECT id, ${SCHEDULE_COLUMNS}, created_at FROM price_proposals WHERE status = 'pending'`
  );
  if (!rows.length) {
    clearPriceOverride();
    return { source: "env", prices: envPriceSchedule(), pending: pending.rows[0] ? proposalView(pending.rows[0]) : null };
  }
  const prices = scheduleFromRow(rows[0]);
  installPriceOverride(prices);
  return { source: "policy", prices, pending: pending.rows[0] ? proposalView(pending.rows[0]) : null };
}

export async function proposePrices(pool, body) {
  const schedule = parsePriceSchedule(body);
  const values = SCHEDULE_FIELDS.map((field) => schedule[field.key]);
  const row = await withClient(pool, async (client) => {
    await client.query(`UPDATE price_proposals SET status = 'withdrawn' WHERE status = 'pending'`);
    const inserted = await client.query(
      `INSERT INTO price_proposals (${SCHEDULE_COLUMNS}, status)
       VALUES (${SCHEDULE_FIELDS.map((_, index) => `$${index + 1}`).join(", ")}, 'pending')
       RETURNING id, created_at`,
      values
    );
    return inserted.rows[0];
  });
  return { proposal: { id: row.id, ...schedule, createdAt: row.created_at } };
}

export async function applyPriceProposal(pool, id) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const schedule = await withClient(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT status, ${SCHEDULE_COLUMNS} FROM price_proposals WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) throw fail("not_found");
    if (rows[0].status !== "pending") throw fail("not_pending");
    const next = scheduleFromRow(rows[0]);
    const params = [...SCHEDULE_FIELDS.map((field) => next[field.key]), id];
    const assignments = SCHEDULE_FIELDS.map((field, index) => `${field.column} = $${index + 1}`).join(", ");
    await client.query(
      `INSERT INTO economy_policy (id, ${SCHEDULE_COLUMNS}, proposal_id, updated_at)
       VALUES (1, ${SCHEDULE_FIELDS.map((_, index) => `$${index + 1}`).join(", ")}, $${SCHEDULE_FIELDS.length + 1}, now())
       ON CONFLICT (id) DO UPDATE SET ${assignments}, proposal_id = $${SCHEDULE_FIELDS.length + 1}, updated_at = now()`,
      params
    );
    await client.query(`UPDATE price_proposals SET status = 'applied', applied_at = now() WHERE id = $1`, [id]);
    return next;
  });
  installPriceOverride(schedule);
  return { source: "policy", prices: schedule, proposalId: id };
}
