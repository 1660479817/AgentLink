import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function openclawBin(config) {
  return config.openclaw.bin;
}

export async function runOpenClaw(args, config) {
  const bin = openclawBin(config);
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`,
  };
  const timeoutMs = config.openclaw.timeoutMs;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`openclaw_timeout_${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-3).join(" ");
        reject(new Error(tail || `openclaw_exit_${code}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function withTempImageFile(imageRef, job, fn) {
  const ext = extensionForMime(job.mime || imageRef.mime);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knot-ingest-"));
  const filePath = path.join(dir, `upload${ext}`);
  fs.writeFileSync(filePath, Buffer.from(imageRef.base64, "base64"));
  try {
    return await fn(filePath);
  } finally {
    try {
      fs.unlinkSync(filePath);
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
}

function extensionForMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  return ".jpg";
}

export function parseOpenClawJson(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) throw new Error("empty_openclaw_output");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    return { text: raw };
  }
}

export function extractTextFromOpenClawPayload(data) {
  if (!data || typeof data !== "object") return String(data || "");
  if (typeof data.text === "string") return data.text;
  if (typeof data.description === "string") return data.description;
  if (typeof data.output === "string") return data.output;
  if (typeof data.content === "string") return data.content;
  if (data.result && typeof data.result.text === "string") return data.result.text;
  if (data.payloads?.[0]?.text) return String(data.payloads[0].text);
  if (data.message?.content) return String(data.message.content);
  return JSON.stringify(data);
}
