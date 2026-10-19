import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadBootstrapConfig } from "./config.js";
import { derivedDir, legacyDerivedDir } from "./storage.js";
import { extractDocumentText } from "@knot/doc-reader";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractFile(uploadDir, intelId) {
  if (!ID.test(String(intelId || ""))) throw new Error("bad_id");
  return path.join(derivedDir(uploadDir, "extracts"), `${intelId}.md`);
}

export function sectionHeading(kind, index, name) {
  const label = String(name || "").replace(/[\r\n#]+/g, " ").replace(/\s+/g, " ").trim();
  const prefix = kind === "image" ? "图片" : "附件";
  return label ? `${prefix} ${index + 1} ${label}` : `${prefix} ${index + 1}`;
}

export function renderExtract(sections) {
  const blocks = (Array.isArray(sections) ? sections : [])
    .map((section) => ({
      heading: String(section?.heading || "").replace(/[\r\n]+/g, " ").trim() || "内容",
      text: String(section?.text || "").trim(),
    }))
    .filter((section) => section.text);
  if (!blocks.length) return "";
  return `${blocks.map((section) => `# ${section.heading}\n\n${section.text}`).join("\n\n")}\n`;
}

export async function writeExtract(uploadDir, intelId, sections) {
  const file = extractFile(uploadDir, intelId);
  const body = renderExtract(sections);
  if (!body) {
    await rm(file, { force: true });
    return "";
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
  return body;
}

export async function readExtract(uploadDir, intelId) {
  if (!ID.test(String(intelId || ""))) return "";
  for (const dir of [derivedDir(uploadDir, "extracts"), legacyDerivedDir(uploadDir, "extracts")]) {
    try {
      return await readFile(path.join(dir, `${intelId}.md`), "utf8");
    } catch {
      // 先看新位置，切换当天还能读到旧位置。
    }
  }
  return "";
}

export async function removeExtract(uploadDir, intelId) {
  if (!ID.test(String(intelId || ""))) return;
  await Promise.all(
    [derivedDir(uploadDir, "extracts"), legacyDerivedDir(uploadDir, "extracts")].map((dir) =>
      rm(path.join(dir, `${intelId}.md`), { force: true }).catch(() => {})
    )
  );
}

export async function saveReviewExtract(intelId, sections) {
  const { uploadDir } = loadBootstrapConfig();
  return writeExtract(uploadDir, intelId, sections);
}

export async function discardExtract(intelId) {
  const { uploadDir } = loadBootstrapConfig();
  await removeExtract(uploadDir, intelId);
}

export async function attachmentExtract(file) {
  try {
    const bytes = await readFile(file.path);
    return await extractDocumentText(file.name || path.basename(file.path), bytes);
  } catch {
    return "";
  }
}

export async function extractsFor(ids) {
  const { uploadDir } = loadBootstrapConfig();
  const texts = await Promise.all((Array.isArray(ids) ? ids : []).map((id) => readExtract(uploadDir, id)));
  return texts;
}
