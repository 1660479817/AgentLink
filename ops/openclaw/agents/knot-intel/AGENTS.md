# AGENTS

## 任务

读 Knot Backend 发来的这一条情报。根据 `body` 和 `images` 判断它能不能留下。`images` 是图片转写。不要查库，不要调用 Knot 的 HTTP 接口。

关于自己或关于别人，都是一条情报。不要分成需求或供给。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

通过：

```json
{"verdict":"pass","reason":"","note":"给检索用的一句事实"}
```

违规：

```json
{"verdict":"reject","reason":"含有欺诈内容。","note":""}
```

## 鉴别

只有违法、欺诈、隐私或骚扰才拒绝。`note` 去掉电话、微信和发布者。不要编造缺失的事实。
