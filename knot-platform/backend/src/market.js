import { access, readFile, rm } from "node:fs/promises";
import { topicMatchesLanguage } from "@knot/locale";
import { toPlain } from "@knot/markdown";
import { intelAgentId, runIntelAgent } from "./agents/openclaw.js";
import { toRecord } from "./card.js";
import { loadBootstrapConfig } from "./config.js";
import { filesByIntel, isArchiveUpload, isAttachmentUpload, isAudioUpload, MAX_AUDIO, MAX_FILES, MAX_IMAGES, publicOf, uploadName, videoItemsOf, visibleVerdict } from "./information.js";
import { assertReachable, contentHash } from "./links.js";
import { resolveVideo } from "./videoPoster.js";
import { assertFriends, directMentions, FRIEND_COLUMNS, mentionList } from "./friends.js";
import { recordNotification } from "./notifications.js";
import { archiveSources, ensurePacketZip, packetDownloadName, packetReadme } from "./packetZip.js";
import { speakerAccount } from "./account.js";
import { applyPoints, serviceFee, economyConfig, packetPrice, servicePrice, sameWallet, PLATFORM_ACCOUNT_ID } from "./points.js";
import { scoreText } from "./search.js";
import { touchDiscoverBoard } from "./discoverPublish.js";
import { attachmentOpens } from "./readable.js";
import { avatarUrlFor } from "./avatars.js";
import { cardImageUrl } from "./uploads.js";
import { TIP_TOTAL_SQL } from "./tips.js";
import { readableBlobPath } from "./storage.js";
import { discardExtract, extractsFor } from "./extracts.js";
import { normalizeCategory } from "./categories.js";
import { wishExpiresAt, wishHours, wishLive } from "./wish.js";
import { recordIntelRead, recordSearchEvent } from "./attention.js";

function videoText(videos) {
  if (!Array.isArray(videos)) return "";
  return videos
    .map((item) => (typeof item === "string" ? item : item?.url))
    .filter((url) => typeof url === "string" && url)
    .join(" ");
}

function intelText(row) {
  const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
  const note = typeof detail.note === "string" ? detail.note : "";
  const language = typeof detail.language === "string" ? detail.language : "";
  return `${toPlain(String(row.body || ""))} ${note} ${language} ${videoText(row.videos)}`.trim();
}

async function imageFiles(pool, intelId) {
  const { uploadDir } = loadBootstrapConfig();
  const { rows } = await pool.query(
    `SELECT u.storage_name, u.original_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1 AND u.mime LIKE 'image/%'
     ORDER BY f.sort_order ASC, f.upload_id ASC
     LIMIT ${MAX_IMAGES}`,
    [intelId]
  );
  const files = [];
  for (const row of rows) {
    const file = readableBlobPath(uploadDir, row.storage_name);
    await access(file);
    files.push({ path: file, name: uploadName(row.original_name) });
  }
  return files;
}

export function presentIntel(row) {
  if (!row) return null;
  const author = row.display_name !== undefined
    ? {
        id: row.account_id || "",
        name: row.display_name || "",
        avatarUrl: avatarUrlFor(row),
      }
    : undefined;
  return toRecord(row, {
    files: row.files || row.attachments || [],
    granted: row.granted !== false,
    author,
    starred: row.starred,
    liked: row.liked,
    tipTotal: row.tip_total,
  });
}

