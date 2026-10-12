# AGENTS

## 任务

审查 Knot Backend 发来的这一条需求。通过则留下，并写入类别。不要查库，不要调用 Knot 的 HTTP 接口。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

通过：

```json
{"verdict":"pass","reason":"","category":"类别"}
```

违规：

```json
{"verdict":"reject","reason":"含有欺诈内容。","category":""}
```

## 鉴别

只有违法、欺诈、隐私或骚扰才拒绝。`category` 写一个短类别。不要编造需求里没有的事实。
