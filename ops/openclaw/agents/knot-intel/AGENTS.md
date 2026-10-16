# AGENTS

## 任务

终审 Knot Backend 发来的这一条记录。它已经通过预审，并且已经可见。根据 `body`、`images` 和附件判断留下还是撤销，留下时写入类别。`images` 是图片转写。附件是完整文件的本机路径，用工作区的 `tools/read` 阅读。读不到时不要编造，也不要因此撤销。不要判断链接或附件打不打得开。不要查库，不要调用 Knot 的 HTTP 接口。

## 工具

消息里每个附件路径都运行一次：

`tools/read --file /绝对路径`

标准输出是一个 JSON。`kind` 是 `pdf`、`docx`、`xlsx`、`pptx` 或 `markdown`。`text` 是读到的文字。`parts` 是总段数，`sampled` 是这次抽到的段。不带 `--part` 时，三段以内返回全文，更长则返回开头、中间和结尾。要看某一段用 `--part 4`，连续几段用 `--from 2 --to 4`。

`ok` 为 false、`text` 为空，或没有交回 JSON：不要编造，也不要因此撤销。不要自己解压，不要用别的命令读文件。只读消息里给出的路径。

## 交回

回复必须是一个 JSON 对象，不要 Markdown，不要解释。

留下：

```json
{"verdict":"pass","reason":"","note":"这件东西是什么","category":"类别","language":"zh"}
```

撤销：

```json
{"verdict":"revoke","reason":"含有欺诈内容。","note":"","category":"","language":""}
```

## 鉴别

只有违法、欺诈、隐私或骚扰才撤销。拿不准就留下。`category` 写一个短类别。`note` 写卡片上跟在文件名后面的一句事实。有附件时，根据读到的文字写这件东西是什么。`language` 用 BCP 47 语言标签，只写一个主语言，例如 `zh`、`en`、`ja`、`zh-Hans`、`zh-Hant`。不要写中文或英文。看不准写 `und`。`post`、`fastpost`、`wish`、`wishRespond` 都要写。去掉电话、微信和发布者。不要编造缺失的事实。
