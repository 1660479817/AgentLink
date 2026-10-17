#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const BASE = (process.env.E2E_BASE || "http://192.168.3.91:8080").replace(/\/$/, "");
const COOKIE = process.env.E2E_COOKIE || "";
const SSH = process.env.E2E_SSH || "zenwang_bot01@192.168.3.91";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function send(path, { method = "GET", body } = {}) {
  const headers = {};
  if (COOKIE) headers.Cookie = COOKIE;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) fail(`${method} ${path} ${response.status} ${data.error || ""}`);
  return data;
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function admin(args) {
  const command = `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; ~/.openclaw/workspace-knot-admin/skills/knot-admin/admin ${args.map(quote).join(" ")}`;
  const { stdout, stderr } = await exec(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", SSH, command],
    { timeout: 30_000 },
  );
  if (stderr.trim()) console.error(stderr.trim());
  return JSON.parse(stdout);
}

async function main() {
  if (!COOKIE) fail("缺少 E2E_COOKIE");
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) fail("health failed");

  const session = await send("/api/web/session");
  const user = session.user;
  if (!user?.id) fail("测试员会话无效");
  const information = await send("/api/web/information");
  const sponsors = await send("/api/web/sponsors");
  if (!Array.isArray(information.information) || !Array.isArray(sponsors.sponsors)) fail("信息流或赞助栏没有返回列表");

  const marker = `e2e ${Date.now()}`;
  const created = await send("/api/web/intel", {
    method: "POST",
    body: { body: `端到端测试记录 ${marker}`, public: false },
  });
  const id = created.intel?.kMeta?.id;
  if (!id) fail("提交没有返回记录 id");

  const listed = await admin(["posts", "--user", user.id, "--q", marker]);
  const post = (listed.posts || []).find((item) => item.id === id);
  if (!post) fail("管理命令没有列出刚提交的记录");

  const removed = await admin(["remove", "--id", id, "--reason", "端到端测试，用完即删。"]);
  if (!removed.ok || removed.already) fail("删除没有做成");

  const again = await admin(["posts", "--user", user.id, "--q", marker]);
  const after = (again.posts || []).find((item) => item.id === id);
  if (!after || after.verdict !== "removed" || after.public !== false) fail("删除后记录仍在公开");

  const submissions = await send("/api/web/submissions");
  const mine = (submissions.submissions || []).find((item) => item.kMeta?.id === id);
  if (!mine || mine.kMeta.verdict !== "removed") fail("作者的提交列表没有记下删除");

  // 点赞：需要公开记录（setIntelLike 只对 is_public 且可见的记录生效）。
  const likeMarker = `端到端点赞测试 ${Date.now()}`;
  const likedPost = await send("/api/web/intel", {
    method: "POST",
    body: { body: likeMarker, public: true },
  });
  const likeId = likedPost.intel?.kMeta?.id;
  if (!likeId) fail("点赞测试提交没有返回记录 id");

  const likedOn = await send(`/api/web/intel/${likeId}/like`, { method: "POST", body: {} });
  if (likedOn.liked !== true) fail("点赞没有返回 liked true");

  const feed = await send("/api/web/information");
  const inFeed = (feed.information || []).find((item) => item.kMeta?.id === likeId);
  if (!inFeed || inFeed.liked !== true) fail("信息流没有记下这条点赞");

  const likedOff = await send(`/api/web/intel/${likeId}/like`, { method: "DELETE" });
  if (likedOff.liked !== false) fail("取消点赞没有返回 liked false");

  const removedLike = await admin(["remove", "--id", likeId, "--reason", "端到端点赞测试，用完即删。"]);
  if (!removedLike.ok || removedLike.already) fail("点赞测试记录删除没有做成");

  console.log("e2e ok");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
