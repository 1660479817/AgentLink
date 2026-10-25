import { Router } from "express";
import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import multer from "multer";
import { hasInformation, isArchiveUpload, isAttachmentUpload, isAudioUpload, isVideoUpload, MAX_AUDIO, MAX_FILES, MAX_IMAGES, uploadName, videoItemsOf } from "../information.js";
import { readImageMedia, readMedia } from "../links.js";
import {
  FEEDBACK_MAX,
  normalizeEmail,
  normalizeLoginKey,
  redeemLoginKey,
  requestLoginKey,
  sendFeedback,
} from "../login.js";
import { bioText, displayNameText, muteState, specialtyList, storedSpecialties } from "../account.js";
import { agentTypeText } from "../agentTypes.js";
import { agentByToken, agentIssueError, ensurePersonalAgent } from "../agentAccount.js";
import { listFriends } from "../friends.js";
import {
  createIntel,
  deleteOwnPost,
  downloadPacket,
  listPublicIntel,
  loadPublicIntel,
  presentIntelRows,
  publicAuthor,
  searchPublicIntel,
} from "../intel.js";
import { buyItem, createItem, listMyItems, listOrders, listStoreItems, loadOwnItem, loadStoreItem, relistItem, withdrawItem } from "../store.js";
import { listNotifications, markNotificationsRead, noticeSummary } from "../notifications.js";
import { allow, retryAfterSeconds } from "../rateLimit.js";
import { searchConfig } from "../searchConfig.js";
import { imageUploadLimit } from "../points.js";
import { attachmentOpens } from "../readable.js";
import { avatarUrlFor } from "../avatars.js";
import { acceptAvatar, ensureUploadDir, newStorageName } from "../uploads.js";
import { tmpDir } from "../storage.js";
import { storeUploadedFile } from "../uploadStore.js";
import { sendUploadError } from "./uploadError.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEEDBACK_WAIT_MS = 60_000;
const feedbackAt = new Map();

// 放行时返回 0；被挡住时返回还要等多少秒，供 Retry-After 用。
function feedbackWaitSeconds(userId) {
  const now = Date.now();
  // 过期的记录没有任何用处（下次提交本来就会覆盖），顺手清掉：
  // 这个 Map 的键是账号，不清就会随「提交过反馈的人数」一直长大（S12-14）。
  if (feedbackAt.size >= 1000) {
    for (const [key, at] of feedbackAt) if (now - at >= FEEDBACK_WAIT_MS) feedbackAt.delete(key);
  }
  const last = feedbackAt.get(userId) || 0;
  const left = FEEDBACK_WAIT_MS - (now - last);
  if (left > 0) return Math.max(1, Math.ceil(left / 1000));
  feedbackAt.set(userId, now);
  return 0;
}

function agentFail(res, error) {
  const code = error.code || error.message;
  if (code === "bad_video") return res.status(400).json({ error: "bad_video" });
  if (code === "bad_poster") return res.status(400).json({ error: "bad_poster" });
  if (code === "bad_image") return res.status(400).json({ error: "bad_image" });
  if (code === "bad_url") return res.status(400).json({ error: "bad_url" });
  if (code === "nothing_to_download") return res.status(400).json({ error: "nothing_to_download" });
  if (code === "bad_price") return res.status(400).json({ error: "bad_price" });
  if (code === "bad_public") return res.status(400).json({ error: "bad_public" });
  if (code === "insufficient_points") return res.status(402).json({ error: "insufficient_points" });
  if (code === "packet_unavailable") return res.status(503).json({ error: "packet_unavailable" });
  if (code === "packet_too_large") return res.status(413).json({ error: "packet_too_large" });
  if (code === "bad_state") return res.status(409).json({ error: "bad_state" });
  if (code === "too_many") return res.status(429).json({ error: "too_many" });
  if (code === "bad_body") return res.status(400).json({ error: "bad_body" });
  if (code === "muted") return res.status(403).json({ error: "muted" });
  if (code === "bad_mention") return res.status(400).json({ error: "bad_mention" });
  if (code === "unreadable_file") return res.status(400).json({ error: "unreadable_file" });
  if (code === "not_found") return res.status(404).json({ error: "not_found" });
  console.error(error);
  return res.status(503).json({ error: "process_unavailable" });
}

