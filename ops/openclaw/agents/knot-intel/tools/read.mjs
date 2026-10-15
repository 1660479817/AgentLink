import { execFileSync } from "node:child_process";
import { realpathSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const MAX_BYTES = 50 * 1024 * 1024;
const WINDOW = 8000;
const SAMPLE_CAP = 12000;

export function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function unzip(buffer) {
  let eocd = -1;
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("unreadable");
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("unreadable");
    const method = buffer.readUInt16LE(cursor + 10);
    const compSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(start, start + compSize);
    let data = null;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    if (data) files.set(name.replaceAll("\\", "/"), data);
  }
  return files;
}

function markedText(xml, { text, tab, line, end }) {
  const chunks = [];
  let current = [];
  const flush = () => {
    const lineText = current.join("").trim();
    if (lineText) chunks.push(lineText);
    current = [];
  };
  const pattern = new RegExp(`${text}|${tab || "$^"}|${line || "$^"}|${end}`, "g");
  for (const match of xml.matchAll(pattern)) {
    if (match[1] != null) current.push(decodeXml(match[1]));
    else if (tab && match[2] != null) current.push("\t");
    else if (line && match[3] != null) current.push("\n");
    else flush();
  }
  flush();
  return chunks.join("\n");
}

function docxUnits(files) {
  const names = [...files.keys()]
    .filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(name))
    .sort((a, b) => Number(a !== "word/document.xml") - Number(b !== "word/document.xml") || a.localeCompare(b));
  if (!files.has("word/document.xml")) throw new Error("unreadable");
  const text = names
    .map((name) => markedText(files.get(name).toString("utf8"), {
      text: "<w:t(?:\\s[^>]*)?>([^<]*)<\\/w:t>",
      tab: "(<w:tab\\/>)",
      line: "(<w:br\\/>)",
      end: "(<\\/w:p>)",
    }))
    .filter(Boolean)
    .join("\n");
  return [{ label: "", text }];
}

function attr(tag, name) {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] || "";
}

