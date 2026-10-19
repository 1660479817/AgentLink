// 系统层开关。只有一行，读一次放在进程里，管理端改完立刻生效。
//
// 边界：这里只放「站点怎么开门」的开关。价格和费率在 economy_policy，
// 语言区域按访问地推断，上传大小在 multer 里，各自有各自的层，不混进来。

export const REGISTRATION_MODES = ["open", "invite", "closed"];

export function defaultSystemPolicy() {
  return {
    guestBrowsing: true,
    registrationMode: "open",
    publicBoard: true,
    updatedAt: null,
  };
}

let current = defaultSystemPolicy();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readSwitch(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return value === 1;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(text)) return true;
  if (["0", "false", "off", "no"].includes(text)) return false;
  throw fail("bad_switch");
}

function readMode(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!REGISTRATION_MODES.includes(text)) throw fail("bad_registration_mode");
  return text;
}

function normalize(policy) {
  return {
    guestBrowsing: Boolean(policy.guestBrowsing),
    registrationMode: REGISTRATION_MODES.includes(policy.registrationMode) ? policy.registrationMode : "open",
    publicBoard: Boolean(policy.publicBoard),
    updatedAt: policy.updatedAt || null,
  };
}

function stamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function installSystemPolicy(policy) {
  current = normalize(policy || {});
  return current;
}

export function resetSystemPolicy() {
  current = defaultSystemPolicy();
  return current;
}

export async function loadSystemPolicy(pool) {
  const { rows } = await pool.query(
    `SELECT guest_browsing, registration_mode, public_board, updated_at
     FROM system_policy WHERE id = 1`
  );
  if (!rows.length) return resetSystemPolicy();
  return installSystemPolicy({
    guestBrowsing: rows[0].guest_browsing,
    registrationMode: rows[0].registration_mode,
    publicBoard: rows[0].public_board,
    updatedAt: stamp(rows[0].updated_at),
  });
}

// 站内浏览：未登录也要停在登录/注册页时，这里是 false。
export function guestBrowsing() {
  return current.guestBrowsing;
}

export function registrationMode() {
  return current.registrationMode;
}

// 公开快照只在「站内可浏览」且「公开快照开着」时才有内容。
export function publicBoardEnabled() {
  return current.guestBrowsing && current.publicBoard;
}

// 返回给网页的公开部分。publicBoard 已经是最终是否可用的值。
export function siteConfig() {
  return {
    guestBrowsing: current.guestBrowsing,
    registrationMode: current.registrationMode,
    publicBoard: publicBoardEnabled(),
  };
}

// 返回给管理端，比网页多一个更新时间。
export function systemPolicyView() {
  return { ...siteConfig(), updatedAt: current.updatedAt };
}

export function parseSystemPatch(body) {
  const source = body && typeof body === "object" ? body : {};
  const patch = {};
  if (Object.hasOwn(source, "guestBrowsing")) patch.guestBrowsing = readSwitch(source.guestBrowsing);
  if (Object.hasOwn(source, "publicBoard")) patch.publicBoard = readSwitch(source.publicBoard);
  if (Object.hasOwn(source, "registrationMode")) patch.registrationMode = readMode(source.registrationMode);
  if (!Object.keys(patch).length) throw fail("bad_args");
  // 关掉站内浏览，公开快照跟着关，不留一个开不了的口子。
  if (patch.guestBrowsing === false) patch.publicBoard = false;
  return patch;
}

export async function saveSystemPolicy(pool, body) {
  const patch = parseSystemPatch(body);
  const next = { ...current, ...patch };
  const { rows } = await pool.query(
    `INSERT INTO system_policy (id, guest_browsing, registration_mode, public_board, updated_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE
       SET guest_browsing = EXCLUDED.guest_browsing,
           registration_mode = EXCLUDED.registration_mode,
           public_board = EXCLUDED.public_board,
           updated_at = now()
     RETURNING updated_at`,
    [next.guestBrowsing, next.registrationMode, next.publicBoard]
  );
  installSystemPolicy({ ...next, updatedAt: stamp(rows[0]?.updated_at) });
  return systemPolicyView();
}
