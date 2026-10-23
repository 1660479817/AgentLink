import { arg } from "../lib/cli.mjs";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 生成一张可解码的 PNG，给上传场景用。
//
// 不提交图片本体（二进制、体积、还会过期），用时生成：
//   node scripts/make-image.mjs [--width 640] [--height 480] [--out data/probe.png]
//
// 像素带一点固定种子的噪声，压缩后落在几百 KB，接近一张手机照片的传输量；
// 纯色图会被压到几百字节，上传只测到请求头，测不到带宽。

const HERE = path.dirname(fileURLToPath(import.meta.url));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  let seed = 20261023;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed >>> 16) & 31;
      const i = row + 1 + x * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = 96 + noise;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}


const width = Number(arg("width", 640));
const height = Number(arg("height", 480));
const out = path.resolve(HERE, "..", arg("out", "data/probe.png"));

mkdirSync(path.dirname(out), { recursive: true });
const buffer = png(width, height);
writeFileSync(out, buffer);
console.log(`${out} ${width}x${height} ${(buffer.length / 1024).toFixed(0)}KB`);
