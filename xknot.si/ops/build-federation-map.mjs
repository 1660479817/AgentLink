#!/usr/bin/env node
// 生成联邦地图示意图，写进仓库根的 docs/knot-federation-map.svg。
//
// 这张图是文档用的静态版，对应门户左栏的 NetworkMap 组件：
// 同一个等距圆柱投影、同一份陆地轮廓、同一批样例节点、同一套状态色。
// 节点来自 instances.json（真实清单）+ fixtures/preview-instances.json（样例），
// 状态取自 fixtures/preview-health.json，所以图和预览站点看到的是同一张。
//
//   node ops/build-federation-map.mjs
//
// 改了投影、清单或样例就重跑一次，别手改那份 SVG。

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LAND_PATH, WORLD, centroidOf, project } from "../web/src/lib/world.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = path.resolve(root, "..", "docs", "knot-federation-map.svg");
const logoPath = path.join(root, "web", "public", "logos", "xknot-icon-64.png");

// 色值取 web/src/styles.css 的浅色主题，和页面同源。
const C = {
  ok: "#0b7a54",
  warn: "#a16207",
  bad: "#b42318",
  unknown: "#64748b",
  grid: "rgba(16,61,122,0.075)",
  equator: "rgba(11,95,255,0.2)",
  land: "rgba(16,61,122,0.15)",
  landEdge: "rgba(16,61,122,0.06)",
  link: "rgba(232,112,28,0.42)",
  peer: "rgba(31,168,110,0.4)",
  ink: "#0a1322",
  muted: "#475569",
  dim: "#64748b",
  line: "#e1e8f2",
  lineStrong: "#c3d2e6",
};

// 上边留出中枢徽标的位置，四周留白给靠边的标签。
const PAD_X = 22;
const PAD_TOP = 96;
const PAD_BOTTOM = 64;
const W = WORLD.width + PAD_X * 2;
const H = WORLD.height + PAD_TOP + PAD_BOTTOM;

const STATUS_LABEL = { up: "在线", degraded: "延迟", down: "不可达", unknown: "未知" };

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

const manifest = readJson("instances.json");
const preview = readJson("fixtures/preview-instances.json");
const health = readJson("fixtures/preview-health.json");

// 与 web/src/lib/preview.js 的 mergePreview 同序：真实条目在前，样例补空缺。
const taken = new Set((manifest.instances || []).map((item) => item.id));
const nodes = [
  ...(manifest.instances || []),
  ...(preview.instances || []).filter((item) => item.id && !taken.has(item.id)),
].map((item) => {
  const state = health.instances?.[item.id];
  return {
    id: item.id,
    name: item.shortName?.en || item.name?.en || item.id,
    regions: item.regions || [],
    status: state?.status || "unknown",
  };
});

// 同一片区域可能有多个节点，挤在一起就上下错开，和组件里的 spread 一致。
function spread(points) {
  const placed = [];
  const minY = 10;
  const maxY = WORLD.height - 10;
  for (const point of points) {
    let next = { ...point };
    let tryIndex = 0;
    while (
      placed.some((other) => Math.hypot(other.x - next.x, other.y - next.y) < 30) &&
      tryIndex < 8
    ) {
      const step = 17 * (tryIndex + 1);
      const direction = tryIndex % 2 === 0 ? -1 : 1;
      next = { ...point, y: Math.min(maxY, Math.max(minY, point.y + direction * step)) };
      tryIndex += 1;
    }
    placed.push(next);
  }
  return placed;
}

const placed = spread(
  nodes
    .map((node) => {
      const center = centroidOf(node.regions);
      const point = center ? project(center.lon, center.lat) : null;
      return point ? { ...node, x: point.x, y: point.y } : null;
    })
    .filter(Boolean)
);

// 中枢不落经纬度，悬在地图上方；所有节点朝它连弧。
const HUB = { x: WORLD.width / 2, y: -8 };

