import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { listRequestResponses, listRequests } from "../requests.js";
import { hasInformation, isAttachmentUpload, isAudioUpload, isVideoUpload, MAX_AUDIO, MAX_FILES, MAX_IMAGES, videosOf } from "../information.js";
import { readMedia } from "../links.js";
import {
  FEEDBACK_MAX,
  normalizeEmail,
  normalizeLoginKey,
  redeemLoginKey,
  requestLoginKey,
  sendFeedback,
} from "../login.js";
import { muteState, specialtyList, storedSpecialties } from "../account.js";
import { decideAgentAccess, suppliedAgentEmail } from "../agentAccess.js";
import { listFriends } from "../friends.js";
import { createIntel, downloadPacket } from "../market.js";
import { listNotifications, markNotificationsRead } from "../notifications.js";
import { acceptAvatar, ensureUploadDir, newStorageName, publicUploadUrl } from "../uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEEDBACK_WAIT_MS = 60_000;
const feedbackAt = new Map();

function feedbackTooSoon(userId) {
  const now = Date.now();
  const last = feedbackAt.get(userId) || 0;
  if (now - last < FEEDBACK_WAIT_MS) return true;
  feedbackAt.set(userId, now);
  return false;
}

function agentFail(res, error) {
  const code = error.code || error.message;
  if (code === "bad_video") return res.status(400).json({ error: "bad_video" });
  if (code === "bad_url") return res.status(400).json({ error: "bad_url" });
  if (code === "nothing_to_download") return res.status(400).json({ error: "nothing_to_download" });
  if (code === "bad_price") return res.status(400).json({ error: "bad_price" });
  if (code === "bad_public") return res.status(400).json({ error: "bad_public" });
  if (code === "insufficient_points") return res.status(402).json({ error: "insufficient_points" });
  if (code === "packet_unavailable") return res.status(503).json({ error: "packet_unavailable" });
  if (code === "bad_state") return res.status(409).json({ error: "bad_state" });
  if (code === "muted") return res.status(403).json({ error: "muted" });
  if (code === "bad_mention") return res.status(400).json({ error: "bad_mention" });
  if (code === "not_found") return res.status(404).json({ error: "not_found" });
  console.error(error);
  return res.status(503).json({ error: "process_unavailable" });
}

function bearerToken(header) {
  return String(header || "").replace(/^Bearer\s+/i, "").trim();
}

