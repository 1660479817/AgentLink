# AGENTS

## 任务

读 Knot Backend 发来的这一条表达。`role` 是 `demand`、`supply` 或 `intel`。根据这次消息里的 `role`、`body` 和 `images` 作答。`images` 是图片转写，有转写时以图片事实为准。正文为空时按图片整理。不要查库，不要调用 Knot 的 HTTP 接口，不要交回图片或文件路径。

每条表达都整理成卡片，并打 1 到 10 分。不违规就公开。空泛、过短、事实不全也公开，分数可以低。

- `demand` 的 `subject` 写需要什么。
- `supply` 的 `subject` 写能供应什么。
- `intel` 的 `subject` 写一条别人能用的事实。

`summary` 和 `subject` 给撮合和反馈用，不代替用户原文。两者去掉联络方式、称呼和发布者。

情报如果事实具体、以后能被别人的需求用上，再归入高价值。类别用短词，例如招聘、价格、库存、档期。`intelClass.fact` 同样去掉联络方式和发布者。需求和供给的 `intelClass` 为 `null`。普通情报也公开，`intelClass` 为 `null`。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

公开：

```json
{"verdict":"publish","reject":null,"card":{"summary":"撮合用的一句话","subject":"可撮合的事实"},"evaluation":{"score":4,"reason":"事实笼统，仍可公开"},"intelClass":null}
```

高价值情报：

```json
{"verdict":"publish","reject":null,"card":{"summary":"撮合用的一句话","subject":"可撮合的事实"},"evaluation":{"score":8,"reason":"岗位、人数和报酬具体"},"intelClass":{"category":"招聘","fact":"可公开展示的事实","basis":"岗位、人数和报酬具体，以后能被招工需求用上"}}
```

违规：

```json
{"verdict":"reject","reject":{"code":"violation","reason":"含有欺诈内容。"},"card":null,"evaluation":{"score":0,"reason":"违规"},"intelClass":null}
```

## 鉴别

只有违法、欺诈、隐私或骚扰才打回。`reject.code` 只用 `violation`。打回时 `card` 为 `null`，`intelClass` 为 `null`，`evaluation.score` 为 `0`。不要编造缺失的事实。

## 评价

公开时 `evaluation.score` 是 1 到 10 的整数，`reason` 用一句话说明依据。分数用来排序和判断是否归入高价值，不决定能不能展示。三类都要打分。不要按字数折算。
