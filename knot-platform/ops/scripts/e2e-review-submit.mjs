// 端到端验证：以测试员身份提交一条记录，打印 id 供外层轮询。
// 只用 /api/web，不碰数据库，不做破坏性操作。
import { readFile } from "node:fs/promises";

const base = process.env.BASE || "http://127.0.0.1:8080";
const sid = process.env.SID;
if (!sid) throw new Error("缺少 SID");
const cookie = `knot_sid=${sid}`;
const body = process.env.BODY || "测试数据";
const image = process.env.IMAGE || "";
const timeoutMs = Number(process.env.HTTP_TIMEOUT || 30000);

async function call(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { ...init, headers: { Cookie: cookie, ...(init.headers || {}) }, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

let imageIds = [];
if (image) {
  const bytes = await readFile(image);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "e2e.png");
  const uploaded = await call("/api/web/uploads", { method: "POST", body: form });
  imageIds = [uploaded.id];
}

const created = await call("/api/web/intel", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ body, imageIds, public: false, kind: "post" }),
});
process.stdout.write(`${created.intel?.id || ""}\n`);
