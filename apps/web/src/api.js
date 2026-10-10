async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.code = data.error || "request_failed";
    error.status = res.status;
    throw error;
  }
  return data;
}

export function getSession() {
  return request("/api/web/session");
}

export function startSession() {
  return request("/api/web/session", { method: "POST", body: "{}" });
}

export function endSession() {
  return request("/api/web/session", { method: "DELETE" });
}

export function uploadImage(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/web/uploads", { method: "POST", body: form });
}

export function listInformation() {
  return request("/api/web/information");
}

export function searchInformation(q) {
  return request(`/api/web/search?q=${encodeURIComponent(q)}`);
}

export function createExpression(role, body, { imageIds = [], contact = "" } = {}) {
  return request("/api/web/expressions", {
    method: "POST",
    body: JSON.stringify({ role, body, imageIds, contact }),
  });
}

export function listSubmissions() {
  return request("/api/web/submissions");
}

export function listMessages() {
  return request("/api/web/messages");
}

export function readMessages() {
  return request("/api/web/messages/read", { method: "POST", body: "{}" });
}

export function listNotifications() {
  return request("/api/web/notifications");
}

export function readNotifications() {
  return request("/api/web/notifications/read", { method: "POST", body: "{}" });
}

export function getPoints() {
  return request("/api/web/points");
}

export function connectMatch(matchId) {
  return request(`/api/web/matches/${encodeURIComponent(matchId)}/connect`, {
    method: "POST",
    body: "{}",
  });
}

export function getDelegation() {
  return request("/api/web/delegation");
}

export function createDelegation() {
  return request("/api/web/delegation", { method: "POST", body: "{}" });
}

export function revokeDelegation() {
  return request("/api/web/delegation", { method: "DELETE" });
}
