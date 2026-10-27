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

// 散开半径不是拍的，是解出来的：圆周上相邻两点要至少 MIN_GAP，
// 弦长 2·r·sin(π/n) ≥ MIN_GAP 反解出 r ≥ MIN_GAP / (2·sin(π/n))。
// 所以「半径」和「能容纳几个」本来就是同一个变量的两面：要更多点，圈就自动更大。
// base 只是下限，让两三个点不至于挤在锚点上；gap 是「同一个落点」的容差：
// 国家中心点的坐标是查表来的，同一国家必然完全相同；留余量是为了将来位置细化
// 到城市、两个点只差零点几个单位时也还能算作一处。
export const RING = { base: 16, gap: 2, margin: 1.02 };

// 两个不同落点靠得太近时（比如香港与西贡）也要让开：点本身只有 9 个单位，
// 但命中区 40 个单位，25 以内的两点在窄屏上会读成一处。
export const MIN_GAP = 26;

// 同一个圈上相邻两点的弦长要求。它比 MIN_GAP 大，是因为宽屏上站名常驻在点右侧
// （`.tag` 从 26px 处开始，长约 50–80px）：只是不压住点还不够，得让名字也读得开。
// 站名改成悬停才显示的话，这个值可以直接降到 MIN_GAP，单圈容量随之翻几倍。
export const FAN_GAP = 44;

/**
 * 一个锚点上摆 count 个点时需要的半径。
 *
 * 单人簇不需要圆，返回 0（调用方原样保留坐标）。乘 margin 是为了让相邻弦长
 * 比要求的间距略大一点：正好相等时松弛每轮只能推 0，会一直在边界上磨。
 */
export function ringRadius(count, gap = FAN_GAP) {
  if (!Number.isFinite(count) || count < 2) return 0;
  return Math.max(RING.base, (gap * RING.margin) / (2 * Math.sin(Math.PI / count)));
}

// 让位用迭代松弛，不是扫一遍。半径按上式随数量长大，正常情况下第一轮就排得开；
// 但贴边的锚点会被 clamp 压回画布，圈被压扁，相邻点又挤到一起，所以要能反复推。
// 轮数按最坏情况取：差一点点越线的那种最难收（十七个点相邻弦长 25.8，每轮只推
// 0.2），实测要 54 轮；再多也是同一个量级，取 64 留余量。
export const RELAX_ROUNDS = 64;

// 散开后的点不许出画布：贴着上缘的锚点（高纬度）往外推会把点推到地图外面。
const EDGE = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function anchorOf(point) {
  return !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ? null : point;
}

// 约束质量：先看还有几对压在一起，再看最小间距。两个指标一起比，
// 「违反的点对更少」优先，其次才是「散得更开」。
function scoreOf(points) {
  let pairs = 0;
  let min = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (distance < MIN_GAP) pairs += 1;
      if (distance < min) min = distance;
    }
  }
  return { pairs, min };
}

function isBetter(a, b) {
  return a.pairs !== b.pairs ? a.pairs < b.pairs : a.min > b.min;
}

/**
 * 近邻让位，原地改写 x/y。
 *
 * 每轮把违反约束的点对推开一点，反复扫到没人被推动为止。只推后到的那个点，
 * 先声明的实例位置是权威的，后到的让路。
 *
 * 两点保证：一是全程留着「最好的一轮」，收尾时回滚到那一轮 —— 拥挤时松弛会
 * 来回摆，不看分数收尾，跑得越久反而可能更糟（同一锚点 20 个点，单遍扫描还剩
 * 9.84 的间距）；二是轮数有硬上限，贴边聚类在 clamp 之后永远解不开，没有上限
 * 就卡在排布里出不来。
 */
function separate(points, width, height) {
  const snapshot = () => points.map((point) => ({ x: point.x, y: point.y }));
  let best = scoreOf(points);
  let bestXY = snapshot();
  if (best.pairs === 0) return;

  for (let round = 0; round < RELAX_ROUNDS; round += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        let dx = points[i].x - points[j].x;
        let dy = points[i].y - points[j].y;
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
        const nextX = clamp(points[i].x + (dx / distance) * push, EDGE, width - EDGE);
        const nextY = clamp(points[i].y + (dy / distance) * push, EDGE, height - EDGE);
        // 贴边时 clamp 会吃掉整段位移，那一对永远推不开：算作没动，别再无谓地空转。
        if (nextX !== points[i].x || nextY !== points[i].y) moved = true;
        points[i].x = nextX;
        points[i].y = nextY;
      }
    }

    const score = scoreOf(points);
    if (isBetter(score, best)) {
      best = score;
      bestXY = snapshot();
      if (best.pairs === 0) break;
    }
    if (!moved) break;
  }

  points.forEach((point, index) => {
    point.x = bestXY[index].x;
    point.y = bestXY[index].y;
  });
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

    // 半径由容纳数量反解，不再封顶：点多了圈就大，这是同一个变量的两面。
    const radius = ringRadius(count);
    // 圈心按半径往里收，保证整圆都在画布内。位置偏到边上的国家（南极、图瓦卢）
    // 如果按真实锚点画圆，一半的弧会被画布切掉，切掉的那半就挤成一条线；
    // 圈心内移之后圆是完整的，真实位置由引线指出来。
    const center = {
      x: clamp(group.x, EDGE + radius, width - EDGE - radius),
      y: clamp(group.y, EDGE + radius, height - EDGE - radius),
    };
    // 从正上方再偏半格起排：正上方那一格正好压在朝中枢的弧线上，看着像多了一个点。
    const start = -Math.PI / 2 + Math.PI / count;

    group.members.forEach((point, index) => {
      const angle = start + (index * 2 * Math.PI) / count;
      placed.push({
        ...point,
        x: clamp(center.x + Math.cos(angle) * radius, EDGE, width - EDGE),
        y: clamp(center.y + Math.sin(angle) * radius, EDGE, height - EDGE),
        origin: { x: group.x, y: group.y },
      });
    });

    anchors.push({ x: group.x, y: group.y, count });
  }

  // 近邻让位：约束是「两两至少 MIN_GAP」，用固定上限的迭代松弛解。
  // 只挪后到的那个点，沿着两点连线推开；扫描顺序固定、不引随机数，
  // 所以结果依然只取决于清单顺序，刷新和老点位置都不会抖。
  separate(placed, width, height);

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
