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

export function listBounties() {
  return request("/api/web/bounties");
}

export function searchInformation(q) {
  return request(`/api/web/search?q=${encodeURIComponent(q)}`);
}

export function createIntel(body, imageIds = [], fileIds = []) {
  return request("/api/web/intel", {
    method: "POST",
    body: JSON.stringify({ body, imageIds, fileIds }),
  });
}

export function uploadAttachment(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/web/files", { method: "POST", body: form });
}

export function createDemand(brief, fileIds = []) {
  return request("/api/web/demands", {
    method: "POST",
    body: JSON.stringify({ brief, fileIds }),
  });
}

export function listDemands() {
  return request("/api/web/demands");
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
