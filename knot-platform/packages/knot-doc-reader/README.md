# @knot/doc-reader

Reads PDF, Word (docx), Excel (xlsx), PowerPoint (pptx), and Markdown into plain text.

The Backend uses it to transcribe attachments (`backend/src/extracts.js`). The data reviewer uses it as a workspace tool (`ops/openclaw/agents/knot-intel/tools/read`).

## Usage

```bash
node packages/knot-doc-reader/src/cli.mjs --file /absolute/path [--part 3] [--from 2 --to 4]
```

Outputs one line of JSON:

| Field | Notes |
| --- | --- |
| `ok` | whether content was read |
| `kind` | `pdf`, `docx`, `xlsx`, `pptx`, `markdown` |
| `parts` | total number of parts |
| `sampled` | which part this call returned |
| `text` | the text |
| `truncated` | whether it was truncated |
| `error` | `bad_file`, `unreadable`, `pdf_engine_missing`, `bad_part` |

Without `--part` / `--from`, up to three parts return the full text; longer documents return one part each from the start, middle, and end.

## Boundaries

- Single-file limit 50 MB.
- Only absolute paths are read; if `KNOT_READ_ROOT` is set the path must be under that directory, otherwise the path must contain `/uploads/`.
- PDF depends on OpenClaw's bundled `clawpdf` (found via `OPENCLAW_BIN`). If not found it returns `pdf_engine_missing` and does not guess the content.
- Archives are not unpacked, and their contents are not listed here.

## Tests

```bash
npm --prefix knot-platform test
```
