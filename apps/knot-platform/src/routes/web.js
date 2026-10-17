import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import multer from "multer";
import { fileView, isArchiveUpload, isAttachmentUpload, isAudioUpload, isVideoUpload, MAX_AUDIO, MAX_FILES, MAX_IMAGES, uploadName, videosOf, visibleVerdict } from "../information.js";
import { readMedia } from "../links.js";
import { FRIEND_COLUMNS, listFriends, removeFriend, setCardFriend } from "../friends.js";
import { loadDiscoverSelf, emptyDiscoverSelf } from "../discoverBoard.js";
import { createIntel, downloadPacket, listPublicIntel, presentIntel, publicAuthor, searchPublicIntel, setIntelStar } from "../market.js";
import { listNotifications, markNotificationsRead } from "../notifications.js";
import { listLooks, listMyResponses, listRequestResponses, listRequests, lookRequest } from "../requests.js";
import { attachmentDisposition } from "../packetZip.js";
import { normalizeEmail, normalizeLoginKey, redeemLoginKey, requestLoginKey } from "../login.js";
import { bioText, muteState } from "../account.js";
import { economyReport } from "../actuary.js";
import { policyConfig } from "../points.js";
import { clearSessionCookie, setSessionCookie, SESSION_TTL_MS } from "../middleware/session.js";
import { directMediaReadable } from "../preview.js";
import { ensureSharePoster } from "../sharePoster.js";
import { listPublicSponsors } from "../sponsors.js";
import { attachmentOpens } from "../readable.js";
import { avatarUrlFor } from "../avatars.js";
import { parseLocale, regionForRequest } from "../locale.js";
import { acceptAvatar, ensureCardImage, ensureUploadDir, newStorageName, publicUploadUrl, storagePath } from "../uploads.js";

const USER_COLUMNS = `id, email, display_name, avatar_upload_id, level, entitlements, points_balance, muted_until, locale, bio`;

function presentUser(row) {
  const entitlements = row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {};
  const mute = muteState(row.muted_until);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    avatarUrl: avatarUrlFor(row),
    level: row.level,
    entitlements,
    pointsBalance: row.points_balance,
    muted: mute.muted,
    mutedUntil: mute.mutedUntil,
    locale: row.locale || null,
    bio: row.bio || "",
  };
}

