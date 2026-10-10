async function jsonFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

export function authRequest(email) {
  return jsonFetch("/api/auth/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function authVerify(email, code) {
  return jsonFetch("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function authLogout() {
  return jsonFetch("/api/auth/logout", { method: "POST" });
}

export function authMe() {
  return jsonFetch("/api/auth/me");
}

/**
 * @typedef {{ surfaces: string[]; plaza?: { q?: string; cursor?: string; limit?: number } }} PullRequest
 * @typedef {Record<string, unknown>} WebSnapshotResponse
 */

/** @param {PullRequest} req */
export function fetchWebSnapshot(req) {
  const params = new URLSearchParams();
  params.set("surfaces", req.surfaces.join(","));
  const plaza = req.plaza ?? {};
  if (plaza.q) params.set("plaza.q", plaza.q);
  if (plaza.cursor) params.set("plaza.cursor", plaza.cursor);
  if (plaza.limit != null) params.set("plaza.limit", String(plaza.limit));
  return jsonFetch(`/api/web/v1/snapshot?${params.toString()}`);
}

export function getCard(id) {
  return jsonFetch(`/api/cards/${encodeURIComponent(id)}`);
}

export function browseCards(q = "") {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return jsonFetch(`/api/cards${qs}`);
}

export function listCards() {
  return jsonFetch("/api/cards?mine=1");
}

export function exchangeIntent(cardId) {
  return jsonFetch("/api/exchange/intent", {
    method: "POST",
    body: JSON.stringify({ card_id: cardId }),
  });
}

export function submitDemand(body, contactHint) {
  return jsonFetch("/api/demands", {
    method: "POST",
    body: JSON.stringify({ body, contact_hint: contactHint }),
  });
}

export function listJobs() {
  return jsonFetch("/api/ingest-jobs");
}

export function issueAgentToken(label) {
  return jsonFetch("/api/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function listAgentTokens() {
  return jsonFetch("/api/auth/tokens");
}

export function revokeAgentToken(tokenId) {
  return jsonFetch(`/api/auth/tokens/${tokenId}/revoke`, { method: "POST" });
}

export function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  return jsonFetch("/api/uploads", { method: "POST", body: fd });
}
