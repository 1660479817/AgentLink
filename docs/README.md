# XKnot 公共文档与资产

这里放**跨项目**的东西：描述 XKnot 网络本身，与某个实例的实现无关。两个项目各自的实现文档留在各自目录，不往这里复制。

## 公共资产清单

| 资产 | 位置 | 说明 |
|------|------|------|
| 概念与归属 | [`concepts.md`](./concepts.md) | 中枢、实例、公网入口三者的分工、归属与禁用词；配图 `concepts.svg` |
| 版权与署名 | [`../LICENSE`](../LICENSE)、[`../NOTICE`](../NOTICE) | Apache-2.0；`XKnot`、`Knot`、`xknot`、`xknot.si` 的名称与标识归 PaulWang，许可证不授予商标权 |
| API 入口 | [`API.md`](./API.md) | 实例 Web API 与联邦契约的索引，正文在各自项目 |
| 标识母版 | `xknot-mark.svg` | 见下文「标识与地图」 |
| 横向组合标 | `xknot-lockup.svg`、`xknot-lockup-mono.svg`、`xknot-lockup-inverse.svg` | 标识当 X，后接 `Knot`；见下文「横向组合标」 |
| PNG 导出 | `png/` | 由上面几个 SVG 栅格化的成品，见「PNG 导出」 |
| 联邦地图 | `knot-federation-map.svg` | 由 `xknot.si/ops/build-federation-map.mjs` 生成，别手改 |
| 联邦层文档 | `soul-questions.md` | 灵魂几问：部署与加入之前值得先自问的一组问题，不给答案 |

## 标识与地图

- `xknot-mark.svg` — 唯一标识母版，296×296，透明底，深橙 `#C2410C`。页头、页签、主屏图标、分享卡都从它栅格化；`knot-platform` 的页头读自己 `web/public/logos/xknot-mark.svg` 这一份副本。没有带字标的第二版。
- `knot-federation-map.svg` — 联邦地图。由 `xknot.si/ops/build-federation-map.mjs` 生成，别手改。图里的中枢徽标是 `xknot.si/web/public/logos/xknot-icon-64.png` 内嵌进去的，换标之后要重跑一次脚本。

## 标识的几何

图形只由三样东西构成，没有任何手绘折点：

- **正圆**：中心圆环为 `circle` 的 `r=23` 加 `stroke-width=14`，即外半径 30、内半径 16。
- **标准圆弧**：四条臂端头是半径 16 的半圆；内端被一个以图形中心为圆心、半径 46 的圆切开，两条臂的内侧因此共用同一段弧。
- **直线**：臂的两条侧边，间距 32，正好等于端头半圆的直径，与端头相切。

四条臂是同一段 `<path>` 用 `rotate(45/135/225/315)` 复制，四重旋转对称。改动半径时，`43.128` 要跟着按 `sqrt(46² - 16²)` 重算——它是臂侧边与内切口圆的交点，不是描出来的坐标。

## 横向组合标

`xknot-lockup.svg` 是「标识 + `Knot`」的横向排法，标识当字母 X 用，读作 XKnot。同一版式出三份，几何完全一致，只换颜色：

| 文件 | 标识 | `Knot` | 底 | 用在 |
|---|---|---|---|---|
| `xknot-lockup.svg` | 深橙 `#C2410C` | `#050505` | 透明 | 默认，浅色底 |
| `xknot-lockup-mono.svg` | `#050505` | `#050505` | 透明 | 单色印刷、烫印、传真件，不能有第二色 |
| `xknot-lockup-inverse.svg` | `#FFFFFF` | `#FFFFFF` | 透明 | 深色底（深于约 `#444`），底下自己铺背景 |

`#050505` 是平台正文色，就是这里的「高级黑」；`Knot` 字重取 Helvetica Neue Bold（700），本机没有更重、又不压扁字宽的等宽字重。

版式以 **cap height 160** 为基准，全部尺寸按它换算：

| 项 | 值 | 相对字高 |
|---|---|---|
| 标识实心高度 | 168 | 1.05 × 字高，上下各溢出 4，把四条臂的斜向重量配平 |
| 标识到 `K` 的间隙 | 30.4 | 0.19 × 字高，按墨迹量，不含字宽侧边距 |
| 四周留白 | 25.6 | 0.16 × 字高，四边等宽 |
| 画布 | 741.48 × 219.2 | 3.38:1 |

`Knot` 是 Helvetica Neue Bold（weight 700，upem 1000，cap 714）的轮廓，已转成路径，字距 0，渲染不依赖系统字体。换字重就重取轮廓，不要只改 `font-weight`——文件里没有字体引用。换字也不需要动标识：只替换 `<g fill="#050505">` 里那四条字形路径。