function bearerToken(header) {
  return String(header || "").replace(/^Bearer\s+/i, "").trim();
}

async function requireAccess(pool, req, res) {
  const token = bearerToken(req.headers.authorization);
  if (!token) return { error: "bad_token", status: 401 };
  const agent = await agentByToken(pool, token);
  if (!agent) return { error: "bad_token", status: 401 };
  // 信箱与积分都属于账号（Agent 的主人），令牌只决定「谁在发」。
  const accountId = agent.owner_id || agent.id;
  res.locals.noticeUserId = accountId;
  // email 给反馈邮件用：回信地址与「账户」一行都取自这里（S12-01）。
  return { userId: agent.id, accountId, side: agent.side, email: agent.email || "" };
}

function readDelivery(body, limits = {}) {
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  let images = [];
  let audio;
  let attachments;
  try {
    images = readImageMedia(body?.images, limits.images ?? MAX_IMAGES);
    audio = readMedia(body?.audio, MAX_AUDIO);
    attachments = readMedia(body?.attachments, limits.files ?? MAX_FILES);
  } catch (error) {
    if (error.code === "bad_url" || error.code === "bad_image") return { error: error.code, status: 400 };
    throw error;
  }
  let videos = [];
  if (body && Object.prototype.hasOwnProperty.call(body, "videos")) {
    try {
      videos = videoItemsOf(body.videos);
    } catch (error) {
      if (error.code === "bad_video" || error.code === "bad_poster") return { error: error.code, status: 400 };
      throw error;
    }
  }
  return {
    body: text,
    imageIds: images,
    audioIds: audio.ids,
    audioUrls: audio.urls,
    fileIds: attachments.ids,
    fileUrls: attachments.urls,
    videos,
  };
}

function presentAccount(row) {
  const entitlements = row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {};
  const mute = muteState(row.muted_until);
  return {
    id: row.id,
    role: row.role,
    ownerId: row.owner_id || null,
    email: row.email || null,
    displayName: row.display_name || "",
    avatarUrl: avatarUrlFor(row),
    level: row.level,
    entitlements,
    pointsBalance: row.points_balance,
    muted: mute.muted,
    mutedUntil: mute.mutedUntil,
    specialties: storedSpecialties(row.specialties),
    bio: row.bio || "",
    // 自述的产品类型。空串表示还没说自己是什么；认不出的值原样返回，
    // 平台据此看还有哪些没进名单的产品。
    agentType: row.agent_type || "",
  };
}

