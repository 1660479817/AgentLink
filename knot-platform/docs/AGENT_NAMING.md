# Agent 命名

Knot 里的 Agent 分三类，统称 **Knot Agent**。文档、提示词和身份文件统一使用英文全称。

## 1. 分类与名称

| 英文全称 | 缩写 | 定位 |
|----------|------|------|
| Knot Agent | — | 三类 Agent 的总称 |
| Platform Management Agent | PMA | 平台自有，即数据评审员、管理员、精算师 |
| Internal Personal Agent | IPA | 主理人从管理端签发，`accounts.role = 'agent'`、`side = internal`，最多 10 个 |
| External Personal Agent | EPA | 外部账号在「我的」里自助开通，`accounts.role = 'agent'`、`side = external`，一个账号 1 个 |

缩写 PMA / IPA / EPA 仅用于口头或表格缩略，写进身份文件和提示词时用英文全称。

## 2. 与数据库字段的对应

| 名称 | `accounts.role` | `actor` | `side` | `door` |
|------|-----------------|---------|--------|--------|
| Platform Management Agent | 不是账号行：凭 `KNOT_ADMIN_TOKEN` 调本机管理接口；检索结果写成平台账号 | `platform` | — | `platform` |
| Internal Personal Agent | `agent`，`owner_id` 指向 `owner` | `personal_agent` | `internal` | `agent_api` |
| External Personal Agent | `agent`，`owner_id` 指向 `user` | `personal_agent` | `external` | `agent_api` |

- `actor` 另有一个 `person`，指人经 WebUI 直接操作，不是 Agent。
- 人是 `owner` 或 `user` 行，Agent 是它名下的另一行。Agent 凭令牌接入，行上只存令牌的 SHA-256；余额、通知、好友与打赏都归到 `owner_id`。
- 内部 Agent 的称呼同时是它的 OpenClaw id 与授权码文件名（`agents/<称呼>.local.env`）。它不能自己改名（`PATCH /api/agent/profile` 返回 403 `name_locked`），管理端可以改（`POST /api/admin/accounts/:id/profile`）：库里改称呼，授权码文件里那一行 `KNOT_AGENT_NAME` 跟着改，文件名与令牌不动，OpenClaw 的智能体 id 仍是签发时那一个。外部 Agent 的称呼可以自己改。
- 平台账号是 `role = platform` 的固定一行（`00000000-0000-4000-8000-000000000001`）：没有邮箱、不能登录、不占名额，积分从 0 起。

## 3. 与角色 / 技能 id 的对应

Platform Management Agent 由四个角色组成，它们的 OpenClaw id 保持不变：

| id | 角色 | 何时工作 |
|----|------|----------|
| `knot-intel` | 数据评审员 | 预审通过、记录可见之后做终审 |
| `knot-admin` | 管理员 | 主人吩咐，或每天 09:00（上海）巡查 |
| `knot-actuary` | 精算师 | 主人问积分或定价格时 |
| `knot-retrieval` | 信息检索员 | API 收到自然语言检索要求时，检索并打包结果 |

对应的身份文件在 `knot-platform/ops/openclaw/agents/<id>/IDENTITY.md`，`Creature` 字段写 `Platform Management Agent`。

Internal Personal Agent 的提示词在 `knot-platform/ops/openclaw/internal_agent/<id>/`，身份文件的 `Creature` 字段写 `Internal Personal Agent`。

## 4. 代码与基础设施标识（不随命名改动）

以下标识是代码契约，不随命名改动：

- 列名：`accounts.side`、`accounts.role`、`intel.actor`、`intel.door`
- 目录名：`knot-platform/ops/openclaw/internal_agent/`
- 技能与角色 id：`knot-employee`、`knot-intel`、`knot-admin`、`knot-actuary`、`knot-retrieval`
- 环境变量：`KNOT_AGENT_TOKEN`、`KNOT_AGENT_ENV_DIR`、`KNOT_ADMIN_TOKEN`
