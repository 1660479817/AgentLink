export const PACKET_LIMITS = {
  images: 9,
  audio: 1,
  videos: 1,
  files: 1,
};

export function photoUrls(images = []) {
  return (images || []).map((file) => file?.url).filter((url) => typeof url === "string" && url).slice(0, PACKET_LIMITS.images);
}

// 卡片排版要的不只是地址，还有宽高：多图按真实比例切等高行，比例来自数据而不是等图下载完再量。
export function photoItems(images = []) {
  return (images || [])
    .filter((file) => typeof file?.url === "string" && file.url)
    .slice(0, PACKET_LIMITS.images)
    .map((file) => ({
      url: file.url,
      width: Number(file.width) || 0,
      height: Number(file.height) || 0,
    }));
}

export function lockedImages(images = []) {
  if (photoUrls(images).length) return [];
  return (images || []).filter((file) => file && !file.url).slice(0, PACKET_LIMITS.images);
}

export function packetAudio(audio = []) {
  return (audio || []).slice(0, PACKET_LIMITS.audio);
}

// 站外链接只放行 http/https：写入层现在都校验过，但卡片是最后一道，
// 一旦有别的导入路径塞进 javascript:，这里点一下就会在站点源上执行。
function isHttpUrl(parsed) {
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function packetVideos(videos = []) {
  return (videos || [])
    .map((item) => {
      const url = typeof item === "string" ? item : item?.url;
      if (typeof url !== "string" || !url) return null;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (!isHttpUrl(parsed)) return null;
      const poster = typeof item === "object" && typeof item.poster === "string" ? item.poster : "";
      const playUrl = typeof item === "object" && typeof item.playUrl === "string" ? item.playUrl : "";
      const out = poster ? { url, poster } : { url };
      if (playUrl) out.playUrl = playUrl;
      return out;
    })
    .filter(Boolean)
    .slice(0, PACKET_LIMITS.videos);
}

export function packetForm({ images = [], videos = [] } = {}) {
  if (packetVideos(videos).length) return "video";
  if (photoUrls(images).length) return "image";
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
  const source = playUrl && isVideoFile(playUrl) ? playUrl : url;
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return null;
  }
  // 非 http(s)（javascript:、data: …）一律不画：这是 URL 出厂前最后一道协议白名单。
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
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
