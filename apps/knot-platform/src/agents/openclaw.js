import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function processAgentId() {
  const id = String(process.env.OPENCLAW_PROCESS_AGENT || "").trim();
  return id || null;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(text, max) {
  const value = cleanText(text);
  return value.length > max ? value.slice(0, max) : value;
}

function readJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("process_agent_bad_json");
  const value = JSON.parse(body.slice(start, end + 1));
  if (!value || typeof value !== "object") throw new Error("process_agent_bad_json");
  return value;
}

function readEvaluation(value, verdict) {
  const reason = cleanText(value?.evaluation?.reason);
  if (verdict === "reject") return { score: 0, reason };
  const score = Number(value?.evaluation?.score);
  if (!Number.isInteger(score) || score < 1 || score > 10 || !reason) {
    throw new Error("process_agent_bad_reward");
  }
  return { score, reason };
}

function readCard(value) {
  const summary = cleanText(value.card?.summary);
  const subject = cleanText(value.card?.subject);
  if (!summary || !subject) return null;
  return { summary, subject };
}

function readIntelClass(value) {
  const item = value?.intelClass;
  if (!item || typeof item !== "object") return null;
  const category = clip(item.category, 32);
  const fact = clip(item.fact, 400);
  const basis = clip(item.basis, 200);
  if (!category || !fact || !basis) return null;
  return { category, fact, basis };
}

function publishReply(value) {
  const card = readCard(value);
  if (!card) throw new Error("process_agent_bad_json");
  return {
    verdict: "publish",
    reject: null,
    card,
    evaluation: readEvaluation(value, "publish"),
    intelClass: readIntelClass(value),
  };
}

export function parseProcessReply(text) {
  const value = readJsonObject(text);
  if (value.verdict === "reject") {
    const code = value.reject?.code;
    const reason = cleanText(value.reject?.reason);
    if (code === "violation" && reason) {
      return {
        verdict: "reject",
        reject: { code: "violation", reason },
        card: null,
        evaluation: readEvaluation(value, "reject"),
        intelClass: null,
      };
    }
    const card = readCard(value);
    if (card) {
      let evaluation;
      try {
        evaluation = readEvaluation(value, "publish");
      } catch {
        evaluation = { score: 1, reason: "未违规，照原文公开" };
      }
      return { verdict: "publish", reject: null, card, evaluation, intelClass: readIntelClass(value) };
    }
    return {
      verdict: "publish",
      reject: null,
      card: null,
      evaluation: { score: 1, reason: "未违规，照原文公开" },
      intelClass: null,
    };
  }
  if (value.verdict !== "publish") throw new Error("process_agent_bad_json");
  return publishReply(value);
}

function replyText(envelope) {
  if (typeof envelope?.final === "string" && envelope.final.trim()) return envelope.final;
  if (typeof envelope?.result?.final === "string" && envelope.result.final.trim()) return envelope.result.final;
  const payloads = envelope?.payloads || envelope?.result?.payloads;
  if (Array.isArray(payloads)) {
    const text = payloads.map((item) => item?.text || "").filter(Boolean).join("\n");
    if (text.trim()) return text;
  }
  throw new Error("process_agent_empty");
}

function readJsonEnvelope(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("process_agent_bad_json");
  return JSON.parse(raw.slice(start, end + 1));
}

function clipNote(text, max = 4000) {
  const value = String(text || "").trim();
  return value.length > max ? value.slice(0, max) : value;
}

async function describeImage(bin, agentId, file, timeoutMs) {
  const stdout = await run(
    bin,
    [
      "infer",
      "image",
      "describe",
      "--agent",
      agentId,
      "--file",
      file,
      "--json",
      "--timeout-ms",
      String(timeoutMs),
      "--prompt",
      "用中文转写图片里能公开展示的事实，保留岗位、数量、地点、时间和报酬。不要写电话、微信或联系人姓名。",
    ],
    timeoutMs + 15000
  );
  const data = readJsonEnvelope(stdout);
  const text = (Array.isArray(data.outputs) ? data.outputs : [])
    .map((item) => clipNote(item?.text))
    .filter(Boolean)
    .join("\n");
  if (!data.ok || !text) throw new Error("process_agent_empty");
  return text;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("process_agent_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error("process_agent_failed");
        error.detail = err.slice(-2000);
        reject(error);
        return;
      }
      resolve(out);
    });
  });
}

export async function runProcessAgent(expression, imagePaths = []) {
  const agentId = processAgentId();
  if (!agentId) throw new Error("process_agent_unconfigured");
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const timeoutSec = Number(process.env.OPENCLAW_PROCESS_TIMEOUT || 90);
  const notes = [];
  for (const file of imagePaths.slice(0, 3)) {
    notes.push(await describeImage(bin, agentId, file, 60_000));
  }
  const message = [
    "处理这一条 Knot 表达。只返回一个 JSON 对象。",
    '公开：{"verdict":"publish","reject":null,"card":{"summary":"","subject":""},"evaluation":{"score":7,"reason":""},"intelClass":null}',
    '高价值情报：intelClass 为 {"category":"招聘","fact":"可公开展示的事实","basis":"为什么值得归类"}。需求和供给的 intelClass 为 null。',
    '违规：{"verdict":"reject","reject":{"code":"violation","reason":""},"card":null,"evaluation":{"score":0,"reason":""},"intelClass":null}',
    "只有违法、欺诈、隐私或骚扰才打回，reject.code 只能是 violation。空泛、过短、事实不全都公开，分数可以低。",
    "有 images 时，事实以图片转写为准。正文为空时按图片整理。",
    "summary 和 subject 给撮合用，不代替用户原文。summary、subject 和 intelClass.fact 去掉电话、微信、联系人姓名和发布者。",
    `role: ${expression.role}`,
    "body:",
    String(expression.body || ""),
    ...(notes.length ? ["images:", ...notes.map((note, index) => `图${index + 1}:\n${note}`)] : []),
  ].join("\n");
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-process-"));
  const file = path.join(dir, "message.txt");
  try {
    await writeFile(file, message, "utf8");
    const stdout = await run(
      bin,
      [
        "agent",
        "--agent",
        agentId,
        "--session-key",
        `expr-${expression.id}`,
        "--message-file",
        file,
        "--json",
        "--timeout",
        String(timeoutSec),
      ],
      (timeoutSec + 15) * 1000
    );
    const envelope = JSON.parse(stdout);
    return parseProcessReply(replyText(envelope));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
