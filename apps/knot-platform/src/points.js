export const PLATFORM_USER_ID = "00000000-0000-4000-8000-000000000001";

function nonNegativeInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

// 环境变量是还没有价格表时的初值。精算师写入 economy_policy 后，
// 下面这八个键盖过环境变量，其余键仍只读环境变量。
const PRICE_KEYS = [
  "defaultPrice",
  "priceMin",
  "priceMax",
  "publishServiceFeePerMb",
  "downloadServiceFeePerMb",
  "serviceFeeCap",
  "pointUsdCents",
  "retrievalPrice",
];

let priceOverride = null;

export function installPriceOverride(schedule) {
  priceOverride = schedule ? Object.fromEntries(PRICE_KEYS.map((key) => [key, schedule[key]])) : null;
}

export function clearPriceOverride() {
  priceOverride = null;
}

function economyFromEnv() {
  let priceMin = nonNegativeInt(process.env.KNOT_PRICE_MIN, 0);
  let priceMax = nonNegativeInt(process.env.KNOT_PRICE_MAX, 100);
  if (priceMax < priceMin) priceMax = priceMin;
  let defaultPrice = nonNegativeInt(process.env.KNOT_DEFAULT_PRICE, 10);
  if (defaultPrice < priceMin) defaultPrice = priceMin;
  if (defaultPrice > priceMax) defaultPrice = priceMax;
  return {
    defaultPrice,
    priceMin,
    priceMax,
    signupGrant: nonNegativeInt(process.env.KNOT_SIGNUP_GRANT, 100),
    grantMax: nonNegativeInt(process.env.KNOT_GRANT_MAX, 100000),
    // 发布服务费：post/fastpost/wish/wishRespond 发布时按附件字节收，平台收（存储/传输）。每 MB x 积分，向上取整，封顶 serviceFeeCap。
    publishServiceFeePerMb: nonNegativeInt(process.env.KNOT_PUBLISH_SERVICE_FEE_PER_MB, 1),
    // 下载服务费：下载时按附件字节收，平台收（存储/传输），加在作者标价之上。每 MB y 积分，向上取整，封顶 serviceFeeCap。
    downloadServiceFeePerMb: nonNegativeInt(process.env.KNOT_DOWNLOAD_SERVICE_FEE_PER_MB, 1),
    // 服务费单次上限，避免大附件天价。0 表示不封顶。
    serviceFeeCap: nonNegativeInt(process.env.KNOT_SERVICE_FEE_CAP, 10),
    // 信息检索价：平台「信息检索员」每次检索的统一定价，下载检索结果时收。独立于作者标价。
    retrievalPrice: nonNegativeInt(process.env.KNOT_RETRIEVAL_PRICE, 10),
    // 第二期：只充值、不兑出。汇率是平台定价，盈亏平衡看现金流。
    // 每积分的美元价，用「美分」表示（1 = 0.01 美元），避免小数。
    pointUsdCents: nonNegativeInt(process.env.KNOT_POINT_USD_CENTS, 1),
    // 累计充值（美元）。本期没有真钱流入，占位 0；第三期从充值流水读。
    rechargeUsd: nonNegativeInt(process.env.KNOT_RECHARGE_USD, 0),
    // 月运营开支（美元）。动态值，初期以 1 万美金/月作为预算。
    monthlyOpexUsd: nonNegativeInt(process.env.KNOT_MONTHLY_OPEX_USD, 10000),
    // 消费券：独立于积分的一次性下载抵扣券，初期拉新用。
    // 面值（积分），默认等于 defaultPrice，正好抵扣一次标准下载。
    couponFace: nonNegativeInt(process.env.KNOT_COUPON_FACE, defaultPrice),
    // 有效期（天），过期作废。
    couponTtlDays: nonNegativeInt(process.env.KNOT_COUPON_TTL_DAYS, 30),
    // 每个 agent 同时持有的未使用、未过期券上限。
    couponMax: nonNegativeInt(process.env.KNOT_COUPON_MAX, 1),
    // 新注册是否自动发一张（1 开，0 关）。
    couponOnSignup: nonNegativeInt(process.env.KNOT_COUPON_SIGNUP, 1) > 0,
  };
}

export function economyConfig() {
  const config = economyFromEnv();
  if (!priceOverride) return config;
  const next = { ...config, ...priceOverride };
  if (process.env.KNOT_COUPON_FACE == null || String(process.env.KNOT_COUPON_FACE).trim() === "") {
    next.couponFace = next.defaultPrice;
  }
  return next;
}

export function pricePolicy() {
  const { priceMin, priceMax, defaultPrice } = economyConfig();
  return { min: priceMin, max: priceMax, defaultPrice };
}

export function signupGrant() {
  return economyConfig().signupGrant;
}

export function policyConfig() {
  const price = pricePolicy();
  const { publishServiceFeePerMb, downloadServiceFeePerMb, serviceFeeCap, retrievalPrice } = economyConfig();
  return {
    defaultPrice: price.defaultPrice,
    priceMin: price.min,
    priceMax: price.max,
    publishServiceFeePerMb,
    downloadServiceFeePerMb,
    serviceFeeCap,
    retrievalPrice,
  };
}

const MB = 1024 * 1024;

// 服务费：平台为存储/传输收取，按附件字节计价，每 MB 收 rate 积分，向上取整，封顶 cap。没有附件或费率为 0 时免费。
export function serviceFee(totalBytes, ratePerMb, cap) {
  const bytes = Number(totalBytes) || 0;
  const rate = Number(ratePerMb) || 0;
  const max = Number(cap) || 0;
  if (bytes <= 0 || rate <= 0) return 0;
  const units = Math.ceil(bytes / MB);
  const fee = units * rate;
  return max > 0 ? Math.min(fee, max) : fee;
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

// 平台服务价（信息检索）：平台统一定价，独立于作者标价的 min/max 区间。
export function servicePrice(raw) {
  if (raw == null || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    const error = new Error("bad_price");
    error.code = "bad_price";
    throw error;
  }
  return value;
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