async function attachmentFiles(pool, intelId) {
  const { uploadDir } = loadBootstrapConfig();
  const { rows } = await pool.query(
    `SELECT u.storage_name, u.original_name, u.mime
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [intelId]
  );
  const files = [];
  for (const row of rows) {
    if (String(row.mime || "").startsWith("image/")) continue;
    if (isAudioUpload({ mime: row.mime, originalname: row.original_name })) continue;
    if (isArchiveUpload({ originalname: row.original_name })) continue;
    const file = readableBlobPath(uploadDir, row.storage_name);
    await access(file);
    files.push({ path: file, name: uploadName(row.original_name) });
  }
  return files;
}

async function loadIntel(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, account_id, body, videos, links, verdict, kind, responds_to FROM intel WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadPresentedIntel(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, account_id, actor, body, videos, links, content_hash, detail, verdict, reject_reason, category, price, is_public, kind, responds_to, weight, created_at, updated_at, expires_at, origin_id, version FROM intel WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const files = await filesByIntel(pool, [id]);
  return presentIntel({ ...rows[0], files: files.get(id) || [] });
}

async function assertAttachmentsOpen(pool, uploadIds) {
  if (!uploadIds.length) return;
  const { uploadDir } = loadBootstrapConfig();
  const { rows } = await pool.query(
    `SELECT id, storage_name, original_name, mime FROM uploads WHERE id = ANY($1::uuid[])`,
    [uploadIds]
  );
  for (const row of rows) {
    if (String(row.mime || "").startsWith("image/")) continue;
    if (isAudioUpload({ mime: row.mime, originalname: row.original_name })) continue;
    const name = uploadName(row.original_name || row.storage_name);
    if (!isAttachmentUpload({ originalname: name }) || isArchiveUpload({ originalname: name })) continue;
    const file = readableBlobPath(uploadDir, row.storage_name);
    let buffer;
    try {
      buffer = await readFile(file);
    } catch {
      const error = new Error("unreadable_file");
      error.code = "unreadable_file";
      throw error;
    }
    if (attachmentOpens(name, buffer)) continue;
    const used = await pool.query(
      `SELECT 1 FROM intel_files WHERE upload_id = $1
       UNION ALL SELECT 1 FROM accounts WHERE avatar_upload_id = $1
       UNION ALL SELECT 1 FROM sponsors WHERE image_upload_id = $1
       LIMIT 1`,
      [row.id]
    );
    if (!used.rows.length) {
      await pool.query(`DELETE FROM uploads WHERE id = $1`, [row.id]);
      await rm(file, { force: true });
    }
    const error = new Error("unreadable_file");
    error.code = "unreadable_file";
    throw error;
  }
}

async function notifyWishResponse(pool, { wishId, ownerId }) {
  const owner = await pool.query(
    `SELECT COALESCE(a.owner_id, a.id) AS wallet
       FROM intel i JOIN accounts a ON a.id = i.account_id
      WHERE i.id = $1 AND i.kind = 'wish' AND ${visibleVerdict("i.verdict")}`,
    [wishId]
  );
  const authorWallet = owner.rows[0]?.wallet;
  if (!authorWallet || authorWallet === ownerId) return;
  await recordNotification(pool, {
    userId: authorWallet,
    kind: "request_response",
    title: "有一条 wish 响应",
    body: "",
    href: `/wish?wish=${wishId}`,
  });
}

export async function judgeIntel(pool, id) {
  const intel = await loadIntel(pool, id);
  if (!intel || intel.verdict !== "pending") return presentIntel(intel);
  let result = { verdict: "pass", reason: "", note: "", category: "", language: "", topics: [] };
  if (intelAgentId()) {
    const images = await imageFiles(pool, id);
    const attachments = await attachmentFiles(pool, id);
    result = await runIntelAgent(intel, images, attachments);
  }
  if (result.verdict === "revoke") {
    const { rows } = await pool.query(
      `UPDATE intel SET verdict = 'rejected', reject_reason = $2, detail = NULL, category = ''
       WHERE id = $1 AND verdict = 'pending'
       RETURNING id`,
      [id, result.reason]
    );
    if (rows.length) {
      await discardExtract(id);
      await recordNotification(pool, {
        userId: intel.account_id,
        kind: "intel_rejected",
        title: "信息已撤销",
        body: result.reason,
        href: "/mine/submissions",
      });
    }
  } else {
    const category = normalizeCategory(result.category);
    await pool.query(
      `UPDATE intel SET verdict = 'passed', reject_reason = NULL, category = $2, detail = $3::jsonb
       WHERE id = $1 AND verdict = 'pending'`,
      [id, category, JSON.stringify({ note: result.note || "", language: result.language || "", topics: result.topics || [] })]
    );
  }
  if (intel.kind === "post" || intel.kind === "fastpost" || intel.kind === "wish") touchDiscoverBoard();
  return loadPresentedIntel(pool, id);
}

/**
 * 只重出话题标签：类别、语种与 note 都不动。
 * 用于整理历史上「英文正文配中文标签」这类记录。评审员再判一次，只取 topics。
 */
export async function retagIntelTopics(pool, id) {
  if (!intelAgentId()) throw new Error("intel_agent_unconfigured");
  const intel = await loadIntel(pool, id);
  if (!intel) return null;
  const { rows } = await pool.query(`SELECT detail FROM intel WHERE id = $1`, [id]);
  const detail = rows[0]?.detail && typeof rows[0].detail === "object" ? rows[0].detail : {};
  const before = Array.isArray(detail.topics) ? detail.topics : [];
  const language = typeof detail.language === "string" ? detail.language : "";
  const images = await imageFiles(pool, id);
  const attachments = await attachmentFiles(pool, id);
  const result = await runIntelAgent(intel, images, attachments);
  // 评审员换了语种判定时以它的为准；它说撤销也不要真的撤销，只整理标签。
  const tagLanguage = language || result.language;
  const fresh = result.topics.filter((topic) => topicMatchesLanguage(topic, tagLanguage));
  // 它这次一个合语种的标签都没给，就退一步：只删掉原来那些不合语种的，不清空。
  const topics = fresh.length ? fresh : before.filter((topic) => topicMatchesLanguage(topic, tagLanguage));
  await pool.query(
    `UPDATE intel SET detail = jsonb_set(coalesce(detail, '{}'::jsonb), '{topics}', $2::jsonb, true) WHERE id = $1`,
    [id, JSON.stringify(topics)]
  );
  if (intel.kind === "post" || intel.kind === "fastpost" || intel.kind === "wish") touchDiscoverBoard();
  return { id, language: tagLanguage, before, topics };
}

const REVIEW_LABELS = {
  agent_timeout: "数据评审员超时",
  agent_failed: "数据评审员没有完成审核",
  agent_bad_json: "数据评审员没有交回可用结果",
  agent_empty: "数据评审员没有交回内容",
};

function reviewFailureCode(error) {
  const code = String(error?.message || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return code || "review_failed";
}

export function reviewFailureText(error) {
  const code = reviewFailureCode(error);
  const lead = REVIEW_LABELS[code] || "审核没有完成";
  const detail = String(error?.detail || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const tail = "这条记录仍然可见，稍后会再试。";
  return detail ? `${lead}（${code}）。${detail} ${tail}` : `${lead}（${code}）。${tail}`;
}

export async function noteReviewFailure(pool, id, error) {
  const code = reviewFailureCode(error);
  const { rows } = await pool.query(`SELECT account_id, verdict, detail FROM intel WHERE id = $1`, [id]);
  const intel = rows[0];
  if (!intel || intel.verdict !== "pending") return false;
  const previous = intel.detail && typeof intel.detail.reviewError === "string" ? intel.detail.reviewError : "";
  if (previous === code) return false;
  const updated = await pool.query(
    `UPDATE intel SET detail = COALESCE(detail, '{}'::jsonb) || $2::jsonb
     WHERE id = $1 AND verdict = 'pending'
     RETURNING account_id`,
    [id, JSON.stringify({ reviewError: code })]
  );
  if (!updated.rows.length) return false;
  await recordNotification(pool, {
    userId: updated.rows[0].account_id,
    kind: "intel_review_error",
    title: "审核异常",
    body: reviewFailureText(error),
    href: "/mine/submissions",
  });
  return true;
}

const reviewQueue = [];
const reviewing = new Set();
const reviewAttempts = new Map();
let reviewPumping = false;

function reviewDelay(attempt) {
  return Math.min(15 * 60 * 1000, 15_000 * 2 ** Math.min(attempt - 1, 6));
}

function enqueueReview(pool, id) {
  if (!id || reviewing.has(id) || reviewQueue.includes(id)) return;
  reviewQueue.push(id);
  pumpReviews(pool);
}

function scheduleReviewRetry(pool, id) {
  const attempt = (reviewAttempts.get(id) || 0) + 1;
  reviewAttempts.set(id, attempt);
  const timer = setTimeout(() => enqueueReview(pool, id), reviewDelay(attempt));
  timer.unref();
}

async function holdForRetry(pool, id, error) {
  console.error(error);
  try {
    await noteReviewFailure(pool, id, error);
  } catch (notifyError) {
    console.error(notifyError);
  }
  scheduleReviewRetry(pool, id);
}

async function reviewOne(pool, id) {
  try {
    await judgeIntel(pool, id);
    reviewAttempts.delete(id);
  } catch (error) {
    await holdForRetry(pool, id, error);
  }
}

function pumpReviews(pool) {
  if (reviewPumping) return;
  reviewPumping = true;
  const step = () => {
    const id = reviewQueue.shift();
    if (!id) {
      reviewPumping = false;
      return;
    }
    reviewing.add(id);
    reviewOne(pool, id).finally(() => {
      reviewing.delete(id);
      step();
    });
  };
  step();
}

export async function resumePendingReviews(pool) {
  const { rows } = await pool.query(`SELECT id FROM intel WHERE verdict = 'pending' ORDER BY created_at ASC`);
  for (const row of rows) enqueueReview(pool, row.id);
}

async function assertRespondsTo(pool, requestId, ownerId) {
  if (!requestId) return;
  const { rows } = await pool.query(
    `SELECT COALESCE(a.owner_id, a.id) AS wallet
       FROM intel i JOIN accounts a ON a.id = i.account_id
      WHERE i.id = $1 AND i.kind = 'wish' AND ${visibleVerdict("i.verdict")} AND ${wishLive("i")}`,
    [requestId]
  );
  if (!rows.length || rows[0].wallet === ownerId) {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
}

const KINDS = new Set(["post", "fastpost", "wish", "wishRespond"]);

function resolveKind({ kind, respondsTo }) {
  const target = typeof respondsTo === "string" && respondsTo ? respondsTo : null;
  const name = typeof kind === "string" && kind ? kind : "post";
  if (!KINDS.has(name) || (name === "wishRespond") !== Boolean(target)) {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
  return { kind: name, respondsTo: name === "wishRespond" ? target : null };
}

// 修订只对 post / fastpost 开放：wish 有时效、wishRespond 是响应，都不修订。
// origin 是首版 id，version 是 origin 内的序号。早期流量低，先不做跨事务行锁。
async function assertRevision(pool, userId, revises, kind) {
  if (!revises) return { originId: null, version: 1 };
  if (kind !== "post" && kind !== "fastpost") {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
  const { rows } = await pool.query(
    `SELECT id, account_id, origin_id, version FROM intel WHERE id = $1 AND ${visibleVerdict("verdict")}`,
    [revises]
  );
  if (!rows[0] || rows[0].account_id !== userId) {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
  const originId = rows[0].origin_id || rows[0].id;
  const { rows: latest } = await pool.query(
    `SELECT COALESCE(MAX(version), 0)::int AS v FROM intel WHERE COALESCE(origin_id, id) = $1`,
    [originId]
  );
  return { originId, version: (latest[0]?.v || 0) + 1 };
}

export async function createIntel(pool, input) {
  const { userId, actor, door, body, videos = [], isPublic = true, price } = input;
  const author = await speakerAccount(pool, userId);
  // 好友与钱包都按作者所属的账号算：Agent 用主人的关系网，花主人的积分。
  const ownerId = author.owner_id || author.id;
  const imageIds = (input.imageIds || []).slice(0, MAX_IMAGES);
  const audioIds = (input.audioIds || []).slice(0, MAX_AUDIO);
  const audioUrls = (input.audioUrls || []).slice(0, Math.max(0, MAX_AUDIO - audioIds.length));
  const fileIds = (input.fileIds || []).slice(0, MAX_FILES);
  const fileUrls = (input.fileUrls || []).slice(0, Math.max(0, MAX_FILES - fileIds.length));
  const { kind, respondsTo } = resolveKind(input);
  const revision = await assertRevision(pool, userId, typeof input.revises === "string" ? input.revises : null, kind);
  // wish 时效固定；出售帖的时效取决于 owned 里有没有可下载附件，等 owned 查出后再定。
  const wishExpiry = kind === "wish" ? wishExpiresAt(wishHours(input.hours)) : null;
  const mentions = mentionList(input.mentions);
  if (mentions.length && kind !== "post" && kind !== "fastpost" && kind !== "wish") {
    const error = new Error("bad_mention");
    error.code = "bad_mention";
    throw error;
  }
  if (mentions.length) await assertFriends(pool, ownerId, mentions);
  const mention = (intelId) => directMentions(pool, { authorId: ownerId, intelId, kind, body, mentions });
  const videoItems = videoItemsOf(videos);
  const hash = contentHash({
    kind,
    respondsTo,
    body,
    imageIds,
    audioIds,
    audioUrls,
    fileIds,
    fileUrls,
    videos: videoItems,
  });
  const prior = await pool.query(
    `SELECT id FROM intel WHERE account_id = $1 AND content_hash = $2 AND verdict <> 'pending'`,
    [userId, hash]
  );
  if (prior.rows[0]) {
    await mention(prior.rows[0].id);
    return loadPresentedIntel(pool, prior.rows[0].id);
  }
  const uploadIds = [...new Set([...imageIds.slice(0, MAX_IMAGES), ...audioIds.slice(0, MAX_AUDIO), ...fileIds.slice(0, MAX_FILES)])];
  if (kind !== "wish" && fileIds.length) {
    // 平台自产（信息检索结果）走服务价，不受作者标价上下限约束。
    if (actor === "platform") servicePrice(price);
    else packetPrice(1, price);
  }
  let owned = [];
  if (uploadIds.length) {
    const { rows } = await pool.query(
      `SELECT id, size, mime, original_name FROM uploads WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [userId, uploadIds]
    );
    if (rows.length !== uploadIds.length) {
      const error = new Error("bad_url");
      error.code = "bad_url";
      throw error;
    }
    const order = new Map(uploadIds.map((id, index) => [id, index]));
    owned = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  const videoLinks = videoItems.map((item) => item.url);
  const posterIds = [...new Set(videoItems.filter((item) => item.poster.id).map((item) => item.poster.id))];
  const posterById = new Map();
  if (posterIds.length) {
    const { rows } = await pool.query(
      `SELECT id FROM uploads WHERE account_id = $1 AND id = ANY($2::uuid[]) AND mime LIKE 'image/%'`,
      [userId, posterIds]
    );
    if (rows.length !== posterIds.length) {
      const error = new Error("bad_poster");
      error.code = "bad_poster";
      throw error;
    }
    for (const row of rows) posterById.set(row.id, cardImageUrl(row.id));
  }
  // 存进 intel.videos 的 poster 是上传图的卡片显示地址。
  // playUrl 是后端从落地页解析出的直链，解析不出就留空；它不是用户输入，不进 content_hash。
  const playUrls = await Promise.all(videoItems.map((item) => resolveVideo(item.url)));
  const storedVideos = videoItems.map((item, i) => {
    const playUrl = playUrls[i] && playUrls[i] !== item.url ? playUrls[i] : "";
    const record = {
      url: item.url,
      poster: posterById.get(item.poster.id) || "",
    };
    if (playUrl) record.playUrl = playUrl;
    return record;
  });
  await assertAttachmentsOpen(pool, fileIds);
  await assertReachable([...audioUrls, ...fileUrls, ...videoLinks]);
  await assertRespondsTo(pool, respondsTo, ownerId);
  const external = {
    audio: audioUrls.map((url) => ({ url })),
    attachments: fileUrls.map((url) => ({ url })),
  };
  const listed = kind === "post" || kind === "fastpost" ? publicOf(isPublic) : false;
  const billable = owned.filter((row) => isAttachmentUpload({ originalname: row.original_name }));
  const priced = kind === "wish" ? 0 : actor === "platform" ? servicePrice(price) : packetPrice(billable.length, price);
  // 出售帖 = post/fastpost 且有可下载附件、且标价大于 0。与 SALE_POST 同口径，平台时长、用户不可填。
  // 零价附件帖只是「附带全文」，不设有效期。
  const isSale = (kind === "post" || kind === "fastpost") && priced > 0 && owned.some(isDownloadableFile);
  const expiresAt = wishExpiry ?? (isSale ? saleExpiresAt() : null);
  let intelId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO intel (account_id, actor, door, body, videos, links, content_hash, is_public, kind, responds_to, price, expires_at, origin_id, version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [userId, actor, door, body, JSON.stringify(storedVideos), JSON.stringify(external), hash, listed, kind, respondsTo, priced, expiresAt, revision.originId, revision.version]
    );
    intelId = inserted.rows[0].id;
    for (let i = 0; i < owned.length; i += 1) {
      await client.query(`INSERT INTO intel_files (intel_id, upload_id, sort_order) VALUES ($1, $2, $3)`, [
        intelId,
        owned[i].id,
        i,
      ]);
    }
    // 四种发布都按附件字节收发布服务费。图片和音频直接显示，不计入。
    // 平台自产（信息检索结果）不向自己收发布服务费，只在下游下载时收检索价。
    if (actor !== "platform") {
      await chargePublish(client, { userId, intelId, bytes: billable.reduce((sum, row) => sum + Number(row.size || 0), 0) });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.message === "insufficient_points") error.code = "insufficient_points";
    if (error.code !== "23505") throw error;
    const again = await pool.query(
      `SELECT id FROM intel WHERE account_id = $1 AND content_hash = $2`,
      [userId, hash]
    );
    if (!again.rows[0]) throw error;
    await mention(again.rows[0].id);
    return loadPresentedIntel(pool, again.rows[0].id);
  } finally {
    client.release();
  }
  await mention(intelId);
  if (kind === "wishRespond" && respondsTo) await notifyWishResponse(pool, { wishId: respondsTo, ownerId });
  if (kind === "post" || kind === "fastpost" || kind === "wish") touchDiscoverBoard();
  if (!intelAgentId()) {
    try {
      return await judgeIntel(pool, intelId);
    } catch (error) {
      await holdForRetry(pool, intelId, error);
      return loadPresentedIntel(pool, intelId);
    }
  }
  enqueueReview(pool, intelId);
  return loadPresentedIntel(pool, intelId);
}

