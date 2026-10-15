import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function agentId(name) {
  const id = String(process.env[name] || "").trim();
  return id || null;
}

export function intelAgentId() {
  return agentId("OPENCLAW_INTEL_AGENT");
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

function attachmentLinks(links) {
  const bag = links && typeof links === "object" ? links : {};
  const list = Array.isArray(bag.attachments) ? bag.attachments : [];
  return list
    .map((item) => (typeof item === "string" ? item : item?.url))
    .filter((url) => typeof url === "string" && url);
}

export async function runIntelAgent(intel, imagePaths = [], attachments = []) {
  const agent = intelAgentId();
  if (!agent) throw new Error("intel_agent_unconfigured");
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const timeoutSec = Number(process.env.OPENCLAW_PROCESS_TIMEOUT || 90);
  const notes = [];
  for (const file of imagePaths.slice(0, 4)) {
    notes.push(await describeImage(bin, agent, file, 60_000));
  }
  const stored = attachments.filter((file) => file?.path);
  const linked = attachmentLinks(intel.links);
  const message = [
    "审查这一条记录。通过则留下，并写入类别。只返回一个 JSON 对象。不要判断链接是否打得开。",
    '{"verdict":"pass","reason":"","note":"给检索用的一句事实","category":"类别"}',
    '{"verdict":"reject","reason":"违规原因","note":"","category":""}',
    "只有违法、欺诈、隐私或骚扰才 reject。category 写一个短类别。",
    "note 去掉电话、微信和发布者。不要编造。",
    "附件是完整文件的本机路径。用你自己的能力阅读。读不到时不要编造文件里的内容。",
    "body:",
    String(intel.body || ""),
    ...(Array.isArray(intel.videos) && intel.videos.length
      ? ["videos:", ...intel.videos.map((item, index) => `链接${index + 1}: ${typeof item === "string" ? item : item?.url || ""}`)]
      : []),
    ...(notes.length ? ["images:", ...notes.map((note, index) => `图${index + 1}:\n${note}`)] : []),
    ...(stored.length
      ? ["attachments:", ...stored.map((file, index) => `附件${index + 1}: ${file.name || ""}\n${file.path}`)]
      : []),
    ...(linked.length ? ["attachmentLinks:", ...linked.map((url, index) => `外链${index + 1}: ${url}`)] : []),
  ].join("\n");
  const text = await askEmployee(agent, `intel-${intel.id}`, message, timeoutSec);
  return parseIntelReply(text);
}
