#!/usr/bin/env node
// 入口首页的静态化：把站点自述写进 index.html 的 head，再随手生成 robots.txt 与 sitemap.xml。
//
// 为什么不在构建时做：站点名称、介绍和 logo 属于「自述区」，主理人在 /admin 里随时改，
// 构建产物不知道域名，也不知道这份档案。推到哪台入口主机、用哪个子域，只有 push-entry.sh
// 知道，所以在这一步生成。
//
// 这里不渲染信息流，也不起 Node 服务：入口仍然只放静态文件，只是把「首页 HTML 里
// 一个字都没有」变成「首页 HTML 里有站点名、一句话介绍和详细介绍」。
//
// 用法：
//   node ops/scripts/entry-html.mjs \
//     --in web/dist/index.html --out /tmp/knot-entry \
//     --origin https://wang.xknot.si --profile sites/wang/profile.json
//
// --profile 缺省读 KNOT_PROFILE_FILE；--name 是档案缺失时的兜底站点名。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inferLocale, isLocale } from "@knot/locale";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * 静态 HTML 的 lang 描述页面里真正写着的那段文字。
 * 档案里的 `locale` 是主理人自己定的，直接用；还没有这一项的旧档案按文案推一次。
 */
export function documentLang({ locale, text } = {}) {
  if (isLocale(locale)) return locale;
  return inferLocale(text);
}

/** 按字符截断，避免把 emoji 或中文切一半。 */
function clip(text, limit) {
  const chars = [...String(text ?? "").trim()];
  return chars.length <= limit ? chars.join("") : chars.slice(0, limit).join("");
}

function cleanSite(site, fallbackName) {
  const name = String(site?.name || "").trim() || fallbackName;
  return {
    name,
    // 站点默认语种：主理人在 /admin 里定。旧档案没有这一项时留空，下面按文案推一次。
    locale: isLocale(site?.locale) ? site.locale : "",
    tagline: String(site?.tagline || "").trim(),
    intro: String(site?.intro || "").trim(),
    logo: /^https:\/\//i.test(String(site?.logo || "")) ? String(site.logo).trim() : "",
    owner: String(site?.owner || "").trim(),
    contact: String(site?.contact || "").trim(),
  };
}

