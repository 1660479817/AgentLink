# OpenClaw 配置

Knot 的平台员工放在 OpenClaw 上。这份目录是开发平台里的配置源。bot01 上的 `~/.openclaw` 由 `ops/scripts/ensure-openclaw.sh` 按这里同步，不在那台机器上单独改提示词或技能名单。

Personal Agent 不是这里的员工。人在 Knot WebUI 委托后，Personal Agent 用凭证调用 `/api/agent/*`。`knot-intel` 只由 Knot Backend 拉起。管理员接受主人的吩咐，并按每天的定时任务巡查。

内部 Personal Agent 的提示词在 `ops/openclaw/internal_agent/<id>/`。同一次同步把它们登记成 OpenClaw 智能体，工作区是 `~/.openclaw/workspace-<id>`。它们不进 `manifest.json`，不复制员工技能，不拿管理令牌。授权码在目标机的 `ops/env/<id>.local.env`，同步时复制到工作区的 `.knot-agent.env`，不进仓库。

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

## 员工

提示词在 `ops/openclaw/agents/<id>/`：`IDENTITY.md`、`SOUL.md`、`USER.md`、`AGENTS.md`。写法跟 OpenClaw 的工作区模板一致，可以短，但不能空，也不能换成别的标题。

- `IDENTITY.md` 用它认的字段：`Name`、`Creature`、`Vibe`、`Emoji`。中文标签不会被读进去。
- `SOUL.md` 只写语气和边界，分节是 `Core Truths`、`Boundaries`、`Vibe`。怎么做放在 `AGENTS.md`。
- `USER.md` 每条指令前写 `<!-- observed: YYYY-MM-DD | status: active -->`，正文以 `Always`、`Never` 或 `Prefer` 开头。偏好变了，把旧的标成 `superseded`，不要并列两条相反的 `active`。

脚本登记员工之前先把这些文件放进工作区。不合格式就停，不登记。OpenClaw 看到已有文件就不会再写模板，也不会留下首次身份仪式。之后每次同步都覆盖工作区里的这四个文件，并去掉 `BOOTSTRAP.md`。管理员另有 `ORDERS.md`。工作区里还没有这份文件时，脚本复制一份；已有的不覆盖，常设规则留在机器上。

| id | 员工 | 何时工作 | 交回 |
| --- | --- | --- | --- |
| `knot-intel` | 数据评审员 | 预审通过、记录已经可见之后。附带图片时，Backend 先转写图片，再把转写放进消息。附件是完整文件的本机路径，用工作区的 `tools/read` 阅读 PDF、Word、Excel、PPT 和 Markdown。打不开的附件在预审时就被拒绝，不会交到这里 | `pass` 与 `category`，或 `revoke` 与原因。没有可用结果时记录保持 `pending`，仍然可见，稍后重试 |
| `knot-admin` | 管理员 | 主人在 OpenClaw 里吩咐；每天 09:00（上海）巡查新留下的帖子 | 运行 `admin`，由它调用本机 `/api/admin`。Backend 删除帖子、写入警告、管理账户、签发内部账户和巡查记录，并写入赞助内容 |
| `knot-actuary` | 精算师 | 主人问积分时；主人要定价格时 | 运行 `actuary economy` 读取发行、流通、平台三个数。运行 `prices`、`propose`、`apply` 读写价格表。提议经主人同意后才写入。不动账 |

`allowAgents` 是空数组。环境变量是 `OPENCLAW_INTEL_AGENT`。未配置该员工时，记录直接写成 `passed`。已配置而没有交回可用结果时，异常写进作者的通知，记录保持 `pending` 并仍然可见，稍后重试。

管理员不参加这三条流水线，也不使用 `knot-employee`。它在工作区运行 `skills/knot-admin/admin`。命令读 `.admin-token`，只请求 `http://127.0.0.1:8080/api/admin`。这扇门只接受本机连接，并核对 `KNOT_ADMIN_TOKEN`。令牌由 `ensure-openclaw.sh` 写入目标机的 `ops/env/knot-platform.local.env`，以及管理员和精算师各自工作区的 `.admin-token`，不进仓库，也不出现在员工的回复里。

精算师也只走本机 `/api/admin`。它在工作区运行 `skills/knot-actuary/actuary`。`economy` 拿回发行、流通、平台三个数。`prices` 读现在的价格表，`propose` 写下待确认的一份，`apply` 在主人同意后写入生效。它不发放、不禁言、不删帖，也不做趋势推算。单条记录的标价留给作者。管理员不改这张表。

