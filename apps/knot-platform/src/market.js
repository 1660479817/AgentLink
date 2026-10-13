import { access } from "node:fs/promises";
import { intelAgentId, runIntelAgent } from "./agents/openclaw.js";
import { toRecord } from "./card.js";
import { loadBootstrapConfig } from "./config.js";
import { fileView, MAX_AUDIO, MAX_FILES, MAX_IMAGES, publicOf, videosOf } from "./information.js";
import { assertReachable, contentHash } from "./links.js";
import { postersFor } from "./videoPoster.js";
import { recordNotification } from "./notifications.js";
import { archiveSources, ensurePacketZip, packetDownloadName, packetReadme } from "./packetZip.js";
import { assertCanSpeak } from "./account.js";
import { applyPoints, feeConfig, packetPrice, PLATFORM_USER_ID } from "./points.js";
import { scoreText } from "./search.js";
import { ensureCardPreview, removeCardPreview } from "./preview.js";
import { publicUploadUrl, storagePath } from "./uploads.js";

function videoText(videos) {
  if (!Array.isArray(videos)) return "";
  return videos
    .map((item) => (typeof item === "string" ? item : item?.url))
    .filter((url) => typeof url === "string" && url)
    .join(" ");
}

function intelText(row) {
  const note = row.detail && typeof row.detail.note === "string" ? row.detail.note : "";
  return `${row.body || ""} ${note} ${videoText(row.videos)}`.trim();
}

async function imageFiles(pool, intelId) {
  const { uploadDir } = loadBootstrapConfig();
  const { rows } = await pool.query(
    `SELECT u.storage_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1 AND u.mime LIKE 'image/%'
     ORDER BY f.sort_order ASC, f.upload_id ASC
     LIMIT 4`,
    [intelId]
  );
  const files = [];
  for (const row of rows) {
    const file = storagePath(uploadDir, row.storage_name);
    await access(file);
    files.push(file);
  }
  return files;
}

export function presentIntel(row) {
  if (!row) return null;
  const author = row.display_name !== undefined
    ? {
        name: row.display_name || "",
        avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
      }
    : undefined;
  return toRecord(row, {
    files: row.files || row.attachments || [],
    granted: row.granted !== false,
    author,
    starred: row.starred,
  });
}

