// 第一次接入 XKnot：问中枢一个二级域名能不能签，再把申请交上去。
//
// 端侧不复制中枢的签发规则。规则写两份，迟早会出现「本地说可以、提交却失败」，
// 那是最伤人的一种反馈。这里只做代理：请求原样转过去，结论原样转回来。
//
// 只在实例自己的管理页里用，走内网 /api/admin，不对外暴露。

const DEFAULT_HUB = "https://xknot.si";
const TIMEOUT_MS = 8000;

/** 中枢地址：接入件里有就用它，没有就用默认的联邦入口。 */
export function hubOriginOf({ hubOrigin, status } = {}) {
  const candidates = [hubOrigin, status?.running?.hubOrigin, process.env.KNOT_HUB_ORIGIN, DEFAULT_HUB];
  for (const value of candidates) {
    const text = String(value || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\/[^/]+/i.test(text)) return text;
  }
  return DEFAULT_HUB;
}

async function callHub(url, init, fetchImpl) {
  const response = await fetchImpl(url, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

function transportError(error) {
  const name = error?.name || "";
  if (name === "TimeoutError" || name === "AbortError") return "hub_timeout";
  return "hub_unreachable";
}

/**
 * @returns {{ ok: true, result: object } | { error: string, status?: number }}
 */
export async function checkSubdomain({ label, hubOrigin, fetchImpl = fetch } = {}) {
  const hub = hubOriginOf({ hubOrigin });
  const url = `${hub}/api/subdomains/check?label=${encodeURIComponent(String(label || ""))}`;
  try {
    const { status, data } = await callHub(url, { method: "GET", headers: { accept: "application/json" } }, fetchImpl);
    if (status === 429) return { error: "hub_rate_limited" };
    if (status !== 200 || !data || typeof data !== "object") return { error: "hub_error", status };
    return { ok: true, result: data };
  } catch (error) {
    return { error: transportError(error) };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function cut(value, max) {
  return [...String(value ?? "").trim()].slice(0, max).join("");
}

/**
 * 站点档案 → 中枢申请表。两边的字段名不一样，这里显式对一次：
 * owner → operator，contact → email（用户可以在管理页改）。
 * intro 在中枢那侧上限 60 字，超过就截断，不让中枢替我们拒绝。
 */
export function applicationPayload(site = {}, { subdomain = "", email = "", locale = "zh-CN" } = {}) {
  const region = String(site.region || "").trim().toUpperCase();
  return {
    name: cut(site.name, 40),
    mode: "subdomain",
    subdomain: cut(subdomain, 40).toLowerCase(),
    intro: cut(site.tagline || site.intro, 60),
    operator: cut(site.owner, 80),
    email: cut(email || site.contact, 120),
    region: /^[A-Z]{2}$/.test(region) ? region : "GLOBAL",
    timezone: cut(site.timezone, 40) || "UTC",
    tags: Array.isArray(site.tags) ? site.tags.join(", ") : "",
    agree: true,
    locale,
  };
}

// 本地先拦一眼，省一次往返；最终仍以中枢的校验为准。
export function missingFields(payload) {
  const missing = [];
  if (!payload.name) missing.push("name");
  if (!payload.operator) missing.push("operator");
  if (!EMAIL_RE.test(payload.email)) missing.push("email");
  if (!payload.intro) missing.push("intro");
  return missing;
}

/**
 * @returns {{ ok: true, application: object|null } | { error: string, fields?: object|string[] }}
 */
export async function submitApplication({ site, subdomain, email, locale, hubOrigin, fetchImpl = fetch } = {}) {
  const payload = applicationPayload(site, { subdomain, email, locale });
  const missing = missingFields(payload);
  if (missing.length) return { error: "incomplete", fields: missing };

  const hub = hubOriginOf({ hubOrigin });
  try {
    const { status, data } = await callHub(
      `${hub}/api/applications`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      fetchImpl
    );
    if (status === 201) return { ok: true, application: data?.application || null };
    if (status === 400) return { error: "invalid", fields: data?.fields || {} };
    if (status === 409) return { error: "duplicate" };
    if (status === 429) return { error: "rate_limited" };
    return { error: "hub_error", status };
  } catch (error) {
    return { error: transportError(error) };
  }
}
