import { uploadName } from "./information.js";
import { publicUploadUrl } from "./uploads.js";
import { storeUploadedFile } from "./uploadStore.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_URL = /^\/api\/web\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const TITLE_MAX = 80;
const HREF_MAX = 500;
const CAPTION_MAX = 120;
const SOURCE_MAX = 40;
const PLATFORM_USER_ID = "00000000-0000-4000-8000-000000000001";
const SPONSOR_COLUMNS = `id, title, href, position, image_url, image_upload_id, caption, source`;
export const SPONSOR_LIMIT = 8;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function sponsorTitle(value) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!title || title.length > TITLE_MAX) throw fail("bad_body");
  return title;
}

export function sponsorHref(value) {
  const href = String(value ?? "").trim();
  if (!href || href.length > HREF_MAX || /[\s\\]/.test(href)) throw fail("bad_href");
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  let url;
  try {
    url = new URL(href);
  } catch {
    throw fail("bad_href");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw fail("bad_href");
  return href;
}

function line(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > max) throw fail("bad_body");
  return text;
}

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

export async function sponsorImage(pool, value) {
  if (value === null || String(value ?? "").trim() === "") return { imageUrl: null, imageUploadId: null };
  const text = String(value).trim();
  const upload = text.match(UPLOAD_URL);
  const uploadId = upload ? upload[1] : UUID.test(text) ? text : "";
  if (uploadId) {
    const { rows } = await pool.query(`SELECT id FROM uploads WHERE id = $1 AND mime LIKE 'image/%'`, [uploadId]);
    if (!rows.length) throw fail("bad_image");
    return { imageUrl: null, imageUploadId: uploadId };
  }
  let href;
  try {
    href = sponsorHref(text);
  } catch {
    throw fail("bad_image");
  }
  if (href.startsWith("/")) throw fail("bad_image");
  return { imageUrl: href, imageUploadId: null };
}

function present(row, position) {
  const item = {
    id: row.id,
    title: row.title,
    href: row.href,
    image: row.image_upload_id ? publicUploadUrl(row.image_upload_id) : row.image_url || null,
    caption: row.caption || "",
    source: row.source || "",
  };
  if (position) item.position = row.position;
  return item;
}

export async function listSponsors(pool, { position = false } = {}) {
  const { rows } = await pool.query(
    `SELECT ${SPONSOR_COLUMNS}
     FROM sponsors
     ORDER BY position ASC, created_at ASC`
  );
  return rows.map((row) => present(row, position));
}

export function listPublicSponsors(pool) {
  return listSponsors(pool);
}

export async function createSponsor(pool, input) {
  const title = sponsorTitle(input?.title);
  const href = sponsorHref(input?.href);
  const image = has(input, "image") ? await sponsorImage(pool, input.image) : { imageUrl: null, imageUploadId: null };
  const caption = line(input?.caption, CAPTION_MAX);
  const source = line(input?.source, SOURCE_MAX);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n, COALESCE(max(position), 0)::int AS max FROM sponsors`
  );
  if (Number(rows[0].n) >= SPONSOR_LIMIT) throw fail("sponsor_full");
  const inserted = await pool.query(
    `INSERT INTO sponsors (title, href, position, image_url, image_upload_id, caption, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SPONSOR_COLUMNS}`,
    [title, href, Number(rows[0].max) + 1, image.imageUrl, image.imageUploadId, caption, source]
  );
  return present(inserted.rows[0], true);
}

export async function storeSponsorImage(pool, uploadDir, file) {
  const name = uploadName(file?.originalname);
  try {
    const stored = await storeUploadedFile({
      uploadDir,
      pool,
      userId: PLATFORM_USER_ID,
      file,
      kind: "image",
      name,
      skipQuota: true,
    });
    return { id: stored.id, url: stored.url };
  } catch (error) {
    throw fail(error?.code === "bad_mime" ? "bad_mime" : "upload_failed");
  }
}

export async function updateSponsor(pool, id, input) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const fields = [];
  const params = [id];
  if (input?.title !== undefined) {
    params.push(sponsorTitle(input.title));
    fields.push(`title = $${params.length}`);
  }
  if (input?.href !== undefined) {
    params.push(sponsorHref(input.href));
    fields.push(`href = $${params.length}`);
  }
  if (has(input, "image")) {
    const image = await sponsorImage(pool, input.image);
    params.push(image.imageUrl);
    fields.push(`image_url = $${params.length}`);
    params.push(image.imageUploadId);
    fields.push(`image_upload_id = $${params.length}`);
  }
  if (has(input, "caption")) {
    params.push(line(input.caption, CAPTION_MAX));
    fields.push(`caption = $${params.length}`);
  }
  if (has(input, "source")) {
    params.push(line(input.source, SOURCE_MAX));
    fields.push(`source = $${params.length}`);
  }
  if (!fields.length) throw fail("bad_body");
  fields.push("updated_at = now()");
  const { rows } = await pool.query(
    `UPDATE sponsors SET ${fields.join(", ")} WHERE id = $1 RETURNING ${SPONSOR_COLUMNS}`,
    params
  );
  if (!rows.length) throw fail("not_found");
  return present(rows[0], true);
}

export async function removeSponsor(pool, id) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const { rows } = await pool.query(`DELETE FROM sponsors WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) throw fail("not_found");
  return { ok: true, id };
}

export async function placeSponsor(pool, id, position) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const pos = Number(position);
  if (!Number.isSafeInteger(pos) || pos < 1) throw fail("bad_position");
  const { rows } = await pool.query(`SELECT id FROM sponsors ORDER BY position ASC, created_at ASC`);
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) throw fail("not_found");
  const [item] = rows.splice(index, 1);
  rows.splice(Math.min(pos, rows.length + 1) - 1, 0, item);
  await pool.query(
    `UPDATE sponsors AS s
     SET position = v.position, updated_at = now()
     FROM unnest($1::uuid[], $2::int[]) AS v(id, position)
     WHERE s.id = v.id`,
    [rows.map((row) => row.id), rows.map((_, i) => i + 1)]
  );
  return { ok: true, id, position: rows.findIndex((row) => row.id === id) + 1 };
}
