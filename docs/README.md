# XKnot 公共文档与资产

这里放**跨项目**的东西：描述 XKnot 网络本身，与某个实例的实现无关。两个项目各自的实现文档留在各自目录，不往这里复制。

## 公共资产清单

| 资产 | 位置 | 说明 |
|------|------|------|
| 版权与署名 | [`../LICENSE`](../LICENSE)、[`../NOTICE`](../NOTICE) | Apache-2.0；`XKnot`、`Knot`、`xknot`、`xknot.si` 的名称与标识归 PaulWang，许可证不授予商标权 |
| API 入口 | [`API.md`](./API.md) | 实例 Web API 与联邦契约的索引，正文在各自项目 |
| 标识母版 | `xknot-logo.svg`、`xknot-mark.svg`、`xknot-logo-editable.svg` | 见下文「品牌资产的来源」 |
| 联邦地图 | `knot-federation-map.svg` | 由 `xknot.si/ops/build-federation-map.mjs` 生成，别手改 |
| 联邦层文档 | `soul-questions.md` | 灵魂几问：部署与加入之前值得先自问的一组问题，不给答案 |

## 标识与地图

- `xknot-logo.svg` — 标识母版，1024×1024。蝶翼加底部 `knot` 字标，**文字已全部转成路径**，形状不再随系统字体变。
- `xknot-mark.svg` — 同一母版去掉字标，只留蝶翼。页头、页签、主屏图标用它。
- `xknot-logo-editable.svg` — 与母版同画面，但字标和翼片上的 0/1 纹样仍是 `<text>`，改字时在这个文件上改，改完按下面的流程重出。
- `knot-federation-map.svg` — 联邦地图。由 `xknot.si/ops/build-federation-map.mjs` 生成，别手改。图里的中枢徽标是 `xknot.si/web/public/logos/xknot-icon-64.png` 内嵌进去的，换标之后要重跑一次脚本。

## 品牌资产的来源

`xknot-logo-editable.svg` 里的文字用的是系统字体：字标是 `DejaVu Sans, Helvetica Neue, Arial, sans-serif` 700，纹样是 `ui-monospace, Menlo, monospace`。同一份文件在不同系统上字宽能差一成，所以成品必须先转路径。

转路径用的是 macOS 自带的 Helvetica Neue Bold（`/System/Library/Fonts/HelveticaNeue.ttc` 第 2 个 face）和 Menlo Regular，也就是 Chrome 在 macOS 上对那两条字体栈的实际解析结果。**换机器重做这一步，字形可能与现在不同**；所以要改字标，请先在可编辑版上改，再按下面步骤整体重出，别只替换成品。

## 换标流程

母版换掉之后，按站点登记的档位重出。别让小图标去拉 1024 的原图：

```sh
# 标记版（无字标）：页头、页签、主屏图标
for s in 16 32 64 128 180 512; do
  rsvg-convert -w $s -h $s docs/xknot-mark.svg -o /tmp/mark-$s.png
done

cp /tmp/mark-32.png  xknot.si/web/public/favicon-32.png
cp /tmp/mark-16.png  xknot.si/web/public/favicon-16.png
cp /tmp/mark-180.png xknot.si/web/public/apple-touch-icon.png
cp /tmp/mark-32.png  xknot.si/web/public/logos/xknot-icon-32.png
cp /tmp/mark-64.png  xknot.si/web/public/logos/xknot-icon-64.png
cp /tmp/mark-128.png xknot.si/web/public/logos/xknot-icon-128.png
cp /tmp/mark-512.png xknot.si/web/public/logos/xknot-icon.png

# 组合版（带字标）：分享卡片
rsvg-convert -w 1024 -h 1024 docs/xknot-logo.svg -o /tmp/og.png
magick /tmp/og.png -strip -quality 90 xknot.si/web/public/logos/xknot.jpg

# 地图里内嵌的徽标是 icon-64，必须重跑
node xknot.si/ops/build-federation-map.mjs
```

PNG 不调色板、不降色：橙色底上叠着蓝、青、墨绿几层，量化会把过渡抹平。靠矢量按档位直接栅格化，体积本来就比从位图缩更小。

档位与用途见 [`xknot.si/docs/HUB.md`](../xknot.si/docs/HUB.md) 的「品牌资产」一节。

实例自己的实现文档在 [`knot-platform/docs/`](../knot-platform/docs/)，联邦契约与加入流程在 [`xknot.si/docs/`](../xknot.si/docs/)。