function fanArc(point) {
  const dx = HUB.x - point.x;
  const dy = HUB.y - point.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = -dy / distance;
  const ny = dx / distance;
  const outward = point.x >= HUB.x ? 1 : -1;
  const sign = nx * outward >= 0 ? 1 : -1;
  const bow = Math.min(52, distance * 0.13);
  const cx = (point.x + HUB.x) / 2 + nx * sign * bow;
  const cy = (point.y + HUB.y) / 2 + ny * sign * bow;
  return `M${point.x.toFixed(1)} ${point.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${HUB.x} ${HUB.y}`;
}

// 节点之间的直连：每个站挑最近的 2–4 个邻居，连几个按顺序轮流取。
const PEER_DEGREES = [2, 3, 4];
const peers = [];
{
  const seen = new Set();
  placed.forEach((point, index) => {
    const degree = PEER_DEGREES[index % PEER_DEGREES.length];
    const neighbours = placed
      .map((other, otherIndex) => ({
        otherIndex,
        distance: Math.hypot(other.x - point.x, other.y - point.y),
      }))
      .filter((entry) => entry.otherIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, degree);
    for (const { otherIndex } of neighbours) {
      const low = Math.min(index, otherIndex);
      const high = Math.max(index, otherIndex);
      const key = `${low}:${high}`;
      if (seen.has(key)) continue;
      seen.add(key);
      peers.push(`M${placed[low].x.toFixed(1)} ${placed[low].y.toFixed(1)}L${placed[high].x.toFixed(1)} ${placed[high].y.toFixed(1)}`);
    }
  });
}

// 经纬网：经线每 30°、纬线每 30°。
const graticule = [];
for (let lon = -150; lon <= 150; lon += 30) {
  const x = project(lon, 0).x.toFixed(1);
  graticule.push(`M${x} 0V${WORLD.height}`);
}
for (let lat = -30; lat <= 60; lat += 30) {
  const y = project(0, lat).y.toFixed(1);
  graticule.push(`M0 ${y}H${WORLD.width}`);
}

const q1 = (n) => Math.round(n * 10) / 10;
const esc = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const WORLD_AT = `translate(${PAD_X} ${PAD_TOP})`;
const HUB_X = PAD_X + HUB.x;
const HUB_Y = PAD_TOP + HUB.y;

// 线走在字下面：先画底图与连线，再写文字。
const lines = placed
  .map((point) => {
    const color = point.status === "down" ? C.bad : C.link;
    const opacity = point.status === "down" ? 0.45 : 1;
    return `<path d="${fanArc(point)}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1" stroke-dasharray="10 5"/>`;
  })
  .join("\n    ");

const pins = placed
  .map((point) => {
    const color = C[point.status] || C.unknown;
    const x = q1(point.x);
    const y = q1(point.y);
    const flip = point.x > WORLD.width * 0.78;
    const labelX = flip ? x - 10 : x + 10;
    const anchor = flip ? "end" : "start";
    return `<g class="pin">
      <circle cx="${x}" cy="${y}" r="7.5" fill="${color}" fill-opacity="0.14"/>
      <circle cx="${x}" cy="${y}" r="3.6" fill="${color}"/>
      <text x="${labelX}" y="${y + 3.5}" text-anchor="${anchor}" class="pin-name" data-halo="1">${esc(point.name)}</text>
    </g>`;
  })
  .join("\n    ");