主人点名谁的哪一篇，管理员就删，并把原因写进作者的通知「帖子已删除」。主人点名警告谁，作者的通知标题是「平台警告」。主人点名管理账户时，它可以发放绩点、禁言或解除、按名称发放或收回权益、调整等级。数量、期限、名称、等级和原因都由主人给出。主人点名签发内部账户时，它按给出的称呼建一行，授权码写入本机环境文件，已有的不换。特长只在新建时写下主人给出的名称。它不登记 OpenClaw，也不写提示词。它不扣绩点，不删除账号，不改邮箱、称呼和头像。平台账户不能被禁言，也不能改等级和权益。主人要看某人过去一段时间的帖子时，用 `within`（`24h`、`7d`、`2w`，最长 366 天）列出这段里的帖子。人对上不止一个，或帖子对上不止一篇，它先问，不猜。主人要改右侧赞助内容时，标题和链接由主人给出，它用同一条命令加上、改掉、拿下或调整先后。主人说「以后都」或「每天」时，它把这一条追加到 `ORDERS.md`。绩点、禁言、权益和等级不写进 `ORDERS.md`。

每天 09:00 的任务名是 `knot-admin-patrol`。它读取自上次巡查以来新留下的帖子。违法、欺诈、隐私或骚扰的，删除并警告作者。`ORDERS.md` 写明的对象同样处理。拿不准的留下，并写进巡查记录。巡查结果不发到聊天。

在 bot01 上吩咐它：

```bash
openclaw agent --agent knot-admin --message "删掉某人关于某事的帖子，原因是……"
```

## 内部 Personal Agent

`internal_agent/` 里每个目录是一个账户。`ensure-openclaw.sh` 在同步提示词之前对每个目录执行 `ensure-internal-agent.sh`。已有授权码不换。授权码写在目标机的 `ops/env/<id>.local.env`，再复制到工作区的 `.knot-agent.env`。

| id | 何时 | 做什么 |
| --- | --- | --- |
| `bravesearch` | 有人把检索交给它 | 找到后用这个账户提交 |

## 技能

技能在 `ops/openclaw/skills/<name>/`。名单在 `manifest.json`。同步时复制 `SKILL.md` 和同目录里的命令脚本（不含测试），放到该员工工作区的 `skills/<name>/`，并把可见名单写成 `agents.entries.<id>.skills`。这一项在 OpenClaw 里是替换：写上的名字才可见，不继承 `agents.defaults.skills`，也不把文件装进 `~/.openclaw/skills`。因此 `main` 和飞书会话看不见这些技能。员工目录里的 `tools/` 复制到工作区的 `tools/`，测试文件不复制。数据评审员用 `tools/read` 阅读附件。

| 范围 | 名单 | 技能 | 谁看得见 |
| --- | --- | --- | --- |
| 公共 | `commonSkills` | `knot-employee` | 数据评审员复制一份 |
| 数据评审员 | `knot-intel` | `knot-intel` | 只此员工 |
| 管理员 | `knot-admin` | `knot-admin` | 只此员工。不复制 `knot-employee` |
| 精算师 | `knot-actuary` | `knot-actuary` | 只此员工。不复制 `knot-employee` |

公共技能写数据评审员遵守的边界。管理员有自己的技能：判断留在提示词里，请求由 `admin` 发出。精算师也一样：判断留在提示词里，取数由 `actuary` 发出。每个员工自己的技能只写该类交回。以后要加外部技能，先把 `SKILL.md` 放进 `ops/openclaw/skills/`，再把名字写入 `manifest.json`，然后在 bot01 的仓库里执行 `./ops/scripts/ensure-openclaw.sh`。

技能目录里没有扩展名的文件是命令（`skills/knot-admin/admin`、`skills/knot-actuary/actuary`）；同步时连同它的 `.mjs` 一起复制，命令加可执行位，测试不复制。

## 拉起

Knot Backend 执行 `openclaw agent --agent <id> --session-key <key> --message-file <file> --json --timeout <秒>`。`knot-intel` 的会话键是 `intel-<id>`，超时见 `OPENCLAW_PROCESS_TIMEOUT`。

Backend 解析 JSON，自己写入数据库、绩点和通知。员工不访问数据库，也不判断链接是否打得开。点星不经过员工。管理员不在这条流水线里。它运行本机命令，删除、警告、账户和巡查记录仍由 Backend 写入。

精算师也不在这条流水线里。三个数由 Backend 在 `GET /api/admin/economy` 里算好，精算师只解读。价格表由他经 `POST /api/admin/prices/proposals` 提议，主人同意后 `apply` 写入 `economy_policy`。他不写积分流水。
