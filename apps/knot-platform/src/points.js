export const PLATFORM_USER_ID = "00000000-0000-4000-8000-000000000001";

function nonNegativeInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function positiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

export function feeConfig() {
  return {
    defaultPrice: nonNegativeInt(process.env.KNOT_DEFAULT_PRICE, 10),
    matchUnit: nonNegativeInt(process.env.KNOT_MATCH_UNIT, 1),
    listingFee: nonNegativeInt(process.env.KNOT_LISTING_FEE, 1),
    completionFee: nonNegativeInt(process.env.KNOT_COMPLETION_FEE, 1),
    signupGrant: nonNegativeInt(process.env.KNOT_SIGNUP_GRANT, 100),
  };
}

export function pricePolicy() {
  let min = nonNegativeInt(process.env.KNOT_PRICE_MIN, 0);
  let max = nonNegativeInt(process.env.KNOT_PRICE_MAX, 100);
  if (max < min) max = min;
  let defaultPrice = feeConfig().defaultPrice;
  if (defaultPrice < min) defaultPrice = min;
  if (defaultPrice > max) defaultPrice = max;
  return { min, max, defaultPrice };
}

export function policyConfig() {
  const price = pricePolicy();
  return {
    demandTtlHours: positiveInt(process.env.KNOT_DEMAND_TTL_HOURS, 24),
    matchLimit: positiveInt(process.env.KNOT_MATCH_LIMIT, 10),
    bountyMaxHours: positiveInt(process.env.KNOT_BOUNTY_MAX_HOURS, 72),
    defaultPrice: price.defaultPrice,
    priceMin: price.min,
    priceMax: price.max,
    listingFee: feeConfig().listingFee,
    completionFee: feeConfig().completionFee,
  };
}

export function packetPrice(fileCount, raw) {
  if (!fileCount) return 0;
  const { min, max, defaultPrice } = pricePolicy();
  if (raw == null || raw === "") return defaultPrice;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    const error = new Error("bad_price");
    error.code = "bad_price";
    throw error;
  }
  return value;
}

export async function getBalance(pool, userId) {
  const { rows } = await pool.query(`SELECT points_balance FROM users WHERE id = $1`, [userId]);
  return rows[0]?.points_balance ?? 0;
}

export async function applyPoints(client, { userId, delta, reason, refId = null }) {
  const { rows } = await client.query(
    `UPDATE users
     SET points_balance = points_balance + $2
     WHERE id = $1 AND points_balance + $2 >= 0
     RETURNING points_balance`,
    [userId, delta]
  );
  if (!rows.length) throw new Error("insufficient_points");
  await client.query(
    `INSERT INTO point_ledger (user_id, delta, reason, ref_id) VALUES ($1, $2, $3, $4)`,
    [userId, delta, reason, refId]
  );
  return rows[0].points_balance;
}

export async function adjustPoints(pool, entry) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const balance = await applyPoints(client, entry);
    await client.query("COMMIT");
    return balance;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
