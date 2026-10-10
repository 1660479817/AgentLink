import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function agentId(name) {
  const id = String(process.env[name] || "").trim();
  return id || null;
}

export function processAgentId() {
  return agentId("OPENCLAW_PROCESS_AGENT");
}

export function matchAgentId() {
  return agentId("OPENCLAW_MATCH_AGENT");
}

export function sourceAgentId() {
  return agentId("OPENCLAW_SOURCE_AGENT");
}

export function feedbackAgentId() {
  return agentId("OPENCLAW_FEEDBACK_AGENT");
}

function agentTimeout() {
  const timeout = Number(process.env.OPENCLAW_AGENT_TIMEOUT || 45);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 45;
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

export function parseMatchReply(text) {
  const value = readJsonObject(text);
  if (value.id === null) return { id: null };
  const id = cleanText(value.id);
  if (!id) throw new Error("match_agent_bad_json");
  return { id };
}

export function parseSourceReply(text) {
  const value = readJsonObject(text);
  const leads = [];
  for (const item of Array.isArray(value.leads) ? value.leads : []) {
    const id = cleanText(item?.id);
    if (!id) continue;
    leads.push({ id, note: clip(item?.note, 120) });
    if (leads.length === 3) break;
  }
  const suggestion = clip(value.suggestion, 400);
  if (!leads.length && !suggestion) throw new Error("source_agent_bad_json");
  return { leads, suggestion };
}

export function parseFeedbackReply(text) {
  const body = clip(text && readJsonObject(text).body, 400);
  if (!body) throw new Error("feedback_agent_bad_json");
  return { body };
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

async function askEmployee(agentId, sessionKey, message, timeoutSec) {
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-"));
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
        sessionKey,
        "--message-file",
        file,
        "--json",
        "--timeout",
        String(timeoutSec),
      ],
      (timeoutSec + 15) * 1000
    );
    return replyText(JSON.parse(stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runMatchAgent(input) {
  const id = matchAgentId();
  if (!id) throw new Error("match_agent_unconfigured");
  const lines = input.candidates.map((item) => `${item.id} ${item.text}`);
  const message = [
    "从候选里选出唯一一条与这条表达是同一件事、能够互相满足的。只返回一个 JSON 对象。",
    '{"id":"候选id"} 或 {"id":null}',
    "个别字面重合、事情对不上时 id 为 null。不要改写原文。",
    `focus: ${input.focusText}`,
    "candidates:",
    ...lines,
  ].join("\n");
  const text = await askEmployee(id, `match-${input.focusId}`, message, agentTimeout());
  return parseMatchReply(text);
}

export async function runSourceAgent(demand) {
  const id = sourceAgentId();
  if (!id) throw new Error("source_agent_unconfigured");
  const lines = demand.clues.map((clue) => `${clue.id} ${clue.kind} ${clue.text}`);
  const message = [
    "这条需求还没有配对上的供给。只返回一个 JSON 对象。",
    '{"leads":[{"id":"候选id","note":"这条线索如何对上需求"}],"suggestion":""}',
    "leads 只能使用下面列出的 id，最多三条。对不上的不要写。没有可用线索时 leads 为空，suggestion 用一两句中文。",
    "不要编造供给方，不要写发布者、电话或微信。",
    "demand:",
    demand.text,
    "clues:",
    ...(lines.length ? lines : ["（没有现成线索）"]),
  ].join("\n");
  const text = await askEmployee(id, `source-${demand.id}`, message, agentTimeout());
  return parseSourceReply(text);
}

export async function runFeedbackAgent(input) {
  const id = feedbackAgentId();
  if (!id) throw new Error("feedback_agent_unconfigured");
  const message = [
    "整理要送回提交者的一句话。只返回一个 JSON 对象。",
    '{"body":""}',
    "有配对时以「已配对：」起头，后面是对方的摘要。有寻源结果时，body 就是那条寻源结果。其余用「已记下：」加上这条表达自己的摘要。",
    `self: ${input.self}`,
    `peer: ${input.peer || ""}`,
    `suggestion: ${input.suggestion || ""}`,
  ].join("\n");
  const text = await askEmployee(id, `feedback-${input.id}`, message, agentTimeout());
  return parseFeedbackReply(text);
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
  const text = await askEmployee(agentId, `expr-${expression.id}`, message, timeoutSec);
  return parseProcessReply(text);
}