async function userFromAccess(pool, header, emailRaw) {
  const supplied = suppliedAgentEmail(emailRaw);
  if (supplied.error) return supplied;
  const token = bearerToken(header);
  if (!token) return { error: "bad_token", status: 401 };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.side
     FROM users u
     JOIN delegations d ON d.user_id = u.id
     WHERE d.token_hash = $1`,
    [tokenHash]
  );
  return decideAgentAccess(rows[0], supplied.email);
}

function readDelivery(body, limits = {}) {
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  let images;
  let audio;
  let attachments;
  try {
    images = readMedia(body?.images, limits.images ?? MAX_IMAGES);
    audio = readMedia(body?.audio, MAX_AUDIO);
    attachments = readMedia(body?.attachments, limits.files ?? MAX_FILES);
  } catch (error) {
    if (error.code === "bad_url") return { error: "bad_url", status: 400 };
    throw error;
  }
  let videos = [];
  if (body && Object.prototype.hasOwnProperty.call(body, "videos")) {
    try {
      videos = videosOf(body.videos);
    } catch (error) {
      if (error.code === "bad_video") return { error: "bad_video", status: 400 };
      throw error;
    }
  }
  return {
    body: text,
    imageIds: images.ids,
    imageUrls: images.urls,
    audioIds: audio.ids,
    audioUrls: audio.urls,
    fileIds: attachments.ids,
    fileUrls: attachments.urls,
    videos,
  };
}

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
    specialties: storedSpecialties(row.specialties),
  };
}

async function loadUser(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, email, display_name, avatar_upload_id, level, entitlements, points_balance, muted_until, specialties
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ? presentUser(rows[0]) : null;
}

export function agentRouter({ pool, uploadDir }) {
  ensureUploadDir(uploadDir);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
  });
  const imageUpload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });
  const fileUpload = multer({
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

  function acceptFile(kind) {
    const parser = kind === "image" ? imageUpload : kind === "audio" ? audioUpload : fileUpload;
    return (req, res, next) => {
      parser.single("file")(req, res, (err) => {
        if (err) {
          const tooBig = err.code === "LIMIT_FILE_SIZE";
          const known = err.message === "bad_mime" || err.message === "bad_video" || err.message === "bad_audio" || err.message === "bad_file";
          const code = known ? err.message : tooBig ? "file_too_large" : "upload_failed";
          return res.status(400).json({ error: code });
        }
        if (!req.file) return res.status(400).json({ error: "empty_file" });
        next();
      });
    };
  }

  async function storeUpload(req, res) {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const name = path.basename(req.file.originalname || "").slice(0, 180);
    const { rows } = await pool.query(
      `INSERT INTO uploads (user_id, storage_name, mime, original_name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [access.userId, req.file.filename, req.file.mimetype, name || null]
    );
    const mime = req.file.mimetype || "";
    res.status(201).json({
      id: rows[0].id,
      url: publicUploadUrl(rows[0].id),
      name,
      mime,
    });
  }

  router.post("/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "bad_email" });
    const sent = await requestLoginKey(pool, email);
    if (sent.error) return res.status(sent.status).json({ error: sent.error });
    res.json({ ok: true });
  });

  router.post("/register/key", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const key = normalizeLoginKey(req.body?.key);
    if (!email) return res.status(400).json({ error: "bad_email" });
    if (!key) return res.status(400).json({ error: "bad_key" });
    const redeemed = await redeemLoginKey(pool, email, key);
    if (redeemed.error) return res.status(redeemed.status).json({ error: redeemed.error });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { rows } = await pool.query(
      `INSERT INTO delegations (user_id, token_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()
       RETURNING created_at`,
      [redeemed.userId, tokenHash]
    );
    res.status(201).json({
      token,
      email,
      pointsBalance: redeemed.pointsBalance,
      createdAt: rows[0].created_at,
    });
  });

  router.get("/profile", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const user = await loadUser(pool, access.userId);
    if (!user) return res.status(401).json({ error: "bad_token" });
    res.json({ user });
  });

  router.patch("/profile", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const hasName = typeof req.body?.displayName === "string";
    const name = hasName ? req.body.displayName.trim() : null;
    if (hasName && name.length > 40) return res.status(400).json({ error: "bad_name" });
    let avatarId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "avatarUploadId")) {
      const raw = req.body.avatarUploadId;
      if (raw === null || raw === "") {
        avatarId = null;
      } else if (!UUID.test(String(raw))) {
        return res.status(400).json({ error: "bad_avatar" });
      } else {
        const checked = await acceptAvatar(pool, uploadDir, access.userId, raw);
        if (checked.error) return res.status(400).json({ error: checked.error });
        avatarId = checked.id;
      }
    }
    let specialties;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "specialties")) {
      try {
        specialties = specialtyList(req.body.specialties);
      } catch (error) {
        if (error.code === "bad_specialty") return res.status(400).json({ error: "bad_specialty" });
        throw error;
      }
    }
    if (!hasName && avatarId === undefined && specialties === undefined) return res.status(400).json({ error: "empty_body" });
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
    if (specialties !== undefined) {
      params.push(JSON.stringify(specialties));
      sets.push(`specialties = $${params.length}::jsonb`);
    }
    params.push(access.userId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    res.json({ user: await loadUser(pool, access.userId) });
  });

  router.post("/uploads", acceptFile("image"), storeUpload);
  router.post("/audio", acceptFile("audio"), storeUpload);
  router.post("/files", acceptFile("file"), storeUpload);

  router.post("/intel", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const delivery = readDelivery(req.body);
    if (delivery.error) return res.status(delivery.status).json({ error: delivery.error });
    if (!hasInformation({
      body: delivery.body,
      images: [...delivery.imageIds, ...delivery.imageUrls],
      audio: [...delivery.audioIds, ...delivery.audioUrls],
      videos: delivery.videos,
      attachments: [...delivery.fileIds, ...delivery.fileUrls],
    })) {
      return res.status(400).json({ error: "empty_body" });
    }
    try {
      const intel = await createIntel(pool, {
        userId: access.userId,
        actor: "personal_agent",
        door: "agent_api",
        body: delivery.body,
        imageIds: delivery.imageIds,
        imageUrls: delivery.imageUrls,
        audioIds: delivery.audioIds,
        audioUrls: delivery.audioUrls,
        fileIds: delivery.fileIds,
        fileUrls: delivery.fileUrls,
        videos: delivery.videos,
        isPublic: req.body?.public,
        price: req.body?.price,
        kind: typeof req.body?.kind === "string" ? req.body.kind : "",
        respondsTo: typeof req.body?.respondsTo === "string" ? req.body.respondsTo : null,
        mentions: req.body?.mentions,
      });
      res.status(201).json({ intel });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.post("/intel/:id/download", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    try {
      const result = await downloadPacket(pool, access.userId, req.params.id, uploadDir);
      res.json({ intel: { ...result.intel, granted: true } });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.get("/requests", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ requests: await listRequests(pool, access.userId) });
  });

  router.get("/requests/:id/responses", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    const result = await listRequestResponses(pool, access.userId, req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  router.get("/friends", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ friends: await listFriends(pool, access.userId) });
  });

  router.get("/notifications", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.query.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json(await listNotifications(pool, access.userId));
  });

  router.post("/notifications/read", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json(await markNotificationsRead(pool, access.userId));
  });

  router.post("/feedback", async (req, res) => {
    const access = await userFromAccess(pool, req.headers.authorization, req.body?.email);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const kind = req.body?.kind;
    if (kind !== "suggestion" && kind !== "complaint") return res.status(400).json({ error: "bad_kind" });
    const text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!text) return res.status(400).json({ error: "empty_body" });
    if (text.length > FEEDBACK_MAX) return res.status(400).json({ error: "bad_body" });
    if (feedbackTooSoon(access.userId)) return res.status(429).json({ error: "too_many" });
    try {
      await sendFeedback({
        kind,
        accountEmail: access.email,
        userId: access.userId,
        body: text,
      });
    } catch (error) {
      feedbackAt.delete(access.userId);
      const code = error.code === "mail_unavailable" ? "mail_unavailable" : "mail_failed";
      return res.status(503).json({ error: code });
    }
    res.json({ ok: true });
  });

  return router;
}