function relTarget(files, relsPath, id) {
  const xml = files.get(relsPath)?.toString("utf8") || "";
  const tag = xml.match(new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*>`))?.[0]
    || xml.match(new RegExp(`<Relationship\\b[^>]*Target="[^"]*"[^>]*Id="${id}"[^>]*>`))?.[0]
    || "";
  const target = attr(tag, "Target").replaceAll("\\", "/").replace(/^\//, "");
  if (!target) return "";
  if (target.startsWith("xl/") || target.startsWith("ppt/") || target.startsWith("word/")) return target;
  const base = relsPath.replace(/\/_rels\/[^/]+$/, "");
  return path.posix.normalize(path.posix.join(base, target));
}

function sharedStrings(xml) {
  return xml.split(/<si[\s>]/).slice(1).map((block) => (
    [...block.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((match) => decodeXml(match[1])).join("")
  ));
}

function columnIndex(ref) {
  let index = 0;
  for (const char of ref) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function sheetText(xml, strings) {
  const rows = [];
  for (const rowXml of xml.split(/<row[\s>]/).slice(1)) {
    const cells = [];
    for (const cell of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /\sr="([A-Z]+)/.exec(cell[1]);
      const col = ref ? columnIndex(ref[1]) : cells.length;
      const type = attr(cell[1], "t");
      let value = "";
      if (type === "s") value = strings[Number(/<v>([^<]*)<\/v>/.exec(cell[2])?.[1])] || "";
      else if (type === "inlineStr") {
        value = [...cell[2].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
      } else if (type === "b") value = /<v>1<\/v>/.test(cell[2]) ? "TRUE" : "FALSE";
      else value = decodeXml(/<v>([^<]*)<\/v>/.exec(cell[2])?.[1] || "");
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    if (cells.some((item) => item)) rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

function xlsxUnits(files) {
  if (!files.has("xl/workbook.xml")) throw new Error("unreadable");
  const strings = sharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const workbook = files.get("xl/workbook.xml").toString("utf8");
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match) => ({
    name: attr(match[0], "name") || "sheet",
    id: attr(match[0], "r:id"),
  }));
  const units = [];
  for (const sheet of sheets) {
    const target = relTarget(files, "xl/_rels/workbook.xml.rels", sheet.id);
    const xml = files.get(target)?.toString("utf8");
    if (!xml) continue;
    units.push({ label: `工作表 ${sheet.name}`, text: sheetText(xml, strings) });
  }
  if (!units.length) throw new Error("unreadable");
  return units;
}

function pptxUnits(files) {
  if (!files.has("ppt/presentation.xml")) throw new Error("unreadable");
  const presentation = files.get("ppt/presentation.xml").toString("utf8");
  const ids = [...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map((match) => attr(match[0], "r:id"));
  const slides = ids
    .map((id) => relTarget(files, "ppt/_rels/presentation.xml.rels", id))
    .filter((name) => files.has(name));
  const ordered = slides.length
    ? slides
    : [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
  if (!ordered.length) throw new Error("unreadable");
  return ordered.map((name, index) => ({
    label: `幻灯片 ${index + 1}`,
    text: markedText(files.get(name).toString("utf8"), {
      text: "<a:t(?:\\s[^>]*)?>([^<]*)<\\/a:t>",
      tab: "($^)",
      line: "(<a:br\\/>)",
      end: "(<\\/a:p>)",
    }),
  }));
}

function markdownUnits(bytes) {
  if (bytes.includes(0)) throw new Error("unreadable");
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  return [{ label: "", text }];
}

function pack(units) {
  const parts = [];
  let current = "";
  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const unit of units) {
    const body = String(unit.text || "").trim();
    if (!body && !unit.label) continue;
    const block = unit.label ? `【${unit.label}】\n${body}` : body;
    if (!block) continue;
    if (block.length > WINDOW) {
      push();
      for (let i = 0; i < block.length; i += WINDOW) {
        const slice = block.slice(i, i + WINDOW);
        parts.push(i === 0 ? slice : `【续】\n${slice}`);
      }
      continue;
    }
    if (current && current.length + 2 + block.length > WINDOW) push();
    current = current ? `${current}\n\n${block}` : block;
  }
  push();
  return parts.length ? parts : [""];
}

function sampleIndexes(count) {
  if (count <= 3) return [...Array(count).keys()];
  return [0, Math.floor((count - 1) / 2), count - 1];
}

function take(parts, indexes) {
  const chosen = [];
  let used = 0;
  let truncated = false;
  const sampled = [];
  for (const index of indexes) {
    const text = parts[index] || "";
    const room = SAMPLE_CAP - used;
    if (room <= 0) {
      truncated = true;
      break;
    }
    sampled.push(index + 1);
    if (text.length > room) {
      chosen.push(text.slice(0, room));
      truncated = true;
      break;
    }
    chosen.push(text);
    used += text.length + 2;
  }
  return { text: chosen.join("\n\n"), truncated, sampled };
}

let clawpdfPromise;

function openclawPackage() {
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  let resolved = "";
  try {
    resolved = realpathSync(bin.includes("/") ? bin : execFileSync("which", [bin], { encoding: "utf8" }).trim());
  } catch {
    return "";
  }
  let dir = path.dirname(resolved);
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.name === "openclaw") return dir;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

function loadClawpdf() {
  if (!clawpdfPromise) {
    clawpdfPromise = (async () => {
      const root = openclawPackage();
      const file = root ? path.join(root, "node_modules/clawpdf/dist/index.js") : "";
      if (!file) return null;
      try {
        return await import(pathToFileURL(file).href);
      } catch {
        return null;
      }
    })();
  }
  return clawpdfPromise;
}

async function pdfUnits(bytes) {
  const clawpdf = await loadClawpdf();
  if (!clawpdf?.openPdf) throw new Error("pdf_engine_missing");
  const pdf = await clawpdf.openPdf(bytes);
  try {
    const count = pdf.pageCount || 0;
    if (!count) throw new Error("unreadable");
    const units = [];
    for (let page = 1; page <= count; page += 1) {
      const text = typeof pdf.getPageText === "function" ? pdf.getPageText(page) : pdf.text({ pages: [page] });
      units.push({ label: `第${page}页`, text: String(text || "").trim() });
    }
    return units;
  } finally {
    pdf.destroy?.();
  }
}

async function unitsOf(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", units: await pdfUnits(bytes) };
  if (bytes.subarray(0, 2).toString("latin1") === "PK") {
    const files = unzip(bytes);
    if (files.has("word/document.xml")) return { kind: "docx", units: docxUnits(files) };
    if (files.has("xl/workbook.xml")) return { kind: "xlsx", units: xlsxUnits(files) };
    if (files.has("ppt/presentation.xml")) return { kind: "pptx", units: pptxUnits(files) };
    throw new Error("bad_file");
  }
  if (ext === ".md" || ext === ".markdown") return { kind: "markdown", units: markdownUnits(bytes) };
  throw new Error("bad_file");
}

export async function readDocument(name, bytes, range = {}) {
  let kind = "";
  let parts = [];
  try {
    const found = await unitsOf(name, bytes);
    kind = found.kind;
    parts = pack(found.units);
  } catch (error) {
    const code = error?.message;
    return { ok: false, error: code === "pdf_engine_missing" || code === "bad_file" ? code : "unreadable" };
  }
  const count = parts.length;
  let indexes;
  if (range.part) indexes = [range.part - 1];
  else if (range.from || range.to) {
    const from = Math.max(1, range.from || 1);
    const to = Math.max(from, range.to || from);
    indexes = [];
    for (let n = from; n <= to && n <= count; n += 1) indexes.push(n - 1);
    if (!indexes.length || (range.from || 1) > count) return { ok: false, error: "bad_part", kind, parts: count };
  } else indexes = sampleIndexes(count);
  if (indexes.some((index) => index < 0 || index >= count)) return { ok: false, error: "bad_part", kind, parts: count };
  const taken = take(parts, indexes);
  return { ok: true, kind, parts: count, sampled: taken.sampled, text: taken.text, truncated: taken.truncated };
}

function allowedPath(file, root) {
  const real = realpathSync(file);
  const info = statSync(real);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error("bad_file");
  const base = root ? realpathSync(root) : "";
  if (base) {
    const prefix = base.endsWith(path.sep) ? base : base + path.sep;
    if (real !== base && !real.startsWith(prefix)) throw new Error("bad_file");
    return real;
  }
  if (!real.includes(`${path.sep}uploads${path.sep}`)) throw new Error("bad_file");
  return real;
}

function parseArgs(argv) {
  const args = { file: "", part: 0, from: 0, to: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--file") args.file = next || "";
    else if (token === "--part") args.part = Number(next);
    else if (token === "--from") args.from = Number(next);
    else if (token === "--to") args.to = Number(next);
    else return null;
    i += 1;
  }
  if (!args.file || !path.isAbsolute(args.file)) return null;
  if (args.part && (!Number.isInteger(args.part) || args.part < 1)) return null;
  if ((args.from && (!Number.isInteger(args.from) || args.from < 1)) || (args.to && (!Number.isInteger(args.to) || args.to < 1))) return null;
  return args;
}

export async function execute(argv, options = {}) {
  const args = parseArgs(argv);
  if (!args) return { code: 2, body: { ok: false, error: "bad_args" } };
  try {
    const file = allowedPath(args.file, options.root || process.env.KNOT_READ_ROOT || "");
    const bytes = await readFile(file);
    const body = await readDocument(file, bytes, args);
    return { code: 0, body };
  } catch (error) {
    const code = error?.message === "bad_file" ? "bad_file" : "unreadable";
    return { code: 0, body: { ok: false, error: code } };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const result = await execute(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  process.exit(result.code);
}
