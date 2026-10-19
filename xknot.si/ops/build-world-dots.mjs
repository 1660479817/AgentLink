#!/usr/bin/env node
// 生成世界陆地轮廓与国家中心点，写进 web/src/lib/world.js。
//
// 这张图只回答「联邦在世界哪里」，是版面的底图，不是地理数据源。
// 数据是 Natural Earth 110m 陆地（world-atlas）与国家中心点（world-countries），
// 等距圆柱投影，裁掉南极、量化到 0.5°，只留看得出来的陆地。
//
// 运行一次，把结果提交进仓库；平时构建不依赖这三个包：
//
//   npm i --no-save world-atlas topojson-client world-countries
//   node ops/build-world-dots.mjs
//
// 改了投影或精度就重新生成，别手改 world.js。

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { feature } from "topojson-client";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = path.join(root, "web", "src", "lib", "world.js");

// 画面比例：960 宽、纬度 84°N…58°S，正好盖住有人住的地方。
const W = 960;
const LAT_MAX = 84;
const LAT_MIN = -58;
const H = Math.round((W * (LAT_MAX - LAT_MIN)) / 360);

// 量化步长与小岛门槛：0.5° 在这个宽度上约 1.3px，够用且路径小一半。
const STEP = 0.5;
const MIN_AREA = 14;

function project(lon, lat) {
  return [((lon + 180) / 360) * W, ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H];
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum / 2);
}

function buildLand() {
  const topoPath = path.join(root, "node_modules", "world-atlas", "land-110m.json");
  const topo = JSON.parse(readFileSync(topoPath, "utf8"));
  const land = feature(topo, topo.objects.land);
  const geoms = land.features ? land.features.map((f) => f.geometry) : [land.geometry];
  const polygons = geoms
    .filter(Boolean)
    .flatMap((g) => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]));

  const parts = [];
  for (const polygon of polygons) {
    if (ringArea(polygon[0]) < MIN_AREA) continue;
    for (const ring of polygon) {
      if (ringArea(ring) < MIN_AREA * 0.25) continue;
      const points = [];
      for (const [lon, lat] of ring) {
        if (lat < LAT_MIN - 3 || lat > LAT_MAX + 3) continue;
        const next = [
          Math.round(lon / STEP) * STEP,
          Math.max(LAT_MIN, Math.min(LAT_MAX, Math.round(lat / STEP) * STEP)),
        ];
        const last = points[points.length - 1];
        if (last && last[0] === next[0] && last[1] === next[1]) continue;
        points.push(next);
      }
      if (points.length < 4) continue;
      parts.push(
        `${points
          .map(([lon, lat], index) => {
            const [x, y] = project(lon, lat);
            return `${index === 0 ? "M" : "L"}${Math.round(x)} ${Math.round(y)}`;
          })
          .join("")}Z`
      );
    }
  }
  return parts.join("");
}

const landPath = buildLand();

// 国家中心点：[经度, 纬度]，两位小数够画一个点。
function buildCentroids() {
  const file = path.join(root, "node_modules", "world-countries", "countries.json");
  const list = JSON.parse(readFileSync(file, "utf8"));
  const rows = [];
  for (const country of list) {
    const [lat, lon] = country.latlng || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!/^[A-Z]{2}$/.test(country.cca2)) continue;
    rows.push(`${country.cca2}:[${lon.toFixed(2)},${lat.toFixed(2)}]`);
  }
  return rows.sort().join(",");
}

const centroids = buildCentroids();

const file = `// 世界陆地轮廓（Natural Earth 110m，等距圆柱投影）。
//
// 这张图只回答「联邦在世界哪里」，是版面的底图，不是地理数据源。
// 由 ops/build-world-dots.mjs 生成，别手改。
//
// 画布 ${W}×${H}，经度 -180…180、纬度 ${LAT_MAX}…${LAT_MIN}（裁掉南极）。

export const WORLD = { width: ${W}, height: ${H}, latMax: ${LAT_MAX}, latMin: ${LAT_MIN} };

export const LAND_PATH =
  "${landPath}";

// ISO 3166-1 alpha-2 → [经度, 纬度]。清单里只写国家代码，坐标在这里查。
export const COUNTRY_AT = {
  ${centroids.split(",").join(",\n  ")},
};

// 经纬度 → 画布坐标。极点在裁切范围外，纬度先夹一次。
export function project(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const clamped = Math.max(WORLD.latMin, Math.min(WORLD.latMax, lat));
  return {
    x: ((lon + 180) / 360) * WORLD.width,
    y: ((WORLD.latMax - clamped) / (WORLD.latMax - WORLD.latMin)) * WORLD.height,
  };
}

// 一个实例可以声明多个国家。取覆盖范围的中心：经度先处理跨 180° 的回绕。
export function centroidOf(regions) {
  const list = (Array.isArray(regions) ? regions : [])
    .map((code) => COUNTRY_AT[code])
    .filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return { lon: list[0][0], lat: list[0][1] };

  let x = 0;
  let y = 0;
  for (const [lon, lat] of list) {
    x += Math.cos((lon * Math.PI) / 180);
    y += Math.sin((lon * Math.PI) / 180);
  }
  const meanLat = list.reduce((sum, point) => sum + point[1], 0) / list.length;
  return {
    lon: (Math.atan2(y, x) * 180) / Math.PI,
    lat: meanLat,
  };
}
`;

writeFileSync(target, file);
console.log(`wrote ${path.relative(root, target)} · ${(landPath.length / 1024).toFixed(1)} KB`);
