# OpenClaw 配置

Knot 的平台员工放在 OpenClaw 上。这份目录是开发平台里的配置源。bot01 上的 `~/.openclaw` 由 `ops/scripts/ensure-openclaw.sh` 按这里同步，不在那台机器上单独改提示词或技能名单。

Personal Agent 不是这里的员工。人在 Knot WebUI 委托后，Personal Agent 用凭证调用 `/api/agent/*`。下面四个 id 只由 Knot Backend 拉起。

## 机器上的位置

| 项 | 位置 |
| --- | --- |
| OpenClaw 配置 | `~/.openclaw/openclaw.json` |
| Gateway | `127.0.0.1:18789`，只监听本机 |
| 模型与密钥 | 留在 bot01 的 OpenClaw 状态里，不写入本仓库 |
| 员工工作区 | `~/.openclaw/workspace-<id>` |
| 公共技能 | `~/.openclaw/skills`（`openclaw skills install <spec> --global`） |
| 员工技能 | 该员工工作区的 `skills/`（`openclaw skills install <spec> --agent <id>`） |

Gateway、模型、飞书和 `main` 智能体沿用 bot01 上已经配好的 OpenClaw。脚本不重跑 onboarding，也不改 `channels`、`auth`、`gateway.auth`。

## 四个员工

提示词在 `ops/openclaw/agents/<id>/`：`IDENTITY.md`、`SOUL.md`、`USER.md`、`AGENTS.md`。脚本每次都覆盖工作区里的这四个文件。

| id | 员工 | Backend 何时拉起 | 交回 |
| --- | --- | --- | --- |
| `knot-process` | Process | 有一条尚未整理的表达。附带图片时，Backend 先用该员工的模型转写图片，再把转写放进消息 | `verdict`、`card`、`evaluation`。不违规即公开。高价值情报另交 `intelClass` |
| `knot-source` | Source | 需求还没有对得上的供给 | `suggestion` |
| `knot-match` | Match | 一条需求和对得上的供给都在 | `fits` |
| `knot-feedback` | Feedback | 已经有要送回去的结果 | `body` |

四类并排，互不调用。`allowAgents` 都是空数组。当前 Backend 已经拉起 `knot-process`。Source、Match、Feedback 的提示词和技能名单先登记在这里，运行时仍用 Backend 里的本地函数，等各自的交回格式接上后再换。

## 技能

技能文件在 `ops/openclaw/skills/<name>/SKILL.md`。名单在 `manifest.json`。脚本把技能复制到该员工工作区的 `skills/<name>/`，并把可见名单写成 `agents.entries.<id>.skills`。这一项在 OpenClaw 里是替换：写上的名字才可见，不继承 `agents.defaults.skills`，也不把文件装进 `~/.openclaw/skills`。因此 `main` 和飞书会话看不见这些技能。

| 范围 | 名单 | 技能 | 谁看得见 |
| --- | --- | --- | --- |
| 公共 | `commonSkills` | `knot-employee` | 四个 Knot 员工都复制一份 |
| Process | `knot-process` | `knot-process` | 只此员工 |
| Source | `knot-source` | `knot-source` | 只此员工 |
| Match | `knot-match` | `knot-match` | 只此员工 |
| Feedback | `knot-feedback` | `knot-feedback` | 只此员工 |

公共技能写四个员工共同遵守的边界。每个员工自己的技能只写该类交回的 JSON。以后要加外部技能，先把 `SKILL.md` 放进 `ops/openclaw/skills/`，再把名字写入 `manifest.json`，然后在 bot01 的仓库里执行 `./ops/scripts/ensure-openclaw.sh`。

## 拉起

`ops/env/knot-platform.local.env` 里有 `OPENCLAW_PROCESS_AGENT=knot-process` 时，Knot Backend 执行：

```bash
openclaw agent --agent knot-process --session-key expr-<id> --message-file <file> --json --timeout 90
```

Backend 解析 JSON，自己写入数据库、积分和通知。员工不访问数据库。
