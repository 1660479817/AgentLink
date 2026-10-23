// 多图排版：先按图片真实比例把一组图切成若干行，再给每行定一个高度。
//
// 一行的高度（记作 h，单位是「容器宽的倍数」）决定两件事：
//   - 行内每格的宽度按图片比例分配，所以「不裁也不留边」的行高恰好是 1/Σa（a 是这一行的比例之和）；
//   - 行高被夹在 [minRow, maxRow] 之间，夹住的那点差额由 cover 裁掉，裁多少 = |ln(h / (1/Σa))|。
//
// 于是「太高的图」不需要单独特判：它的自然行高超过 maxRow，被夹住之后自动变成满宽的一条，
// 上下裁掉一截；「太扁的图」同理，左右裁。裁多少由数据与规则算出，代码里没有「单图」「长图」这类分支。
//
// 为什么不用量 DOM：行高只由「这一行比例之和」与规则决定，与容器绝对宽度无关，
// 所以整份排版可以只从图片尺寸算出来。渲染前就知道每行的比例，
// 图片下载完只是往同样大小的盒子里填，不重排、不跳版（CLS 为 0）。
//
// 分几行是穷举出来的：n 张图只切 n-1 个缝，最多 2^8 = 256 种，逐个评估即可。
// 代价看四件事：行高偏离目标多远、整组是否过高、一行里最窄的那格还剩多宽、裁掉了多少。
//
// 这份算法同时给两个地方用：WebUI 的卡片（`PhotoGallery.vue`，用 CSS 比例排）
// 和分享图（Backend 的 `sharePoster.js`，按像素框裁图再拼）。两边各有一份预算，
// 但切行与裁剪的判断只有这一份，卡片上看到的拼法就是分享图上的拼法。

// 比例先夹住：1:2.5 的竖图和 3.5:1 的全景之外，再极端就跟内容无关了。
// 夹住的是「排版用的比例」，不是图片本身；超出部分照样由 cover 收掉。
const MIN_ASPECT = 0.4;
const MAX_ASPECT = 3.5;
// 没有尺寸（旧记录、还没来得及量）时按 4:3 猜。猜错只是那一格被 cover 裁一点。
const DEFAULT_ASPECT = 4 / 3;
// 行高与自然行高差到这个程度才算「裁过」，免得浮点误差把整行标成裁剪。
const CROP_EPSILON = 0.004;

// target / targetDense：理想行高 = 容器宽的百分之多少。
// 少到四张时按 36% 排，图片够大；五张起按 25% 排，九宫格才压得进一屏。
// minRow / maxRow：一行最矮、最高的行高（相对容器宽）。maxRow 是「太高就裁」的唯一出处：
//   1.25 是 4:5 的竖图上限，也是常见信息流对竖版内容的通行上限。
// maxCard：整组图的高度上限（相对容器宽），超出的部分按 cardPenalty 计罚。
// 这几个数是排版口味，不是精确值；要调整只改这里，组件和样式跟着走。
export const LAYOUT_RULES = {
  target: 0.36,
  targetDense: 0.25,
  denseFrom: 5,
  minRow: 0.16,
  maxRow: 1.25,
  maxCard: 1.25,
  maxPerRow: 4,
  // 一格最少占这一行宽度的 16%。328px 的窄屏上约 52px，还能按得住（规则要求不小于 44px）。
  minCell: 0.16,
  minCellPenalty: 240,
  rowPenalty: 0.45,
  cardPenalty: 6,
  crowdedPenalty: 40,
  // 裁掉的内容按「可见比例的平方」计罚：裁 10% 几乎不算，裁一半很贵。
  // 它让求解器在「多切一行」与「多裁一截」之间做选择，而不是永远选裁。
  cropPenalty: 6,
};

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function clampAspect(value) {
  const aspect = Number(value);
  if (!Number.isFinite(aspect) || aspect <= 0) return DEFAULT_ASPECT;
  return clamp(aspect, MIN_ASPECT, MAX_ASPECT);
}