async function loadAccount(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.role, a.owner_id, a.email, a.display_name, a.avatar_upload_id,
            COALESCE(o.level, a.level) AS level,
            COALESCE(o.entitlements, a.entitlements) AS entitlements,
            a.muted_until, a.specialties, a.bio, a.agent_type,
            COALESCE(o.points_balance, a.points_balance) AS points_balance
       FROM accounts a
       LEFT JOIN accounts o ON o.id = a.owner_id
      WHERE a.id = $1`,
    [accountId]
  );
  return rows[0] ? presentAccount(rows[0]) : null;
}

export function agentRouter({ pool, uploadDir, storeEnabled = false }) {
  ensureUploadDir(uploadDir);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir(uploadDir)),
    filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
  });
  const imageUpload = multer({
    storage,
    // 与 Web 上传读同一个键：Agent 与 WebUI 对「一张图能有多大」给出同一个答案。
    limits: { fileSize: imageUploadLimit(), files: 1, fields: 10, parts: 20 },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });
  const fileUpload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 10, parts: 20 },
    fileFilter: (_req, file, cb) => {
      if (isVideoUpload(file)) cb(new Error("bad_video"));
      else if (isAudioUpload(file)) cb(new Error("bad_audio"));
      else if (!isAttachmentUpload(file)) cb(new Error("bad_file"));
      else cb(null, true);
    },
  });
  const audioUpload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10, parts: 20 },
    fileFilter: (_req, file, cb) => {
      if (isAudioUpload(file)) cb(null, true);
      else cb(new Error("bad_audio"));
    },
  });
  const router = Router();

  // 商店是可选模块：关掉时这一组接口不存在，已经上架与成交的数据仍留在库里。
  const storeGuard = (_req, res, next) => {
    if (storeEnabled) return next();
    return res.status(404).json({ error: "store_closed" });
  };

  // 每次带着授权码的响应都捎上未读信箱。账户由 accessFor 记下，这里只负责挂上。
  router.use((_req, res, next) => {
    const send = res.json.bind(res);
    res.json = (payload) => {
      const userId = res.locals.noticeUserId;
      const plain = payload && typeof payload === "object" && !Array.isArray(payload);
      if (!userId || !plain || payload.notices) return send(payload);
      // 失败处理只挂在摘要查询上，不裹住 send，免得序列化出错时再发一次。
      return noticeSummary(pool, userId).then(
        (notices) => send({ ...payload, notices }),
        (error) => {
          console.error(error);
          return send(payload);
        }
      );
    };
    next();
  });

  async function accessFor(req, res) {
    return requireAccess(pool, req, res);
  }

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

  async function storeUpload(req, res, kind) {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const name = uploadName(req.file.originalname);
    if (kind === "file" && isAttachmentUpload(req.file) && !isArchiveUpload(req.file)) {
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
    try {
      const stored = await storeUploadedFile({ uploadDir, pool, userId: access.userId, file: req.file, kind, name });
      res.status(201).json({ id: stored.id, url: stored.url, name, mime: stored.mime });
    } catch (error) {
      sendUploadError(res, error);
    }
  }

  router.post("/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "bad_email" });
    const sent = await requestLoginKey(pool, email, { inviteCode: req.body?.inviteCode });
    if (sent.error) return res.status(sent.status).json({ error: sent.error });
    res.json({ ok: true });
  });

  // 外部 Agent 自注册：人的邮箱收密钥，Agent 拿密钥换自己的令牌。
  // 一本账号只有一个 Agent 名额，重复调用就是换令牌（旧令牌立即失效）。
  router.post("/register/key", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const key = normalizeLoginKey(req.body?.key);
    if (!email) return res.status(400).json({ error: "bad_email" });
    if (!key) return res.status(400).json({ error: "bad_key" });
    const redeemed = await redeemLoginKey(pool, email, key);
    if (redeemed.error) return res.status(redeemed.status).json({ error: redeemed.error });
    const person = await pool.query(
      `SELECT id, role, display_name, points_balance FROM accounts WHERE id = $1`,
      [redeemed.userId]
    );
    if (person.rows[0]?.role !== "user") return res.status(403).json({ error: "not_user" });
    let issued;
    try {
      issued = await ensurePersonalAgent(pool, person.rows[0]);
    } catch (error) {
      const failure = agentIssueError(error);
      return res.status(failure.status).json({ error: failure.error });
    }
    // 让包装器去捎信箱，摘要失败时 token 照常返回，不被拖垮。
    res.locals.noticeUserId = redeemed.userId;
    res.status(201).json({
      token: issued.token,
      agentId: issued.id,
      displayName: issued.displayName,
      email,
      pointsBalance: redeemed.pointsBalance,
      createdAt: issued.createdAt,
    });
  });

  router.get("/profile", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const user = await loadAccount(pool, access.userId);
    if (!user) return res.status(401).json({ error: "bad_token" });
    res.json({ user });
  });

  router.patch("/profile", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const hasName = typeof req.body?.displayName === "string";
    // 内部 Agent 的称呼同时是 OpenClaw 的智能体 id。管理端改称呼时会同步授权码文件里
    // 那一行名字；Agent 自己拿着令牌不能改，否则等于允许它冒名或改成与别的 Agent 同名的样子。
    if (hasName && req.body.displayName.trim() && access.side === "internal") {
      return res.status(403).json({ error: "name_locked" });
    }
    let name;
    if (hasName) {
      try {
        name = displayNameText(req.body.displayName);
      } catch {
        return res.status(400).json({ error: "bad_name" });
      }
    }
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
    let bio;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "bio")) {
      try {
        bio = bioText(req.body.bio);
      } catch (error) {
        if (error.code === "bad_bio") return res.status(400).json({ error: "bad_bio" });
        throw error;
      }
    }
    // 自述的产品类型。认不出的值照样收下（平台要看这份画像），只有不是字符串或太长才挡。
    let agentType;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "agentType")) {
      try {
        agentType = agentTypeText(req.body.agentType);
      } catch (error) {
        if (error.code === "bad_agent_type") return res.status(400).json({ error: "bad_agent_type" });
        throw error;
      }
    }
    if (!hasName && avatarId === undefined && specialties === undefined && bio === undefined && agentType === undefined) {
      return res.status(400).json({ error: "empty_body" });
    }
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
    if (bio !== undefined) {
      params.push(bio);
      sets.push(`bio = $${params.length}`);
    }
    if (agentType !== undefined) {
      params.push(agentType);
      sets.push(`agent_type = $${params.length}`);
    }
    params.push(access.userId);
    try {
      await pool.query(`UPDATE accounts SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "name_taken" });
      throw error;
    }
    res.json({ user: await loadAccount(pool, access.userId) });
  });

  router.post("/uploads", acceptFile("image"), (req, res) => storeUpload(req, res, "image"));
  router.post("/audio", acceptFile("audio"), (req, res) => storeUpload(req, res, "audio"));
  router.post("/files", acceptFile("file"), (req, res) => storeUpload(req, res, "file"));

  router.post("/intel", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const delivery = readDelivery(req.body);
    if (delivery.error) return res.status(delivery.status).json({ error: delivery.error });
    if (!hasInformation({
      body: delivery.body,
      images: delivery.imageIds,
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
        audioIds: delivery.audioIds,
        audioUrls: delivery.audioUrls,
        fileIds: delivery.fileIds,
        fileUrls: delivery.fileUrls,
        videos: delivery.videos,
        isPublic: req.body?.public,
        kind: req.body?.kind === "fastpost" ? "fastpost" : "post",
        revises: typeof req.body?.revises === "string" ? req.body.revises : null,
        mentions: req.body?.mentions,
      });
      res.status(201).json({ intel });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.post("/intel/:id/download", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "not_found" });
    try {
      const result = await downloadPacket(pool, access.userId, req.params.id, uploadDir);
      res.json({ intel: result.intel });
    } catch (error) {
      agentFail(res, error);
    }
  });

  // ---- Knot Store ------------------------------------------------------------
  // 与网页同一份货架：商品不进信息流与检索，只在这里进出。

  router.get("/store", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const before = String(req.query.before || "").trim();
    const anchor = before && UUID.test(before) ? before : null;
    res.json({ items: await listStoreItems(pool, access.userId, { before: anchor }) });
  });

  router.get("/store/orders", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ orders: await listOrders(pool, access.userId) });
  });

  router.get("/store/mine", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ items: await listMyItems(pool, access.userId) });
  });

  router.get("/store/:id", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    const item = await loadStoreItem(pool, access.userId, id);
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json({ item });
  });

  router.post("/store", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const delivery = readDelivery(req.body);
    if (delivery.error) return res.status(delivery.status).json({ error: delivery.error });
    // 一件商品必须有一份可下载的附件：没有货的货架没有意义。
    if (!delivery.fileIds.length) return res.status(400).json({ error: "bad_state" });
    try {
      const item = await createItem(pool, {
        userId: access.userId,
        actor: "personal_agent",
        door: "agent_api",
        body: delivery.body,
        imageIds: delivery.imageIds,
        fileIds: delivery.fileIds,
        price: req.body?.price,
      });
      res.status(201).json({ item });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.post("/store/:id/buy", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      const bought = await buyItem(pool, access.userId, id);
      res.json({ ...bought, item: await loadStoreItem(pool, access.userId, id) });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.post("/store/:id/withdraw", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json({ item: await withdrawItem(pool, access.userId, id) });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.post("/store/:id/relist", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json({ item: await relistItem(pool, access.userId, id) });
    } catch (error) {
      agentFail(res, error);
    }
  });

  router.get("/store/:id/mine", storeGuard, async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    const item = await loadOwnItem(pool, access.userId, id);
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json({ item });
  });

  // 读取公开信息流：与网页同一份记录。带授权码，个人态（关掉的、星、赞、已下载、好友）按这个账户算。
  router.get("/information", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const author = String(req.query.author || "").trim();
    if (author && !UUID.test(author)) return res.json({ information: [], author: null });
    const before = String(req.query.before || "").trim();
    const anchor = before && UUID.test(before) ? before : null;
    const filters = { category: req.query.category, topic: req.query.topic, source: req.query.source, since: req.query.since };
    const rows = await listPublicIntel(pool, 30, access.userId, author || null, anchor, filters);
    const information = await presentIntelRows(pool, rows);
    if (!author) return res.json({ information });
    res.json({ information, author: await publicAuthor(pool, author) });
  });

  router.get("/search", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const config = searchConfig();
    const key = `search:${access.userId}`;
    const windowMs = 60_000;
    if (!allow(key, config.searchRatePerMinute, windowMs)) {
      const wait = retryAfterSeconds(key, windowMs);
      if (wait) res.set("Retry-After", String(wait));
      return res.status(429).json({ error: "too_many" });
    }
    const q = String(req.query.q || "").trim().slice(0, config.queryMax);
    if (!q) return res.json({ information: [] });
    const filters = { category: req.query.category, topic: req.query.topic, source: req.query.source, since: req.query.since };
    const rows = await searchPublicIntel(pool, q, access.userId, filters);
    res.json({ information: await presentIntelRows(pool, rows) });
  });

  router.get("/intel/:id", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    const intel = await loadPublicIntel(pool, access.userId, id);
    if (!intel) return res.status(404).json({ error: "not_found" });
    res.json({ intel });
  });

  // 删除自己的一条 post/fastpost：记录留在库里，只记为 removed 并取消公开。
  // 修订链上的历史版本一并撤下。不是自己的、没有这条返回 not_found。
  router.delete("/intel/:id", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await deleteOwnPost(pool, access.userId, id));
    } catch (error) {
      agentFail(res, error);
    }
  });

  // 标记读过：从 information/search 拿到 id 后记一笔读痕迹。loadPublicIntel 读到即记，重复读不重复记。
  router.post("/intel/:id/look", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const id = String(req.params.id || "");
    if (!UUID.test(id)) return res.status(404).json({ error: "not_found" });
    const found = await loadPublicIntel(pool, access.userId, id);
    if (!found) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  });

  router.get("/friends", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json({ friends: await listFriends(pool, access.accountId) });
  });

  router.get("/notifications", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json(await listNotifications(pool, access.accountId));
  });

  router.post("/notifications/read", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    res.json(await markNotificationsRead(pool, access.accountId));
  });

  router.post("/feedback", async (req, res) => {
    const access = await accessFor(req, res);
    if (!access.userId) return res.status(access.status).json({ error: access.error });
    const kind = req.body?.kind;
    if (kind !== "suggestion" && kind !== "complaint") return res.status(400).json({ error: "bad_kind" });
    const text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!text) return res.status(400).json({ error: "empty_body" });
    if (text.length > FEEDBACK_MAX) return res.status(400).json({ error: "bad_body" });
    const feedbackWait = feedbackWaitSeconds(access.userId);
    if (feedbackWait) {
      res.set("Retry-After", String(feedbackWait));
      return res.status(429).json({ error: "too_many" });
    }
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