const PUBLIC_INTEL_SQL = `
  SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.weight, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.account_id, i.actor, i.is_public, i.created_at, i.updated_at, i.expires_at, i.origin_id, i.version,
    u.display_name, u.avatar_upload_id,
    EXISTS (
      SELECT 1 FROM intel_stars s
      WHERE s.intel_id = i.id AND s.account_id = $1
    ) AS starred,
    EXISTS (
      SELECT 1 FROM intel_likes l
      WHERE l.intel_id = i.id AND l.account_id = $1
    ) AS liked,
    ($1::uuid IS NOT NULL AND (
      i.account_id = $1 OR EXISTS (
        SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.account_id = $1
      )
    )) AS granted,
${FRIEND_COLUMNS},
    ${TIP_TOTAL_SQL}
  FROM intel i
  JOIN accounts u ON u.id = i.account_id
  WHERE ${visibleVerdict("i.verdict")}
    AND i.is_public
    AND i.kind IN ('post', 'fastpost')
    AND ($1::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM intel_dismissals d
      WHERE d.intel_id = i.id AND d.account_id = $1
    ))
    AND NOT EXISTS (
      SELECT 1 FROM intel newer
      WHERE COALESCE(newer.origin_id, newer.id) = COALESCE(i.origin_id, i.id)
        AND newer.version > i.version
        AND newer.is_public
        AND newer.kind IN ('post', 'fastpost')
        AND ${visibleVerdict("newer.verdict")}
    )
`;

