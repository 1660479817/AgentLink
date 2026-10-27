// 地图落点排布：同一个落点的几个实例向外散开，再用引线指回真实位置。
//
// 位置是国家中心点（`world.js` 的 `COUNTRY_AT`），所以从同一个出口出来的实例
// 会算出完全相同的坐标 —— 线上四台就都落在 CN 那个点上，竖着排成一列，
// 读起来像四台机器在四个地方。这里以真实坐标为锚，把簇里的实例按圆周均匀摆开，
// 锚点留一个小空心圈，每个散开的点用一条短线指回锚点：
// 位置没有被改动，只是不再互相压住。
//
// 布局只依赖输入顺序和坐标，不依赖时间或随机数，所以刷新、加站、
// 切换筛选都不会让点跳位置。文档图（ops/build-federation-map.mjs）与门户组件
// （components/NetworkMap.vue）共用这一份，两处不会各摆一套。

import { WORLD } from "./world.js";

// base/step/max 决定散开半径：成员越多圈越大，到 max 就不再长。
// gap 是「同一个落点」的容差：国家中心点的坐标是查表来的，同一国家必然完全相同；
// 留余量是为了将来位置细化到城市、两个点只差零点几个单位时也还能算作一处。
export const RING = { base: 16, step: 7, max: 70, gap: 2 };

// 两个不同落点靠得太近时（比如香港与西贡）也要让开：点本身只有 9 个单位，
// 但站名常驻、命中区 40 个单位，25 以内的两点在窄屏上会读成一处。
export const MIN_GAP = 26;

// 散开后的点不许出画布：贴着上缘的锚点（高纬度）往外推会把点推到地图外面。
const EDGE = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function anchorOf(point) {
  return !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ? null : point;
}

/**
 * 把点在画布上摆开。
 *
 * @param {Array<{x: number, y: number}>} points 已投影好、还没避让的点，按清单顺序
 * @param {{width?: number, height?: number}} [canvas]
 * @returns {{
 *   points: Array<object>,   // 原样带上 x/y；散开过的另带 origin（锚点坐标）
 *   spokes: Array<{id: string, index: number, x1: number, y1: number, x2: number, y2: number}>,
 *   anchors: Array<{x: number, y: number, count: number}>,
 * }}
 */
export function placePoints(points, { width = WORLD.width, height = WORLD.height } = {}) {
  // 先按落点分组：第一个到达的成员定义锚点，后面的跟着它走。
  const groups = [];
  for (const point of points) {
    if (!anchorOf(point)) continue;
    const group = groups.find(
      (entry) => Math.hypot(entry.x - point.x, entry.y - point.y) < RING.gap
    );
    if (group) group.members.push(point);
    else groups.push({ x: point.x, y: point.y, members: [point] });
  }

  const placed = [];
  const anchors = [];

  for (const group of groups) {
    const count = group.members.length;

    // 单独一个：原样保留，不加引线也不画锚点。
    if (count === 1) {
      placed.push({ ...group.members[0] });
      continue;
    }

    const radius = Math.min(RING.max, RING.base + RING.step * (count - 1));
    // 从正上方再偏半格起排：正上方那一格正好压在朝中枢的弧线上，看着像多了一个点。
    const start = -Math.PI / 2 + Math.PI / count;

    group.members.forEach((point, index) => {
      const angle = start + (index * 2 * Math.PI) / count;
      placed.push({
        ...point,
        x: clamp(group.x + Math.cos(angle) * radius, EDGE, width - EDGE),
        y: clamp(group.y + Math.sin(angle) * radius, EDGE, height - EDGE),
        origin: { x: group.x, y: group.y },
      });
    });

    anchors.push({ x: group.x, y: group.y, count });
  }

  // 近邻让位：只挪后到的那个点，沿着两点连线推开，直到够 MIN_GAP。
  // 单遍、不迭代，所以结果依然只取决于顺序，刷新不会抖。
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      let dx = placed[i].x - placed[j].x;
      let dy = placed[i].y - placed[j].y;
      let distance = Math.hypot(dx, dy);
      if (distance >= MIN_GAP) continue;
      if (distance < 0.001) {
        // 两个完全重合的点（簇内已被散开，走到这里说明锚点相同却没被合并）：
        // 一律往下让，不引入随机。
        dx = 0;
        dy = 1;
        distance = 1;
      }
      const push = MIN_GAP - distance;
      placed[i].x = clamp(placed[i].x + (dx / distance) * push, EDGE, width - EDGE);
      placed[i].y = clamp(placed[i].y + (dy / distance) * push, EDGE, height - EDGE);
    }
  }

  // 引线在让位之后才统计：端点要落在点最后停下的地方。
  const spokes = [];
  placed.forEach((point, index) => {
    if (!point.origin) return;
    spokes.push({
      id: point.id,
      index,
      x1: point.origin.x,
      y1: point.origin.y,
      x2: point.x,
      y2: point.y,
    });
  });

  return { points: placed, spokes, anchors };
}