// 一张图的宽高比。卡片用的是显示图，宽高由后端随记录下发；缺了就退回 4:3。
export function photoAspect(photo) {
  const width = Number(photo?.width) || 0;
  const height = Number(photo?.height) || 0;
  if (width <= 0 || height <= 0) return DEFAULT_ASPECT;
  return clampAspect(width / height);
}

// 一行最终的形状：自然行高（不裁时的行高）、实际行高、裁掉多少、是竖着裁还是横着裁。
function rowShape(sum, rules) {
  const natural = 1 / sum;
  const height = clamp(natural, rules.minRow, rules.maxRow);
  const crop = Math.abs(Math.log(height / natural));
  return {
    natural,
    height,
    // 行高比自然值矮：格子比图片「瘦」，裁上下；比自然值高：裁左右。
    vertical: height < natural,
    cropped: crop > CROP_EPSILON,
    crop,
  };
}

function measureRows(breaks, list, prefix, rules, total) {
  const target = total >= rules.denseFrom ? rules.targetDense : rules.target;
  let cost = 0;
  let totalHeight = 0;
  const rows = [];
  let start = 0;
  for (const end of breaks) {
    const count = end - start;
    const sum = prefix[end] - prefix[start];
    const shape = rowShape(sum, rules);
    let row = count * Math.log(shape.height / target) ** 2 + rules.rowPenalty;
    if (count > rules.maxPerRow) row += (count - rules.maxPerRow) * rules.crowdedPenalty;
    // 一行里最窄的那格：比例悬殊的图（长截图 + 全景）挤在一行时，窄的那格只剩几十像素，
    // 手机上连按都按不准。罚它，让求解器把它们分到不同的行。
    let narrowest = Infinity;
    for (let index = start; index < end; index++) narrowest = Math.min(narrowest, list[index]);
    const share = narrowest / sum;
    if (share < rules.minCell) row += (rules.minCell - share) * rules.minCellPenalty;
    // 被夹住的行高就是裁切：一张 1:1.6 的长图单独一行时，这一项是它「裁掉一截」的代价，
    // 而拆成多行、每行不那么高，代价更小——是否值得，交给求解器算。
    row += count * shape.crop ** 2 * rules.cropPenalty;
    cost += row;
    totalHeight += shape.height;
    rows.push({ start, end, sum, ...shape });
    start = end;
  }
  cost += Math.max(0, totalHeight - rules.maxCard) * rules.cardPenalty;
  return { cost, rows, totalHeight };
}

// 切分是穷举的：n 张图有 2^(n-1) 种切法。九张以内只有 256 种，随手就算完；
// 二十张就是 52 万种，纯同步算在渲染路径上要停上百毫秒。上限之内的张数照旧
// 穷举（九宫格排法最讲究，不能拿贪心凑），超过就按「加到行高够矮就换行」贪心切。
// 前端接口有 MAX_IMAGES，但这是共享包，不能把正确性押在调用方记得限制上。
const MAX_ENUMERATED = 12;

function greedyBreaks(list, rules, count) {
  const target = count >= rules.denseFrom ? rules.targetDense : rules.target;
  const breaks = [];
  let start = 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const next = sum + list[index];
    const size = index - start + 1;
    // 再加一张就让这一行比目标更高（图片偏竖），或者已经顶到一行上限：收尾换行。
    if (size > 1 && (1 / next < target || size > rules.maxPerRow)) {
      breaks.push(index);
      start = index;
      sum = list[index];
      continue;
    }
    sum = next;
  }
  breaks.push(count);
  return breaks;
}

