# @knot/photo-layout

一组图片怎么排：先按真实宽高切成若干等高行，再给每行定一个高度。

卡片（`web/src/components/PhotoGallery.vue`）和分享图（`backend/src/sharePoster.js`）用的是同一份
`planPhotoRows`，所以分享图上看到的拼法就是卡片上的拼法。两处只有「预算」不同：
卡片行高封顶 125% 内容宽（太高会挤满一屏），分享图放到 300%，因为那张图本来就是竖着看的。

- `photoAspect(photo)`：一张图的宽高比，缺尺寸时按 4:3。
- `planPhotoRows(aspects, rules)`：穷举切分（`2^(n-1)` 种），挑代价最小的一种，返回每行的行高与裁切方向。
- `planPhotoLayout(photos)`：卡片用，切行结果直接给 CSS 变量。
- `planPhotoBoxes(photos, { width, gap, rules })`：分享图用，把行高乘成像素框，交给 sharp 裁图贴图。
- `rowShares(aspects, cells)`：一行里每格占多少宽，归一后加起来是 1（直接拿比例当 `flex-grow` 会铺不满）。
- `LAYOUT_RULES`：目标行高、行高上下限、整组高度上限、最窄格、裁切罚分。调整排版口味只改这里。

设计说明写在 `src/index.js` 开头：为什么不用量 DOM、为什么「太高的图」不需要特判、代价函数各罚什么。
