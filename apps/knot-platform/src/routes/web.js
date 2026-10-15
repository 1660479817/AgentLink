import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { isAudioUpload, isVideoUpload, MAX_AUDIO, MAX_FILES, MAX_IMAGES, videosOf } from "../information.js";
import { readMedia } from "../links.js";
import { FRIEND_COLUMNS, listFriends, removeFriend, setCardFriend } from "../friends.js";
import { createIntel, downloadPacket, listPublicIntel, presentIntel, searchPublicIntel, setIntelStar } from "../market.js";
import { listNotifications, markNotificationsRead } from "../notifications.js";
import { listLooks, listMyResponses, listRequestResponses, listRequests, lookRequest } from "../requests.js";
import { attachmentDisposition } from "../packetZip.js";
import { normalizeEmail, normalizeLoginKey, redeemLoginKey, requestLoginKey } from "../login.js";
import { muteState } from "../account.js";
import { policyConfig } from "../points.js";
import { clearSessionCookie, setSessionCookie, SESSION_TTL_MS } from "../middleware/session.js";
import { ensureCardPreview, previewReadable } from "../preview.js";
import { listPublicSponsors } from "../sponsors.js";
import { acceptAvatar, ensureUploadDir, newStorageName, publicUploadUrl, storagePath } from "../uploads.js";

const USER_COLUMNS = `id, email, display_name, avatar_upload_id, level, entitlements, points_balance, muted_until`;

function presentUser(row) {
  const entitlements = row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {};
  const mute = muteState(row.muted_until);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
    level: row.level,
    entitlements,
    pointsBalance: row.points_balance,
    muted: mute.muted,
    mutedUntil: mute.mutedUntil,
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
  if (code === "bad_url") return res.status(400).json({ error: "bad_url" });
  if (code === "bad_price") return res.status(400).json({ error: "bad_price" });
  if (code === "bad_public") return res.status(400).json({ error: "bad_public" });
  if (code === "nothing_to_download") return res.status(400).json({ error: "nothing_to_download" });
  if (code === "insufficient_points") return res.status(402).json({ error: "insufficient_points" });
  if (code === "packet_unavailable") return res.status(503).json({ error: "packet_unavailable" });
  if (code === "bad_state") return res.status(409).json({ error: "bad_state" });
  if (code === "muted") return res.status(403).json({ error: "muted" });
  if (code === "bad_mention") return res.status(400).json({ error: "bad_mention" });
  if (code === "not_found") return res.status(404).json({ error: "not_found" });
  console.error(error);
  return res.status(503).json({ error: "process_unavailable" });
}

const INTEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicCard(row) {
  return {
    role: "intel",
    ...presentIntel({
      ...row,
      files: row.attachments || [],
      granted: Boolean(row.granted),
    }),
    friend: Boolean(row.friend),
    canFriend: Boolean(row.can_friend),
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
    const { rows } = await pool.query(
      `SELECT u.storage_name, u.mime, u.user_id,
              EXISTS (SELECT 1 FROM users p WHERE p.avatar_upload_id = u.id) AS avatar,
              EXISTS (SELECT 1 FROM sponsors s WHERE s.image_upload_id = u.id) AS sponsor
       FROM uploads u
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    const row = rows[0];
    const owner = Boolean(req.user && req.user.id === row.user_id);
    const image = String(row.mime || "").startsWith("image/");
    if (image && !row.avatar && !row.sponsor && !owner) return res.status(404).end();
    const filePath = storagePath(uploadDir, row.storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.type(row.mime);
    fs.createReadStream(filePath).pipe(res);
  });

  router.get("/previews/:id", async (req, res) => {
    if (!INTEL_ID.test(req.params.id)) return res.status(404).end();
    const visible = await previewReadable(pool, req.params.id, req.user?.id || null);
    if (!visible) return res.status(404).end();
    try {
      const file = await ensureCardPreview(pool, req.params.id, uploadDir);
      if (!file) return res.status(404).end();
      res.type("image/jpeg");
      res.set("Cache-Control", "public, max-age=86400");
      fs.createReadStream(file).pipe(res);
    } catch {
      res.status(404).end();
    }
  });

  router.post("/intel", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    let images;
    let audio;
    let attachments;
    let videos = [];
    try {
      images = readMedia([...(Array.isArray(req.body?.images) ? req.body.images : []), ...(Array.isArray(req.body?.imageIds) ? req.body.imageIds : [])], MAX_IMAGES);
      audio = readMedia([...(Array.isArray(req.body?.audio) ? req.body.audio : []), ...(Array.isArray(req.body?.audioIds) ? req.body.audioIds : [])], MAX_AUDIO);
      attachments = readMedia([...(Array.isArray(req.body?.attachments) ? req.body.attachments : []), ...(Array.isArray(req.body?.fileIds) ? req.body.fileIds : [])], MAX_FILES);
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "videos")) videos = videosOf(req.body.videos);
    } catch (error) {
      if (error.code === "bad_video" || error.code === "bad_url") return res.status(400).json({ error: error.code });
      throw error;
    }
    if (!body && !images.ids.length && !images.urls.length && !audio.ids.length && !audio.urls.length && !attachments.ids.length && !attachments.urls.length && !videos.length) {
      return res.status(400).json({ error: "empty_body" });
    }
    try {
      const intel = await createIntel(pool, {
        userId: req.user.id,
        actor: "person",
        door: "webui",
        body,
        imageIds: images.ids,
        imageUrls: images.urls,
        audioIds: audio.ids,
        audioUrls: audio.urls,
        fileIds: attachments.ids,
        fileUrls: attachments.urls,
        videos,
        isPublic: req.body?.public,
        price: req.body?.price,
        kind: typeof req.body?.kind === "string" ? req.body.kind : "",
        respondsTo: typeof req.body?.respondsTo === "string" ? req.body.respondsTo : null,
        mentions: req.body?.mentions,
      });
      res.status(201).json({ intel });
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/submissions", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT id, body, videos, links, content_hash, verdict, reject_reason, category, price, is_public, kind, responds_to, weight, created_at, updated_at
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

  router.get("/requests", async (req, res) => {
    res.json({ requests: await listRequests(pool, req.user?.id || null) });
  });

  router.get("/responses", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    res.json({ responses: await listMyResponses(pool, req.user.id) });
  });

  router.get("/looks", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    res.json({ looks: await listLooks(pool, req.user.id) });
  });

  router.post("/requests/:id/look", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      const look = await lookRequest(pool, req.user.id, id);
      res.json({ look });
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/requests/:id/responses", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    const result = await listRequestResponses(pool, req.user.id, id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
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

  router.get("/sponsors", async (_req, res) => {
    res.json({ sponsors: await listPublicSponsors(pool) });
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
      `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.weight, i.user_id, i.is_public, i.created_at, i.updated_at, u.display_name, u.avatar_upload_id,
        TRUE AS starred,
        (i.user_id = $1 OR EXISTS (
          SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $1
        )) AS granted,
${FRIEND_COLUMNS}
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

  router.get("/friends", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    res.json({ friends: await listFriends(pool, req.user.id) });
  });

  router.delete("/friends/:id", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await removeFriend(pool, req.user.id, id));
    } catch (error) {
      httpError(res, error);
    }
  });

  async function writeFriend(req, res, friend) {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await setCardFriend(pool, req.user.id, id, friend));
    } catch (error) {
      httpError(res, error);
    }
  }

  router.post("/intel/:id/friend", (req, res) => writeFriend(req, res, true));
  router.delete("/intel/:id/friend", (req, res) => writeFriend(req, res, false));

  router.get("/notifications", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    res.json(await listNotifications(pool, req.user.id));
  });

  router.post("/notifications/read", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    res.json(await markNotificationsRead(pool, req.user.id));
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
