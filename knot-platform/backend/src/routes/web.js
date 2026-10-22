import { Router } from "express";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import multer from "multer";
import { filesByIntel, isArchiveUpload, isAttachmentUpload, isAudioUpload, isVideoUpload, MAX_AUDIO, MAX_FILES, MAX_IMAGES, uploadName, videoItemsOf, visibleVerdict } from "../information.js";
import { readImageMedia, readMedia } from "../links.js";
import { FRIEND_COLUMNS, listFriends, removeFriend, setCardFriend } from "../friends.js";
import { loadDiscoverSelf, emptyDiscoverSelf, listActivePeople } from "../discoverBoard.js";
import { listFacets } from "../facets.js";
import { createIntel, downloadPacket, listPublicIntel, presentIntel, publicAuthor, reopenSale, searchPublicIntel, setIntelLike, setIntelStar } from "../market.js";
import { listNotifications, markNotificationsRead, unreadCount } from "../notifications.js";
import { listLooks, listMyResponses, listRequestResponses, listRequests, lookRequest } from "../requests.js";
import { attachmentDisposition } from "../packetZip.js";
import { isOwnerAccount, normalizeEmail, normalizeLoginKey, redeemLoginKey, requestLoginKey } from "../login.js";
import { removePost } from "../admin.js";
import { agentLimitOf, bioText, displayNameText, muteState } from "../account.js";
import { agentIssueError, ensurePersonalAgent, findAgentsOf, retireAgent } from "../agentAccount.js";
import { economyReport } from "../actuary.js";
import { policyConfig } from "../points.js";
import { clearSessionCookie, setSessionCookie, sessionTtlMs } from "../middleware/session.js";
import { MEDIA_PUBLIC, mediaAudience } from "../preview.js";
import { ensureSharePoster } from "../sharePoster.js";
import { listPublicSponsors } from "../sponsors.js";
import { loadTipSummary, tipIntel } from "../tips.js";
import { attachmentOpens } from "../readable.js";
import { avatarUrlFor } from "../avatars.js";
import { DEFAULT_SITE_LOCALE, parseLocale } from "@knot/locale";
import { guestBrowsing, siteConfig } from "../system.js";
import { acceptAvatar, ensureCardImage, ensureUploadDir, newStorageName } from "../uploads.js";
import { readableBlobPath, tmpDir } from "../storage.js";
import { storeUploadedFile } from "../uploadStore.js";
import { sendUploadError } from "./uploadError.js";
import { brandView } from "../profile.js";

const MiB = 1024 * 1024;

