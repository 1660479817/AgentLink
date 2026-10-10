export function loadAgentConfig() {
  const apiBase = (process.env.KNOT_API_BASE || "http://127.0.0.1:8080").replace(/\/$/, "");
  const email = process.env.KNOT_AGENT_EMAIL || "";
  const token = process.env.KNOT_AGENT_TOKEN || "";
  const pollMs = Number(process.env.POLL_MS || 3000);
  const interpretMode = (process.env.INTERPRET_MODE || "openclaw").toLowerCase();
  return {
    apiBase,
    email,
    token,
    pollMs,
    interpretMode,
    openclaw: {
      bin: process.env.OPENCLAW_BIN || "openclaw",
      agentId: process.env.OPENCLAW_AGENT_ID || "main",
      sessionPrefix: process.env.OPENCLAW_SESSION_PREFIX || "knot-ingest",
      imageModel: process.env.OPENCLAW_IMAGE_MODEL || "",
      useGatewayAgent: process.env.OPENCLAW_USE_GATEWAY_AGENT !== "false",
      timeoutMs: Number(process.env.OPENCLAW_TIMEOUT_MS || 180_000),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
    },
    ollama: {
      host: (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, ""),
      model: process.env.OLLAMA_VISION_MODEL || "llava",
    },
  };
}
