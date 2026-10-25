// 站内链接判定：`/store`、`/discover?post=…` 这类服务端给的路径可以直接交给 RouterLink；
// `//evil.example`、`javascript:…` 与外链不行。通知的 href 来自库里的字符串，
// 后端只原样存取，所以前端这里是唯一一道校验。

export function internalHref(href) {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}
