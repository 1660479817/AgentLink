// 每个 VU 一份身份。k6 的 __VU 在 init 阶段是 0，所以只能在 default 里调用这里。
//
// 为什么要按 VU 分身份：检索限流按「一个身份每分钟 120 次」算，匿名按 IP、Agent 按账号。
// 压测里所有 VU 共用一个出口 IP 或一个授权码时，它们其实是一个人；前几档把额度用完后，
// 后一档会成片 429，看起来像「间歇错误」。分身份以后，每一档测到的才是并发能力。
//
// 三种身份来源，优先级从高到低：
//   1. BENCH_COOKIES：每行一个 Cookie 头（如 knot_sid=...），VU 按序号取；
//   2. BENCH_IDENTITY=xff：每个 VU 带一个不同的 X-Forwarded-For。
//      只在直连源站、或代理明确信任并透传 XFF 时有效；公网入口的 nginx 会把真实 IP
//      追加在右边，Backend 只信一跳，所以从公网打 XFF 不会换身份。
//   3. 都没有：所有 VU 共享一个身份，报告里会提示 429 风险。
//
// Agent 场景用 KNOT_AGENT_TOKENS（每行/逗号一个），VU 按序号取；只有一份就是共享。

export function parseIdentityText(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("#"));
}

export function pickByVu(list, vu) {
  if (!Array.isArray(list) || !list.length) return "";
  const index = Math.max(1, Number(vu) || 1) - 1;
  return list[index % list.length];
}

// 198.18.0.0/15 是 RFC 2544 的基准测试保留段，不会和真实用户撞地址。
export function xffForVu(vu) {
  const index = Math.max(1, Number(vu) || 1) - 1;
  return `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
}

export function identityConfig(env = {}) {
  return {
    cookies: parseIdentityText(env.BENCH_COOKIES),
    tokens: parseIdentityText(env.KNOT_AGENT_TOKENS),
    mode: String(env.BENCH_IDENTITY || "shared").toLowerCase(),
  };
}

export function webHeaders(config, vu) {
  const headers = {};
  const cookie = pickByVu(config.cookies, vu);
  if (cookie) headers.Cookie = cookie;
  else if (config.mode === "xff") headers["X-Forwarded-For"] = xffForVu(vu);
  return headers;
}

export function agentHeaders(config, vu, fallbackToken = "") {
  const token = pickByVu(config.tokens, vu) || String(fallbackToken || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
