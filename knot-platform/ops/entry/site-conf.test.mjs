import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderTemplate } from "../scripts/render-config.mjs";

// 入口模板只有一个 source，两种投放靠 KNOT_ENTRY_STATIC 分叉。
// 这里直接渲染真模板，盯住两件事：static 才声明缓存区，proxy 把首页也回源。

const TEMPLATE = readFileSync(fileURLToPath(new URL("./site.conf.template", import.meta.url)), "utf8");

const BASE = {
  KNOT_DOMAIN: "wang.xknot.si",
  KNOT_ENTRY_WEB_ROOT: "/var/www/wang",
  KNOT_ENTRY_MAX_BODY: "52m",
  KNOT_ENTRY_PROXY_PORT: "18080",
  KNOT_ENTRY_ACCESS_LOG: "/var/log/nginx/knot-access.log",
  KNOT_ENTRY_CACHE_DIR: "/var/cache/nginx/knot_uploads",
  KNOT_ENTRY_CACHE_ZONE: "knot_uploads",
  KNOT_ENTRY_CACHE_SIZE: "2g",
  KNOT_ENTRY_SSL: "1",
  KNOT_ENTRY_CERT: "/etc/letsencrypt/live/wang.xknot.si/fullchain.pem",
  KNOT_ENTRY_KEY: "/etc/letsencrypt/live/wang.xknot.si/privkey.pem",
};

const render = (overrides) => renderTemplate(TEMPLATE, { ...BASE, ...overrides });

test("static 投放：首页从磁盘出，缓存区不在这份文件里声明", () => {
  const text = render({ KNOT_ENTRY_STATIC: "1" });
  assert.match(text, /root \/var\/www\/wang;/);
  assert.match(text, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(text, /proxy_cache knot_uploads;/);
  // 缓存区同一台入口主机只允许一次，放在 cache.conf.template。
  assert.doesNotMatch(text, /^proxy_cache_path/m);
  // 静态兜底在那里，但 / 不应该整段回源。
  assert.doesNotMatch(text, /location \/ \{\n\s*proxy_pass/);
});

test("proxy 投放：不声明缓存区，首页整段回源", () => {
  const text = render({ KNOT_ENTRY_STATIC: "" });
  assert.doesNotMatch(text, /^proxy_cache_path/m);
  assert.match(text, /location \/ \{\n\s*proxy_pass http:\/\/knot_entry_18080;/);
  // 上传也回源，但不带缓存键，避免和同机 static 入口抢同一个 zone。
  assert.doesNotMatch(text, /proxy_cache knot_uploads/);
});

test("缓存区单独成一份，同一台入口主机只声明一次", () => {
  const cache = renderTemplate(
    readFileSync(fileURLToPath(new URL("./cache.conf.template", import.meta.url)), "utf8"),
    BASE,
  );
  assert.match(cache, /^proxy_cache_path \/var\/cache\/nginx\/knot_uploads/m);
  assert.equal(cache.match(/proxy_cache_path/g).length, 1);
  assert.doesNotMatch(cache, /server \{/);
});

test("static 投放：发现页快照先看磁盘，缺了才回源", () => {
  const text = render({ KNOT_ENTRY_STATIC: "1" });
  assert.match(text, /location = \/discover\.json \{[\s\S]*?try_files \/discover\.json @knot_origin;/);
  // 首屏直接读快照：允许浏览器用 30 秒内的副本，不为校验再走一次跨境往返。
  assert.match(text, /Cache-Control "public, max-age=30, stale-while-revalidate=300"/);
});

test("入口的上传代理 location 不带尾斜杠：POST 不能被 301 改写成 GET", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    // 带尾斜杠时 nginx 把 /api/web/uploads 当成目录，对 POST 回 301 补斜杠；
    // 浏览器跟随时改发 GET、请求体丢掉，WebUI 选好的图传上去就是 404。
    assert.match(text, /location \^~ \/api\/web\/uploads \{/);
    assert.doesNotMatch(text, /location \^~ \/api\/web\/uploads\/\s*\{/);
    // 读取路径不变：带 id 的 /api/web/uploads/<uuid> 仍由这条前缀回源。
    assert.match(text, /location \^~ \/api\/web\/uploads \{[\s\S]*?proxy_pass http:\/\/knot_entry_18080;/);
  }
});

test("两种投放都保留管理接口、管理后台 404 与 ACME 目录", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    assert.match(text, /location \^~ \/api\/admin/);
    assert.match(text, /location \^~ \/admin \{/);
    assert.match(text, /return 404 '\{"error":"not_found"\}'/);
    assert.match(text, /\.well-known\/acme-challenge\//);
  }
});

test("入口不为 /help 单独回源，它和任何不存在的路径一样走 SPA 兜底", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    // Agent 指引在中枢（xknot.si/knot-help）。入口只转运 /api 与静态站：
    // 给 /help 留一条回源，就是每次白穿一次隧道去取一个不存在的页面。
    assert.doesNotMatch(text, /location = \/help\b/);
    assert.doesNotMatch(text, /\bhelpPage\b|knot-help\.md/);
  }
});

test("两种投放都开 gzip，且只压文本类", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    assert.match(text, /^\s*gzip on;$/m);
    assert.match(text, /^\s*gzip_vary on;$/m);
    // 穿过隧道的 /api JSON 也要压。
    assert.match(text, /^\s*gzip_proxied any;$/m);
    assert.match(text, /gzip_types[^;]*application\/json/);
    assert.match(text, /gzip_types[^;]*text\/css/);
    // 入口不发文档（Agent 指引在中枢 xknot.si/knot-help），没有 markdown 可压。
    assert.doesNotMatch(text, /^\s*gzip_types[^;\n]*text\/markdown/m);
    // 图片与字体已经压过，不要再走一遍。
    assert.doesNotMatch(text, /gzip_types[^;]*image\/(jpeg|png)/);
  }
});

test("两种投放都把访问日志写进同一个文件，格式只在 log.conf 里声明一次", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    assert.match(text, /^\s*access_log \/var\/log\/nginx\/knot-access\.log knot_json;$/m);
    // log_format 只能出现一次，放进每个子域的 conf 会让第二个子域过不了 nginx -t。
    assert.doesNotMatch(text, /log_format/);
  }
  const log = renderTemplate(
    readFileSync(fileURLToPath(new URL("./log.conf.template", import.meta.url)), "utf8"),
    {},
  );
  assert.equal(log.match(/log_format knot_json/g).length, 1);
  // 子域靠 $host 分；查询串可能带令牌，不记。
  const directive = log.slice(log.indexOf("log_format knot_json"));
  assert.match(directive, /\$host/);
  assert.match(directive, /"\$uri"/);
  assert.doesNotMatch(directive, /\$request_uri|\$args/);
  assert.match(directive, /escape=json/);
});