const logo = readFileSync(logoPath).toString("base64");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Knot 联邦：各节点汇入 xknot.si 中枢，节点之间另有直连">
  <title>Knot 联邦</title>
  <desc>一张等距圆柱投影的世界地图。每个节点朝上方的 xknot.si 中枢连一条橙色虚线，表示按清单登记、由中枢探测与展示；节点之间的绿色实线表示协议直连、可就地交换数据。点的颜色表示探测到的状态。</desc>
  <defs>
    <pattern id="land-dots" width="11" height="11" patternUnits="userSpaceOnUse">
      <circle cx="2.4" cy="2.4" r="1.55" fill="${C.land}"/>
    </pattern>
    <clipPath id="world-clip">
      <rect x="0" y="0" width="${WORLD.width}" height="${WORLD.height}"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <g transform="${WORLD_AT}">
    <path d="${graticule.join("")}" fill="none" stroke="${C.grid}" stroke-width="1"/>
    <line x1="0" y1="${project(0, 0).y.toFixed(1)}" x2="${WORLD.width}" y2="${project(0, 0).y.toFixed(1)}" stroke="${C.equator}" stroke-width="1" stroke-dasharray="3 5"/>

    <g clip-path="url(#world-clip)">
      <path d="${LAND_PATH}" fill="url(#land-dots)" stroke="${C.landEdge}" stroke-width="1"/>
    </g>

    <g class="peers">
      ${peers.map((d) => `<path d="${d}" fill="none" stroke="${C.peer}" stroke-width="1"/>`).join("\n      ")}
    </g>

    <g class="links">
    ${lines}
    </g>
  </g>

  <g transform="${WORLD_AT}">
    ${pins}
  </g>

  <g transform="translate(${q1(HUB_X)} ${q1(HUB_Y)})">
    <ellipse cx="0" cy="14" rx="118" ry="9" fill="#0a1322" fill-opacity="0.10"/>
    <rect x="-124" y="-24" width="248" height="48" rx="24" fill="#ffffff" stroke="${C.lineStrong}" stroke-width="1"/>
    <image x="-112" y="-12" width="24" height="24" href="data:image/png;base64,${logo}"/>
    <text x="-80" y="-2" class="hub-name">XKNOT</text>
    <text x="-80" y="12" class="hub-role">FEDERATION HUB</text>
  </g>

  <g transform="translate(${PAD_X} ${H - 34})">
    <g class="legend">
      <circle cx="4" cy="-4" r="3.6" fill="${C.ok}"/><text x="14" y="0" class="legend-text">在线 ${placed.filter((p) => p.status === "up").length}</text>
      <circle cx="84" cy="-4" r="3.6" fill="${C.warn}"/><text x="94" y="0" class="legend-text">延迟 ${placed.filter((p) => p.status === "degraded").length}</text>
      <circle cx="164" cy="-4" r="3.6" fill="${C.bad}"/><text x="174" y="0" class="legend-text">不可达 ${placed.filter((p) => p.status === "down").length}</text>
      <line x1="256" y1="-4" x2="282" y2="-4" stroke="${C.link}" stroke-width="1" stroke-dasharray="10 5"/><text x="290" y="0" class="legend-text">登记与探测</text>
      <line x1="396" y1="-4" x2="422" y2="-4" stroke="${C.peer}" stroke-width="1"/><text x="430" y="0" class="legend-text">节点直连</text>
    </g>
    <text x="0" y="22" class="foot">说明：绿色直连表示协议层直接交换，当前版本尚未启用，图上是目标形态。${esc(placed.length)} 个节点中，${esc(nodes.find((n) => n.id === "wang")?.name || "wang")} 为真实实例，其余来自样例清单。</text>
  </g>

  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
    .pin-name { font-size: 12px; fill: ${C.muted}; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; stroke-linejoin: round; }
    .hub-name { font-size: 14px; font-weight: 700; letter-spacing: 2.6px; fill: ${C.ink}; }
    .hub-role { font-size: 8.5px; letter-spacing: 1.4px; fill: ${C.muted}; font-family: "SF Mono", Menlo, Consolas, monospace; }
    .legend-text { font-size: 11px; fill: ${C.dim}; }
    .foot { font-size: 10.5px; fill: ${C.dim}; }
  </style>
</svg>
`;

writeFileSync(target, svg, "utf8");
console.log(`已写入 ${path.relative(root, target)}（${placed.length} 个节点，${peers.length} 条直连）`);