这三份只在颜色上不同，几何一模一样：改版式就三份一起改，否则并排放在一起会错位。

标识部分与 `xknot-mark.svg` 同一套几何（环 `r30/r16`、臂宽 32、端头 `r16`、内切口 `r46`），只是内联了副本、把 `id` 改成 `lockup-arm`，避免和页面上同时内联的母版撞号。深色底用 `xknot-lockup-inverse.svg`，别把默认版直接放上去——橙色在深底上对比不足，黑字会直接消失。

## PNG 导出

`docs/png/` 是按档位栅格化的成品，供投稿、印刷、即时通讯和设计稿引用。透明底，边缘不描边，别从大的往回缩。全部由 SVG 直接渲染：

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `xknot-mark-1024.png` | 1024×1024 | 正方形标，缩放母版 |
| `xknot-mark-512.png` … `-256` … `-128` | 512/256/128 | 站点图标与文档配图 |
| `xknot-lockup.png` / `@2x` | 1200×355 / 2400×710 | 横向组合标，浅色底 |
| `xknot-lockup-mono.png` / `@2x` | 同尺寸 | 横向·单色，单色印刷 |
| `xknot-lockup-inverse.png` / `@2x` | 同尺寸 | 横向·反白，深色底 |

重出：

```sh
mkdir -p docs/png
for s in 1024 512 256 128; do
  rsvg-convert -w $s -h $s docs/xknot-mark.svg -o docs/png/xknot-mark-$s.png
done
for v in "" "-mono" "-inverse"; do
  rsvg-convert -w 1200 docs/xknot-lockup$v.svg -o docs/png/xknot-lockup$v.png
  rsvg-convert -w 2400 docs/xknot-lockup$v.svg -o docs/png/xknot-lockup$v@2x.png
done
```

两份横向 PNG 默认与单色、反白的留白都是 41px（1200 宽）/ 82px（2400 宽），四边相等；这是 SVG 自带的 0.16 × 字高内边距，没有额外裁剪。要贴边使用，别裁这两份，直接用 SVG 并改 `viewBox`。

## 换标流程

母版换掉之后，按站点登记的档位重出。别让小图标去拉 296 的原图：

```sh
# 透明底的成品：页头、页签、三档图标
for s in 16 32 64 128 512; do
  rsvg-convert -w $s -h $s docs/xknot-mark.svg -o /tmp/mark-$s.png
done

cp /tmp/mark-32.png  xknot.si/web/public/favicon-32.png
cp /tmp/mark-16.png  xknot.si/web/public/favicon-16.png
cp /tmp/mark-32.png  xknot.si/web/public/logos/xknot-icon-32.png
cp /tmp/mark-64.png  xknot.si/web/public/logos/xknot-icon-64.png
cp /tmp/mark-128.png xknot.si/web/public/logos/xknot-icon-128.png
cp /tmp/mark-512.png xknot.si/web/public/logos/xknot-icon.png

# 主屏图标不能带透明通道，垫白底
rsvg-convert -w 180 -h 180 -b white docs/xknot-mark.svg -o xknot.si/web/public/apple-touch-icon.png

# 实例 WebUI 的页头用同一张母版；knot-platform 是独立项目，复制一份进去
cp docs/xknot-mark.svg knot-platform/web/public/logos/xknot-mark.svg

# 分享卡：深橙底 1024，图形反白。从母版改色生成，别手抄路径——
# 抄错一个角度，臂就跑到轴上去了。
sed -e 's/#C2410C/#FFFFFF/g' \
    -e 's|<g transform="translate(148 148)"|<rect width="296" height="296" fill="#C2410C"/>\n  <g transform="translate(148 148)"|' \
    docs/xknot-mark.svg > /tmp/og.svg
rsvg-convert -w 1024 -h 1024 /tmp/og.svg -o /tmp/og.png
magick /tmp/og.png -strip -quality 92 xknot.si/web/public/logos/xknot.jpg

# 地图里内嵌的徽标是 icon-64，必须重跑
node xknot.si/ops/build-federation-map.mjs
```

PNG 不调色板、不降色，按档位从矢量直接栅格化；图形只有一种颜色，体积本来就小，别从 512 往回缩。

档位与用途见 [`xknot.si/docs/HUB.md`](../xknot.si/docs/HUB.md) 的「品牌资产」一节。

实例自己的实现文档在 [`knot-platform/docs/`](../knot-platform/docs/)，联邦契约与加入流程在 [`xknot.si/docs/`](../xknot.si/docs/)。
