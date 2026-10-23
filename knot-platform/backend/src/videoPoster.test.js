import assert from "node:assert/strict";
import test from "node:test";
import { publicUrl, readHtml, resolveVideo } from "./videoPoster.js";

// 后端会替用户去抓这些地址，所以「私有网段」的判定必须覆盖各种 IPv6 写法，
// 而不只是 ::1 / fe80: / fc / fd。直链用 http://[..] 测试，不查 DNS。

test("loopback and private addresses are refused in every spelling", async () => {
  for (const raw of [
    "http://127.0.0.1/x",
    "http://10.0.0.1/x",
    "http://172.16.0.1/x",
    "http://192.168.1.1/x",
    "http://169.254.1.1/x",
    "http://100.64.0.1/x",
    "http://[::1]/x",
    "http://[::]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://[::ffff:7f00:1]/x",
    "http://[64:ff9b::7f00:1]/x",
    "http://[2002:7f00:1::]/x",
    "http://[fd00::1]/x",
    "http://[fe80::1]/x",
    "http://localhost/x",
    "http://box.local/x",
  ]) {
    assert.equal(await publicUrl(raw), null, raw);
  }
});

test("a public IPv6 literal is a URL, not a failed DNS lookup", async () => {
  const url = await publicUrl("http://[2606:4700::1111]/x");
  assert.equal(url?.hostname, "[2606:4700::1111]");
});

test("only http(s) without credentials is fetched", async () => {
  assert.equal(await publicUrl("file:///etc/passwd"), null);
  assert.equal(await publicUrl("ftp://example.com/x"), null);
  assert.equal(await publicUrl("http://user:pass@93.184.216.34/x"), null);
  assert.equal(await publicUrl("not a url"), null);
});

test("a video direct link is returned, a private one is not", async () => {
  assert.equal(await resolveVideo("http://[2606:4700::1111]/clip.mp4"), "http://[2606:4700::1111]/clip.mp4");
  assert.equal(await resolveVideo("http://[::1]/clip.mp4"), "");
});

// 抓落地页的三个边界：重定向要跟一跳但断开上一跳的响应体，超长响应不能整段读进内存，
// 非 HTML 的响应读完头就断开。用公网 IP 字面量，测试不查 DNS。
function stubFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = previous;
  };
}

test("a redirect is followed and the previous body is dropped", async () => {
  let canceled = false;
  const restore = stubFetch(async (url) => {
    if (url.pathname === "/page") {
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: "http://[2606:4700::1111]/next" }),
        body: { cancel: async () => { canceled = true; } },
      };
    }
    return new Response('<video src="http://[2606:4700::1111]/clip.mp4"></video>', {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });
  try {
    const page = await readHtml("http://[2606:4700::1111]/page");
    assert.equal(canceled, true, "重定向那一跳的响应体要断开");
    assert.match(page.html, /clip\.mp4/);
  } finally {
    restore();
  }
});

test("a response that declares itself too large is dropped unread", async () => {
  let canceled = false;
  const restore = stubFetch(async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "text/html", "content-length": String(64 * 1024 * 1024) }),
    body: { cancel: async () => { canceled = true; } },
  }));
  try {
    const page = await readHtml("http://[2606:4700::1111]/page");
    assert.equal(page.html, "");
    assert.equal(canceled, true);
  } finally {
    restore();
  }
});

test("a streamed body is cut at the limit and the connection is canceled", async () => {
  let canceled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(200 * 1024));
    },
    cancel() {
      canceled = true;
    },
  });
  const restore = stubFetch(async () => new Response(stream, { headers: { "content-type": "text/html" } }));
  try {
    const page = await readHtml("http://[2606:4700::1111]/page");
    assert.equal(page.html.length, 512 * 1024, "只保留上限以内的字节");
    assert.equal(canceled, true, "读到上限后不再继续收");
  } finally {
    restore();
  }
});

test("a non-html response is closed without reading it", async () => {
  let canceled = false;
  const restore = stubFetch(async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "application/pdf" }),
    body: { cancel: async () => { canceled = true; } },
  }));
  try {
    const page = await readHtml("http://[2606:4700::1111]/clip");
    assert.equal(page.html, "");
    assert.equal(canceled, true);
  } finally {
    restore();
  }
});
