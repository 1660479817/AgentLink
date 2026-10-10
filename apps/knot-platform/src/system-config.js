const PLATFORM_KEY = "platform";

const DEFAULT_PLATFORM = {
  publicWebOrigin: "http://127.0.0.1:5173",
  smtp: {
    host: "",
    port: 465,
    secure: true,
    user: "",
    pass: "",
    from: "",
  },
};

let cache = null;
let cacheAt = 0;
const CACHE_MS = 15_000;

export async function loadPlatformSettings(pool) {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) {
    return cache;
  }
  const { rows } = await pool.query(
    "SELECT value FROM system_config WHERE key = $1",
    [PLATFORM_KEY]
  );
  const raw = rows[0]?.value;
  cache = mergePlatform(DEFAULT_PLATFORM, raw && typeof raw === "object" ? raw : {});
  cacheAt = now;
  return cache;
}

export function invalidatePlatformSettingsCache() {
  cache = null;
  cacheAt = 0;
}

export async function savePlatformSettings(pool, partial) {
  const current = await loadPlatformSettings(pool);
  const next = mergePlatform(current, partial);
  await pool.query(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [PLATFORM_KEY, JSON.stringify(next)]
  );
  invalidatePlatformSettingsCache();
  return next;
}

function mergePlatform(base, patch) {
  const smtp = { ...base.smtp, ...(patch.smtp || {}) };
  return {
    publicWebOrigin: patch.publicWebOrigin ?? base.publicWebOrigin,
    smtp,
  };
}

export function smtpFromPlatform(platform) {
  const s = platform.smtp || {};
  return {
    host: String(s.host || ""),
    port: Number(s.port || 587),
    secure:
      s.secure === true ? true : s.secure === false ? false : Number(s.port) === 465,
    user: String(s.user || ""),
    pass: String(s.pass || ""),
    from: String(s.from || s.user || "knot@localhost"),
  };
}

export function redactPlatformForLog(platform) {
  const smtp = { ...platform.smtp };
  if (smtp.pass) smtp.pass = "***";
  return { ...platform, smtp };
}