// 所有切分方式里挑代价最小的一种。
export function planPhotoRows(aspects, rules = LAYOUT_RULES) {
  const list = (aspects || []).map(clampAspect);
  const count = list.length;
  if (!count) return [];
  if (count === 1) {
    const shape = rowShape(list[0], rules);
    return [{ cells: [0], aspect: 1 / shape.height, ...shape }];
  }
  const prefix = [0];
  for (const aspect of list) prefix.push(prefix[prefix.length - 1] + aspect);

  const gaps = count - 1;
  let rows;
  if (count > MAX_ENUMERATED) {
    rows = measureRows(greedyBreaks(list, rules, count), list, prefix, rules, count).rows;
  } else {
    let best = null;
    for (let mask = 0; mask < 2 ** gaps; mask++) {
      const breaks = [];
      for (let i = 0; i < gaps; i++) if (mask & (1 << i)) breaks.push(i + 1);
      breaks.push(count);
      const candidate = measureRows(breaks, list, prefix, rules, count);
      // 代价相同的切分不少（一组等比例图，行序怎么排代价都一样），挑第一行更高的一种：
      // 大图在上、往下渐小，和常见相册的顺序一致，3 张也就排成 1+2 而不是 2+1。
      const better = !best
        || candidate.cost < best.cost - 1e-9
        || (Math.abs(candidate.cost - best.cost) <= 1e-9 && candidate.rows[0].height > best.rows[0].height + 1e-9);
      if (better) best = candidate;
    }
    rows = best.rows;
  }

  return rows.map((row) => {
    const cells = [];
    for (let index = row.start; index < row.end; index++) cells.push(index);
    return {
      cells,
      height: row.height,
      aspect: 1 / row.height,
      natural: row.natural,
      crop: row.crop,
      vertical: row.vertical,
      cropped: row.cropped,
    };
  });
}

// 一行里每格占这一行宽度的份额，加起来正好 1。
// 不能直接拿图片比例当 flex-grow：grow 之和小于 1 时浏览器只分出去那么多空闲宽度，
// 一张竖图（0.75）单独一行就只占 75% 宽，右边空一条。
export function rowShares(aspects, cells) {
  const list = (aspects || []).map(clampAspect);
  const sum = cells.reduce((total, index) => total + (list[index] ?? DEFAULT_ASPECT), 0);
  return cells.map((index) => (list[index] ?? DEFAULT_ASPECT) / sum);
}

// 卡片只需要一件事：把这组图切成若干行，每行给出行高与裁切方向。
export function planPhotoLayout(photos, rules = LAYOUT_RULES) {
  const items = (photos || []).filter((photo) => photo && typeof photo.url === "string" && photo.url);
  return { rows: planPhotoRows(items.map(photoAspect), rules) };
}

// 分享图要的是像素框：每格贴在哪、多大。行高仍是「内容宽的倍数」，乘上宽度就是像素，
// 所以同一份计划既能在 CSS 里按比例排，也能在 sharp 里按坐标裁。
// 宽度按份额取整后，最后一格吃掉舍入误差，整行正好铺满 width。
export function planPhotoBoxes(photos, options = {}) {
  const { width, gap = 2, rules = LAYOUT_RULES, x: originX = 0, y: originY = 0 } = options;
  // 所有坐标都是「行高 × 宽度」算出来的：宽度缺了或不是正数，Math.round(row.height * undefined)
  // 得 NaN，Math.max(1, NaN) 仍是 NaN，整张分享图的框会带着 NaN 交给 sharp。
  // 与其让下游拿到一堆 NaN，不如在这里当场拒绝。
  const boxWidth = Number(width);
  if (!Number.isFinite(boxWidth) || boxWidth <= 0) {
    throw new TypeError("planPhotoBoxes: width must be a positive finite number");
  }
  const items = (photos || []).map((photo) => photo || {});
  const aspects = items.map(photoAspect);
  const rows = planPhotoRows(aspects, rules);
  const boxes = [];
  let top = originY;
  rows.forEach((row) => {
    const height = Math.max(1, Math.round(row.height * boxWidth));
    const usable = Math.max(1, boxWidth - gap * (row.cells.length - 1));
    const shares = rowShares(aspects, row.cells);
    let acc = 0;
    row.cells.forEach((index, position) => {
      const left = originX + Math.round(acc * usable) + position * gap;
      acc += shares[position];
      const right = originX + Math.round(acc * usable) + position * gap;
      boxes.push({
        index,
        photo: items[index],
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height,
        vertical: row.vertical,
        cropped: row.cropped,
      });
    });
    top += height + gap;
  });
  return { rows, boxes, height: boxes.length ? top - gap - originY : 0 };
}
