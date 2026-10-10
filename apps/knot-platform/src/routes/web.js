import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { createDemand, createIntel, listDemands, listPublicIntel, presentIntel, searchPublicIntel } from "../market.js";
import { hashLoginKey, newLoginKey, normalizeEmail, normalizeLoginKey, sendLoginKey } from "../login.js";
import { clearSessionCookie, setSessionCookie, SESSION_TTL_MS } from "../middleware/session.js";
import { ensureUploadDir, newStorageName, publicUploadUrl, storagePath } from "../uploads.js";

const USER_COLUMNS = `id, email, display_name, avatar_upload_id, level, entitlements, points_balance`;

function presentUser(row) {
  const entitlements = row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {};
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
    level: row.level,
    entitlements,
    pointsBalance: row.points_balance,
  };
}

async function loadUser(pool, id) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? presentUser(rows[0]) : null;
}

function attachmentOf(row) {
  const mime = row.mime || "";
  return {
    id: row.id,
    name: row.original_name || "",
    mime,
    url: publicUploadUrl(row.id),
    image: mime.startsWith("image/"),
  };
}

function publicCard(row) {
  const attachments = row.attachments || [];
  return {
    id: row.id,
    role: "intel",
    body: typeof row.body === "string" ? row.body.trim() : "",
    imageUrls: attachments.filter((item) => item.image).map((item) => item.url),
    attachments,
  };
}

