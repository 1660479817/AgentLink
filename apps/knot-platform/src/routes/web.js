import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { listBounties, listBountyResponses, openBounty } from "../bounties.js";
import { informationOf, isAudioUpload, isVideoUpload, listedFiles, videosOf } from "../information.js";
import { createDemand, createIntel, downloadPacket, listDemands, listPublicIntel, presentIntel, searchPublicIntel, setIntelStar, stopDemand } from "../market.js";
import { attachmentDisposition } from "../packetZip.js";
import { normalizeEmail, normalizeLoginKey, redeemLoginKey, requestLoginKey } from "../login.js";
import { policyConfig } from "../points.js";
import { clearSessionCookie, setSessionCookie, SESSION_TTL_MS } from "../middleware/session.js";
import { acceptAvatar, ensureUploadDir, newStorageName, publicUploadUrl, storagePath } from "../uploads.js";

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
    audio: mime.startsWith("audio/") || isAudioUpload({ mime, originalname: row.original_name }),
  };
}

function httpError(res, error) {
  const code = error.code || error.message;
  if (code === "bad_video") return res.status(400).json({ error: "bad_video" });
  if (code === "bad_price") return res.status(400).json({ error: "bad_price" });
  if (code === "bad_public") return res.status(400).json({ error: "bad_public" });
  if (code === "nothing_to_download") return res.status(400).json({ error: "nothing_to_download" });
  if (code === "insufficient_points") return res.status(402).json({ error: "insufficient_points" });
  if (code === "packet_unavailable") return res.status(503).json({ error: "packet_unavailable" });
  if (code === "bad_state") return res.status(409).json({ error: "bad_state" });
  if (code === "not_found") return res.status(404).json({ error: "not_found" });
  console.error(error);
  return res.status(503).json({ error: "process_unavailable" });
}

