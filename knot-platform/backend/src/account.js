// 账户与 Agent 的共用规则。数据库是最终裁判（见 migrations/001_accounts.sql），
// 这里只放应用层要反复用到的那几件：称呼与简介的校验、禁言状态、名额上限。

// 名额与库里的触发器保持一致。改了这里也要改迁移里的数字，
// 否则界面说的上限和真正拦住写入的上限会对不上。
export const AGENT_LIMIT = { owner: 10, user: 1 };
export const USER_LIMIT = 90;

const FOREVER_YEAR = 9999;

export function agentLimitOf(account) {
  return AGENT_LIMIT[account?.role] ?? 0;
}

export function muteState(value, now = new Date()) {
  if (value == null || value === "") return { muted: false, mutedUntil: null };
  const time = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(time.getTime()) || time.getTime() <= now.getTime()) {
    return { muted: false, mutedUntil: null };
  }
  if (time.getUTCFullYear() >= FOREVER_YEAR) return { muted: true, mutedUntil: null };
  return { muted: true, mutedUntil: time.toISOString() };
}

const SPECIALTY_MAX = 8;
const SPECIALTY_LEN = 20;
export const BIO_MAX = 200;
export const NAME_MAX = 40;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function bioText(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw fail("bad_bio");
  const text = value.replace(/\r\n?/g, "\n").trim();
  // 长度按码点算，和 displayNameText、库里 char_length 同口径。
  // 用 text.length 会把一个 emoji 记成 2：文档说「200 个字符」，11 个 emoji 的特长就会误判超限。
  if ([...text].length > BIO_MAX) throw fail("bad_bio");
  return text;
}

// 称呼：连续空白收成一个，首尾去掉，非空且不超过 40 个字（按码点算，和库里的 char_length 一致）。
export function displayNameText(value) {
  if (typeof value !== "string") throw fail("bad_name");
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > NAME_MAX) throw fail("bad_name");
  return text;
}

export function honorList(value) {
  const honors = value && typeof value === "object" && !Array.isArray(value) ? value.honors : null;
  if (!Array.isArray(honors)) return [];
  return honors.filter((item) => typeof item === "string" && item.trim());
}

export function storedSpecialties(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim());
}

export function specialtyList(value) {
  if (!Array.isArray(value)) throw fail("bad_specialty");
  const names = [];
  for (const item of value) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    // 与称呼、简介同一口径：按码点计，emoji 算一个字（S04-14）。
    if (!text || [...text].length > SPECIALTY_LEN || /[、,，]/.test(text)) throw fail("bad_specialty");
    if (!names.includes(text)) names.push(text);
  }
  if (names.length > SPECIALTY_MAX) throw fail("bad_specialty");
  return names;
}

// 发言前读一次作者行：既判禁言，也给出所属账号（钱包与好友关系都按账号算）。
// 账号被禁言时，它名下的 Agent 也一并停：否则换个门就能接着发。
export async function speakerAccount(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.role, a.owner_id, a.muted_until,
            p.muted_until AS owner_muted_until
       FROM accounts a
       LEFT JOIN accounts p ON p.id = a.owner_id
      WHERE a.id = $1`,
    [accountId]
  );
  const row = rows[0];
  if (!row) throw fail("not_found");
  if (muteState(row.muted_until).muted || muteState(row.owner_muted_until).muted) throw fail("muted");
  return row;
}
