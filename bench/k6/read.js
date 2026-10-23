import http from "k6/http";
import { group, sleep } from "k6";
import { probe } from "./lib/probe.js";
import { identityConfig, webHeaders } from "./lib/identity.js";
import { assetPaths, baseUrl, options as baseOptions } from "./lib/common.js";

// 未登录访客的一次页面浏览。
//
// 一次迭代等于「打开 /discover，看一张卡」：
//   page  / + /discover.json                      入口主机磁盘，不穿隧道
//   api   session / home / information / 卡片详情  穿隧道回实例
//   extra 搜索、赞助、静态资源按比例出现（配比见 README）
//
// 刻意不请求卡片里的图片：入口按 $uri 缓存一天，重复请求只会测到 nginx 的缓存命中，
// 与「用户等多久」无关。唯一的静态资源是主包，按 1/20 模拟一次缓存未命中。

const BASE = baseUrl();
const QUERY = String(__ENV.QUERY || "");
const IDENTITY = identityConfig(__ENV);

export const options = baseOptions();

const p = {
  index: probe("index"),
  board: probe("board", { expect: "json" }),
  session: probe("session", { expect: "json" }),
  home: probe("home", { expect: "json" }),
  feed: probe("feed", { expect: "json" }),
  card: probe("card", { expect: "json" }),
  search: probe("search", { expect: "json" }),
  sponsors: probe("sponsors", { expect: "json" }),
  asset: probe("asset"),
};

export function setup() {
  const started = Date.now();
  const index = http.get(`${BASE}/`);
  const assets = assetPaths(index.body);

  // 帖子 id 从快照拿；快照不可用时退回 Web API，两条路都是 GET。
  let ids = [];
  let query = QUERY;
  const board = http.get(`${BASE}/discover.json`);
  if (board.status === 200) {
    try {
      const data = board.json();
      const info = Array.isArray(data.information) ? data.information : [];
      ids = info.map((item) => item && item.id).filter(Boolean);
      if (!query && info.length) {
        const topics = (info[0].kMeta && info[0].kMeta.topics) || [];
        const words = String(info[0].body || "").split(/\s+/);
        const pick = topics[0] || words.find((w) => w.length > 4) || "agent";
        query = String(pick).replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "agent";
      }
    } catch (e) {
      // 快照坏了不致命，下面还有一条退路。
    }
  }
  if (!ids.length) {
    const feed = http.get(`${BASE}/api/web/information`, { headers: webHeaders(IDENTITY, 1) });
    if (feed.status === 200) {
      try {
        ids = (feed.json("information") || []).map((item) => item.id).filter(Boolean);
      } catch (e) {}
    }
  }

  console.log(`setup: base=${BASE} assets=${assets.length} ids=${ids.length} query=${query || "-"} ${Date.now() - started}ms`);
  return { assets, ids, query };
}

export default function (data) {
  const id = data.ids.length ? data.ids[Math.floor(Math.random() * data.ids.length)] : "";
  // 每个 VU 一份身份：有 Cookie 用 Cookie，否则按 VU 给一个独立的 XFF（直连源站时）。
  const headers = webHeaders(IDENTITY, __VU);

  group("page", () => {
    p.index.record(http.get(`${BASE}/`, { tags: { name: "GET /" } }));
    p.board.record(http.get(`${BASE}/discover.json`, { tags: { name: "GET /discover.json" } }));
  });

  group("api", () => {
    p.session.record(http.get(`${BASE}/api/web/session`, { headers, tags: { name: "GET /api/web/session" } }));
    p.home.record(http.get(`${BASE}/api/web/home`, { headers, tags: { name: "GET /api/web/home" } }));
    p.feed.record(http.get(`${BASE}/api/web/information`, { headers, tags: { name: "GET /api/web/information" } }));
    if (id) {
      p.card.record(http.get(`${BASE}/api/web/intel/${id}`, { headers, tags: { name: "GET /api/web/intel/:id" } }));
    }
  });

  // 搜索不是每次浏览都发生。1/3 是「看一张卡顺手搜一下」的比例。
  if (data.query && Math.random() < 1 / 3) {
    group("search", () => {
      p.search.record(
        http.get(`${BASE}/api/web/search?q=${encodeURIComponent(data.query)}`, {
          headers,
          tags: { name: "GET /api/web/search" },
        })
      );
    });
  }

  if (Math.random() < 0.1) {
    group("sponsors", () => {
      p.sponsors.record(http.get(`${BASE}/api/web/sponsors`, { headers, tags: { name: "GET /api/web/sponsors" } }));
    });
  }

  // 浏览器缓存只在第一次访问时取静态资源；5% 的迭代模拟一次缓存未命中。
  if (Math.random() < 0.05 && data.assets.length) {
    const asset = data.assets[Math.floor(Math.random() * data.assets.length)];
    group("asset", () => {
      p.asset.record(http.get(`${BASE}${asset}`, { tags: { name: "GET /assets/*" } }));
    });
  }

  // 思考时间 1–3 秒。并发数是「同时在看的人」，不是「每秒请求」。
  sleep(1 + Math.random() * 2);
}
