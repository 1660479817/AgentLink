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

export function requestLoginKey(email) {
  return request("/api/web/login", { method: "POST", body: JSON.stringify({ email }) });
}

export function confirmLoginKey(email, key) {
  return request("/api/web/login/key", { method: "POST", body: JSON.stringify({ email, key }) });
}

export function endSession() {
  return request("/api/web/session", { method: "DELETE" });
}

export function updateProfile(profile) {
  return request("/api/web/profile", { method: "PATCH", body: JSON.stringify(profile) });
}

export function uploadImage(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/web/uploads", { method: "POST", body: form });
}

export function listInformation() {
  return request("/api/web/information");
}

export function dismissInformation(id) {
  return request(`/api/web/intel/${id}/dismiss`, { method: "POST", body: "{}" });
}

export function listStars() {
  return request("/api/web/stars");
}

export function starInformation(id) {
  return request(`/api/web/intel/${id}/star`, { method: "POST", body: "{}" });
}

export function unstarInformation(id) {
  return request(`/api/web/intel/${id}/star`, { method: "DELETE" });
}

export function listRequests() {
  return request("/api/web/requests");
}

export function listRequestResponses(id) {
  return request(`/api/web/requests/${id}/responses`);
}

export function listMyResponses() {
  return request("/api/web/responses");
}

export function searchInformation(q) {
  return request(`/api/web/search?q=${encodeURIComponent(q)}`);
}

export function createIntel(body, imageIds = [], fileIds = [], extra = {}) {
  return request("/api/web/intel", {
    method: "POST",
    body: JSON.stringify({ body, imageIds, fileIds, ...extra }),
  });
}

function downloadName(header) {
  const named = /filename\*=UTF-8''([^;]+)/i.exec(header || "");
  if (named) {
    try {
      return decodeURIComponent(named[1]);
    } catch {
      /* use the plain name below */
    }
  }
  const plain = /filename="([^"]*)"/.exec(header || "");
  return plain?.[1] || "packet.zip";
}

export async function downloadInformation(id) {
  const res = await fetch(`/api/web/intel/${id}/download`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || type.includes("json")) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.error || res.statusText);
    error.code = data.error || "request_failed";
    error.status = res.status;
    throw error;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadName(res.headers.get("content-disposition"));
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


export function uploadAudio(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/web/audio", { method: "POST", body: form });
}

export function uploadAttachment(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/web/files", { method: "POST", body: form });
}

export function listSubmissions() {
  return request("/api/web/submissions");
}

export function listNotifications() {
  return request("/api/web/notifications");
}

export function readNotifications() {
  return request("/api/web/notifications/read", { method: "POST", body: "{}" });
}

export function getDelegation() {
  return request("/api/web/delegation");
}

export function createDelegation() {
  return request("/api/web/delegation", { method: "POST", body: "{}" });
}
