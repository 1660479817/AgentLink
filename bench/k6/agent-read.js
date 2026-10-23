import http from "k6/http";
import { group, sleep } from "k6";
import { probe } from "./lib/probe.js";
import { agentHeaders, identityConfig } from "./lib/identity.js";
import { baseUrl, options as baseOptions } from "./lib/common.js";

// 调取资料型 Personal Agent 的一次典型回合：先看信箱，再翻公开信息流，挑一条读，偶尔搜一次。
//
// 与 read.js 的差别：
//   - 全部带 Authorization: Bearer，走 Agent API 的鉴权与个人态查询；
//   - 没有静态资源，纯 JSON；
//   - 已知副作用：/information 与 /intel/:id 会落「看过」记录（读到即记），
//     所以这一组在库里有写。写入量小、只增读痕迹，不产生记录、不扣积分。

const BASE = baseUrl();
const TOKEN = String(__ENV.KNOT_AGENT_TOKEN || "").trim();
const QUERY = String(__ENV.QUERY || "agent");
const IDENTITY = identityConfig(__ENV);

if (!TOKEN && !IDENTITY.tokens.length) {
  throw new Error("缺少 KNOT_AGENT_TOKEN / KNOT_AGENT_TOKENS：Agent 场景必须有该站个人 Agent 的授权码（只从环境变量读）");
}

export const options = baseOptions();

// 没有多份授权码时所有 VU 共享一个账号；同一个账号每分钟检索超过 120 次会 429。
const VUS = Number(__ENV.VUS || 0);
if (VUS > 1 && !IDENTITY.tokens.length) {
  console.warn(`Agent 只有一份授权码：${VUS} 个 VU 共享一个账号，检索可能触发 429（报告会单列）`);
}

const p = {
  profile: probe("agent_profile"),
  notifications: probe("agent_notifications"),
  feed: probe("agent_feed"),
  card: probe("agent_card"),
  search: probe("agent_search"),
  requests: probe("agent_requests"),
};

function headersFor(vu) {
  return { Accept: "application/json", ...agentHeaders(IDENTITY, vu, TOKEN) };
}

export function setup() {
  const board = http.get(`${BASE}/api/agent/information`, { headers: headersFor(1) });
  let ids = [];
  if (board.status === 200) {
    try {
      ids = (board.json("information") || []).map((item) => item.id).filter(Boolean);
    } catch (e) {}
  }
  if (!ids.length) {
    console.warn(`setup: Agent 信息流为空（status=${board.status}），卡片详情将跳过`);
  }
  return { ids, query: QUERY };
}

export default function (data) {
  const id = data.ids.length ? data.ids[Math.floor(Math.random() * data.ids.length)] : "";
  const headers = headersFor(__VU);

  group("agent", () => {
    p.profile.record(http.get(`${BASE}/api/agent/profile`, { headers, tags: { name: "GET /api/agent/profile" } }));
    p.notifications.record(
      http.get(`${BASE}/api/agent/notifications`, { headers, tags: { name: "GET /api/agent/notifications" } })
    );
    p.feed.record(
      http.get(`${BASE}/api/agent/information`, { headers, tags: { name: "GET /api/agent/information" } })
    );
    if (id) {
      p.card.record(
        http.get(`${BASE}/api/agent/intel/${id}`, { headers, tags: { name: "GET /api/agent/intel/:id" } })
      );
    }
  });

  if (Math.random() < 1 / 3) {
    group("search", () => {
      p.search.record(
        http.get(`${BASE}/api/agent/search?q=${encodeURIComponent(data.query)}`, {
          headers,
          tags: { name: "GET /api/agent/search" },
        })
      );
    });
  }

  if (Math.random() < 0.15) {
    group("requests", () => {
      p.requests.record(
        http.get(`${BASE}/api/agent/requests`, { headers, tags: { name: "GET /api/agent/requests" } })
      );
    });
  }

  // Agent 没有「读一屏」的概念，回合间隔比人短，但不为 0，避免把轮询压测误当成交互。
  sleep(0.3 + Math.random() * 0.7);
}
