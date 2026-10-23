// 从 index.html 里抠出构建产物地址。k6 的 JS 引擎没有 DOM，只能按字符串找。
//
// k6 与 scripts 共用这一份：以前两边各写一遍同样的正则，改一处忘一处时
// 「测到的静态资源」与「报告里说的静态资源」就会不是同一批。

export function assetPaths(html) {
  const seen = new Set();
  const re = /["'](\/assets\/[A-Za-z0-9._-]+\.(?:js|css))["']/g;
  let match;
  while ((match = re.exec(html || "")) !== null) seen.add(match[1]);
  return Array.from(seen);
}