async function filesByIntel(pool, ids) {
  const byId = new Map();
  if (!ids.length) return byId;
  const { rows } = await pool.query(
    `SELECT f.intel_id, u.id, u.mime, u.original_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = ANY($1::uuid[])
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [ids]
  );
  for (const row of rows) {
    const list = byId.get(row.intel_id) || [];
    list.push(fileView(row));
    byId.set(row.intel_id, list);
  }
  return byId;
}

async function loadIntel(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, user_id, body, videos, verdict, detail, kind, responds_to FROM intel WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadPresentedIntel(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, user_id, body, videos, links, content_hash, verdict, reject_reason, category, price, is_public, kind, responds_to, weight, created_at, updated_at FROM intel WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const files = await filesByIntel(pool, [id]);
  return presentIntel({ ...rows[0], files: files.get(id) || [] });
}

export async function judgeIntel(pool, id) {
  const intel = await loadIntel(pool, id);
  if (!intel || intel.verdict !== "pending") return presentIntel(intel);
  let result = { verdict: "pass", reason: "", note: "", category: "" };
  if (intelAgentId()) {
    const images = await imageFiles(pool, id);
    result = await runIntelAgent(intel, images);
  }
  if (result.verdict === "reject") {
    const { rows } = await pool.query(
      `UPDATE intel SET verdict = 'rejected', reject_reason = $2, detail = NULL, category = ''
       WHERE id = $1 AND verdict = 'pending'
       RETURNING id`,
      [id, result.reason]
    );
    if (rows.length) {
      await recordNotification(pool, {
        userId: intel.user_id,
        kind: "intel_rejected",
        title: "信息未通过",
        body: result.reason,
        href: "/mine/submissions",
      });
    }
  } else {
    const { rows } = await pool.query(
      `UPDATE intel SET verdict = 'passed', reject_reason = NULL, category = $2, detail = $3::jsonb
       WHERE id = $1 AND verdict = 'pending'
       RETURNING id`,
      [id, result.category || "", JSON.stringify({ note: result.note || "" })]
    );
    if (rows.length) {
      const response = intel.kind === "wishRespond" && intel.responds_to;
      await recordNotification(pool, {
        userId: intel.user_id,
        kind: "intel_passed",
        title: response ? "回应已交给发出 wish 的人" : "已留下",
        body: result.category || "",
        href: "/mine/submissions",
      });
      if (response) {
        const owner = await pool.query(`SELECT user_id FROM intel WHERE id = $1 AND kind = 'wish'`, [intel.responds_to]);
        const ownerId = owner.rows[0]?.user_id;
        if (ownerId && ownerId !== intel.user_id) {
          await recordNotification(pool, {
            userId: ownerId,
            kind: "request_response",
            title: "有一条 wish 响应",
            body: "",
            href: `/wish?wish=${intel.responds_to}`,
          });
        }
      }
    }
  }
  return loadPresentedIntel(pool, id);
}

async function assertRespondsTo(pool, requestId, userId) {
  if (!requestId) return;
  const { rows } = await pool.query(
    `SELECT user_id FROM intel WHERE id = $1 AND kind = 'wish' AND verdict = 'passed'`,
    [requestId]
  );
  if (!rows.length || rows[0].user_id === userId) {
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

export async function createIntel(pool, input) {
  const { userId, actor, door, body, videos = [], isPublic = true, price } = input;
  await assertCanSpeak(pool, userId);
  const imageIds = (input.imageIds || []).slice(0, MAX_IMAGES);
  const imageUrls = (input.imageUrls || []).slice(0, Math.max(0, MAX_IMAGES - imageIds.length));
  const audioIds = (input.audioIds || []).slice(0, MAX_AUDIO);
  const audioUrls = (input.audioUrls || []).slice(0, Math.max(0, MAX_AUDIO - audioIds.length));
  const fileIds = (input.fileIds || []).slice(0, MAX_FILES);
  const fileUrls = (input.fileUrls || []).slice(0, Math.max(0, MAX_FILES - fileIds.length));
  const { kind, respondsTo } = resolveKind(input);
  const hash = contentHash({
    kind,
    respondsTo,
    body,
    imageIds,
    imageUrls,
    audioIds,
    audioUrls,
    fileIds,
    fileUrls,
    videos: videosOf(videos),
  });
  const prior = await pool.query(
    `SELECT id FROM intel WHERE user_id = $1 AND content_hash = $2 AND verdict <> 'pending'`,
    [userId, hash]
  );
  if (prior.rows[0]) return loadPresentedIntel(pool, prior.rows[0].id);
  const uploadIds = [...new Set([...imageIds.slice(0, MAX_IMAGES), ...audioIds.slice(0, MAX_AUDIO), ...fileIds.slice(0, MAX_FILES)])];
  if (kind !== "wish" && uploadIds.length) packetPrice(1, price);
  let owned = [];
  if (uploadIds.length) {
    const { rows } = await pool.query(
      `SELECT id FROM uploads WHERE user_id = $1 AND id = ANY($2::uuid[])`,
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
  const videoLinks = videosOf(videos);
  await assertReachable([...imageUrls, ...audioUrls, ...fileUrls, ...videoLinks]);
  await assertRespondsTo(pool, respondsTo, userId);
  const posters = await postersFor(videoLinks);
  const external = {
    images: imageUrls.map((url) => ({ url })),
    audio: audioUrls.map((url) => ({ url })),
    attachments: fileUrls.map((url) => ({ url })),
  };
  const listed = kind === "post" || kind === "fastpost" ? publicOf(isPublic) : false;
  let intelId;
  try {
    const inserted = await pool.query(
      `INSERT INTO intel (user_id, actor, door, body, videos, links, content_hash, is_public, kind, responds_to)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10) RETURNING id`,
      [userId, actor, door, body, JSON.stringify(posters), JSON.stringify(external), hash, listed, kind, respondsTo]
    );
    intelId = inserted.rows[0].id;
  } catch (error) {
    if (error.code !== "23505") throw error;
    const again = await pool.query(
      `SELECT id FROM intel WHERE user_id = $1 AND content_hash = $2`,
      [userId, hash]
    );
    if (!again.rows[0]) throw error;
    return loadPresentedIntel(pool, again.rows[0].id);
  }
  for (let i = 0; i < owned.length; i += 1) {
    await pool.query(`INSERT INTO intel_files (intel_id, upload_id, sort_order) VALUES ($1, $2, $3)`, [
      intelId,
      owned[i].id,
      i,
    ]);
  }
  const priced = kind === "wish"
    ? (owned.length ? feeConfig().requestFee : 0)
    : packetPrice(owned.length, price);
  await pool.query(`UPDATE intel SET price = $2 WHERE id = $1`, [intelId, priced]);
  try {
    await ensureCardPreview(pool, intelId);
  } catch (error) {
    console.error(error);
  }
  try {
    return await judgeIntel(pool, intelId);
  } catch (error) {
    try {
      await pool.query(`DELETE FROM intel WHERE id = $1 AND verdict = 'pending'`, [intelId]);
      await removeCardPreview(intelId);
    } catch (cleanup) {
      console.error(cleanup);
    }
    throw error;
  }
}

const PUBLIC_INTEL_SQL = `
  SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.weight, i.price, i.category, i.kind, i.responds_to, i.verdict, i.reject_reason, i.user_id, i.is_public, i.created_at, i.updated_at,
    u.display_name, u.avatar_upload_id,
    EXISTS (
      SELECT 1 FROM intel_stars s
      WHERE s.intel_id = i.id AND s.user_id = $1
    ) AS starred,
    ($1::uuid IS NOT NULL AND (
      i.user_id = $1 OR EXISTS (
        SELECT 1 FROM packet_downloads pd WHERE pd.intel_id = i.id AND pd.user_id = $1
      )
    )) AS granted
  FROM intel i
  JOIN users u ON u.id = i.user_id
  WHERE i.verdict = 'passed'
    AND i.is_public
    AND i.kind IN ('post', 'fastpost')
    AND ($1::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM intel_dismissals d
      WHERE d.intel_id = i.id AND d.user_id = $1
    ))
