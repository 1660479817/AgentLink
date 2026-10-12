import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function agentId(name) {
  const id = String(process.env[name] || "").trim();
  return id || null;
}

export function intelAgentId() {
  return agentId("OPENCLAW_INTEL_AGENT") || agentId("OPENCLAW_PROCESS_AGENT");
}

export function demandAgentId() {
  return agentId("OPENCLAW_DEMAND_AGENT") || agentId("OPENCLAW_MATCH_AGENT");
}

export function briefAgentId() {
  return agentId("OPENCLAW_BRIEF_AGENT");
}

export function seekAgentId() {
  return agentId("OPENCLAW_SEEK_AGENT");
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
  if (start < 0 || end <= start) throw new Error("agent_bad_json");
  const value = JSON.parse(body.slice(start, end + 1));
  if (!value || typeof value !== "object") throw new Error("agent_bad_json");
  return value;
}

function categoryOf(value) {
  return clip(value.category, 40);
}

export function parseIntelReply(text) {
  const value = readJsonObject(text);
  const note = clip(value.note, 400);
  if (value.verdict === "reject") {
    const reason = cleanText(value.reason || value.reject?.reason);
    if (reason) return { verdict: "reject", reason, note: "", category: "" };
  }
  return { verdict: "pass", reason: "", note, category: categoryOf(value) };
}

export function parseBriefReply(text) {
  const value = readJsonObject(text);
  if (value.verdict === "reject") {
    const reason = cleanText(value.reason || value.reject?.reason);
    if (reason) return { verdict: "reject", reason, category: "" };
  }
  return { verdict: "pass", reason: "", category: categoryOf(value) };
}

export function parseDemandReply(text) {
  const value = readJsonObject(text);
  if (!Array.isArray(value.citations)) throw new Error("demand_agent_bad_json");
  const citations = [];
  for (const id of value.citations) {
    const clean = cleanText(id);
    if (clean && !citations.includes(clean)) citations.push(clean);
  }
  return { citations, ask: clip(value.ask, 400) };
}

export function parseSeekReply(text) {
  const value = readJsonObject(text);
  if (value.able !== true) return { able: false, items: [] };
  const items = [];
  for (const raw of Array.isArray(value.items) ? value.items : []) {
    if (!raw || typeof raw !== "object") continue;
    const body = clip(raw.body, 2000);
    const note = clip(raw.note, 400);
    const source = clip(raw.source, 300);
    if (!body || !source) continue;
    items.push({ body, note, source });
  }
  if (!items.length) return { able: false, items: [] };
  return { able: true, items };
}

function replyText(envelope) {
  if (typeof envelope?.final === "string" && envelope.final.trim()) return envelope.final;
  if (typeof envelope?.result?.final === "string" && envelope.result.final.trim()) return envelope.result.final;
  const payloads = envelope?.payloads || envelope?.result?.payloads;
  if (Array.isArray(payloads)) {
    const text = payloads.map((item) => item?.text || "").filter(Boolean).join("\n");
    if (text.trim()) return text;
  }
  throw new Error("agent_empty");
}

function readJsonEnvelope(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("agent_bad_json");
  return JSON.parse(raw.slice(start, end + 1));
}

function clipNote(text, max = 4000) {
  const value = String(text || "").trim();
  return value.length > max ? value.slice(0, max) : value;
}

async function describeImage(bin, agent, file, timeoutMs) {
  const stdout = await run(
    bin,
    [
      "infer",
      "image",
      "describe",
      "--agent",
      agent,
      "--file",
      file,
      "--json",
      "--timeout-ms",
      String(timeoutMs),
      "--prompt",
      "用中文转写图片里能公开展示的事实。不要写电话、微信或联系人姓名。",
    ],
    timeoutMs + 15000
  );
  const data = readJsonEnvelope(stdout);
  const text = (Array.isArray(data.outputs) ? data.outputs : [])
    .map((item) => clipNote(item?.text))
    .filter(Boolean)
    .join("\n");
  if (!data.ok || !text) throw new Error("agent_empty");
  return text;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("agent_timeout"));
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
        const error = new Error("agent_failed");
        error.detail = err.slice(-2000);
        reject(error);
        return;
      }
      resolve(out);
    });
  });
}

