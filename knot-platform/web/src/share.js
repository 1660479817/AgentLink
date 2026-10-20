// 卡片分享：图片走 /api/web/intel/:id/share，链接指回单条信息的深链。
// 深链路径与分享图二维码一致（/discover?post=），站点部分取当前页面 origin。
export function cardShareUrl(id, origin = "") {
  const value = String(id || "").trim();
  if (!value) return "";
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/discover?post=${encodeURIComponent(value)}`;
}

// 局域网 http 站点不在安全上下文里，navigator.clipboard 不存在，退回 execCommand。
export async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("copy_failed");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") throw new Error("copy_failed");
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    area.remove();
  }
  if (!ok) throw new Error("copy_failed");
}

export async function copyCardLink(id, origin = "") {
  const url = cardShareUrl(id, origin);
  if (!url) throw new Error("copy_failed");
  await copyText(url);
  return url;
}
