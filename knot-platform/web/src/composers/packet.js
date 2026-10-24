import { computed, onUnmounted, ref } from "vue";
import { t } from "../i18n/index.js";
import { PACKET_LIMITS } from "../packet.js";

// 这一档与后端 backend/src/routes/web.js 的默认值对齐（8 MiB）。实例可以用环境变量调大，
// 前端读不到那个值，所以只做兜底拦截，文案里也不写死数字——写死就会和实例真实上限脱钩。
export const MAX_BYTES = 8 * 1024 * 1024;
export const AUDIO_MAX = 8 * 1024 * 1024;
export const FILE_MAX = 50 * 1024 * 1024;
// 数量上限只有 packet.js 一份，这里 re-export 给组件用，避免两处各写一个 9。
export const MAX_IMAGES = PACKET_LIMITS.images;
export const MAX_FILES = PACKET_LIMITS.files;

const VIDEO_FILE = /^video\/|\.(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg|3gp|wmv|flv|ogv)$/i;
const AUDIO_FILE = /^audio\/|\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$/i;
const ATTACHMENT_FILE = /\.(pdf|docx|xlsx|pptx|md|markdown|zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;
export const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.md,.markdown,.zip,.rar,.7z,.tar,.gz,.tgz,.bz2,.xz";

export function isVideoFile(file) {
  return VIDEO_FILE.test(`${file?.type || ""} ${file?.name || ""}`);
}

export function isAudioFile(file) {
  return AUDIO_FILE.test(`${file?.type || ""} ${file?.name || ""}`);
}

export function isAttachmentFile(file) {
  return ATTACHMENT_FILE.test(String(file?.name || ""));
}

// iOS 的相机/相册可能交出 HEIC/HEIF：后端只收 JPEG、PNG、WebP、GIF、AVIF，而服务端的
// sharp 没编进 HEVC 解码器（libde265），无法在服务端转码。这里借浏览器的原生解码
// （iOS/macOS Safari 能解 HEIC）先转成 JPEG 再上传；解不了的浏览器退回原文件，交给
// 后端按 bad_mime 拒绝，至少不会把一个「看起来传上去了」的坏文件发出去。
const HEIC_TYPE = /^image\/hei[cf](-sequence)?$/i;

export async function normalizeImageFile(file) {
  if (!file || typeof file !== "object") return file;
  if (!HEIC_TYPE.test(String(file.type || ""))) return file;
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("heic_decode_failed"));
        el.src = url;
      });
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (!width || !height) throw new Error("heic_decode_failed");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("heic_encode_failed");
      const name = String(file.name || "image").replace(/\.hei[cf](-sequence)?$/i, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

export function nameMark(user) {
  const name = String(user?.displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const latin = parts.every((part) => /^[A-Za-z]/.test(part));
    if (latin && parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (latin) return parts[0].slice(0, 1).toUpperCase();
    const chars = Array.from(name.replace(/\s+/g, ""));
    return chars.slice(-2).join("");
  }
  const email = String(user?.email || "").trim();
  return email ? email.slice(0, 1).toUpperCase() : "";
}

// code 没有对应文案时用 fallback：同一个请求失败，不同位置想说的话不一样
// （例如取管理后台地址失败要说「管理后台」而不是泛泛的「请求失败」）。
export function errorText(code, policy = {}, fallback = "error.request_failed") {
  const key = `error.${code}`;
  if (code === "bad_price") {
    return t(key, { min: policy.priceMin ?? 0, max: policy.priceMax ?? 100 });
  }
  const message = t(key);
  return message === key ? t(fallback) : message;
}

export function requireSession(user) {
  if (user) return;
  const err = new Error("no_session");
  err.code = "no_session";
  throw err;
}

export function readVideoLink(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readOptionalPrice(raw, policy = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, price: undefined };
  if (!/^\d+$/.test(text)) return { ok: false };
  const value = Number(text);
  const min = policy.priceMin ?? 0;
  const max = policy.priceMax ?? 100;
  if (value < min || value > max) return { ok: false };
  return { ok: true, price: value };
}

export function usePacketMedia() {
  const images = ref([]);
  const previewUrls = ref([]);
  const files = ref([]);
  const audio = ref(null);
  const video = ref("");
  const videoOpen = ref(false);
  const posterFile = ref(null);
  const posterPreview = ref("");
  const price = ref("");
  const error = ref("");
  const hasUpload = computed(() => images.value.length > 0 || files.value.length > 0 || Boolean(audio.value));

  function clearPreviews() {
    for (const url of previewUrls.value) URL.revokeObjectURL(url);
    previewUrls.value = [];
  }

  function syncPreviews() {
    clearPreviews();
    previewUrls.value = images.value.map((file) => URL.createObjectURL(file));
  }

  async function addImages(list) {
    error.value = "";
    const next = [...images.value];
    for (const file of list) {
      if (next.length >= MAX_IMAGES) break;
      if (!String(file.type || "").startsWith("image/")) continue;
      const normalized = await normalizeImageFile(file);
      if (normalized.size > MAX_BYTES) {
        error.value = t("error.image_too_large");
        continue;
      }
      next.push(normalized);
    }
    images.value = next;
    syncPreviews();
  }

  function removeImage(index) {
    images.value = images.value.filter((_, i) => i !== index);
    syncPreviews();
  }

  function addFiles(list) {
    error.value = "";
    const next = [...files.value];
    for (const file of list) {
      if (next.length >= MAX_FILES) break;
      if (isVideoFile(file)) {
        error.value = t("error.bad_video");
        continue;
      }
      if (isAudioFile(file)) {
        error.value = t("error.bad_audio");
        continue;
      }
      if (!isAttachmentFile(file)) {
        error.value = t("error.bad_file");
        continue;
      }
      if (file.size > FILE_MAX) {
        error.value = t("error.file_too_large");
        continue;
      }
      next.push({ file, name: file.name });
    }
    files.value = next;
  }

  function removeFile(index) {
    files.value = files.value.filter((_, i) => i !== index);
  }

  function setAudio(file) {
    error.value = "";
    if (!file) return;
    if (!isAudioFile(file)) {
      error.value = t("error.bad_audio");
      return;
    }
    if (file.size > AUDIO_MAX) {
      error.value = t("error.audio_too_large");
      return;
    }
    audio.value = { file, name: file.name };
  }

  function removeAudio() {
    audio.value = null;
  }

  function setPosterFile(file) {
    error.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      error.value = t("error.bad_mime");
      return;
    }
    if (file.size > MAX_BYTES) {
      error.value = t("error.image_too_large");
      return;
    }
    removePoster();
    posterFile.value = file;
    posterPreview.value = URL.createObjectURL(file);
  }

  function removePoster() {
    if (posterPreview.value) URL.revokeObjectURL(posterPreview.value);
    posterPreview.value = "";
    posterFile.value = null;
  }

  function reset() {
    images.value = [];
    files.value = [];
    audio.value = null;
    video.value = "";
    videoOpen.value = false;
    removePoster();
    price.value = "";
    error.value = "";
    clearPreviews();
  }

  onUnmounted(() => {
    clearPreviews();
    removePoster();
  });

  return {
    images,
    previewUrls,
    files,
    audio,
    video,
    videoOpen,
    posterFile,
    posterPreview,
    price,
    error,
    hasUpload,
    addImages,
    removeImage,
    addFiles,
    removeFile,
    setAudio,
    removeAudio,
    setPosterFile,
    removePoster,
    reset,
  };
}
