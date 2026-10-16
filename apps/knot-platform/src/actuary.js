import { economyConfig, PLATFORM_USER_ID } from "./points.js";

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
