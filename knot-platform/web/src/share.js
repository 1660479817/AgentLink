// 卡片分享：图片走 /api/web/intel/:id/share，链接指回单条信息的深链。
// 深链路径与分享图二维码一致（/discover?post=），站点部分取当前页面 origin。
export function cardShareUrl(id, origin = "") {
  const value = String(id || "").trim();
  if (!value) return "";
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/discover?post=${encodeURIComponent(value)}`;
}

// 非安全上下文（例如 http://127.0.0.1 以外的本地地址）里 navigator.clipboard 不存在，退回 execCommand。
export async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("copy_failed");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      /* 权限被拒或页面未聚焦时继续走 execCommand */
    }
  }
  if (typeof document === "undefined" || typeof document.execCommand !== "function") throw new Error("copy_failed");
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  let ok = false;
  try {
    area.select();
    // iOS 上 select() 不会选中 textarea 的内容，要再给一次范围。
    area.setSelectionRange?.(0, value.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
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
