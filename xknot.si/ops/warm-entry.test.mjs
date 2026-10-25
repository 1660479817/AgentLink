import assert from "node:assert/strict";
import test from "node:test";

import { assetPaths, warmEntry } from "./warm-entry.mjs";

const HTML = `<!doctype html><html><head>
<link rel="stylesheet" crossorigin href="/assets/index-abc.css">
<script type="module" crossorigin src="/assets/index-abc.js"></script>
</head><body><div id="app"></div></body></html>`;

const CSS = `@font-face{src:url(/assets/inter-def.woff2) format("woff2")}`;

function recorder() {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.endsWith(".css")) return { ok: true, text: async () => CSS };
    if (url.endsWith("/")) return { ok: true, text: async () => HTML };
    return { ok: true, text: async () => "" };
  };
  return { asked, fetchImpl };
}

test("warm: assets come out of the shell, then out of its stylesheets", () => {
  // 字体只出现在 CSS 里，只解析 HTML 会漏掉最大的一两个文件。
  assert.deepEqual(assetPaths(HTML, []), ["/assets/index-abc.css", "/assets/index-abc.js"]);
  assert.deepEqual(assetPaths(HTML, [CSS]), ["/assets/index-abc.css", "/assets/index-abc.js", "/assets/inter-def.woff2"]);
  // 首页里重复引用的同一份只取一次。
  assert.deepEqual(assetPaths(`<script src="/assets/a.js"></script><script src="/assets/a.js"></script>`, []), [
    "/assets/a.js",
  ]);
});

test("warm: paths that could resolve outside /assets/ are not requested", () => {
  // 这些路径来自实例自己的 HTML，正常构建不会给出这种写法。挡掉是因为这一层
  // 会把拿到的路径拼成一个对公网入口的请求：预热的范围只该是构建产物。
  assert.deepEqual(assetPaths(`<script src="/assets/../../api/admin/x.js"></script>`, []), []);
  assert.deepEqual(assetPaths(`<script src="/assets//cdn.example.com/x.js"></script>`, []), []);
  assert.deepEqual(assetPaths(`<script src="/api/web/board"></script>`, []), []);
});

test("warm: the page is asked for the page and every asset it references", async () => {
  const { asked, fetchImpl } = recorder();
  const result = await warmEntry({ origin: "https://cpswang.xknot.si/", fetchImpl });

  assert.deepEqual(result, { home: true, assets: 3, warmed: 3 });
  assert.equal(asked[0], "https://cpswang.xknot.si/");
  assert.ok(asked.includes("https://cpswang.xknot.si/assets/index-abc.js"));
  assert.ok(asked.includes("https://cpswang.xknot.si/assets/index-abc.css"));
  assert.ok(asked.includes("https://cpswang.xknot.si/assets/inter-def.woff2"));
});

test("warm: an unreachable entry is reported, not thrown", async () => {
  const result = await warmEntry({
    origin: "https://cpswang.xknot.si",
    fetchImpl: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(result.error, "unreachable");
});

test("warm: something that is not an origin is refused before any request", async () => {
  const { asked, fetchImpl } = recorder();
  assert.equal((await warmEntry({ origin: "cpswang.xknot.si", fetchImpl })).error, "bad_origin");
  assert.equal(asked.length, 0);
});

test("warm: a shell that answers 502 does not turn into a burst of asset requests", async () => {
  const { asked, fetchImpl } = recorder();
  const result = await warmEntry({ origin: "https://cpswang.xknot.si", fetchImpl: async (url) => {
    asked.push(url);
    return { ok: false, status: 502, text: async () => "" };
  } });
  assert.equal(result.error, "home_failed");
  assert.equal(asked.length, 1);
});

test("warm: a stylesheet fetched for its font list is not asked for twice", async () => {
  // 取样式表的那一趟已经把它放进入口缓存了，再取一次只是多穿一次隧道。
  const { asked, fetchImpl } = recorder();
  await warmEntry({ origin: "https://cpswang.xknot.si", fetchImpl });
  const css = asked.filter((url) => url === "https://cpswang.xknot.si/assets/index-abc.css");
  assert.equal(css.length, 1);
  assert.equal(new Set(asked).size, asked.length);
});
