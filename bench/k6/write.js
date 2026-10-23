import http from "k6/http";
import { group, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { probe } from "./lib/probe.js";
import { agentHeaders, identityConfig } from "./lib/identity.js";
import { baseUrl } from "./lib/common.js";
import { deletePassed, intelIdFrom } from "./lib/cleanup.js";

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
// 清理链路的三种失败都记进 write_cleanup_err / write_leftover，报告据此列出
// 「发布 N / 删除 M / 残留 N-M」：只看 ep_write_delete_err 会漏掉
// 「发帖成功但解析不出 id」这种根本没发出 DELETE 的情况。

if (String(__ENV.ALLOW_WRITES || "") !== "1") {
  throw new Error("写场景默认关闭：设 ALLOW_WRITES=1，并确认你是有权限在这个站点写数据的人");
}

const IMAGE = open("../data/probe.png", "b");

const BASE = baseUrl();
const TOKEN = String(__ENV.KNOT_AGENT_TOKEN || "").trim();
const IDENTITY = identityConfig(__ENV);
if (!TOKEN && !IDENTITY.tokens.length) {
  throw new Error("缺少 KNOT_AGENT_TOKEN / KNOT_AGENT_TOKENS：写场景必须用站点自己的个人 Agent 授权码");
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

const p = {
  publish: probe("write_publish"),
  look: probe("write_look"),
  del: probe("write_delete"),
  upload: probe("write_upload"),
};

// 清理链路的失败单独计数，不混进 p95，也不被 429 的「限流不是错误」规则吞掉。
// write_cleanup_err 的分母是发帖成功数：每次 201 都记一次 true/false，否则 Rate
// 只会看到失败的那几次，算出来永远是 100%。
// write_leftover 是「发帖成功但没删掉」的条数，等于报告里要写的残留。
const cleanupErr = new Rate("write_cleanup_err");
const published = new Counter("write_created");
const removed = new Counter("write_deleted");
const leftover = new Counter("write_leftover");

function preview(res) {
  return String((res && res.body) || "")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

// 三种清理失败共用一条路：计数 + 打进 stderr。
// 只 console.warn 不够——run.mjs 成功时丢弃 stdout/stderr，指标才会随 summary.json 留下来。
function recordCleanupFailure(why) {
  cleanupErr.add(true);
  leftover.add(1);
  console.warn(`[write] ${why}`);
}

function authHeadersFor(vu) {
  return agentHeaders(IDENTITY, vu, TOKEN);
}

export function setup() {
  const feed = http.get(`${BASE}/api/agent/information`, { headers: authHeadersFor(1) });
  let ids = [];
  if (feed.status === 200) {
    try {
      ids = (feed.json("information") || []).map((item) => item.id).filter(Boolean);
    } catch (e) {}
  }
  if (!ids.length) console.warn("setup: 公开信息流为空，看卡这一步会跳过");
  return { ids };
}

export default function (data) {
  const stamp = `${Date.now()}-${__VU}-${__ITER}`;
  const headers = { ...authHeadersFor(__VU), "Content-Type": "application/json" };

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

    if (created.status === 201) {
      // 只有真的建出来了才需要清理；这一步之后的任何失败都会留下痕迹。
      published.add(1);
      let id = "";
      try {
        id = intelIdFrom(created);
      } catch (e) {
        id = "";
      }
      if (!id) {
        // 发帖成功而拿不到 id：这条记录已经在库里，且没有任何办法删。
        // 以前这里整段跳过，一轮下来留下脏数据却一条错误都不记。
        recordCleanupFailure(`发帖 201 但解析不出 intelId：${preview(created)}`);
      } else {
        try {
          const res = http.del(`${BASE}/api/agent/intel/${id}`, null, {
            headers,
            tags: { name: "DELETE /api/agent/intel/:id" },
          });
          const passed = deletePassed(res);
          // 严格判定：2xx 且 body.ok，或 404（本来就不在）。
          // 429 在这里也算没删掉，不能因为「限流不是错误」就当成清理成功。
          p.del.record(res, () => passed);
          if (passed) {
            removed.add(1);
            cleanupErr.add(false);
          } else {
            recordCleanupFailure(`DELETE ${id} 没删掉：status=${res.status} ${preview(res)}`);
          }
        } catch (error) {
          // 删除请求本身抛异常（网络层/解析层）也要算残留，不能吞掉。
          recordCleanupFailure(`DELETE ${id} 抛异常：${error && error.message}`);
        }
      }
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
        headers: authHeadersFor(__VU),
        tags: { name: "POST /api/agent/uploads" },
      });
      p.upload.record(res, (r) => r.status === 201);
    });
  }

  sleep(1 + Math.random());
}
