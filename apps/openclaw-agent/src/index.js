import { loadAgentConfig } from "./config.js";
import { interpretJob } from "./interpret.js";

const config = loadAgentConfig();

if (!config.email || !config.token) {
  console.error("Set KNOT_AGENT_EMAIL and KNOT_AGENT_TOKEN");
  process.exit(1);
}

async function agentFetch(path, options = {}) {
  const res = await fetch(`${config.apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "X-Knot-Email": config.email,
      Authorization: `Bearer ${config.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function processOnce() {
  const { job } = await agentFetch("/api/agent/ingest-jobs?status=pending");
  if (!job) return;

  console.log("[openclaw-agent] job", job.id, job.mime, "mode", config.interpretMode);
  try {
    const card = await interpretJob(job, config);
    await agentFetch("/api/agent/cards", {
      method: "POST",
      body: JSON.stringify({
        ingest_job_id: job.id,
        ...card,
      }),
    });
    console.log("[openclaw-agent] card created for", job.id, card.title);
  } catch (e) {
    console.error("[openclaw-agent] failed", job.id, e.message);
    await agentFetch(`/api/agent/ingest-jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", error: e.message }),
    }).catch(() => {});
  }
}

async function loop() {
  for (;;) {
    try {
      await processOnce();
    } catch (e) {
      if (e.status === 401) {
        console.error("[openclaw-agent] unauthorized — check email/token");
      } else {
        console.error("[openclaw-agent]", e.message);
      }
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

console.log("[openclaw-agent] polling", config.apiBase, "as", config.email);
loop();