`;

export function compareByWeight(a, b) {
  const weight = (b.weight || 0) - (a.weight || 0);
  if (weight) return weight;
  return new Date(b.created_at) - new Date(a.created_at);
}

export async function listPublicIntel(pool, limit = 30, userId = null) {
  const { rows } = await pool.query(
    `${PUBLIC_INTEL_SQL} ORDER BY i.weight DESC, i.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function searchPublicIntel(pool, query, userId = null) {
  const { rows } = await pool.query(
    `${PUBLIC_INTEL_SQL} ORDER BY i.weight DESC, i.created_at DESC LIMIT 500`,
    [userId]
  );
  return rows
    .map((row) => ({ ...row, score: scoreText(query, intelText(row)) }))
    .filter((row) => row.score > 0)
    .sort(compareByWeight)
    .slice(0, 30);
}

export async function setIntelStar(pool, userId, intelId, starred) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id FROM intel WHERE id = $1 AND verdict = 'passed' AND is_public FOR UPDATE`,
      [intelId]
    );
    if (!found.rows.length) {
      const error = new Error("not_found");
      error.code = "not_found";
      throw error;
    }
    if (starred) {
      await client.query(
        `INSERT INTO intel_stars (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, intelId]
      );
    } else {
      await client.query(`DELETE FROM intel_stars WHERE user_id = $1 AND intel_id = $2`, [userId, intelId]);
    }
    await client.query(
      `UPDATE intel
       SET weight = (SELECT count(*)::int FROM intel_stars WHERE intel_id = $1)
       WHERE id = $1`,
      [intelId]
    );
    await client.query("COMMIT");
    return { starred: Boolean(starred) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadDownloadIntel(db, intelId, lock) {
  const { rows } = await db.query(
    `SELECT i.id, i.user_id, i.body, i.videos, i.links, i.category, i.price, i.is_public, i.kind, i.responds_to, i.created_at, u.display_name
     FROM intel i
     JOIN users u ON u.id = i.user_id
     WHERE i.id = $1 AND i.verdict = 'passed'
     ${lock ? "FOR UPDATE OF i" : ""}`,
    [intelId]
  );
  return rows[0] || null;
}

async function assertCanDownload(db, intel, userId) {
  if (intel.kind === "wish" || intel.is_public || intel.user_id === userId) return;
  if (intel.kind === "wishRespond" && intel.responds_to) {
    const parent = await db.query(
      `SELECT 1 FROM intel WHERE id = $1 AND user_id = $2 AND kind = 'wish'`,
      [intel.responds_to, userId]
    );
    if (parent.rows.length) return;
  }
  const error = new Error("not_found");
  error.code = "not_found";
  throw error;
}

async function chargeRequest(client, intel, userId) {
  if (intel.user_id === userId) return;
  const prior = await client.query(
    `SELECT 1 FROM request_unlocks WHERE user_id = $1 AND intel_id = $2`,
    [userId, intel.id]
  );
  if (prior.rows.length) return;
  const fee = Number(intel.price) || 0;
  if (fee > 0) {
    await applyPoints(client, {
      userId,
      delta: -fee,
      reason: "request_detail",
      refId: intel.id,
    });
    await applyPoints(client, {
      userId: PLATFORM_USER_ID,
      delta: fee,
      reason: "request_detail",
      refId: intel.id,
    });
  }
  await client.query(
    `INSERT INTO request_unlocks (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, intel.id]
  );
}

async function chargeDownload(client, intel, userId) {
  if (intel.user_id === userId) return;
  const prior = await client.query(
    `SELECT 1 FROM packet_downloads WHERE user_id = $1 AND intel_id = $2`,
    [userId, intel.id]
  );
  if (!prior.rows.length && intel.price > 0) {
    await applyPoints(client, {
      userId,
      delta: -intel.price,
      reason: "download",
      refId: intel.id,
    });
    await applyPoints(client, {
      userId: intel.user_id,
      delta: intel.price,
      reason: "download",
      refId: intel.id,
    });
  }
  await client.query(
    `INSERT INTO packet_downloads (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
    if (locked.kind === "wish") await chargeRequest(client, locked, userId);
    else await chargeDownload(client, locked, userId);
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
