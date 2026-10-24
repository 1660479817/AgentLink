# @knot/doc-reader

把 PDF、Word（docx）、Excel（xlsx）、PowerPoint（pptx）和 Markdown 读成纯文本。

Backend 用它给附件做转写（`backend/src/extracts.js`）。数据评审员把它当工作区工具用（`ops/openclaw/agents/knot-intel/tools/read`）。

## 用法

```bash
node packages/knot-doc-reader/src/cli.mjs --file /绝对路径 [--part 3] [--from 2 --to 4]
```

输出一行 JSON：

| 字段 | 说明 |
| --- | --- |
| `ok` | 是否读到内容 |
| `kind` | `pdf`、`docx`、`xlsx`、`pptx`、`markdown` |
| `parts` | 总段数 |
| `sampled` | 这次返回了第几段 |
| `text` | 正文 |
| `truncated` | 是否被截断 |
| `error` | `bad_file`、`unreadable`、`pdf_engine_missing`、`bad_part` |

不带 `--part` / `--from` 时，三段以内返回全文，更长则返回开头、中间、结尾各一段。

## 边界

- 单文件上限 50 MB。
- 只能读绝对路径；给了 `KNOT_READ_ROOT` 时必须在那个目录下，否则路径里必须含 `/uploads/`。
- PDF 依赖 OpenClaw 自带的 `clawpdf`（从 `OPENCLAW_BIN` 找）。找不到时返回 `pdf_engine_missing`，不猜内容。
- 压缩包不解，也不在这里列目录。

## 测试

```bash
npm --prefix knot-platform test
```
