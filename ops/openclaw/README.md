# OpenClaw 配置

Knot 的平台员工放在 OpenClaw 上。这份目录是开发平台里的配置源。bot01 上的 `~/.openclaw` 由 `ops/scripts/ensure-openclaw.sh` 按这里同步，不在那台机器上单独改提示词或技能名单。

Personal Agent 不是这里的员工。人在 Knot WebUI 委托后，Personal Agent 用凭证调用 `/api/agent/*`。下面三个 id 只由 Knot Backend 拉起。

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

## 三个员工

提示词在 `ops/openclaw/agents/<id>/`：`IDENTITY.md`、`SOUL.md`、`USER.md`、`AGENTS.md`。脚本每次都覆盖工作区里的这四个文件。

| id | 员工 | Backend 何时拉起 | 交回 |
| --- | --- | --- | --- |
| `knot-intel` | 数据评审员 | 有一个新数据包。附带图片时，Backend 先转写图片，再把转写放进消息 | `verdict` 与 `category`。通过则留下 |
| `knot-brief` | 需求评审员 | 有一条新需求 | `verdict` 与 `category`。通过则进入匹配 |
| `knot-demand` | 数据匹配专家 | 需求已通过，库存里是带附件的数据包 | `citations`。条数不超过余额付得起的个数 |

三个并排，互不调用。`allowAgents` 都是空数组。环境变量是 `OPENCLAW_INTEL_AGENT`、`OPENCLAW_BRIEF_AGENT` 与 `OPENCLAW_DEMAND_AGENT`。员工没有交回可用 JSON 时，数据包和需求在未配置对应员工时直接通过；匹配改由 Backend 按字面重合从带附件的库存里取。

## 技能

技能文件在 `ops/openclaw/skills/<name>/SKILL.md`。名单在 `manifest.json`。脚本把技能复制到该员工工作区的 `skills/<name>/`，并把可见名单写成 `agents.entries.<id>.skills`。这一项在 OpenClaw 里是替换：写上的名字才可见，不继承 `agents.defaults.skills`，也不把文件装进 `~/.openclaw/skills`。因此 `main` 和飞书会话看不见这些技能。

| 范围 | 名单 | 技能 | 谁看得见 |
| --- | --- | --- | --- |
| 公共 | `commonSkills` | `knot-employee` | 三个 Knot 员工都复制一份 |
| 数据评审员 | `knot-intel` | `knot-intel` | 只此员工 |
| 需求评审员 | `knot-brief` | `knot-brief` | 只此员工 |
| 数据匹配专家 | `knot-demand` | `knot-demand` | 只此员工 |

公共技能写三个员工共同遵守的边界。每个员工自己的技能只写该类交回的 JSON。以后要加外部技能，先把 `SKILL.md` 放进 `ops/openclaw/skills/`，再把名字写入 `manifest.json`，然后在 bot01 的仓库里执行 `./ops/scripts/ensure-openclaw.sh`。

## 拉起

Knot Backend 执行 `openclaw agent --agent <id> --session-key <key> --message-file <file> --json --timeout <秒>`。`knot-intel` 的会话键是 `intel-<id>`，超时见 `OPENCLAW_PROCESS_TIMEOUT`。`knot-brief` 的会话键是 `brief-<id>`，`knot-demand` 的会话键是 `demand-<id>`，超时都见 `OPENCLAW_AGENT_TIMEOUT`。

Backend 解析 JSON，自己写入数据库、绩点和通知。员工不访问数据库。匹配最多返回 10 个带附件的数据包，并且不超过当时余额付得起的个数。同一个数据包在同一次回复里只算一次。点星不经过员工。