test("入口的 server_name 来自 KNOT_DOMAIN", () => {
  const text = render({
    KNOT_DOMAIN: "cpswang.xknot.si",
    KNOT_ENTRY_CERT: "/etc/letsencrypt/live/cpswang.xknot.si/fullchain.pem",
    KNOT_ENTRY_KEY: "/etc/letsencrypt/live/cpswang.xknot.si/privkey.pem",
    KNOT_ENTRY_STATIC: "1",
  });
  assert.match(text, /server_name cpswang\.xknot\.si;/);
  assert.match(text, /ssl_certificate \/etc\/letsencrypt\/live\/cpswang\.xknot\.si\/fullchain\.pem;/);
});

test("回源复用长连接：upstream 按端口命名，所有反代都带 Connection 空值", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    // 名字带端口，同一台入口主机上多个子域各有各的 upstream。
    assert.match(text, /^upstream knot_entry_18080 \{$/m);
    assert.match(text, /^\s*server 127\.0\.0\.1:18080;$/m);
    assert.match(text, /^\s*keepalive 16;$/m);
    // keepalive 必须配 HTTP/1.1 和空的 Connection，否则复用不了。
    const passes = text.match(/proxy_pass http:\/\/knot_entry_18080;/g) ?? [];
    const conns = text.match(/proxy_set_header Connection "";/g) ?? [];
    assert.equal(passes.length, conns.length);
    assert.ok(passes.length >= 3);
    // 不要再有直连 127.0.0.1 的 proxy_pass，否则那条路径复用不到连接。
    assert.doesNotMatch(text, /proxy_pass http:\/\/127\.0\.0\.1:18080/);
  }
});

test("KNOT_ENTRY_SSL=1 时开 HTTP/2", () => {
  const text = render({ KNOT_ENTRY_STATIC: "1" });
  assert.match(text, /^\s*listen 443 ssl;$/m);
  assert.match(text, /^\s*http2 on;$/m);
});

test("KNOT_ENTRY_SSL=0 时只监听 80，不写证书，也不开 HTTP/2", () => {
  const text = render({ KNOT_ENTRY_SSL: "0", KNOT_ENTRY_STATIC: "1" });
  assert.doesNotMatch(text, /listen 443/);
  assert.doesNotMatch(text, /ssl_certificate/);
  assert.doesNotMatch(text, /http2 on;/);
  assert.match(text, /listen 80;/);
});

test("真实客户端地址单独成一份，只信任 Cloudflare 网段", () => {
  const realip = readFileSync(fileURLToPath(new URL("./realip.conf", import.meta.url)), "utf8");
  // 不声明这个头，CF 网段配了也白配：$remote_addr 仍是边缘地址。
  assert.equal(realip.match(/^\s*real_ip_header CF-Connecting-IP;$/gm)?.length, 1);
  // nginx 的 set_real_ip_from 只能一个网段一行，没有列表写法。
  assert.match(realip, /^set_real_ip_from 104\.16\.0\.0\/13;$/m);
  assert.match(realip, /^set_real_ip_from 2606:4700::\/32;$/m);
  // 全放行等于允许任何人伪造这个头，直连入口就能换掉自己的 IP。
  assert.doesNotMatch(realip, /set_real_ip_from (0\.0\.0\.0\/0|::\/0);/);
  // 同一台入口主机一份，http 级：不能带 server 块。
  assert.doesNotMatch(realip, /server \{/);
});

test("每个子域的 conf 不重复声明 real_ip", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    // 每个子域各写一份，后装的那份会盖掉前一份，同一台机上还多一处要同步。
    assert.doesNotMatch(text, /^\s*real_ip_header/m);
    assert.doesNotMatch(text, /^\s*set_real_ip_from/m);
  }
});
