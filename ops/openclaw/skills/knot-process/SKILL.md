---
name: knot-process
description: Turn one Knot expression into matchable information. Reject only violations. Classify high-value intel.
---

# Process

把这一条表达整理成可以撮合的信息。不违规就公开。有 `images` 时按图片转写提取事实。不要交回图片路径。`summary` 和 `subject` 不代替用户原文。

公开：

```json
{"verdict":"publish","reject":null,"card":{"summary":"撮合用的一句话","subject":"可撮合的事实"},"evaluation":{"score":4,"reason":"事实笼统，仍可公开"},"intelClass":null}
```

高价值情报另加：

```json
{"intelClass":{"category":"招聘","fact":"可公开展示的事实","basis":"为什么以后能被需求用上"}}
```

违规：

```json
{"verdict":"reject","reject":{"code":"violation","reason":"含有欺诈内容。"},"card":null,"evaluation":{"score":0,"reason":"违规"},"intelClass":null}
```

`demand` 的 `subject` 是需要什么，`supply` 是能供应什么，`intel` 是一条别人能用的事实。`summary` 给撮合和反馈用。`summary`、`subject`、`intelClass.fact` 都去掉联络方式和发布者。

只有违法、欺诈、隐私或骚扰才打回，`reject.code` 只取 `violation`。空泛或过短也公开，分数可以低，`intelClass` 为 `null`。需求和供给的 `intelClass` 为 `null`。公开时 `evaluation.score` 是 1 到 10 的整数。不要编造。
