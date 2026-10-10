---
name: knot-photo-ingest
description: Interpret user-uploaded photos into Knot information cards via platform Agent API.
---

# Knot photo ingest (Phase 0)

Use when driving **Knot** ingest jobs on the same host as OpenClaw.

## Platform contract

- Poll: `GET {KNOT_API_BASE}/api/agent/ingest-jobs?status=pending`
- Headers: `Authorization: Bearer {KNOT_AGENT_TOKEN}`, `X-Knot-Email: {user email}`
- Complete: `POST {KNOT_API_BASE}/api/agent/cards` with JSON `{ ingest_job_id, title, summary, thumb_url, payload }`

## Reference worker

Repository: `apps/openclaw-agent` — polls the API, saves upload to a temp file, then:

1. **`openclaw infer image describe --file … --prompt … --json`** (default, uses OpenClaw 已配置的视觉/主模型栈)
2. 若失败：`openclaw agent --agent main --session-id knot-ingest-<job> --json --message …`（Gateway 主 Agent 读本地图片路径）

`INTERPRET_MODE=openclaw`（默认）。直连 OpenAI/Ollama 仅作备选。

Compliance and PII rules for production Knot belong in a later phase; Phase 0 only structures card JSON.
