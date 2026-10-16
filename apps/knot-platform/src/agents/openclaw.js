import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { attachmentExtract, saveReviewExtract, sectionHeading } from "../extracts.js";

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

const BCP47 = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function languageOf(value) {
  const raw = cleanText(value.language).replace(/_/g, "-");
  if (!BCP47.test(raw)) return "";
  return raw.split("-").map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  }).join("-");
}

export function parseIntelReply(text) {
  const value = readJsonObject(text);
  const note = clip(value.note, 400);
  if (value.verdict === "revoke" || value.verdict === "reject") {
    const reason = cleanText(value.reason || value.reject?.reason);
    if (reason) return { verdict: "revoke", reason, note: "", category: "", language: "" };
  }
  return { verdict: "pass", reason: "", note, category: categoryOf(value), language: languageOf(value) };
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

function imageFile(image) {
  if (typeof image === "string") return { path: image, name: "" };
  return { path: image?.path || "", name: image?.name || "" };
}

export async function runIntelAgent(intel, imagePaths = [], attachments = []) {
  const agent = intelAgentId();
  if (!agent) throw new Error("intel_agent_unconfigured");
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const timeoutSec = Number(process.env.OPENCLAW_PROCESS_TIMEOUT || 90);
  const notes = [];
  const sections = [];
  const images = imagePaths.slice(0, 4).map(imageFile).filter((image) => image.path);
  for (const [index, image] of images.entries()) {
    const text = await describeImage(bin, agent, image.path, 60_000);
    notes.push(text);
    sections.push({ heading: sectionHeading("image", index, image.name), text });
  }
  const stored = attachments.filter((file) => file?.path);
  for (const [index, file] of stored.entries()) {
    const text = await attachmentExtract(file);
    if (text) sections.push({ heading: sectionHeading("file", index, file.name), text });
  }
  await saveReviewExtract(intel.id, sections);
  const linked = attachmentLinks(intel.links);
  const message = [
    "审查这一条已经可见的记录。留下则写入类别。有问题则撤销。只返回一个 JSON 对象。",
    '{"verdict":"pass","reason":"","note":"这件东西是什么","category":"类别","language":"zh"}',
    '{"verdict":"revoke","reason":"违规原因","note":"","category":"","language":""}',
    "只有违法、欺诈、隐私或骚扰才 revoke。拿不准就 pass。",
    "不要判断链接或附件打不打得开。category 写一个短类别。",
    "language 用 BCP 47 语言标签，只写一个主语言，例如 zh、en、ja、zh-Hans、zh-Hant。不要写中文或英文。看不准写 und。post、fastpost、wish、wishRespond 都要写。",
    "note 写卡片上跟在文件名后面的一句事实。有附件时，根据读到的文字写这件东西是什么。去掉电话、微信和发布者。不要编造。",
    "附件是完整文件的本机路径。对每个路径运行 tools/read --file <路径>。只根据返回 JSON 的 text 判断。ok 为 false、text 为空或读不到时不要编造，也不要因此撤销。",
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
