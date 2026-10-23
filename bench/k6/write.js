import http from "k6/http";
import { group, sleep } from "k6";
import { probe } from "./lib/probe.js";
import { baseUrl } from "./lib/common.js";

// 写路径：发一条不公开的 post → 记一次看公开卡 → 删掉。每 5 次迭代多传一张图。
//
// 黑箱约束下这一组默认不跑，必须显式同意：
//   ALLOW_WRITES=1 + 站点自己的个人 Agent 授权码。
// 一次发帖在源站会扣积分、进审核队列、触发快照推送；在别人的站上压写入
// 等于往人家库里灌数据，所以「能不能写」只能由站点主人决定，脚本不替人做主。
//
// 为什么是 post 而不是 wish：DELETE /intel/:id 只接受 post / fastpost，
// wish 删不掉，压一轮会留一堆。public: false 让它不进信息流和快照。
// 为什么读回不走 GET /intel/:id：那条只解公开的 post / fastpost，不公开的按 id 读是 404。
//
// 若删除失败，留下的是「不公开」记录：不在信息流、不进快照，只在作者的记录里。
// 这一项有独立指标 ep_write_delete_err，报告里会单独列出来。

if (String(__ENV.ALLOW_WRITES || "") !== "1") {
  throw new Error("写场景默认关闭：设 ALLOW_WRITES=1，并确认你是有权限在这个站点写数据的人");
}

const IMAGE = open("../data/probe.png", "b");

const BASE = baseUrl();
const TOKEN = String(__ENV.KNOT_AGENT_TOKEN || "").trim();
if (!TOKEN) {
  throw new Error("缺少 KNOT_AGENT_TOKEN：写场景必须用站点自己的个人 Agent 授权码");
}

export const options = {
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
  vus: Math.max(1, Number(__ENV.VUS || 5)),
  duration: String(__ENV.DURATION || "20s"),
  // 写场景不跑 100 并发：每条都是 INSERT + 审核入队，先量 5 和 10 两档。
  thresholds: {
    "ep_write_delete_err": ["rate<0.02"],
  },
};

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const p = {
  publish: probe("write_publish"),
  look: probe("write_look"),
  del: probe("write_delete"),
  upload: probe("write_upload"),
};

export function setup() {
  const feed = http.get(`${BASE}/api/agent/information`, { headers });
  let ids = [];
  if (feed.status === 200) {
    try {
      ids = (feed.json("information") || []).map((item) => item.id).filter(Boolean);
    } catch (e) {}
  }
  if (!ids.length) console.warn("setup: 公开信息流为空，看卡这一步会跳过");
  return { ids };
}

function intelId(res) {
  try {
    const body = res.json();
    return (body.intel && (body.intel.id || (body.intel.kMeta && body.intel.kMeta.id))) || "";
  } catch (e) {
    return "";
  }
}

export default function (data) {
  const stamp = `${Date.now()}-${__VU}-${__ITER}`;
  let id = "";

  group("write", () => {
    const created = http.post(
      `${BASE}/api/agent/intel`,
      JSON.stringify({
        kind: "post",
        public: false,
        body: `[bench] ${stamp} 并发写入样本，跑完即删。`,
      }),
      { headers, tags: { name: "POST /api/agent/intel" } }
    );
    p.publish.record(created, (r) => r.status === 201);
    id = intelId(created);

    if (id) {
      const removed = http.del(`${BASE}/api/agent/intel/${id}`, null, {
        headers,
        tags: { name: "DELETE /api/agent/intel/:id" },
      });
      p.del.record(removed, (r) => r.status === 200 || r.status === 404);
    }

    if (data.ids.length && Math.random() < 0.5) {
      const card = data.ids[Math.floor(Math.random() * data.ids.length)];
      p.look.record(
        http.post(`${BASE}/api/agent/intel/${card}/look`, null, {
          headers,
          tags: { name: "POST /api/agent/intel/:id/look" },
        })
      );
    }
  });

  if (Math.random() < 0.2) {
    group("upload", () => {
      const body = { file: http.file(IMAGE, "probe.png", "image/png") };
      const res = http.post(`${BASE}/api/agent/uploads`, body, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        tags: { name: "POST /api/agent/uploads" },
      });
      p.upload.record(res, (r) => r.status === 201);
    });
  }

  sleep(1 + Math.random());
}
