import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  alignImageExtension,
  digestFile,
  readImageMeta,
  storeUploadedFile,
  uploadQuotaBytes,
} from "./uploadStore.js";
import { blobPath, tmpDir, tmpPath } from "./storage.js";

const ID = "11111111-1111-4111-8111-111111111111";

function fakePool({ used = 0, failInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("sum(size)")) return { rows: [{ total: used }] };
      if (failInsert) throw new Error("insert_failed");
      return { rows: [{ id: ID }] };
    },
  };
}

// 上传时 multer 落在 tmp/，入库后原件在 blobs/<分片>/。
async function uploadDir() {
  const root = await mkdtemp(path.join(tmpdir(), "knot-upload-"));
  await mkdir(tmpDir(root), { recursive: true });
  return root;
}

async function writeImage(root, name, { width = 320, height = 240, format = "png" } = {}) {
  const file = tmpPath(root, name);
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    [format]()
    .toBuffer();
  await writeFile(file, bytes);
  return file;
}

test("image metadata comes from the decoded file, not the declared mime", async () => {
  const dir = await uploadDir();
  try {
    const png = await writeImage(dir, "a.png");
    assert.deepEqual(await readImageMeta(png), { mime: "image/png", width: 320, height: 240 });

    const jpeg = await writeImage(dir, "a.bin", { format: "jpeg" });
    assert.equal((await readImageMeta(jpeg)).mime, "image/jpeg");

    // sharp 把 AVIF 报成 heif + compression=av1，不能因此拒收。
    const avif = await writeImage(dir, "a.bin", { width: 32, height: 24, format: "avif" });
    assert.deepEqual(await readImageMeta(avif), { mime: "image/avif", width: 32, height: 24 });

    const svg = path.join(dir, "a.svg");
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal(await readImageMeta(svg), null, "svg is not an accepted upload");

    const text = path.join(dir, "a.txt");
    await writeFile(text, "not an image");
    assert.equal(await readImageMeta(text), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the stored extension follows the real format", async () => {
  const root = await uploadDir();
  const dir = tmpDir(root);
  try {
    const file = await writeImage(root, `${ID}.jpeg`, { format: "jpeg" });
    assert.equal(alignImageExtension(dir, `${ID}.jpeg`, "image/jpeg"), `${ID}.jpeg`);
    assert.equal(alignImageExtension(dir, `${ID}.jpeg`, "image/png"), `${ID}.png`);
    assert.ok(fs.existsSync(path.join(dir, `${ID}.png`)));
    assert.equal(fs.existsSync(file), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the digest is the sha256 of the bytes on disk", async () => {
  const dir = await uploadDir();
  try {
    const file = await writeImage(dir, "a.png");
    const expected = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(await digestFile(file), expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the quota is read from env, 0 means unlimited", () => {
  const previous = process.env.KNOT_UPLOAD_QUOTA_BYTES;
  try {
    delete process.env.KNOT_UPLOAD_QUOTA_BYTES;
    assert.equal(uploadQuotaBytes(), 1024 * 1024 * 1024);
    process.env.KNOT_UPLOAD_QUOTA_BYTES = "0";
    assert.equal(uploadQuotaBytes(), 0);
    process.env.KNOT_UPLOAD_QUOTA_BYTES = "1048576";
    assert.equal(uploadQuotaBytes(), 1048576);
    process.env.KNOT_UPLOAD_QUOTA_BYTES = "-1";
    assert.equal(uploadQuotaBytes(), 1024 * 1024 * 1024);
  } finally {
    if (previous === undefined) delete process.env.KNOT_UPLOAD_QUOTA_BYTES;
    else process.env.KNOT_UPLOAD_QUOTA_BYTES = previous;
  }
});

test("a stored image records its real size, digest and dimensions", async () => {
  const dir = await uploadDir();
  try {
    const file = await writeImage(dir, `${ID}.png`);
    const pool = fakePool();
    const stored = await storeUploadedFile({
      uploadDir: dir,
      pool,
      userId: "22222222-2222-4222-8222-222222222222",
      file: { path: file, filename: `${ID}.png`, mimetype: "image/svg+xml", originalname: "a.svg" },
      kind: "image",
    });
    assert.equal(stored.id, ID);
    assert.equal(stored.mime, "image/png");
    assert.equal(stored.width, 320);
    assert.equal(stored.height, 240);
    assert.equal(stored.bytes, fs.statSync(blobPath(dir, `${ID}.png`)).size);
    assert.equal(fs.existsSync(file), false, "the tmp copy is gone");
    assert.equal(fs.existsSync(blobPath(dir, `${ID}.png`)), true, "the blob is in place");
    const insert = pool.calls.find((call) => call.sql.includes("INSERT INTO uploads"));
    assert.deepEqual(insert.params.slice(2), ["image/png", null, stored.bytes, stored.sha256, 320, 240]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a jpeg named .png is stored under the corrected extension", async () => {
  const dir = await uploadDir();
  try {
    // 客户端文件名说 png，内容是 jpeg。改名的文件已经在 tmp 里换了路径，搬进 blobs 时要跟过去。
    const file = await writeImage(dir, `${ID}.png`, { format: "jpeg" });
    const pool = fakePool();
    const stored = await storeUploadedFile({
      uploadDir: dir,
      pool,
      userId: "u",
      file: { path: file, filename: `${ID}.png`, mimetype: "image/png" },
      kind: "image",
    });
    assert.equal(stored.mime, "image/jpeg");
    assert.equal(fs.existsSync(file), false, "the tmp copy is gone");
    assert.equal(fs.existsSync(tmpPath(dir, `${ID}.png`)), false, "no renamed leftover in tmp");
    assert.equal(fs.existsSync(blobPath(dir, `${ID}.jpg`)), true, "moved under the real extension");
    const insert = pool.calls.find((call) => call.sql.includes("INSERT INTO uploads"));
    assert.equal(insert.params[1], `${ID}.jpg`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an over-quota upload is removed and rejected", async () => {
  const previous = process.env.KNOT_UPLOAD_QUOTA_BYTES;
  process.env.KNOT_UPLOAD_QUOTA_BYTES = "1024";
  const dir = await uploadDir();
  try {
    const file = await writeImage(dir, `${ID}.png`, { width: 800, height: 800 });
    const pool = fakePool({ used: 4096 });
    await assert.rejects(
      storeUploadedFile({ uploadDir: dir, pool, userId: "u", file: { path: file, filename: `${ID}.png`, mimetype: "image/png" }, kind: "image", skipQuota: false }),
      (error) => error.code === "quota_exceeded"
    );
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(blobPath(dir, `${ID}.png`)), false);
    assert.equal(pool.calls.some((call) => call.sql.includes("INSERT INTO uploads")), false);
  } finally {
    if (previous === undefined) delete process.env.KNOT_UPLOAD_QUOTA_BYTES;
    else process.env.KNOT_UPLOAD_QUOTA_BYTES = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed insert removes the file instead of leaving an orphan", async () => {
  const dir = await uploadDir();
  try {
    const file = await writeImage(dir, `${ID}.png`);
    const pool = fakePool({ failInsert: true });
    await assert.rejects(
      storeUploadedFile({ uploadDir: dir, pool, userId: "u", file: { path: file, filename: `${ID}.png`, mimetype: "image/png" }, kind: "image" }),
      /insert_failed/
    );
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(blobPath(dir, `${ID}.png`)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-image sent to the image door is rejected and deleted", async () => {
  const dir = await uploadDir();
  try {
    const file = tmpPath(dir, `${ID}.svg`);
    await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await assert.rejects(
      storeUploadedFile({ uploadDir: dir, pool: fakePool(), userId: "u", file: { path: file, filename: `${ID}.svg`, mimetype: "image/svg+xml" }, kind: "image" }),
      (error) => error.code === "bad_mime"
    );
    assert.equal(fs.existsSync(file), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("admin uploads skip the per-user quota", async () => {
  const previous = process.env.KNOT_UPLOAD_QUOTA_BYTES;
  process.env.KNOT_UPLOAD_QUOTA_BYTES = "1";
  const dir = await uploadDir();
  try {
    const file = await writeImage(dir, `${ID}.png`);
    const pool = fakePool({ used: 1_000_000 });
    const stored = await storeUploadedFile({
      uploadDir: dir,
      pool,
      userId: "u",
      file: { path: file, filename: `${ID}.png`, mimetype: "image/png" },
      kind: "image",
      skipQuota: true,
    });
    assert.equal(stored.id, ID);
    assert.equal(pool.calls.some((call) => call.sql.includes("sum(size)")), false);
  } finally {
    if (previous === undefined) delete process.env.KNOT_UPLOAD_QUOTA_BYTES;
    else process.env.KNOT_UPLOAD_QUOTA_BYTES = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
