# OpenClaw 配置

Knot 的平台员工放在 OpenClaw 上。这份目录是开发平台里的配置源。bot01 上的 `~/.openclaw` 由 `ops/scripts/ensure-openclaw.sh` 按这里同步，不在那台机器上单独改提示词或技能名单。

Personal Agent 不是这里的员工。人在 Knot WebUI 委托后，Personal Agent 用凭证调用 `/api/agent/*`。下面四个 id 里，前三个只由 Knot Backend 拉起。管理员接受主人的吩咐，并按每天的定时任务巡查。

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

提示词在 `ops/openclaw/agents/<id>/`：`IDENTITY.md`、`SOUL.md`、`USER.md`、`AGENTS.md`。脚本每次都覆盖工作区里的这四个文件。管理员另有 `ORDERS.md`。工作区里还没有这份文件时，脚本复制一份；已有的不覆盖，常设规则留在机器上。

| id | 员工 | 何时工作 | 交回 |
| --- | --- | --- | --- |
| `knot-intel` | 数据评审员 | 有一个新数据包。附带图片时，Backend 先转写图片，再把转写放进消息 | `verdict` 与 `category`。通过则留下 |
| `knot-brief` | 需求评审员 | 有一条新需求 | `verdict` 与 `category`。通过则进入匹配 |
| `knot-demand` | 数据匹配专家 | 需求已通过，库存里是有上传文件的数据包 | `citations`。条数不超过余额付得起的个数 |
| `knot-admin` | 管理员 | 主人在 OpenClaw 里吩咐；每天 09:00（上海）巡查新留下的帖子 | 调用本机 `/api/admin`。Backend 删除帖子、写入警告和巡查记录 |

前三个并排，互不调用。`allowAgents` 都是空数组。环境变量是 `OPENCLAW_INTEL_AGENT`、`OPENCLAW_BRIEF_AGENT` 与 `OPENCLAW_DEMAND_AGENT`。员工没有交回可用 JSON 时，数据包和需求在未配置对应员工时直接通过；匹配改由 Backend 按字面重合从有上传文件的库存里取。

管理员不参加这三条流水线，也不使用 `knot-employee`。它读工作区里的 `.admin-token`，只调用 `http://127.0.0.1:8080/api/admin`。这扇门只接受本机连接，并核对 `KNOT_ADMIN_TOKEN`。令牌由 `ensure-openclaw.sh` 写入目标机的 `ops/env/knot-platform.local.env` 和工作区，不进仓库。

主人点名谁的哪一篇，管理员就删，并把原因写进作者的通知「帖子已删除」。主人点名警告谁，作者的通知标题是「平台警告」。主人要看某人过去一段时间的帖子时，用 `within`（`24h`、`7d`、`2w`，最长 366 天）列出这段里的帖子。人对上不止一个，或帖子对上不止一篇，它先问，不猜。主人说「以后都」或「每天」时，它把这一条追加到 `ORDERS.md`。

每天 09:00 的任务名是 `knot-admin-patrol`。它读取自上次巡查以来新留下的帖子。违法、欺诈、隐私或骚扰的，删除并警告作者。`ORDERS.md` 写明的对象同样处理。拿不准的留下，并写进巡查记录。巡查结果不发到聊天。

在 bot01 上吩咐它：

```bash
openclaw agent --agent knot-admin --message "删掉某人关于某事的帖子，原因是……"
```

## 技能

技能文件在 `ops/openclaw/skills/<name>/SKILL.md`。名单在 `manifest.json`。脚本把技能复制到该员工工作区的 `skills/<name>/`，并把可见名单写成 `agents.entries.<id>.skills`。这一项在 OpenClaw 里是替换：写上的名字才可见，不继承 `agents.defaults.skills`，也不把文件装进 `~/.openclaw/skills`。因此 `main` 和飞书会话看不见这些技能。

| 范围 | 名单 | 技能 | 谁看得见 |
| --- | --- | --- | --- |
| 公共 | `commonSkills` | `knot-employee` | 数据评审员、需求评审员、数据匹配专家各复制一份 |
| 数据评审员 | `knot-intel` | `knot-intel` | 只此员工 |
| 需求评审员 | `knot-brief` | `knot-brief` | 只此员工 |
| 数据匹配专家 | `knot-demand` | `knot-demand` | 只此员工 |
| 管理员 | `knot-admin` | `knot-admin` | 只此员工。不复制 `knot-employee` |

公共技能写三名评审和匹配员工共同遵守的边界。管理员有自己的技能，只写本机管理接口。每个员工自己的技能只写该类交回。以后要加外部技能，先把 `SKILL.md` 放进 `ops/openclaw/skills/`，再把名字写入 `manifest.json`，然后在 bot01 的仓库里执行 `./ops/scripts/ensure-openclaw.sh`。

## 拉起

Knot Backend 执行 `openclaw agent --agent <id> --session-key <key> --message-file <file> --json --timeout <秒>`。`knot-intel` 的会话键是 `intel-<id>`，超时见 `OPENCLAW_PROCESS_TIMEOUT`。`knot-brief` 的会话键是 `brief-<id>`，`knot-demand` 的会话键是 `demand-<id>`，超时都见 `OPENCLAW_AGENT_TIMEOUT`。

Backend 解析 JSON，自己写入数据库、绩点和通知。员工不访问数据库。匹配最多返回 10 个有上传文件的数据包，并且不超过当时余额付得起的个数。同一个数据包在同一次回复里只算一次。点星不经过员工。管理员不在这条流水线里。它调用本机管理接口，删除、警告和巡查记录仍由 Backend 写入。