async function withUploads(pool, rows) {
  if (!rows.length) return rows;
  const { rows: files } = await pool.query(
    `SELECT f.intel_id, u.id, u.mime, u.original_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = ANY($1::uuid[])
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [rows.map((row) => row.id)]
  );
  const byId = new Map();
  for (const file of files) {
    const list = byId.get(file.intel_id) || [];
    list.push(attachmentOf(file));
    byId.set(file.intel_id, list);
  }
  return rows.map((row) => ({ ...row, attachments: byId.get(row.id) || [] }));
}

export function webRouter({ pool, sessionCookieName, uploadDir }) {
  ensureUploadDir(uploadDir);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
  });
  const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });
  const attachment = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const router = Router();

  router.post("/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "bad_email" });
    const recent = await pool.query(
      `SELECT 1 FROM login_keys WHERE email = $1 AND created_at > now() - interval '60 seconds' LIMIT 1`,
      [email]
    );
    if (recent.rowCount) return res.status(429).json({ error: "too_many" });
    const key = newLoginKey();
    const inserted = await pool.query(
      `INSERT INTO login_keys (email, key_hash, expires_at)
       VALUES ($1, $2, now() + interval '10 minutes')
       RETURNING id`,
      [email, hashLoginKey(key)]
    );
    try {
      await sendLoginKey(email, key);
    } catch (err) {
      await pool.query(`DELETE FROM login_keys WHERE id = $1`, [inserted.rows[0].id]);
      const code = err.code === "mail_unavailable" ? "mail_unavailable" : "mail_failed";
      return res.status(503).json({ error: code });
    }
    res.json({ ok: true });
  });

  router.post("/login/key", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const key = normalizeLoginKey(req.body?.key);
    if (!email) return res.status(400).json({ error: "bad_email" });
    if (!key) return res.status(400).json({ error: "bad_key" });
    const matched = await pool.query(
      `UPDATE login_keys
       SET used_at = now()
       WHERE id = (
         SELECT id FROM login_keys
         WHERE email = $1 AND key_hash = $2 AND used_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1
       )
       RETURNING id`,
      [email, hashLoginKey(key)]
    );
    if (!matched.rowCount) return res.status(400).json({ error: "bad_key" });
    const saved = await pool.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (lower(email)) WHERE email IS NOT NULL
       DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email]
    );
    const userId = saved.rows[0].id;
    const sid = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query(`INSERT INTO sessions (sid, user_id, expires_at) VALUES ($1, $2, $3)`, [
      sid,
      userId,
      expires,
    ]);
    setSessionCookie(res, sessionCookieName, sid);
    res.json({ user: await loadUser(pool, userId) });
  });

  router.get("/session", async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const user = await loadUser(pool, req.user.id);
    res.json({ user });
  });

  router.delete("/session", async (req, res) => {
    const sid = req.cookies?.[sessionCookieName];
    if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
    clearSessionCookie(res, sessionCookieName);
    res.json({ ok: true });
  });

  router.patch("/profile", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const hasName = typeof req.body?.displayName === "string";
    const name = hasName ? req.body.displayName.trim() : null;
    if (hasName && name.length > 40) return res.status(400).json({ error: "bad_name" });
    let avatarId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "avatarUploadId")) {
      const raw = req.body.avatarUploadId;
      if (raw === null || raw === "") {
        avatarId = null;
      } else {
        const { rows } = await pool.query(
          `SELECT id FROM uploads WHERE id = $1 AND user_id = $2 AND mime LIKE 'image/%'`,
          [raw, req.user.id]
        );
        if (!rows.length) return res.status(400).json({ error: "bad_avatar" });
        avatarId = rows[0].id;
      }
    }
    if (!hasName && avatarId === undefined) return res.status(400).json({ error: "empty_body" });
    const sets = ["updated_at = now()"];
    const params = [];
    if (hasName) {
      params.push(name);
      sets.push(`display_name = $${params.length}`);
    }
    if (avatarId !== undefined) {
      params.push(avatarId);
      sets.push(`avatar_upload_id = $${params.length}`);
    }
    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    res.json({ user: await loadUser(pool, req.user.id) });
  });

  router.post("/uploads", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message === "bad_mime" ? "bad_mime" : "upload_failed" });
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_name, mime) VALUES ($1, $2, $3) RETURNING id`,
      [req.user.id, req.file.filename, req.file.mimetype]
    );
    res.status(201).json({ id: rows[0].id, url: publicUploadUrl(rows[0].id) });
  });

  router.post("/files", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    attachment.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        return res.status(400).json({ error: tooBig ? "file_too_large" : "upload_failed" });
      }
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    const name = path.basename(req.file.originalname || "").slice(0, 180);
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_name, mime, original_name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, req.file.filename, req.file.mimetype, name || null]
    );
    res.status(201).json({
      id: rows[0].id,
      url: publicUploadUrl(rows[0].id),
      name,
      mime: req.file.mimetype,
    });
  });

  router.get("/uploads/:id", async (req, res) => {
    const { rows } = await pool.query(`SELECT storage_name, mime FROM uploads WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).end();
    const filePath = storagePath(uploadDir, rows[0].storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.type(rows[0].mime);
    fs.createReadStream(filePath).pipe(res);
  });

  router.post("/intel", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const imageIds = Array.isArray(req.body?.imageIds) ? req.body.imageIds.filter((id) => typeof id === "string") : [];
    const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.filter((id) => typeof id === "string") : [];
    if (!body && !imageIds.length && !fileIds.length) return res.status(400).json({ error: "empty_body" });
    try {
      const intel = await createIntel(pool, {
        userId: req.user.id,
        actor: "person",
        door: "webui",
        body,
        imageIds,
        fileIds,
      });
      res.status(201).json({ intel });
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.get("/submissions", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT id, body, verdict, reject_reason, created_at
       FROM intel
       WHERE user_id = $1 AND door = 'webui'
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    const submissions = [];
    for (const row of rows) {
      const files = await pool.query(
        `SELECT u.id, u.mime, u.original_name
         FROM intel_files f
         JOIN uploads u ON u.id = f.upload_id
         WHERE f.intel_id = $1
         ORDER BY f.sort_order`,
        [row.id]
      );
      const attachments = files.rows.map(attachmentOf);
      submissions.push({
        ...presentIntel(row),
        imageIds: attachments.filter((item) => item.image).map((item) => item.id),
        attachments,
      });
    }
    res.json({ submissions });
  });

  router.get("/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ information: [] });
    const rows = await searchPublicIntel(pool, q);
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.get("/information", async (_req, res) => {
    const rows = await listPublicIntel(pool, 30);
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.get("/notifications", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT id, kind, title, body, href, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({
      unread: rows.filter((row) => !row.read_at).length,
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        href: row.href,
        read: Boolean(row.read_at),
        createdAt: row.created_at,
      })),
    });
  });

  router.post("/notifications/read", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ ok: true });
  });

  router.post("/demands", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
    const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.filter((id) => typeof id === "string") : [];
    if (!brief && !fileIds.length) return res.status(400).json({ error: "empty_body" });
    try {
      const demand = await createDemand(pool, {
        userId: req.user.id,
        actor: "person",
        door: "webui",
        brief,
        citationLimit: req.body?.citationLimit,
        fileIds,
      });
      res.status(201).json({ demand });
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.get("/demands", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const demands = await listDemands(pool, req.user.id, "webui");
    res.json({ demands });
  });

  router.post("/delegation", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO delegations (user_id, token_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()`,
      [req.user.id, tokenHash]
    );
    res.status(201).json({ token });
  });

  router.get("/delegation", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(`SELECT 1 FROM delegations WHERE user_id = $1`, [req.user.id]);
    res.json({ delegated: rows.length > 0 });
  });

  router.delete("/delegation", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    await pool.query(`DELETE FROM delegations WHERE user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  });

  return router;
}