function publicCard(row) {
  const granted = Boolean(row.granted);
  const info = informationOf({
    body: row.body,
    files: listedFiles(row.attachments || [], granted),
    videos: row.videos,
  });
  return {
    id: row.id,
    role: "intel",
    ...info,
    imageUrls: granted ? info.images.map((item) => item.url).filter(Boolean) : [],
    category: row.category || "",
    price: Number(row.price) || 0,
    granted,
    author: {
      name: row.display_name || "",
      avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
    },
    starred: Boolean(row.starred),
    public: row.is_public !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
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
    fileFilter: (_req, file, cb) => {
      if (isVideoUpload(file)) cb(new Error("bad_video"));
      else if (isAudioUpload(file)) cb(new Error("bad_audio"));
      else cb(null, true);
    },
  });

  const audioUpload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (isAudioUpload(file)) cb(null, true);
      else cb(new Error("bad_audio"));
    },
  });

  const router = Router();

  router.post("/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "bad_email" });
    const sent = await requestLoginKey(pool, email);
    if (sent.error) return res.status(sent.status).json({ error: sent.error });
    res.json({ ok: true });
  });

  router.post("/login/key", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const key = normalizeLoginKey(req.body?.key);
    if (!email) return res.status(400).json({ error: "bad_email" });
    if (!key) return res.status(400).json({ error: "bad_key" });
    const redeemed = await redeemLoginKey(pool, email, key);
    if (redeemed.error) return res.status(redeemed.status).json({ error: redeemed.error });
    const userId = redeemed.userId;
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
    const policy = policyConfig();
    if (!req.user) return res.json({ user: null, policy });
    const user = await loadUser(pool, req.user.id);
    res.json({ user, policy });
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
        const checked = await acceptAvatar(pool, uploadDir, req.user.id, raw);
        if (checked.error) return res.status(400).json({ error: checked.error });
        avatarId = checked.id;
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

  router.post("/audio", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    audioUpload.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        const code = err.message === "bad_audio" ? "bad_audio" : tooBig ? "file_too_large" : "upload_failed";
        return res.status(400).json({ error: code });
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

  router.post("/files", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    attachment.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        const known = err.message === "bad_video" || err.message === "bad_audio";
        const code = known ? err.message : tooBig ? "file_too_large" : "upload_failed";
        return res.status(400).json({ error: code });
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
    const audioIds = Array.isArray(req.body?.audioIds) ? req.body.audioIds.filter((id) => typeof id === "string") : [];
    const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.filter((id) => typeof id === "string") : [];
    let videos = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "videos")) {
      try {
        videos = videosOf(req.body.videos);
      } catch (error) {
        if (error.code === "bad_video") return res.status(400).json({ error: "bad_video" });
        throw error;
      }
    }
    if (!body && !imageIds.length && !fileIds.length && !audioIds.length && !videos.length) return res.status(400).json({ error: "empty_body" });
    try {
      const intel = await createIntel(pool, {
        userId: req.user.id,
        actor: "person",
        door: "webui",
        body,
        imageIds,
        audioIds,
        fileIds,
        videos,
        isPublic: req.body?.public,
        price: req.body?.price,
        bountyId: typeof req.body?.bountyId === "string" ? req.body.bountyId : null,
      });
      res.status(201).json({ intel });
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/submissions", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT id, body, videos, verdict, reject_reason, category, price, is_public, bounty_id, created_at, updated_at
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
      submissions.push(presentIntel({ ...row, files: attachments }));
    }
    res.json({ submissions });
  });

  router.get("/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ information: [] });
    const rows = await searchPublicIntel(pool, q, req.user?.id || null);
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.get("/bounties", async (req, res) => {
    res.json({ bounties: await listBounties(pool, req.user?.id || null) });
  });

  router.get("/bounties/:id/responses", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    const result = await listBountyResponses(pool, req.user.id, id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  router.post("/bounties", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    try {
      const result = await openBounty(pool, {
        userId: req.user.id,
        body: req.body?.body,
        hours: req.body?.hours,
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.status(201).json(result);
    } catch (error) {
      httpError(res, error);
    }
  });

  router.post("/intel/:id/download", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    try {
      const result = await downloadPacket(pool, req.user.id, id, uploadDir, { zip: true });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", attachmentDisposition(result.downloadName));
      res.setHeader("Content-Length", fs.statSync(result.zipPath).size);
      const stream = fs.createReadStream(result.zipPath);
      stream.on("error", () => {
        if (!res.headersSent) res.status(503).json({ error: "packet_unavailable" });
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/information", async (req, res) => {
    const rows = await listPublicIntel(pool, 30, req.user?.id || null);
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.post("/intel/:id/dismiss", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    const { rows } = await pool.query(`SELECT id FROM intel WHERE id = $1 AND verdict = 'passed' AND is_public`, [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    await pool.query(
      `INSERT INTO intel_dismissals (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, id]
    );
    res.json({ ok: true });
  });

  async function writeStar(req, res, starred) {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    try {
      res.json(await setIntelStar(pool, req.user.id, id, starred));
    } catch (error) {
      if (error.code === "not_found") return res.status(404).json({ error: "not_found" });
      console.error(error);
      res.status(500).json({ error: "internal" });
    }
  }

  router.post("/intel/:id/star", (req, res) => writeStar(req, res, true));
  router.delete("/intel/:id/star", (req, res) => writeStar(req, res, false));

  router.get("/stars", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT i.id, i.body, i.videos, i.price, i.category, i.user_id, i.is_public, i.created_at, i.updated_at, u.display_name, u.avatar_upload_id,
        TRUE AS starred,
        (i.user_id = $1 OR EXISTS (
          SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $1
        )) AS granted
       FROM intel_stars s
       JOIN intel i ON i.id = s.intel_id
       JOIN users u ON u.id = i.user_id
       WHERE s.user_id = $1 AND i.verdict = 'passed' AND i.is_public
         AND NOT EXISTS (
           SELECT 1 FROM intel_dismissals d
           WHERE d.intel_id = i.id AND d.user_id = s.user_id
         )
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
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
      httpError(res, error);
    }
  });

  router.get("/demands", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const demands = await listDemands(pool, req.user.id, "webui");
    res.json({ demands });
  });

  router.post("/demands/:id/stop", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    try {
      const demand = await stopDemand(pool, req.params.id, req.user.id);
      res.json({ demand });
    } catch (error) {
      if (error.code === "not_found") return res.status(404).json({ error: "not_found" });
      if (error.code === "not_open") return res.status(409).json({ error: "not_open" });
      console.error(error);
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/delegation", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(
      `INSERT INTO delegations (user_id, token_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()
       RETURNING created_at`,
      [req.user.id, tokenHash]
    );
    res.status(201).json({ token, createdAt: rows[0].created_at });
  });

  router.get("/delegation", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(`SELECT created_at FROM delegations WHERE user_id = $1`, [req.user.id]);
    res.json({ delegated: rows.length > 0, createdAt: rows[0]?.created_at ?? null });
  });

  router.delete("/delegation", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    await pool.query(`DELETE FROM delegations WHERE user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  });

  return router;
}
