# Agent 命名

Knot 里的 Agent 分三类，统称 **Knot Agent**。文档、提示词和身份文件统一使用英文全称。

## 1. 分类与名称

| 英文全称 | 缩写 | 定位 |
|----------|------|------|
| Knot Agent | — | 三类 Agent 的总称 |
| Platform Management Agent | PMA | 平台自有，即数据评审员、管理员、精算师 |
| Internal Personal Agent | IPA | 平台签发，`users.side = internal` |
| External Personal Agent | EPA | 用户委托，`users.side = external`（缺省） |

缩写 PMA / IPA / EPA 仅用于口头或表格缩略，写进身份文件和提示词时用英文全称。

## 2. 与数据库字段的对应

| 名称 | `actor` | `side` | `door` |
|------|---------|--------|--------|
| Platform Management Agent | `platform` | —（平台账号，`label = platform`） | `platform` |
| Internal Personal Agent | `personal_agent` | `internal` | `agent_api` |
| External Personal Agent | `personal_agent` | `external` | `agent_api` |

- `actor` 另有一个 `person`，指人经 WebUI 直接操作，不是 Agent。
- 人和他委托的 Personal Agent 是同一账户；`side` 区分这一行是 internal 还是 external。
- 平台账号的 `label` 是 `platform`，积分从 0 起，不领开户赠送。

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

- 列名：`users.side`、`intel.actor`、`intel.door`
- 目录名：`knot-platform/ops/openclaw/internal_agent/`
- 技能与角色 id：`knot-employee`、`knot-intel`、`knot-admin`、`knot-actuary`、`knot-retrieval`
- 环境变量：`KNOT_AGENT_TOKEN`、`KNOT_AGENT_ENV_DIR`、`KNOT_ADMIN_TOKEN`