async function loadUser(pool, id) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? presentUser(rows[0]) : null;
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
  if (code === "unreadable_file") return res.status(400).json({ error: "unreadable_file" });
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
    `SELECT f.intel_id, u.id, u.mime, u.original_name, u.size
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = ANY($1::uuid[])
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [rows.map((row) => row.id)]
  );
  const byId = new Map();
  for (const file of files) {
    const list = byId.get(file.intel_id) || [];
    list.push(fileView(file));
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
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (isVideoUpload(file)) cb(new Error("bad_video"));
      else if (isAudioUpload(file)) cb(new Error("bad_audio"));
      else if (!isAttachmentUpload(file)) cb(new Error("bad_file"));
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
    const region = regionForRequest(req);
    if (!req.user) return res.json({ user: null, policy, region });
    const user = await loadUser(pool, req.user.id);
    res.json({ user, policy, region });
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
    const name = hasName ? req.body.displayName.replace(/\s+/g, " ").trim() : null;
    if (hasName && (!name || name.length > 40)) return res.status(400).json({ error: "bad_name" });
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
    const hasLocale = Object.prototype.hasOwnProperty.call(req.body || {}, "locale");
    const locale = hasLocale ? parseLocale(req.body.locale) : null;
    if (hasLocale && !locale) return res.status(400).json({ error: "bad_locale" });
    let bio;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "bio")) {
      try {
        bio = bioText(req.body.bio);
      } catch (error) {
        if (error.code === "bad_bio") return res.status(400).json({ error: "bad_bio" });
        throw error;
      }
    }
    if (!hasName && avatarId === undefined && !hasLocale && bio === undefined) return res.status(400).json({ error: "empty_body" });
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
    if (hasLocale) {
      params.push(locale);
      sets.push(`locale = $${params.length}`);
    }
    if (bio !== undefined) {
      params.push(bio);
      sets.push(`bio = $${params.length}`);
    }
    params.push(req.user.id);
    try {
      await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "name_taken" });
      throw error;
    }
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
      `INSERT INTO uploads (user_id, storage_name, mime, size) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, req.file.filename, req.file.mimetype, req.file.size]
    );
    res.status(201).json({ id: rows[0].id, url: publicUploadUrl(rows[0].id) });
  });

  router.post("/audio", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    audioUpload.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        const code = err.message === "bad_audio" ? "bad_audio" : tooBig ? "audio_too_large" : "upload_failed";
        return res.status(400).json({ error: code });
      }
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    const name = uploadName(req.file.originalname);
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_name, mime, original_name, size) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, req.file.filename, req.file.mimetype, name || null, req.file.size]
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
        const known = err.message === "bad_video" || err.message === "bad_audio" || err.message === "bad_file";
        const code = known ? err.message : tooBig ? "file_too_large" : "upload_failed";
        return res.status(400).json({ error: code });
      }
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    const name = uploadName(req.file.originalname);
    if (!isArchiveUpload({ originalname: name })) {
      try {
        const buffer = await readFile(req.file.path);
        if (!attachmentOpens(name, buffer)) {
          await rm(req.file.path, { force: true });
          return res.status(400).json({ error: "unreadable_file" });
        }
      } catch {
        await rm(req.file.path, { force: true });
        return res.status(400).json({ error: "unreadable_file" });
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_name, mime, original_name, size) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, req.file.filename, req.file.mimetype, name || null, req.file.size]
    );
    res.status(201).json({
      id: rows[0].id,
      url: publicUploadUrl(rows[0].id),
      name,
      mime: req.file.mimetype,
    });
  });

  async function readableUpload(req) {
    const { rows } = await pool.query(
      `SELECT u.storage_name, u.mime, u.original_name, u.user_id,
              EXISTS (SELECT 1 FROM users p WHERE p.avatar_upload_id = u.id) AS avatar,
              EXISTS (SELECT 1 FROM sponsors s WHERE s.image_upload_id = u.id) AS sponsor
       FROM uploads u
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    const owner = Boolean(req.user && req.user.id === row.user_id);
    const image = String(row.mime || "").startsWith("image/");
    const audio = isAudioUpload({ mime: row.mime, originalname: row.original_name });
    if (isAttachmentUpload({ originalname: row.original_name || row.storage_name })) return null;
    if ((image || audio) && !row.avatar && !row.sponsor && !owner) {
      const visible = await directMediaReadable(pool, req.params.id, req.user?.id || null);
      if (!visible) return null;
    }
    const filePath = storagePath(uploadDir, row.storage_name);
    if (!fs.existsSync(filePath)) return null;
    return { row, filePath, image };
  }

  router.get("/uploads/:id/display", async (req, res) => {
    const opened = await readableUpload(req);
    if (!opened?.image) return res.status(404).end();
    try {
      const display = await ensureCardImage(uploadDir, opened.row.storage_name);
      res.set("Cache-Control", "public, max-age=604800");
      res.type("image/jpeg");
      fs.createReadStream(display).pipe(res);
    } catch {
      res.set("Cache-Control", "no-store");
      res.type(opened.row.mime);
      fs.createReadStream(opened.filePath).pipe(res);
    }
  });

  router.get("/uploads/:id", async (req, res) => {
    const opened = await readableUpload(req);
    if (!opened) return res.status(404).end();
    // 头像和赞助图是公开、不随内容变动而换地址的：换头像生成新 upload，URL 也就变了。
    // 给它们缓存头，让浏览器和边缘缓存，避免每次刷新都穿过隧道重新拉一遍。
    if (opened.row.avatar || opened.row.sponsor) {
      res.set("Cache-Control", "public, max-age=86400");
    }
    res.type(opened.row.mime);
    fs.createReadStream(opened.filePath).pipe(res);
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
      `SELECT id, actor, body, videos, links, content_hash, detail, verdict, reject_reason, category, price, is_public, kind, responds_to, weight, created_at, updated_at
       FROM intel
       WHERE user_id = $1 AND door = 'webui'
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    const submissions = [];
    for (const row of rows) {
      const files = await pool.query(
        `SELECT u.id, u.mime, u.original_name, u.size
         FROM intel_files f
         JOIN uploads u ON u.id = f.upload_id
         WHERE f.intel_id = $1
         ORDER BY f.sort_order`,
        [row.id]
      );
      const attachments = files.rows.map(fileView);
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

  router.get("/intel/:id/share", async (req, res) => {
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      const file = await ensureSharePoster(pool, id, uploadDir);
      if (!file) return res.status(404).json({ error: "not_found" });
      const etag = `"${path.basename(file)}"`;
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", attachmentDisposition("knot.jpg"));
      res.setHeader("Content-Length", fs.statSync(file).size);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-cache");
      const stream = fs.createReadStream(file);
      stream.on("error", () => {
        if (!res.headersSent) res.status(503).json({ error: "process_unavailable" });
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      if (error.code === "not_found") return res.status(404).json({ error: "not_found" });
      console.error(error);
      if (!res.headersSent) res.status(503).json({ error: "process_unavailable" });
    }
  });

  router.get("/sponsors", async (_req, res) => {
    res.json({ sponsors: await listPublicSponsors(pool) });
  });

  // 第二期：现实汇率与经济运行（聚合数据，无个人隐私，公开可读）。
  router.get("/economy", async (_req, res) => {
    try {
      res.json(await economyReport(pool));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "internal" });
    }
  });

  router.get("/information", async (req, res) => {
    const author = String(req.query.author || "").trim();
    if (author && !INTEL_ID.test(author)) return res.json({ information: [], author: null });
    const before = String(req.query.before || "").trim();
    const anchor = before && INTEL_ID.test(before) ? before : null;
    const rows = await listPublicIntel(pool, 30, req.user?.id || null, author || null, anchor);
    const information = (await withUploads(pool, rows)).map(publicCard);
    if (!author) return res.json({ information });
    res.json({ information, author: await publicAuthor(pool, author) });
  });

  // 分享海报二维码深链：按帖子 id 取一条公开信息。
  router.get("/intel/:id", async (req, res) => {
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    const { rows } = await pool.query(
      `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.weight, i.user_id, i.actor, i.is_public, i.created_at, i.updated_at,
              u.display_name, u.avatar_upload_id
       FROM intel i
       JOIN users u ON u.id = i.user_id
       WHERE i.id = $1 AND i.kind IN ('post', 'fastpost') AND i.is_public AND ${visibleVerdict("i.verdict")}`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const [withFiles] = await withUploads(pool, rows);
    res.json(publicCard({ ...withFiles, granted: false }));
  });

  router.post("/discover-self", async (req, res) => {
    if (!req.user) return res.json(emptyDiscoverSelf());
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))]
      .filter((id) => INTEL_ID.test(id))
      .slice(0, 80);
    res.json(await loadDiscoverSelf(pool, req.user.id, ids));
  });

  router.post("/intel/:id/dismiss", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    const { rows } = await pool.query(`SELECT id FROM intel WHERE id = $1 AND ${visibleVerdict("verdict")} AND is_public`, [id]);
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
      `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.weight, i.user_id, i.actor, i.is_public, i.created_at, i.updated_at, u.display_name, u.avatar_upload_id,
        TRUE AS starred,
        (i.user_id = $1 OR EXISTS (
          SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $1
        )) AS granted,
${FRIEND_COLUMNS}
       FROM intel_stars s
       JOIN intel i ON i.id = s.intel_id
       JOIN users u ON u.id = i.user_id
       WHERE s.user_id = $1 AND ${visibleVerdict("i.verdict")} AND i.is_public
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
