import fs from "node:fs";
import path from "node:path";
import {
  extractTextFromOpenClawPayload,
  parseOpenClawJson,
  runOpenClaw,
  withTempImageFile,
} from "./openclaw-run.js";

const CARD_SCHEMA_HINT = `Return ONLY valid JSON (no markdown):
{"title":"string","summary":"string","payload":{"category":"string","keywords":["string"],"language":"zh|en","raw_notes":"string"}}`;

const USER_PROMPT = `You are Knot's photo ingest agent (Phase 0). Read the image and produce an information card for a personal knowledge feed.
${CARD_SCHEMA_HINT}
Title: short headline. Summary: 1-3 sentences. payload.category: e.g. receipt, flyer, business_card, screenshot, product, other.`;

export async function interpretJob(job, config) {
  const mode = resolveMode(config);
  const imageRef = await loadImageRef(job, config.apiBase);
  if (mode === "stub") {
    return stubCard(job, { provider: "stub" });
  }
  try {
    if (mode === "openclaw") {
      return await interpretOpenClaw(imageRef, config, job);
    }
    if (mode === "ollama") {
      return await interpretOllama(imageRef, config.ollama, job);
    }
    return await interpretOpenAI(imageRef, config.openai, job);
  } catch (e) {
    if (config.interpretMode === "auto") {
      console.warn("[interpret] primary failed, stub fallback:", e.message);
      return stubCard(job, { provider: "stub", error: e.message });
    }
    throw e;
  }
}

function resolveMode(config) {
  const m = config.interpretMode;
  if (m === "stub") return "stub";
  if (m === "openclaw") return "openclaw";
  if (m === "ollama") return "ollama";
  if (m === "openai") return "openai";
  if (m === "auto") return "openclaw";
  return "openclaw";
}

async function loadImageRef(job, apiBase) {
  const url = job.image_url?.startsWith("http")
    ? job.image_url
    : `${apiBase}${job.image_url || ""}`;
  if (!url || url.endsWith("/")) {
    throw new Error("missing_image_url");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image_fetch_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = job.mime || res.headers.get("content-type") || "image/jpeg";
  return { url, base64: buf.toString("base64"), mime, bytes: buf.length };
}

async function interpretOpenClaw(imageRef, config, job) {
  return withTempImageFile(imageRef, job, async (filePath) => {
    try {
      return await interpretOpenClawDescribe(filePath, config, job, imageRef);
    } catch (describeErr) {
      if (!config.openclaw.useGatewayAgent) throw describeErr;
      console.warn("[interpret] openclaw describe failed, trying agent:", describeErr.message);
      return await interpretOpenClawAgent(filePath, config, job, imageRef);
    }
  });
}

async function interpretOpenClawDescribe(filePath, config, job, imageRef) {
  const args = [
    "infer",
    "image",
    "describe",
    "--file",
    filePath,
    "--json",
    "--prompt",
    USER_PROMPT,
  ];
  if (config.openclaw.imageModel) {
    args.push("--model", config.openclaw.imageModel);
  }
  const { stdout } = await runOpenClaw(args, config);
  const data = parseOpenClawPayload(stdout);
  return cardFromModelText(data, job, {
    provider: "openclaw",
    capability: "image.describe",
    model: config.openclaw.imageModel || "default",
    image_bytes: imageRef.bytes,
  });
}

async function interpretOpenClawAgent(filePath, config, job, imageRef) {
  const abs = path.resolve(filePath);
  const message = `${USER_PROMPT}\n\nImage file (use your vision on this path): ${abs}`;
  const args = [
    "agent",
    "--agent",
    config.openclaw.agentId,
    "--session-id",
    `${config.openclaw.sessionPrefix}-${job.id}`,
    "--json",
    "--message",
    message,
  ];
  const { stdout } = await runOpenClaw(args, config);
  const data = parseOpenClawPayload(stdout);
  return cardFromModelText(data, job, {
    provider: "openclaw",
    capability: "agent",
    agent: config.openclaw.agentId,
    image_bytes: imageRef.bytes,
  });
}

function parseOpenClawPayload(stdout) {
  const data = parseOpenClawJson(stdout);
  const text = extractTextFromOpenClawPayload(data);
  if (data.title && data.summary) return data;
  return parseModelJson(text);
}

async function cardFromModelText(parsed, job, meta) {
  return normalizeCard(parsed, job, meta);
}

async function interpretOpenAI(imageRef, openai, job) {
  if (!openai.apiKey) throw new Error("openai_api_key_missing");
  const res = await fetch(`${openai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openai.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: USER_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image as a Knot information card." },
            {
              type: "image_url",
              image_url: { url: `data:${imageRef.mime};base64,${imageRef.base64}` },
            },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `openai_${res.status}`);
  }
  const text = data.choices?.[0]?.message?.content || "";
  return normalizeCard(parseModelJson(text), job, {
    provider: "openai",
    model: openai.model,
    image_bytes: imageRef.bytes,
  });
}

async function interpretOllama(imageRef, ollama, job) {
  const res = await fetch(`${ollama.host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollama.model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: USER_PROMPT },
        {
          role: "user",
          content: "Describe this image as a Knot information card.",
          images: [imageRef.base64],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `ollama_${res.status}`);
  }
  const text = data.message?.content || "";
  return normalizeCard(parseModelJson(text), job, {
    provider: "ollama",
    model: ollama.model,
    image_bytes: imageRef.bytes,
  });
}

function parseModelJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("empty_model_output");
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("invalid_model_json");
    return JSON.parse(m[0]);
  }
}

function normalizeCard(parsed, job, meta) {
  const title = String(parsed.title || "").trim().slice(0, 200);
  const summary = String(parsed.summary || "").trim().slice(0, 2000);
  const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {};
  return {
    title: title || "图片信息",
    summary: summary || "已解读上传图片。",
    thumb_url: job.image_url || null,
    payload: {
      ...payload,
      ingest: {
        job_id: job.id,
        upload_id: job.upload_id,
        mime: job.mime,
        storage_key: job.storage_key,
      },
      interpret: { ...meta, at: new Date().toISOString() },
    },
  };
}

function stubCard(job, meta) {
  return {
    title: "图片信息（占位）",
    summary: "OpenClaw 解读不可用；请确认 gateway 运行且 openclaw 已登录模型。",
    thumb_url: job.image_url || null,
    payload: {
      category: "other",
      ingest: {
        job_id: job.id,
        upload_id: job.upload_id,
        mime: job.mime,
        storage_key: job.storage_key,
      },
      interpret: { ...meta, at: new Date().toISOString() },
    },
  };
}

/** Optional: read local file when testing without platform */
export function readLocalImage(filePath) {
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);
  return {
    base64: buf.toString("base64"),
    mime: "image/jpeg",
    bytes: buf.length,
  };
}