// 上传上限。默认值写在 ops/config/schema.mjs，环境变量只做覆盖。
function envBytes(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const USER_COLUMNS = `id, role, email, display_name, avatar_upload_id, level, entitlements, points_balance, muted_until, locale, bio`;

function presentUser(row) {
  const entitlements = row.entitlements && typeof row.entitlements === "object" ? row.entitlements : {};
  const mute = muteState(row.muted_until);
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    admin: row.role === "owner",
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
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM accounts WHERE id = $1`, [id]);
  return rows[0] ? presentUser(rows[0]) : null;
}

function httpError(res, error) {
  const code = error.code || error.message;
  if (code === "bad_video") return res.status(400).json({ error: "bad_video" });
  if (code === "bad_poster") return res.status(400).json({ error: "bad_poster" });
  if (code === "bad_image") return res.status(400).json({ error: "bad_image" });
  if (code === "bad_url") return res.status(400).json({ error: "bad_url" });
  if (code === "bad_price") return res.status(400).json({ error: "bad_price" });
  if (code === "bad_body") return res.status(400).json({ error: "bad_body" });
  if (code === "bad_duration") return res.status(400).json({ error: "bad_duration" });
  if (code === "bad_public") return res.status(400).json({ error: "bad_public" });
  if (code === "nothing_to_download") return res.status(400).json({ error: "nothing_to_download" });
  if (code === "insufficient_points") return res.status(402).json({ error: "insufficient_points" });
  if (code === "packet_unavailable") return res.status(503).json({ error: "packet_unavailable" });
  if (code === "bad_state") return res.status(409).json({ error: "bad_state" });
  if (code === "muted") return res.status(403).json({ error: "muted" });
  if (code === "bad_mention") return res.status(400).json({ error: "bad_mention" });
  if (code === "bad_amount") return res.status(400).json({ error: "bad_amount" });
  if (code === "tip_self") return res.status(400).json({ error: "tip_self" });
  if (code === "unreadable_file") return res.status(400).json({ error: "unreadable_file" });
  if (code === "not_found") return res.status(404).json({ error: "not_found" });
  console.error(error);
  return res.status(503).json({ error: "process_unavailable" });
}

const INTEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 站内浏览开关关掉时，没有会话就拿不到内容。信息流、搜索、深链、分享图都一样。
function contentGate(req, res, next) {
  if (req.account || guestBrowsing()) return next();
  return res.status(401).json({ error: "no_session" });
}

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
  const byId = await filesByIntel(pool, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, attachments: byId.get(row.id) || [] }));
}

export function webRouter({ pool, sessionCookieName, uploadDir, profile, board, agentDoc }) {
  // 站点身份只用于展示：顶栏名称和分享文案。系统开关仍在 session.site。
  // v2 起是十项扁平字段，填什么就显示什么，不再按语种取；`locale` 是站点默认界面语言。
  ensureUploadDir(uploadDir);

  // Agent 指引住在联邦中枢，不随实例发版。地址由 Backend 给出，WebUI 不写死：
  // 本地联调、镜像站或多中枢部署时，改 KNOT_HUB_ORIGIN 一处就够。
  const doc = {
    page: agentDoc?.page || "https://xknot.si/knot-help",
    raw: agentDoc?.raw || "https://xknot.si/knot-help.md",
  };

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir(uploadDir)),
    filename: (_req, file, cb) => cb(null, newStorageName(file.originalname)),
  });
  const upload = multer({
    storage,
    limits: { fileSize: envBytes("KNOT_UPLOAD_IMAGE_MAX_BYTES", 8 * MiB) },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) cb(null, true);
      else cb(new Error("bad_mime"));
    },
  });
  const attachment = multer({
    storage,
    limits: { fileSize: envBytes("KNOT_UPLOAD_ATTACHMENT_MAX_BYTES", 50 * MiB) },
    fileFilter: (_req, file, cb) => {
      if (isVideoUpload(file)) cb(new Error("bad_video"));
      else if (isAudioUpload(file)) cb(new Error("bad_audio"));
      else if (!isAttachmentUpload(file)) cb(new Error("bad_file"));
      else cb(null, true);
    },
  });

  const audioUpload = multer({
    storage,
    limits: { fileSize: envBytes("KNOT_UPLOAD_AUDIO_MAX_BYTES", 8 * MiB) },
    fileFilter: (_req, file, cb) => {
      if (isAudioUpload(file)) cb(null, true);
      else cb(new Error("bad_audio"));
    },
  });

  const router = Router();

  router.post("/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "bad_email" });
    const sent = await requestLoginKey(pool, email, { inviteCode: req.body?.inviteCode });
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
    const expires = new Date(Date.now() + sessionTtlMs());
    await pool.query(`INSERT INTO sessions (sid, account_id, expires_at) VALUES ($1, $2, $3)`, [
      sid,
      userId,
      expires,
    ]);
    setSessionCookie(res, sessionCookieName, sid);
    res.json({ user: await loadUser(pool, userId) });
  });

  router.get("/session", async (req, res) => {
    // 带会话身份，任何一层共享缓存都不要留。
    res.set("Cache-Control", "no-store");
    const policy = policyConfig();
    // 站点默认语种由主理人在 /admin 里定。这里不按访客 IP 或 Accept-Language 猜：
    // 访客自己的选择在 WebUI 的本地存储与 accounts.locale 里，比这一项优先。
    const defaultLocale = parseLocale(profile?.view().site?.locale) || DEFAULT_SITE_LOCALE;
    const site = siteConfig();
    const identity = brandView(profile?.view().site);
    if (!req.account) {
      return res.json({ user: null, policy, defaultLocale, site, brand: identity, agentDoc: doc, agentDelegated: false });
    }
    // Agent 是否已开通和会话一起回：顶栏不必再为这一项单独穿一次隧道。
    const [user, agents] = await Promise.all([loadUser(pool, req.account.id), findAgentsOf(pool, req.account.id)]);
    res.json({ user, policy, defaultLocale, site, brand: identity, agentDoc: doc, agentDelegated: agents.length > 0 });
  });

  // 首页的会话层：一次往返拿齐会话、Agent、未读数，以及「当前公开快照上属于我的状态」。
  //
  // 信息流本身来自入口磁盘上的 /discover.json，不从这里发。这里只补公开快照里不可能有的东西：
  // 登录的人是谁、关掉了哪些卡、点亮了哪些星、有没有未读通知。
  // 首屏先画快照，这一条回来后再叠上去，所以它迟一点不影响页面出现。
  router.get("/home", async (req, res) => {
    // 这是给某个人的一屏：不存浏览器缓存，也不许共享缓存留。
    res.set("Cache-Control", "no-store");
    const policy = policyConfig();
    const defaultLocale = parseLocale(profile?.view().site?.locale) || DEFAULT_SITE_LOCALE;
    const site = siteConfig();
    const brand = brandView(profile?.view().site);
    if (!req.account) {
      return res.json({
        user: null,
        policy,
        defaultLocale,
        site,
        brand,
        agentDoc: doc,
        agentDelegated: false,
        unread: 0,
        boardVersion: null,
        self: emptyDiscoverSelf(),
      });
    }
    const user = await loadUser(pool, req.account.id);
    if (!user) return res.status(401).json({ error: "no_session" });
    // 三件互不依赖的事一起发：少一次等待，就少一次跨境往返。
    const [agents, unread, snapshot] = await Promise.all([
      findAgentsOf(pool, req.account.id),
      unreadCount(pool, req.account.id),
      typeof board === "function" ? board().catch(() => null) : Promise.resolve(null),
    ]);
    // 状态按快照里的 id 算，和浏览器刚画的那一屏对得上。
    const ids = (Array.isArray(snapshot?.information) ? snapshot.information : [])
      .map((item) => item?.id)
      .filter(Boolean);
    const self = ids.length ? await loadDiscoverSelf(pool, req.account.id, ids) : emptyDiscoverSelf();
    res.json({
      user,
      policy,
      defaultLocale,
      site,
      brand,
      agentDoc: doc,
      agentDelegated: agents.length > 0,
      unread,
      boardVersion: snapshot?.version || null,
      self,
    });
  });

  router.delete("/session", async (req, res) => {
    const sid = req.cookies?.[sessionCookieName];
    if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
    clearSessionCookie(res, sessionCookieName);
    res.json({ ok: true });
  });

  router.patch("/profile", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const hasName = typeof req.body?.displayName === "string";
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
      } else {
        const checked = await acceptAvatar(pool, uploadDir, req.account.id, raw);
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
    params.push(req.account.id);
    try {
      await pool.query(`UPDATE accounts SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "name_taken" });
      throw error;
    }
    res.json({ user: await loadUser(pool, req.account.id) });
  });

  router.post("/uploads", (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    upload.single("file")(req, res, (err) => {
      if (err) {
        const tooBig = err.code === "LIMIT_FILE_SIZE";
        const code = err.message === "bad_mime" ? "bad_mime" : tooBig ? "image_too_large" : "upload_failed";
        return res.status(400).json({ error: code });
      }
      if (!req.file) return res.status(400).json({ error: "empty_file" });
      next();
    });
  }, async (req, res) => {
    try {
      const stored = await storeUploadedFile({ uploadDir, pool, userId: req.account.id, file: req.file, kind: "image" });
      res.status(201).json({ id: stored.id, url: stored.url });
    } catch (error) {
      sendUploadError(res, error);
    }
  });

  router.post("/audio", (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
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
    try {
      const stored = await storeUploadedFile({
        uploadDir,
        pool,
        userId: req.account.id,
        file: req.file,
        kind: "audio",
        name,
      });
      res.status(201).json({ id: stored.id, url: stored.url, name, mime: stored.mime });
    } catch (error) {
      sendUploadError(res, error);
    }
  });

  router.post("/files", (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
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
    try {
      const stored = await storeUploadedFile({
        uploadDir,
        pool,
        userId: req.account.id,
        file: req.file,
        kind: "file",
        name,
      });
      res.status(201).json({ id: stored.id, url: stored.url, name, mime: stored.mime });
    } catch (error) {
      sendUploadError(res, error);
    }
  });

  // 内容媒体的缓存头跟着可见范围走。只有「未登录也能读」且站点确实开着访客浏览时，
  // 才允许写进共享缓存（入口按 $uri 缓存，不看会话）；其余一律 private，只进浏览器缓存。
  // 站点关上访客浏览后，新响应不再进入口，旧的最多再分发到缓存到期（入口主机上设 1 天）。
  function mediaCacheControl(audience) {
    if (audience === MEDIA_PUBLIC && guestBrowsing()) return "public, max-age=86400";
    return "private, max-age=600";
  }

  async function readableUpload(req) {
    const { rows } = await pool.query(
      `SELECT u.storage_name, u.mime, u.original_name, u.account_id,
              EXISTS (SELECT 1 FROM accounts p WHERE p.avatar_upload_id = u.id) AS avatar,
              EXISTS (SELECT 1 FROM sponsors s WHERE s.image_upload_id = u.id) AS sponsor
       FROM uploads u
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return null;
    const row = rows[0];
    // 关闭站内浏览时，除头像和赞助图外，内容媒体也要有会话。
    if (!req.account && !guestBrowsing() && !row.avatar && !row.sponsor) return null;
    const image = String(row.mime || "").startsWith("image/");
    // SVG 带脚本，直接打开 URL 就是同源执行。历史上没有这类记录，也不给它开口子。
    if (String(row.mime || "").toLowerCase() === "image/svg+xml") return null;
    const audio = isAudioUpload({ mime: row.mime, originalname: row.original_name });
    if (isAttachmentUpload({ originalname: row.original_name || row.storage_name })) return null;
    // 头像和赞助图对所有人公开；其余内容媒体按当事人关系判一次，一次查询带公开/私下两档。
    const audience = row.avatar || row.sponsor
      ? MEDIA_PUBLIC
      : image || audio
        ? await mediaAudience(pool, req.params.id, req.account?.id || null)
        : null;
    if (audience === null) return null;
    const filePath = readableBlobPath(uploadDir, row.storage_name);
    if (!fs.existsSync(filePath)) return null;
    return { row, filePath, image, audience };
  }

  router.get("/uploads/:id/display", async (req, res) => {
    const opened = await readableUpload(req);
    if (!opened?.image) return res.status(404).end();
    try {
      const display = await ensureCardImage(uploadDir, opened.row.storage_name);
      res.set("Cache-Control", mediaCacheControl(opened.audience));
      res.type("image/jpeg");
      fs.createReadStream(display).pipe(res);
    } catch {
      // 生成失败时回退原件。原件可能是几 MB 的整图，不让它占住 /display 这个地址。
      res.set("Cache-Control", "no-store");
      res.type(opened.row.mime);
      fs.createReadStream(opened.filePath).pipe(res);
    }
  });

  router.get("/uploads/:id", async (req, res) => {
    const opened = await readableUpload(req);
    if (!opened) return res.status(404).end();
    // 头像和赞助图是公开、不随内容变动而换地址的：换头像生成新 upload，URL 也就变了。
    // 给它们缓存头，让浏览器和入口缓存，避免每次刷新都穿过隧道重新拉一遍。
    // 内容原图跟着可见范围走，理由见 mediaCacheControl。
    res.set(
      "Cache-Control",
      opened.row.avatar || opened.row.sponsor ? "public, max-age=86400" : mediaCacheControl(opened.audience)
    );
    res.type(opened.row.mime);
    fs.createReadStream(opened.filePath).pipe(res);
  });

  router.post("/intel", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    let images = [];
    let audio;
    let attachments;
    let videos = [];
    try {
      images = readImageMedia([...(Array.isArray(req.body?.images) ? req.body.images : []), ...(Array.isArray(req.body?.imageIds) ? req.body.imageIds : [])], MAX_IMAGES);
      audio = readMedia([...(Array.isArray(req.body?.audio) ? req.body.audio : []), ...(Array.isArray(req.body?.audioIds) ? req.body.audioIds : [])], MAX_AUDIO);
      attachments = readMedia([...(Array.isArray(req.body?.attachments) ? req.body.attachments : []), ...(Array.isArray(req.body?.fileIds) ? req.body.fileIds : [])], MAX_FILES);
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "videos")) videos = videoItemsOf(req.body.videos);
    } catch (error) {
      if (error.code === "bad_video" || error.code === "bad_poster" || error.code === "bad_url" || error.code === "bad_image") return res.status(400).json({ error: error.code });
      throw error;
    }
    if (!body && !images.length && !audio.ids.length && !audio.urls.length && !attachments.ids.length && !attachments.urls.length && !videos.length) {
      return res.status(400).json({ error: "empty_body" });
    }
    try {
      const intel = await createIntel(pool, {
        userId: req.account.id,
        actor: "person",
        door: "webui",
        body,
        imageIds: images,
        audioIds: audio.ids,
        audioUrls: audio.urls,
        fileIds: attachments.ids,
        fileUrls: attachments.urls,
        videos,
        isPublic: req.body?.public,
        price: req.body?.price,
        hours: req.body?.hours,
        kind: typeof req.body?.kind === "string" ? req.body.kind : "",
        respondsTo: typeof req.body?.respondsTo === "string" ? req.body.respondsTo : null,
        revises: typeof req.body?.revises === "string" ? req.body.revises : null,
        mentions: req.body?.mentions,
      });
      res.status(201).json({ intel });
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/submissions", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT id, actor, body, videos, links, content_hash, detail, verdict, reject_reason, category, price, is_public, kind, responds_to, weight, created_at, updated_at, expires_at, origin_id, version
       FROM intel
       WHERE account_id = $1 AND door = 'webui'
       ORDER BY created_at DESC`,
      [req.account.id]
    );
    // 一次把这一批的附件取齐，不再每条一次查询。
    const files = await filesByIntel(pool, rows.map((row) => row.id));
    const submissions = rows.map((row) => presentIntel({ ...row, files: files.get(row.id) || [] }));
    res.json({ submissions });
  });

  router.get("/search", contentGate, async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ information: [] });
    const filters = { category: req.query.category, topic: req.query.topic, source: req.query.source, since: req.query.since };
    const rows = await searchPublicIntel(pool, q, req.account?.id || null, filters);
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.get("/facets", contentGate, async (_req, res) => {
    res.json(await listFacets(pool));
  });

  router.get("/requests", contentGate, async (req, res) => {
    res.json({ requests: await listRequests(pool, req.account?.id || null) });
  });

  router.get("/people", contentGate, async (_req, res) => {
    res.json({ people: await listActivePeople(pool) });
  });

  router.get("/responses", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    res.json({ responses: await listMyResponses(pool, req.account.id) });
  });

  router.get("/looks", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    res.json({ looks: await listLooks(pool, req.account.id) });
  });

  router.post("/requests/:id/look", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      const look = await lookRequest(pool, req.account.id, id);
      res.json({ look });
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/requests/:id/responses", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    const result = await listRequestResponses(pool, req.account.id, id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  });

  router.post("/intel/:id/download", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    try {
      const result = await downloadPacket(pool, req.account.id, id, uploadDir, { zip: true });
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

  router.get("/intel/:id/share", contentGate, async (req, res) => {
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

  router.get("/information", contentGate, async (req, res) => {
    const author = String(req.query.author || "").trim();
    if (author && !INTEL_ID.test(author)) return res.json({ information: [], author: null });
    const before = String(req.query.before || "").trim();
    const anchor = before && INTEL_ID.test(before) ? before : null;
    const filters = { category: req.query.category, topic: req.query.topic, source: req.query.source, since: req.query.since, sales: req.query.sales === "1" };
    const rows = await listPublicIntel(pool, 30, req.account?.id || null, author || null, anchor, filters);
    const information = (await withUploads(pool, rows)).map(publicCard);
    if (!author) return res.json({ information });
    res.json({ information, author: await publicAuthor(pool, author) });
  });

  // 分享海报二维码深链：按帖子 id 取一条公开信息。
  // 旧地址（首版或中间版）也解到修订链里最新的那一版，链接不会停在旧稿上。
  router.get("/intel/:id", contentGate, async (req, res) => {
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    const { rows } = await pool.query(
      `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.weight, i.account_id, i.actor, i.is_public, i.created_at, i.updated_at, i.expires_at, i.origin_id, i.version,
              u.display_name, u.avatar_upload_id
       FROM intel i
       JOIN accounts u ON u.id = i.account_id
       WHERE COALESCE(i.origin_id, i.id) = (SELECT COALESCE(origin_id, id) FROM intel WHERE id = $1::uuid)
         AND i.kind IN ('post', 'fastpost') AND i.is_public AND ${visibleVerdict("i.verdict")}
       ORDER BY i.version DESC
       LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const [withFiles] = await withUploads(pool, rows);
    res.json(publicCard({ ...withFiles, granted: false }));
  });

  router.post("/discover-self", contentGate, async (req, res) => {
    if (!req.account) return res.json(emptyDiscoverSelf());
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))]
      .filter((id) => INTEL_ID.test(id))
      .slice(0, 80);
    res.json(await loadDiscoverSelf(pool, req.account.id, ids));
  });

  router.post("/intel/:id/dismiss", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    const { rows } = await pool.query(`SELECT id FROM intel WHERE id = $1 AND ${visibleVerdict("verdict")} AND is_public`, [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    await pool.query(
      `INSERT INTO intel_dismissals (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.account.id, id]
    );
    res.json({ ok: true });
  });

  // 平台层关闭：绑定为管理员的人类账号点「关闭」，卡片对所有用户不可见。
  router.post("/intel/:id/close", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    if (!(await isOwnerAccount(pool, req.account.id))) return res.status(403).json({ error: "not_admin" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    const reason = String(req.body?.reason ?? "").trim() || "平台关闭";
    try {
      res.json(await removePost(pool, id, reason, req.account.id));
    } catch (error) {
      httpError(res, error);
    }
  });

  // 再次开放到期的出售帖：仅作者，免费，把有效期重置为平台时长。
  router.post("/intel/:id/reopen", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json({ intel: await reopenSale(pool, req.account.id, id) });
    } catch (error) {
      httpError(res, error);
    }
  });

  async function writeStar(req, res, starred) {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    try {
      res.json(await setIntelStar(pool, req.account.id, id, starred));
    } catch (error) {
      if (error.code === "not_found") return res.status(404).json({ error: "not_found" });
      console.error(error);
      res.status(500).json({ error: "internal" });
    }
  }

  router.post("/intel/:id/star", (req, res) => writeStar(req, res, true));
  router.delete("/intel/:id/star", (req, res) => writeStar(req, res, false));

  async function writeLike(req, res, liked) {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "not_found" });
    }
    try {
      res.json(await setIntelLike(pool, req.account.id, id, liked));
    } catch (error) {
      if (error.code === "not_found") return res.status(404).json({ error: "not_found" });
      console.error(error);
      res.status(500).json({ error: "internal" });
    }
  }

  router.post("/intel/:id/like", (req, res) => writeLike(req, res, true));
  router.delete("/intel/:id/like", (req, res) => writeLike(req, res, false));

  // 打赏：摘要公开，打赏要会话。金额、余额、不能打赏自己都在 tips.js 里判。
  router.get("/intel/:id/tips", async (req, res) => {
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await loadTipSummary(pool, req.account?.id || null, id));
    } catch (error) {
      httpError(res, error);
    }
  });

  router.post("/intel/:id/tip", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await tipIntel(pool, req.account.id, id, req.body?.amount));
    } catch (error) {
      httpError(res, error);
    }
  });

  router.get("/stars", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(
      `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.weight, i.account_id, i.actor, i.is_public, i.created_at, i.updated_at, i.expires_at, u.display_name, u.avatar_upload_id,
        TRUE AS starred,
        EXISTS (
          SELECT 1 FROM intel_likes l WHERE l.intel_id = i.id AND l.account_id = $1
        ) AS liked,
        (i.account_id = $1 OR EXISTS (
          SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.account_id = $1
        )) AS granted,
${FRIEND_COLUMNS}
       FROM intel_stars s
       JOIN intel i ON i.id = s.intel_id
       JOIN accounts u ON u.id = i.account_id
       WHERE s.account_id = $1 AND ${visibleVerdict("i.verdict")} AND i.is_public
         AND NOT EXISTS (
           SELECT 1 FROM intel_dismissals d
           WHERE d.intel_id = i.id AND d.account_id = s.account_id
         )
       ORDER BY s.created_at DESC`,
      [req.account.id]
    );
    res.json({ information: (await withUploads(pool, rows)).map(publicCard) });
  });

  router.get("/friends", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    res.json({ friends: await listFriends(pool, req.account.id) });
  });

  router.delete("/friends/:id", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await removeFriend(pool, req.account.id, id));
    } catch (error) {
      httpError(res, error);
    }
  });

  async function writeFriend(req, res, friend) {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const id = String(req.params.id || "");
    if (!INTEL_ID.test(id)) return res.status(404).json({ error: "not_found" });
    try {
      res.json(await setCardFriend(pool, req.account.id, id, friend));
    } catch (error) {
      httpError(res, error);
    }
  }

  router.post("/intel/:id/friend", (req, res) => writeFriend(req, res, true));
  router.delete("/intel/:id/friend", (req, res) => writeFriend(req, res, false));

  router.get("/notifications", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    // ?count=1 只回红点的数字。顶栏轮询用它，整箱通知留给通知页。
    if (req.query.count === "1") return res.json({ unread: await unreadCount(pool, req.account.id) });
    res.json(await listNotifications(pool, req.account.id));
  });

  router.post("/notifications/read", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    res.json(await markNotificationsRead(pool, req.account.id));
  });

  // 我的 Agent：外部账号在这里自助开通/换令牌/停用（一本账号一个名额）。
  // 主理人的内部 Agent 从管理端签发，这里只读，不代替管理端。
  router.get("/agent", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(`SELECT id, role FROM accounts WHERE id = $1`, [req.account.id]);
    const account = rows[0];
    if (!account) return res.status(401).json({ error: "no_session" });
    const agents = await findAgentsOf(pool, account.id);
    res.json({
      role: account.role,
      limit: agentLimitOf(account),
      selfService: account.role === "user",
      agents: agents.map((agent) => ({
        id: agent.id,
        displayName: agent.display_name,
        createdAt: agent.created_at,
        hasToken: agent.has_token,
      })),
    });
  });

  router.post("/agent", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(`SELECT id, role, display_name FROM accounts WHERE id = $1`, [req.account.id]);
    const account = rows[0];
    if (!account) return res.status(401).json({ error: "no_session" });
    if (account.role !== "user") return res.status(403).json({ error: "not_user" });
    try {
      const issued = await ensurePersonalAgent(pool, account);
      // 新建回 201，只是换了一枚码回 200：后者没有多出任何资源。
      res.status(issued.created ? 201 : 200).json({
        token: issued.token,
        agent: { id: issued.id, displayName: issued.displayName, createdAt: issued.createdAt },
      });
    } catch (error) {
      const failure = agentIssueError(error);
      res.status(failure.status).json({ error: failure.error });
    }
  });

  router.delete("/agent", async (req, res) => {
    if (!req.account) return res.status(401).json({ error: "no_session" });
    const { rows } = await pool.query(`SELECT id, role FROM accounts WHERE id = $1`, [req.account.id]);
    const account = rows[0];
    if (!account) return res.status(401).json({ error: "no_session" });
    // 主理人名下的内部 Agent 从管理端停用：这里一并放开的话，一个 WebUI 请求
    // 就能把评审员、管理员这些在岗 Agent 全停掉。外部账号只管自己那一个名额。
    if (account.role !== "user") return res.status(403).json({ error: "not_user" });
    const agents = await findAgentsOf(pool, account.id);
    for (const agent of agents) await retireAgent(pool, agent.id);
    res.json({ ok: true });
  });

  return router;
}
