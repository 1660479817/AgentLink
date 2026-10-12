const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_IMAGES = 3;
export const MAX_FILES = 5;

export function idsOf(value, limit) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = typeof item === "string" ? item : item?.id;
    if (typeof id !== "string" || !UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function fileView(row) {
  const mime = row.mime || "";
  return {
    id: row.id,
    name: row.original_name || "",
    mime,
    url: `/api/web/uploads/${row.id}`,
    image: mime.startsWith("image/"),
  };
}

function partOf(file) {
  return {
    id: file.id,
    url: file.url,
    name: file.name || "",
    mime: file.mime || "",
  };
}

export function informationOf({ body = "", files = [] }) {
  const images = [];
  const attachments = [];
  for (const file of files) {
    const part = partOf(file);
    if (file.image) images.push(part);
    else attachments.push(part);
  }
  return {
    body: typeof body === "string" ? body.trim() : "",
    images,
    attachments,
  };
}

export function hasInformation(info) {
  return Boolean(info.body || info.images.length || info.attachments.length);
}

export function listedFiles(files, granted) {
  return (files || []).map((file) => {
    if (granted) return file;
    return {
      id: file.id,
      name: file.name || "",
      mime: file.mime || "",
      image: Boolean(file.image),
    };
  });
}