async function askEmployee(agent, sessionKey, message, timeoutSec) {
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-"));
  const file = path.join(dir, "message.txt");
  try {
    await writeFile(file, message, "utf8");
    const stdout = await run(
      bin,
      ["agent", "--agent", agent, "--session-key", sessionKey, "--message-file", file, "--json", "--timeout", String(timeoutSec)],
      (timeoutSec + 15) * 1000
    );
    return replyText(JSON.parse(stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runIntelAgent(intel, imagePaths = []) {
  const agent = intelAgentId();
  if (!agent) throw new Error("intel_agent_unconfigured");
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const timeoutSec = Number(process.env.OPENCLAW_PROCESS_TIMEOUT || 90);
  const notes = [];
  for (const file of imagePaths.slice(0, 3)) {
    notes.push(await describeImage(bin, agent, file, 60_000));
  }
  const message = [
    "审查这一个数据包。通过则留下，并写入类别。只返回一个 JSON 对象。",
    '{"verdict":"pass","reason":"","note":"给检索用的一句事实","category":"类别"}',
    '{"verdict":"reject","reason":"违规原因","note":"","category":""}',
    "只有违法、欺诈、隐私或骚扰才 reject。category 写一个短类别。",
    "note 去掉电话、微信和发布者。不要编造。",
    "body:",
    String(intel.body || ""),
    ...(notes.length ? ["images:", ...notes.map((note, index) => `图${index + 1}:\n${note}`)] : []),
  ].join("\n");
  const text = await askEmployee(agent, `intel-${intel.id}`, message, timeoutSec);
  return parseIntelReply(text);
}

function demandMessage(input) {
  const lines = input.items.map((item) => `${item.id} ${item.text}`);
  const inventory = lines.length ? lines : ["（没有库存）"];
  return [
    "按需求从库存里选出带附件的数据包。只返回一个 JSON 对象。",
    '{"citations":["库存id"]}',
    `最多引用 ${input.limit} 条。citations 只能使用下面列出的 id，同一条只出现一次。`,
    "对不上的不要选。不要编造。",
    "brief:",
    input.brief,
    "inventory:",
    ...inventory,
  ].join("\n");
}

export async function runBriefAgent(input) {
  const agent = briefAgentId();
  if (!agent) throw new Error("brief_agent_unconfigured");
  const message = [
    "审查这一条需求。通过则留下，并写入类别。只返回一个 JSON 对象。",
    '{"verdict":"pass","reason":"","category":"类别"}',
    '{"verdict":"reject","reason":"违规原因","category":""}',
    "只有违法、欺诈、隐私或骚扰才 reject。category 写一个短类别。不要编造。",
    "brief:",
    String(input.brief || ""),
  ].join("\n");
  const text = await askEmployee(agent, `brief-${input.id}`, message, agentTimeout());
  return parseBriefReply(text);
}

export async function runDemandAgent(input) {
  const agent = demandAgentId();
  if (!agent) throw new Error("demand_agent_unconfigured");
  const text = await askEmployee(agent, `demand-${input.id}`, demandMessage(input), agentTimeout());
  const reply = parseDemandReply(text);
  if (input.selectOnly) reply.ask = "";
  return reply;
}

export async function runSeekAgent(input) {
  const agent = seekAgentId();
  if (!agent) throw new Error("seek_agent_unconfigured");
  const message = [
    "判断这段空档能不能从公开来源补上。只返回一个 JSON 对象。",
    '{"able":false,"items":[]}',
    '{"able":true,"items":[{"body":"一条可入库的事实","note":"给检索用的一句","source":"公开出处"}]}',
    `最多 ${input.limit} 条。每条 item 必须有 source。`,
    "没有公开出处、查不到、或要联系对方才能知道的，able 为 false。不要编造。",
    "gap:",
    input.ask,
  ].join("\n");
  const text = await askEmployee(agent, `seek-${input.id}`, message, agentTimeout());
  const reply = parseSeekReply(text);
  reply.items = reply.items.slice(0, input.limit);
  return reply;
}