export function compareByWeight(a, b) {
  const weight = (b.weight || 0) - (a.weight || 0);
  if (weight) return weight;
  return new Date(b.created_at) - new Date(a.created_at);
}

// 筛选值去空白、截断，避免超长参数进查询。
function filterText(raw, max) {
  const value = String(raw ?? "").trim();
  return value ? value.slice(0, max) : "";
}

// 类型与热词筛选：类型精确匹配 category，热词命中 detail.topics 里的某个关键词。
// 另有来源（actor）和时间段（since）坐标，让代理能表达「这个领域最近三天、多来源」这类取数。
const ACTORS = new Set(["person", "personal_agent", "platform"]);

function validSince(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function filterSql(filters, params) {
  let sql = "";
  const category = filterText(filters?.category, 40);
  if (category) {
    params.push(category);
    sql += ` AND i.category = $${params.length}`;
  }
  const topic = filterText(filters?.topic, 20);
  if (topic) {
    params.push(topic);
    sql += ` AND (i.detail -> 'topics') ? $${params.length}`;
  }
  const source = filterText(filters?.source, 16);
  if (source && ACTORS.has(source)) {
    params.push(source);
    sql += ` AND i.actor = $${params.length}`;
  }
  const since = validSince(filters?.since);
  if (since) {
    params.push(since);
    sql += ` AND i.created_at >= $${params.length}::timestamptz`;
  }
  return sql;
}

// 出售 = 有可下载附件（非图片、非音频）**且标价大于 0** 的 post/fastpost。
// 有附件但标价 0 的是「附带全文」的普通帖，留在信息流，也不写 expires_at。
// 出售帖离开信息流，归入市场的出售区。
//
// 「可下载附件」是唯一口径，三处必须一致，改一处同步其余：
//   - HAS_ATTACHMENT（SQL，列表 / reopen 用）
//   - isDownloadableFile（JS，发布时写 expires_at 用）
//   - packetZip.kindOf（下载打包）、card.toRecord（展示）同为「非图片、非音频」
const HAS_ATTACHMENT = `EXISTS (
  SELECT 1 FROM intel_files f
  JOIN uploads u ON u.id = f.upload_id
  WHERE f.intel_id = i.id
    AND u.mime NOT LIKE 'image/%'
    AND NOT (u.mime LIKE 'audio/%' OR u.original_name ~* '\\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$')
)`;

// 出售帖 = 可下载附件 + 标价。零价帖不卖，留在信息流。
const SALE_POST = `(${HAS_ATTACHMENT} AND i.price > 0)`;

export function isDownloadableFile(row) {
  if (String(row.mime || "").startsWith("image/")) return false;
  return !isAudioUpload({ mime: row.mime, originalname: row.original_name });
}

// 出售帖有效期（小时）：平台设定，用户不可填。默认 72 小时，可用 KNOT_SALE_TTL_HOURS 覆盖。
const SALE_DEFAULT_TTL_HOURS = 72;

export function saleTtlHours() {
  const value = Number(process.env.KNOT_SALE_TTL_HOURS);
  return Number.isInteger(value) && value > 0 ? value : SALE_DEFAULT_TTL_HOURS;
}

export function saleExpiresAt(now = Date.now()) {
  return new Date(now + saleTtlHours() * 60 * 60 * 1000);
}

// 025 迁移之前的出售帖没有 expires_at，按创建时间加平台时长算（镜像 wish 的 fallback）。
function saleDeadline(alias = "i") {
  return `COALESCE(${alias}.expires_at, ${alias}.created_at + interval '${saleTtlHours()} hours')`;
}

// 只留仍在有效期内的出售帖。
export function saleLive(alias = "i") {
  return `${saleDeadline(alias)} > now()`;
}

// 作者删除自己的帖子：行留在库里，只把 verdict 记为 removed 并取消公开。
// 修订链上的所有版本一起撤下，免得删掉新版后旧版重新出现在信息流里。
export async function deleteOwnPost(pool, userId, intelId) {
  const { rows } = await pool.query(
    `SELECT id, account_id, kind, origin_id, verdict FROM intel WHERE id = $1`,
    [intelId]
  );
  const target = rows[0];
  if (!target || target.account_id !== userId) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  if (target.kind !== "post" && target.kind !== "fastpost") {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
  const { rows: removed } = await pool.query(
    `UPDATE intel
     SET verdict = 'removed', is_public = false,
         reject_reason = COALESCE(reject_reason, '作者删除'),
         updated_at = now()
     WHERE COALESCE(origin_id, id) = COALESCE($2::uuid, $1::uuid)
       AND verdict <> 'removed'
     RETURNING id`,
    [target.id, target.origin_id]
  );
  // 并发删除时后到的那次什么都没改，按已经删过处理。
  if (!removed.length) return { ok: true, already: true, id: intelId };
  for (const row of removed) await discardExtract(row.id);
  touchDiscoverBoard();
  return { ok: true, already: false, id: intelId };
}

export async function listPublicIntel(pool, limit = 30, userId = null, authorId = null, before = null, filters = {}) {
  const params = [userId];
  let sql = PUBLIC_INTEL_SQL;
  if (authorId) {
    params.push(authorId);
    sql += ` AND i.account_id = $${params.length}`;
  }
  sql += filterSql(filters, params);
  // 信息流只放不卖的；出售（有可下载附件且有标价）归市场。sales=true 时反过来只取出售，且只留仍在有效期内的。
  if (filters.sales === true) {
    sql += ` AND ${SALE_POST} AND ${saleLive("i")}`;
  } else {
    sql += ` AND NOT ${SALE_POST}`;
  }
  if (before) {
    // 键集分页：只取排在锚点（上一页最后一条）之后的内容，避免偏移翻页的重复与漏条。
    params.push(before);
    sql += `
    AND (i.created_at, i.weight, i.id) < (
      SELECT created_at, weight, id FROM intel WHERE id = $${params.length}::uuid
    )`;
  }
  params.push(limit);
  sql += ` ORDER BY i.created_at DESC, i.weight DESC, i.id DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function publicAuthor(pool, authorId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name, u.avatar_upload_id, u.role
     FROM accounts u
     WHERE u.id = $1
       AND EXISTS (
         SELECT 1 FROM intel i
         WHERE i.account_id = u.id
           AND i.is_public
           AND i.kind IN ('post', 'fastpost')
           AND ${visibleVerdict("i.verdict")}
       )`,
    [authorId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.display_name || "",
    avatarUrl: avatarUrlFor(row),
    // agent 是机器人，owner / user 是人：筛选条上的作者胶囊据此画徽标。
    role: row.role || "",
  };
}

export async function searchPublicIntel(pool, query, userId = null, filters = {}) {
  const params = [userId];
  // 候选集上限 500：把「可能命中」的行收进内存打分。真正的内存墙在这里，v0.3 换 trigram / 向量后去掉全量拉取。
  const sql = `${PUBLIC_INTEL_SQL}${filterSql(filters, params)} ORDER BY i.weight DESC, i.created_at DESC LIMIT 500`;
  const { rows } = await pool.query(sql, params);
  // 检索打点（只记不扣费）：先量化代理替人「筛选」的次数，供精算师看。
  recordSearchEvent(pool, userId, query).catch(() => {});
  const extracts = await extractsFor(rows.map((row) => row.id));
  const scored = rows
    .map((row, index) => ({ ...row, score: scoreText(query, `${intelText(row)} ${extracts[index] || ""}`) }))
    .filter((row) => row.score > 0);
  // 完整命中（score >= 1）优先，别让「只碰到一两个字的日报」挤掉真正相关的结果；
  // 一个完整命中都没有时，才回退到部分命中，至少给点结果而不是空手。
  const exact = scored.filter((row) => row.score >= 1);
  const candidates = exact.length ? exact : scored;
  // 相关度优先；相关度相同时按权重、再按时间，与信息流保持一致。
  return candidates
    .sort((a, b) => (b.score - a.score) || compareByWeight(a, b))
    .slice(0, 30);
}

// 给一批行挂上附件，再组装成同一份记录。Agent 读路径和信息流共用，保证 shape 一致。
export async function presentIntelRows(pool, rows) {
  if (!rows.length) return [];
  const files = await filesByIntel(pool, rows.map((row) => row.id));
  return rows.map((row) => presentIntel({ ...row, files: files.get(row.id) || [] }));
}

// 按 id 读一条公开记录，带当前账户的 star/like/granted/friend 个人态。读不到返回 null。
// 读到即记一次读痕迹（只记不扣费），供「回音室」可观测和未来注意力计价。
//
// 地址按「帖子」算，不按版本：深链和分享图里可能还是首版或中间版的 id，
// 这里先归一到一个修订链，再取其中最新的可见版本。这样作者改一版重发，旧链接不会停在旧稿上。
export async function loadPublicIntel(pool, userId, id) {
  const params = [userId, id];
  const sql = `${PUBLIC_INTEL_SQL} AND COALESCE(i.origin_id, i.id) = (SELECT COALESCE(origin_id, id) FROM intel WHERE id = $2::uuid)`;
  const { rows } = await pool.query(sql, params);
  if (!rows.length) return null;
  recordIntelRead(pool, userId, rows[0].id).catch(() => {});
  const [record] = await presentIntelRows(pool, rows);
  return record;
}

export async function setIntelStar(pool, userId, intelId, starred) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id FROM intel WHERE id = $1 AND ${visibleVerdict("verdict")} AND is_public FOR UPDATE`,
      [intelId]
    );
    if (!found.rows.length) {
      const error = new Error("not_found");
      error.code = "not_found";
      throw error;
    }
    if (starred) {
      await client.query(
        `INSERT INTO intel_stars (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, intelId]
      );
    } else {
      await client.query(`DELETE FROM intel_stars WHERE account_id = $1 AND intel_id = $2`, [userId, intelId]);
    }
    await client.query(
      `UPDATE intel
       SET weight = (SELECT count(*)::int FROM intel_stars WHERE intel_id = $1)
       WHERE id = $1`,
      [intelId]
    );
    await client.query("COMMIT");
    touchDiscoverBoard();
    return { starred: Boolean(starred) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setIntelLike(pool, userId, intelId, liked) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id FROM intel WHERE id = $1 AND ${visibleVerdict("verdict")} AND is_public FOR UPDATE`,
      [intelId]
    );
    if (!found.rows.length) {
      const error = new Error("not_found");
      error.code = "not_found";
      throw error;
    }
    if (liked) {
      await client.query(
        `INSERT INTO intel_likes (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, intelId]
      );
    } else {
      await client.query(`DELETE FROM intel_likes WHERE account_id = $1 AND intel_id = $2`, [userId, intelId]);
    }
    await client.query("COMMIT");
    return { liked: Boolean(liked) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadDownloadIntel(db, intelId, lock) {
  const { rows } = await db.query(
    `SELECT i.id, i.account_id, i.body, i.videos, i.links, i.category, i.price, i.is_public, i.kind, i.responds_to, i.created_at, u.display_name
     FROM intel i
     JOIN accounts u ON u.id = i.account_id
     WHERE i.id = $1 AND ${visibleVerdict("i.verdict")}
     ${lock ? "FOR UPDATE OF i" : ""}`,
    [intelId]
  );
  return rows[0] || null;
}

async function assertCanDownload(db, intel, userId) {
  // 作者可能是 Agent，下载者可能是它的主人：同一个人不该为同一件东西再付一次钱。
  if (intel.kind === "wish" || intel.is_public || (await sameWallet(db, intel.account_id, userId))) return;
  if (intel.kind === "wishRespond" && intel.responds_to) {
    const parent = await db.query(
      `SELECT 1 FROM intel WHERE id = $1 AND account_id = $2 AND kind = 'wish'`,
      [intel.responds_to, userId]
    );
    if (parent.rows.length) return;
  }
  const error = new Error("not_found");
  error.code = "not_found";
  throw error;
}

async function intelBytes(db, intelId) {
  const { rows } = await db.query(
    `SELECT u.size, u.original_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1`,
    [intelId]
  );
  return rows
    .filter((row) => isAttachmentUpload({ originalname: row.original_name }))
    .reduce((sum, row) => sum + Number(row.size || 0), 0);
}

// 发布服务费：按附件字节收，平台收（存储/传输）。四种发布共用。
async function chargePublish(client, { userId, intelId, bytes }) {
  const fee = serviceFee(bytes, economyConfig().publishServiceFeePerMb, economyConfig().serviceFeeCap);
  if (fee <= 0) return;
  await applyPoints(client, { userId, delta: -fee, reason: "publish", refId: intelId });
  await applyPoints(client, { userId: PLATFORM_ACCOUNT_ID, delta: fee, reason: "publish", refId: intelId });
}

// wish 下载前先解锁响应列表（免费），服务费由 chargeDownload 收。
async function unlockRequest(client, intel, userId) {
  if (await sameWallet(client, intel.account_id, userId)) return;
  await client.query(
    `INSERT INTO request_unlocks (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, intel.id]
  );
}

async function chargeDownload(client, intel, userId) {
  // 同一个钱包（账号与它名下的 Agent）不付自己的钱。
  if (await sameWallet(client, intel.account_id, userId)) return;
  const prior = await client.query(
    `SELECT 1 FROM packet_downloads WHERE account_id = $1 AND intel_id = $2`,
    [userId, intel.id]
  );
  if (prior.rows.length) return;
  const price = Number(intel.price) || 0;
  const fee = serviceFee(await intelBytes(client, intel.id), economyConfig().downloadServiceFeePerMb, economyConfig().serviceFeeCap);
  const total = price + fee;
  if (total > 0) {
    await applyPoints(client, {
      userId,
      delta: -total,
      reason: "download",
      refId: intel.id,
    });
    if (price > 0) {
      await applyPoints(client, {
        userId: intel.account_id,
        delta: price,
        reason: "download",
        refId: intel.id,
      });
    }
    if (fee > 0) {
      await applyPoints(client, {
        userId: PLATFORM_ACCOUNT_ID,
        delta: fee,
        reason: "download_fee",
        refId: intel.id,
      });
    }
  }
  await client.query(
    `INSERT INTO packet_downloads (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, intel.id]
  );
}

export async function downloadPacket(pool, userId, intelId, uploadDir, { zip = false } = {}) {
  const intel = await loadDownloadIntel(pool, intelId, false);
  if (!intel) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  await assertCanDownload(pool, intel, userId);
  const { rows: fileRows } = await pool.query(
    `SELECT u.mime, u.original_name, u.storage_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [intelId]
  );
  const sources = archiveSources(fileRows);
  if (!sources.length) {
    const error = new Error("nothing_to_download");
    error.code = "nothing_to_download";
    throw error;
  }
  let zipPath = "";
  if (sources.length) {
    if (!uploadDir) {
      const error = new Error("packet_unavailable");
      error.code = "packet_unavailable";
      throw error;
    }
    zipPath = await ensurePacketZip(
      uploadDir,
      intel.id,
      packetReadme({
        category: intel.category,
        price: intel.price,
        author: intel.display_name,
        createdAt: intel.created_at,
        videos: intel.videos,
        links: intel.links,
        body: intel.body,
        files: sources,
      }),
      sources
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await loadDownloadIntel(client, intelId, true);
    if (!locked) {
      const error = new Error("not_found");
      error.code = "not_found";
      throw error;
    }
    await assertCanDownload(client, locked, userId);
    if (locked.kind === "wish") await unlockRequest(client, locked, userId);
    // wish 标价恒为 0，这里只收下载服务费；无附件时服务费为 0。
    await chargeDownload(client, locked, userId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.message === "insufficient_points") error.code = "insufficient_points";
    throw error;
  } finally {
    client.release();
  }
  return {
    intel: await loadPresentedIntel(pool, intelId),
    zipPath,
    downloadName: packetDownloadName(intel.body),
  };
}

// 再次开放到期的出售帖：仅作者，仅 post/fastpost 且有可下载附件、标价大于 0。免费，只把 expires_at 重置为 now + 平台时长。
export async function reopenSale(pool, userId, intelId) {
  const { rows } = await pool.query(
    `SELECT i.id
     FROM intel i
     WHERE i.id = $1
       AND i.account_id = $2
       AND i.kind IN ('post', 'fastpost')
       AND i.is_public
       AND ${visibleVerdict("i.verdict")}
       AND ${SALE_POST}`,
    [intelId, userId]
  );
  if (!rows.length) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  const expiresAt = saleExpiresAt();
  await pool.query(
    `UPDATE intel SET expires_at = $2, updated_at = now() WHERE id = $1`,
    [intelId, expiresAt]
  );
  return loadPresentedIntel(pool, intelId);
}
