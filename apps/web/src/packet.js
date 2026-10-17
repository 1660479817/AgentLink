export const PACKET_LIMITS = {
  images: 9,
  audio: 1,
  videos: 1,
  files: 1,
};

export function photoUrls(imageUrls = [], images = []) {
  const listed = (imageUrls || []).filter((url) => typeof url === "string" && url);
  const urls = listed.length ? listed : (images || []).map((file) => file?.url).filter((url) => typeof url === "string" && url);
  return urls.slice(0, PACKET_LIMITS.images);
}

export function lockedImages(imageUrls = [], images = []) {
  if (photoUrls(imageUrls, images).length) return [];
  return (images || []).filter((file) => file && !file.url).slice(0, PACKET_LIMITS.images);
}

export function packetAudio(audio = []) {
  return (audio || []).slice(0, PACKET_LIMITS.audio);
}

export function packetVideos(videos = []) {
  return (videos || [])
    .map((item) => {
      const url = typeof item === "string" ? item : item?.url;
      if (typeof url !== "string" || !url) return null;
      const poster = typeof item === "object" && typeof item.poster === "string" ? item.poster : "";
      const playUrl = typeof item === "object" && typeof item.playUrl === "string" ? item.playUrl : "";
      const out = poster ? { url, poster } : { url };
      if (playUrl) out.playUrl = playUrl;
      return out;
    })
    .filter(Boolean)
    .slice(0, PACKET_LIMITS.videos);
}

// 卡片形态：视频优先，其次图文，其余是文字。与 kind 无关，纯由内容推导。
export function packetForm({ images = [], imageUrls = [], videos = [] } = {}) {
  if (packetVideos(videos).length) return "video";
  if (photoUrls(imageUrls, images).length) return "image";
  return "text";
}

function youtubeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || "";
  if (host === "youtube.com" || host === "m.youtube.com") {
    const fromPath = parsed.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/);
    return parsed.searchParams.get("v") || fromPath?.[1] || "";
  }
  return "";
}

const VIDEO_FILE = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:$|[?#])/i;

function isVideoFile(raw) {
  try {
    return VIDEO_FILE.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

export function videoFrame(url, poster = "", playUrl = "") {
  // 后端解析出的直链只在确实是可播文件时使用；否则回到原链接（落地页）走完整判断。
  const source = playUrl && isVideoFile(playUrl) ? playUrl : url;
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const youtube = youtubeId(source);
  const known = youtube && /^[\w-]{6,}$/.test(youtube) ? `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg` : "";
  const image = poster || known;
  const frame = { poster: image };
  if (youtube) return { ...frame, kind: "iframe", src: `https://www.youtube.com/embed/${encodeURIComponent(youtube)}` };
  if (host === "bilibili.com" || host === "m.bilibili.com") {
    const bv = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (bv) return { ...frame, kind: "iframe", src: `https://player.bilibili.com/player.html?bvid=${bv[1]}&autoplay=0&danmaku=0` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parsed.pathname.match(/(\d+)/);
    if (id) return { ...frame, kind: "iframe", src: `https://player.vimeo.com/video/${id[1]}` };
  }
  if (VIDEO_FILE.test(parsed.pathname)) return { ...frame, kind: "file", src: source };
  return { ...frame, kind: "open", src: source };
}

export function packetFile(attachments = []) {
  return (attachments || []).filter((file) => file && !file.image).slice(0, PACKET_LIMITS.files);
}
