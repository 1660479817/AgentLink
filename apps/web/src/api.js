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

function uploadForm(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    xhr.open("POST", path);
    xhr.withCredentials = true;
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
    }
    xhr.onerror = () => {
      const error = new Error("upload_failed");
      error.code = "upload_failed";
      reject(error);
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(data.error || "upload_failed");
        error.code = data.error || "upload_failed";
        error.status = xhr.status;
        reject(error);
        return;
      }
      resolve(data);
    };
    xhr.send(form);
  });
}

export function uploadImage(file, onProgress) {
  return uploadForm("/api/web/uploads", file, onProgress);
}

export function listInformation(author, before, filters = {}) {
  const id = String(author || "").trim();
  const cursor = String(before || "").trim();
  const query = new URLSearchParams();
  if (id) query.set("author", id);
  if (cursor) query.set("before", cursor);
  const category = String(filters.category || "").trim();
  if (category) query.set("category", category);
  const topic = String(filters.topic || "").trim();
  if (topic) query.set("topic", topic);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/web/information${suffix}`);
}

export function getInformation(id) {
  return request(`/api/web/intel/${encodeURIComponent(String(id || "").trim())}`);
}

export function discoverSelf(ids) {
  return request("/api/web/discover-self", { method: "POST", body: JSON.stringify({ ids }) });
}

export function listSponsors() {
  return request("/api/web/sponsors");
}

export function getEconomy() {
  return request("/api/web/economy");
}

export function dismissInformation(id) {
  return request(`/api/web/intel/${id}/dismiss`, { method: "POST", body: "{}" });
}

export function closeInformation(id, reason = "") {
  return request(`/api/web/intel/${id}/close`, { method: "POST", body: JSON.stringify({ reason }) });
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

export function likeInformation(id) {
  return request(`/api/web/intel/${id}/like`, { method: "POST", body: "{}" });
}

export function unlikeInformation(id) {
  return request(`/api/web/intel/${id}/like`, { method: "DELETE" });
}

export function listFriends() {
  return request("/api/web/friends");
}

export function removeFriend(id) {
  return request(`/api/web/friends/${id}`, { method: "DELETE" });
}

export function addCardFriend(id) {
  return request(`/api/web/intel/${id}/friend`, { method: "POST", body: "{}" });
}

export function removeCardFriend(id) {
  return request(`/api/web/intel/${id}/friend`, { method: "DELETE" });
}

export function listRequests() {
  return request("/api/web/requests");
}

export function listPeople() {
  return request("/api/web/people");
}

export function listRequestResponses(id) {
  return request(`/api/web/requests/${id}/responses`);
}

export function listMyResponses() {
  return request("/api/web/responses");
}

export function listLooks() {
  return request("/api/web/looks");
}

export function lookRequest(id) {
  return request(`/api/web/requests/${id}/look`, { method: "POST", body: "{}" });
}

export function searchInformation(q, filters = {}) {
  const query = new URLSearchParams({ q: String(q || "") });
  const category = String(filters.category || "").trim();
  if (category) query.set("category", category);
  const topic = String(filters.topic || "").trim();
  if (topic) query.set("topic", topic);
  return request(`/api/web/search?${query.toString()}`);
}

export function fetchFacets() {
  return request("/api/web/facets");
}

export function createIntel(body, imageIds = [], fileIds = [], extra = {}) {
  return request("/api/web/intel", {
    method: "POST",
    body: JSON.stringify({ body, imageIds, fileIds, ...extra }),
  });
}

function downloadName(header, fallback) {
  const named = /filename\*=UTF-8''([^;]+)/i.exec(header || "");
  if (named) {
    try {
      return decodeURIComponent(named[1]);
    } catch {
      /* use the plain name below */
    }
  }
  const plain = /filename="([^"]*)"/.exec(header || "");
  return plain?.[1] || fallback;
}

function saveResponseFile(res, fallback) {
  return res.blob().then((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName(res.headers.get("content-disposition"), fallback);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
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
  await saveResponseFile(res, "packet.zip");
}

export async function downloadShare(id) {
  const res = await fetch(`/api/web/intel/${id}/share`, { credentials: "include" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || type.includes("json")) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.error || res.statusText);
    error.code = data.error || "request_failed";
    error.status = res.status;
    throw error;
  }
  await saveResponseFile(res, "knot.jpg");
}


export function uploadAudio(file, onProgress) {
  return uploadForm("/api/web/audio", file, onProgress);
}

export function uploadAttachment(file, onProgress) {
  return uploadForm("/api/web/files", file, onProgress);
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
