import { createHash } from "node:crypto";
import { extname } from "node:path";

const PDF_PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const OOXML = {
  ".docx": "word/document.xml",
  ".xlsx": "xl/workbook.xml",
  ".pptx": "ppt/presentation.xml",
};

function extOf(name) {
  return extname(String(name || "")).toLowerCase();
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    const swap = s[i];
    s[i] = s[j];
    s[j] = swap;
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const swap = s[i];
    s[i] = s[j];
    s[j] = swap;
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function padPassword(password) {
  const raw = Buffer.from(String(password || ""), "utf8").subarray(0, 32);
  return Buffer.concat([raw, PDF_PAD]).subarray(0, 32);
}

function encryptionKey({ o, p, fileId, revision, lengthBits, encryptMetadata }) {
  const md5 = createHash("md5");
  md5.update(padPassword(""));
  md5.update(o.subarray(0, 32));
  const perms = Buffer.alloc(4);
  perms.writeInt32LE(p | 0);
  md5.update(perms);
  md5.update(fileId);
  if (revision >= 4 && encryptMetadata === false) md5.update(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  let hash = md5.digest();
  const keyLen = revision <= 2 ? 5 : Math.min(16, Math.max(5, Math.floor((lengthBits || 128) / 8)));
  if (revision >= 3) {
    for (let round = 0; round < 50; round += 1) {
      hash = createHash("md5").update(hash.subarray(0, keyLen)).digest();
    }
  }
  return hash.subarray(0, keyLen);
}

function emptyPasswordMatches({ o, u, p, fileId, revision, lengthBits, encryptMetadata }) {
  if (revision >= 6 || revision < 2) return false;
  if (revision === 5) {
    if (u.length < 40) return false;
    const hash = createHash("sha256").update(u.subarray(32, 40)).digest();
    return hash.equals(u.subarray(0, 32));
  }
  if (o.length < 32 || u.length < 32 || !fileId.length) return false;
  const key = encryptionKey({ o, p, fileId, revision, lengthBits, encryptMetadata });
  if (revision === 2) return rc4(key, PDF_PAD).equals(u.subarray(0, 32));
  let hash = createHash("md5").update(PDF_PAD).update(fileId).digest();
  for (let round = 0; round < 20; round += 1) {
    const varied = Buffer.alloc(key.length);
    for (let index = 0; index < key.length; index += 1) varied[index] = key[index] ^ round;
    hash = rc4(varied, hash);
  }
  return hash.equals(u.subarray(0, 16));
}

function hexValue(dict, key) {
  const match = dict.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`));
  if (!match) return null;
  const hex = match[1].replace(/\s+/g, "");
  if (!hex || hex.length % 2) return null;
  return Buffer.from(hex, "hex");
}

function dictAt(text, index) {
  const start = text.indexOf("<<", index);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === "<" && text[i + 1] === "<") {
      depth += 1;
      i += 1;
      continue;
    }
    if (text[i] === ">" && text[i + 1] === ">") {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function encryptDict(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("latin1");
  const tail = buffer.subarray(Math.max(0, buffer.length - 65536)).toString("latin1");
  const region = `${head}\n${tail}`;
  const refs = [...region.matchAll(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/g)];
  if (refs.length) {
    const ref = refs[refs.length - 1];
    // 对象本体可能落在文件中段：按字节找 marker，不把整个 buffer 复制成 latin1 字符串。
    // 附件上限 50 MiB，整份复制一次就是几十 MB，而且这里是同步路径，复制期间事件循环停着。
    const marker = Buffer.from(`${ref[1]} ${ref[2]} obj`, "latin1");
    const at = buffer.lastIndexOf(marker);
    if (at < 0) return "";
    // 字典本身很短，只把 marker 之后的一段转成字符串；配平到 64 KiB 还没收口就当没找到。
    return dictAt(buffer.toString("latin1", at, Math.min(buffer.length, at + 65536)), 0);
  }
  const inline = region.match(/\/Encrypt\s*<</);
  if (!inline) return "";
  return dictAt(region, inline.index + "/Encrypt".length);
}

function fileIdOf(tail) {
  const ids = [...tail.matchAll(/\/ID\s*\[\s*<([0-9A-Fa-f\s]+)>/g)];
  if (!ids.length) return null;
  const hex = ids[ids.length - 1][1].replace(/\s+/g, "");
  if (!hex || hex.length % 2) return null;
  return Buffer.from(hex, "hex");
}

function pdfOpens(buffer) {
  if (!buffer || buffer.length < 8 || buffer.toString("latin1", 0, 5) !== "%PDF-") return false;
  // 头尾各看一眼就够判定：只读 64 KiB，别把整份附件转成字符串。
  const tail = buffer.subarray(Math.max(0, buffer.length - 65536)).toString("latin1");
  if (!tail.includes("startxref") && !tail.includes("%%EOF")) return false;
  const dict = encryptDict(buffer);
  if (!dict) return true;
  const revision = Number(dict.match(/\/R\s+(\d+)/)?.[1] || 0);
  const lengthBits = Number(dict.match(/\/Length\s+(\d+)/)?.[1] || 0);
  const perms = Number(dict.match(/\/P\s+(-?\d+)/)?.[1] || 0);
  const o = hexValue(dict, "O");
  const u = hexValue(dict, "U");
  const fileId = fileIdOf(tail);
  if (!o || !u || !fileId) return false;
  return emptyPasswordMatches({
    o,
    u,
    p: perms,
    fileId,
    revision,
    lengthBits,
    encryptMetadata: !/\/EncryptMetadata\s+false/.test(dict),
  });
}

function zipNames(buffer) {
  const names = [];
  const local = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let at = 0;
  while (at + 30 <= buffer.length && names.length < 4000) {
    const found = buffer.indexOf(local, at);
    if (found < 0 || found + 30 > buffer.length) break;
    const flags = buffer.readUInt16LE(found + 6);
    const compressed = buffer.readUInt32LE(found + 18);
    const nameLen = buffer.readUInt16LE(found + 26);
    const extraLen = buffer.readUInt16LE(found + 28);
    const nameAt = found + 30;
    if (nameAt + nameLen > buffer.length) break;
    names.push(buffer.toString("utf8", nameAt, nameAt + nameLen));
    let next = nameAt + nameLen + extraLen;
    if ((flags & 0x8) === 0) next += compressed;
    if (next <= found) break;
    at = next;
  }
  return names;
}

function ooxmlOpens(buffer, part) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const names = zipNames(buffer);
  if (names.some((name) => name === "EncryptionInfo" || name === "EncryptedPackage")) return false;
  return names.includes(part);
}

function textOpens(buffer) {
  if (!buffer || buffer.includes(0)) return false;
  const head = buffer.subarray(0, Math.min(buffer.length, 8));
  if (head.toString("latin1").startsWith("%PDF-")) return false;
  if (head[0] === 0x50 && head[1] === 0x4b) return false;
  if (head.length >= 4 && head[0] === 0xd0 && head[1] === 0xcf) return false;
  return true;
}

export function attachmentOpens(name, buffer) {
  const ext = extOf(name);
  if (ext === ".pdf") return pdfOpens(buffer);
  if (OOXML[ext]) return ooxmlOpens(buffer, OOXML[ext]);
  if (ext === ".md" || ext === ".markdown") return textOpens(buffer);
  return false;
}
