// 站点色相：同一个 id 在任何语种、任何快照下都是同一个色，换一份快照也不会跳。
//
// 档案里不存主题色，颜色由 id 推出来。推法两步，缺一不可：
//   1. FNV-1a 累积 + murmur3 的 fmix32 收尾，把 id 摊匀成 32 位整数；
//   2. 按 32 位整数占满量程的比例铺到色轮上。
// 少任何一步都会退化：只用 `h * 31 % 360` 时线上四台挤在 65°–156° 里，看图像
// 一片绿；只用 FNV-1a 时末位差一个字符的 id（`site-1` / `site-2`）只差 1.4°，
// 因为那一步只是乘了一个常数。收尾的异或-乘-异或把高位也搅进来。
//
// 卡片徽记与地图点位共用这一份：两处的颜色必须对得上，否则同一个站在卡片上
// 是紫色、在地图上是青色，颜色就不再是识别符了。

function fmix32(value) {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function hueOf(id) {
  let hash = 2166136261;
  for (const char of String(id ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return Math.round((fmix32(hash) / 4294967296) * 360) % 360;
}