function metaTag(attr, key, value) {
  return `    <meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
}

/**
 * 把一份 SPA 空壳变成对外可读的首页。
 * template 里必须有 `<div id="app"></div>`：没有就说明拿错了文件，宁可直接报错。
 */
export function renderEntryHtml(template, { site, origin, fallbackName = "Knot" } = {}) {
  const html = String(template || "");
  // 挂载点可以带首帧内容：脚本没到或被旧内核拒绝执行时，那一段就是页面本身。
  if (!/<div[^>]*\bid="app"[^>]*>/i.test(html)) {
    throw new Error("入口首页里找不到 <div id=\"app\">，这不像是 web/dist/index.html");
  }
  const base = String(origin || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error(`origin 必须是绝对地址：${origin}`);

  const info = cleanSite(site, fallbackName);
  const text = [info.name, info.tagline, info.intro].filter(Boolean).join(" ");
  const lang = documentLang({ locale: info.locale, text });
  const description = clip(info.intro || info.tagline || info.name, 160);
  const title = clip(info.tagline ? `${info.name} · ${info.tagline}` : info.name, 70);

  const head = [
    `    <link rel="canonical" href="${escapeHtml(base + "/")}" />`,
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:site_name", info.name),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", base + "/"),
    ...(info.logo ? [metaTag("property", "og:image", info.logo)] : []),
    metaTag("name", "twitter:card", info.logo ? "summary_large_image" : "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
  ].join("\n");
  // JSON-LD 在 <script> 里不解码 HTML 实体，不能走 escapeHtml；
  // 只要把 `<` 换成 \u003c，就挡住了 `</script>` 提前闭合这条注入路径。
  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: info.name,
    url: base + "/",
    description,
    inLanguage: lang,
    ...(info.owner ? { author: { "@type": "Person", name: info.owner } } : {}),
  }).replace(/</g, "\\u003c");

  // 标题已经是站点名，正文段落里不再重复一遍。
  const lines = [info.tagline, info.intro, [info.owner, info.contact].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .map((line) => `        <p>${escapeHtml(String(line).replace(/\s+/g, " "))}</p>`)
    .join("\n");

  const noscript = [
    "    <noscript>",
    "      <style>.knot-static{max-width:36rem;margin:3rem auto;padding:0 1rem;font-family:system-ui,-apple-system,sans-serif;line-height:1.7;color:#050505}.knot-static h1{margin:0 0 .5rem;font-size:1.7rem;line-height:1.2}.knot-static p{margin:.6rem 0;color:#65676b}.knot-static p:first-of-type{color:#050505;font-size:1.05rem}</style>",
    '      <div class="knot-static">',
    `        <h1>${escapeHtml(info.name)}</h1>`,
    lines,
    "      </div>",
    "    </noscript>",
  ].join("\n");

  let out = html
    .replace(/<html[^>]*>/i, `<html lang="${lang}">`)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);

  if (/<meta name="description"[^>]*>/i.test(out)) {
    out = out.replace(/<meta name="description"[^>]*>/i, metaTag("name", "description", description).trim());
  } else {
    out = out.replace(/\n[ \t]*<\/head>/i, `\n    <meta name="description" content="${escapeHtml(description)}" />\n  </head>`);
  }

  out = out
    .replace(
      /\n[ \t]*<\/head>/i,
      `\n${head}\n    <script type="application/ld+json">${structured}</script>\n  </head>`,
    )
    // 首帧内容：构建产物里写的是通用文案，入口主机按站点档案换成本站的名字与一句话介绍。
    // 正则只认带 data-knot-* 的那个节点，不碰页面里的同名元素以外的结构。
    .replace(/(<[^>]*data-knot-name[^>]*>)[\s\S]*?(<\/[a-z]+>)/i, `$1${escapeHtml(info.name)}$2`)
    .replace(
      /(<[^>]*data-knot-line[^>]*>)[\s\S]*?(<\/[a-z]+>)/i,
      `$1${escapeHtml(info.tagline || description || "正在进入…")}$2`,
    )
    .replace(/(data-knot-retry[^>]*href=")[^"]*(")/i, `$1${escapeHtml(base + "/")}$2`)
    .replace(/\n[ \t]*<\/body>/i, `\n${noscript}\n  </body>`);

  return out;
}

export function renderRobots(origin) {
  const base = String(origin || "").replace(/\/+$/, "");
  return ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /admin", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
}

export function renderSitemap(origin) {
  const base = String(origin || "").replace(/\/+$/, "");
  // 只有这两个地址是真正的静态页。其余路由要么回源（/api），要么是账户态页面。
  // 不写 lastmod：档案的 updatedAt 是「站点介绍改于何时」，拿它当页面更新时间是假的。
  const urls = ["/", "/discover"].map(
    (pathname) => `  <url>\n    <loc>${escapeHtml(base + pathname)}</loc>\n  </url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

function readProfileFile(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    // v2 档案是 { formatVersion, site, updatedAt }；也接受直接把 site 摊平的那份。
    return parsed?.site && typeof parsed.site === "object" ? parsed.site : parsed;
  } catch {
    return null;
  }
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function main() {
  const input = argValue("in");
  const outDir = argValue("out");
  const origin = argValue("origin");
  const profileFile = argValue("profile", process.env.KNOT_PROFILE_FILE || "");
  const name = argValue("name", "Knot");

  if (!input || !outDir || !origin) {
    console.error("用法：entry-html.mjs --in <web/dist/index.html> --out <目录> --origin <站点地址> [--profile <profile.json>] [--name <兜底名称>]");
    process.exit(2);
  }
  if (!/^https?:\/\//i.test(origin)) {
    console.error(`origin 必须是绝对地址，当前是：${origin}`);
    process.exit(2);
  }

  const site = readProfileFile(profileFile);
  if (!site) {
    console.error(
      profileFile
        ? `警告：读不到站点档案 ${profileFile}，首页只用兜底名称 ${name}。`
        : `警告：没有指定站点档案（--profile），首页只用兜底名称 ${name}。`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  const html = renderEntryHtml(fs.readFileSync(input, "utf8"), { site, origin, fallbackName: name });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  fs.writeFileSync(path.join(outDir, "robots.txt"), renderRobots(origin));
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), renderSitemap(origin));
  console.log(`==> 入口首页：${site?.name || name}（${origin}），robots.txt 与 sitemap.xml 已生成`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
