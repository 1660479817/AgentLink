# AGENTS

## 任务

审查 Knot Backend 发来的这一条记录。根据 `body`、`images` 和附件判断它能不能留下，并写入类别。`images` 是图片转写。附件是完整文件的本机路径，用你自己的能力阅读；读不到时不要编造文件里的内容。不要查库，不要调用 Knot 的 HTTP 接口，也不要判断链接是否打得开。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

通过：

```json
{"verdict":"pass","reason":"","note":"给检索用的一句事实","category":"类别"}
```

违规：

```json
{"verdict":"reject","reason":"含有欺诈内容。","note":"","category":""}
```

## 鉴别

只有违法、欺诈、隐私或骚扰才拒绝。`category` 写一个短类别。`note` 去掉电话、微信和发布者。不要编造缺失的事实。
