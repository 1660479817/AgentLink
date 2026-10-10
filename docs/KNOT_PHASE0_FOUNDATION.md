# Phase 0：基础链路（先跑通）

> 相对 [KNOT_PROJECT_PLAN.md](./KNOT_PROJECT_PLAN.md) 的全量 Knot，本阶段只证明：**Web + PostgreSQL + 用户 + openclaw-agent** 完成「注册/登录 → 传图 → Agent 解读入库 → Web 出卡片」。

---

## 1. 部署与环境

| 项 | 约定 |
|----|------|
| **主机** | `ssh zenwang_bot01@192.168.3.91` |
| **同机组件** | **Web** + **knot-platform**（API + **PostgreSQL**）+ 已配置的 **openclaw-agent** |
| **数据库** | **PostgreSQL**（平台唯一真源；不用 SQLite） |
| **网络** | 内网 `http://192.168.3.91/`（nginx）；API 仅 `127.0.0.1:8080`；Agent 调 `http://127.0.0.1:8080` |
| **部署清单** | 仓库 [`ops/README.md`](../ops/README.md) · nginx · systemd · `deploy.sh` |

说明：文档里的「云端 Web」在本环境 = **该服务器上的 Web 前端**，与平台 **同机部署**，无需再拆一台公网云（除非以后单独上 zenheart 式中继）。

### 本地开发

```bash
npm install
npm run db:up
cp apps/knot-platform/.env.example apps/knot-platform/.env   # 可选
npm run migrate
npm run dev:platform    # :8080
npm run dev:web         # :5173
# 登录后在 Web「Agent」页签发 token，再：
cp apps/openclaw-agent/.env.example apps/openclaw-agent/.env   # 填 email + token
npm run dev:agent
```

**系统配置（SMTP、站点 URL）** 存在 PostgreSQL `system_config.platform`；导入：`npm run config:import`（从环境变量一次性写入）。未配 SMTP 时验证码打在服务日志（dev 模式）。

```bash
npm run smoke:phase0   # 健康检查 + 发码；设 SMOKE_CODE_A/B 可测会话与 agent 跨用户拒绝
```

Agent 视觉：默认 `INTERPRET_MODE=openclaw`（`openclaw infer image describe` / Gateway `agent`，用 OpenClaw 主模型鉴权）。技能见 `openclaw-skills/knot-photo-ingest/`。

同机部署见 [ops/README.md](../ops/README.md)。

---

## 2. 本阶段四块

| # | 块 | 交付 |
|---|-----|------|
| 1 | **Web** | 注册/登录、邮件验证、提供信息（传图）、卡片列表 |
| 2 | **PostgreSQL** | 用户、邮件码/会话、上传、ingest_job、information_card |
| 3 | **用户体系** | Email + 邮件令牌/验证码、会话、Agent 接入凭证 |
| 4 | **Agent 驱动** | openclaw-agent 经 **HTTP Agent API** 拉任务、解读、写卡片 |

**不做：** Msgbox、匹配、交钥匙、点数、完整运营后台。  
**口径对齐主规划：** 匿名 **找信息**（公开卡片）+ **提交需求**；**发布/交换** 需注册（`REGISTER_REQUIRED`）。

---

## 3. 参考项目：aiugc-workspace

注册 / 登录 / 邮件 / Agent 接入 **优先对齐或移植思路**（实现语言与库可不同，**逻辑与表意一致**）：

| Knot Phase 0 能力 | 参考路径（`/Users/wangjunhui/Work-Sync/active/aiugc-workspace`） |
|-------------------|---------------------------------------------------------------------|
| Email 规范化 | `lib/user/email.js` |
| 发码/验码/会话 cookie | `lib/auth/index.js`（6 位码、sha256、TTL、限流） |
| 鉴权服务（读写库 + SMTP） | `apps/agent-engine/src/auth-service.ts` |
| Web 登录 UI 流程 | `apps/webui/src/pages/Login.jsx`（request → verify） |
| Web API 封装 | `apps/webui/src/api.js`（`/api/auth/request`、`verify`、`tokens`） |
| 店面 HTTP → 本机（**Knot 可不抄**） | `apps/webui-server/src/auth-relay.js` — aiugc 云面无库、走 WS；**Knot 同机 Phase 0 直接 HTTP 打 knot-platform** |
| Agent 令牌签发/撤销/鉴权 | `lib/domain/agent-channel.js`（`cst_` 前缀、`sha256(email:token)`、`authorizeAgent`） |
| 账户页签发 token | `apps/agent-engine/src/auth-service.ts`（`issue_token` / `revoke_token`） |
| 发信 | `lib/providers/mail/smtp.js` |
| 用户聚合视图 | `lib/user/index.js`、`identity.js`、`reachability.js` |

**与 aiugc 的差异（ intentional ）：**

| aiugc | Knot Phase 0 |
|-------|----------------|
| SQLite `var/data` | **PostgreSQL** |
| 注册需邀请码 | Phase 0 **可不要邀请码**（仅 Email 验证即可 active） |
| 云 webui-server + WS 中继 | **同机** knot-platform 直出 HTTP API |
| 业务是订单/履约 | 业务是 **ingest_job → information_card** |

**邮件「令牌」：** aiugc 用 **6 位数字码** 发邮件（`loginCodeMail`），验完开 session。Knot 可 **原样采用**（推荐，代码现成）；若坚持 **邮件内一次性链接**，只需把 `verify` 从「提交 code」改为「点击 token」，哈希与 TTL 规则仍可与 `lib/auth` 同构。

**Agent 接入：** 与 aiugc 一致 — **email + Bearer token** 双匹配；token 明文仅签发时一次；库内 `sha256(email:token)`；Web 登录后在账户页 **签发/撤销**（对应 `POST /api/auth/tokens` 一类接口，路径可按 Knot 命名）。

---

## 4. 端到端流程

```text
① Web：POST auth/request → 邮件发验证码/令牌 → POST auth/verify → 会话 Cookie
② Web：登录态 → 「提供信息」→ 上传图片 → 创建 ingest_job (pending)
③ openclaw-agent：Bearer agent token → GET pending jobs → 解读 → POST /cards → job done
④ Web：GET /cards 展示卡片（Phase 0 过渡：客户端定时拉取；目标见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md) 平台快照）
```

### 4.1 用户与邮件

- 用户主体：**email**（`normalizeEmail`）。  
- **注册/登录合一**：request 发码，verify 成功则 `users.status = active` 并写 session（aiugc 模式）。  
- **Agent 凭证独立**：`customer_agent_tokens` 表，逻辑见 `agent-channel.js`；**不是**邮件验证码。

### 4.2 openclaw-agent

- 已部署在 **192.168.3.91** 时：配置 `KNOT_API_BASE`、`KNOT_AGENT_EMAIL`、`KNOT_AGENT_TOKEN`（或按用户签发）。  
- 循环：拉 pending job → processing → **OpenClaw CLI**（`infer image describe` / Gateway `agent`，主模型视觉）→ 写 card → done/failed。  
- 解读与合规在 **OpenClaw 配置与技能** 内完成；落库 **只经平台 API**（worker 不直连 OpenAI，除非 `INTERPRET_MODE=openai`）。

### 4.3 Web 展示刷新

- **产品定稿：** Web **被动**；由 **平台** 提供展示快照与 `refreshAfterMs`，**不用 SSE**（见 [KNOT_WEB_UI.md](./KNOT_WEB_UI.md) §2）。  
- **Phase 0 过渡实现：** 仍可 `GET /cards` 等 + 客户端定时拉取，后续改为 `/api/web/snapshot`。

---

## 5. 架构（同机）

```text
浏览器 → :web (静态/反代)
           ↓
     knot-platform :api
           ├── PostgreSQL
           └── 上传文件目录
           ↑ HTTP + Agent Bearer
     openclaw-agent（已配置）
```

**AgentLink 仓库：** `knot-platform` · `web` · `openclaw-agent`（Agent 侧脚本/技能可只在服务器沿用现有 OpenClaw 配置，仓库内放参考实现与文档）。

---

## 6. PostgreSQL（最小表）

| 表 | 用途 |
|----|------|
| `users` | id, email UNIQUE, status, created_at |
| `auth_codes` | email, code_hash, expires_at, attempts, sent_at, …（对齐 aiugc 发码行） |
| `sessions` | sid, user_id, expires_at |
| `agent_tokens` | token_id, user_id, token_hash, label, status, token_last4, created_at |
| `uploads` | id, user_id, storage_key, mime, size, created_at |
| `ingest_jobs` | id, user_id, upload_id, status, error, updated_at |
| `information_cards` | id, user_id, ingest_job_id, payload JSONB, title, summary, thumb_url, created_at |

迁移工具任选（sql migrations / drizzle / knex）；**不要** 引入 aiugc 的 sqlite store 整包拷贝，只 **移植域逻辑**。

| `system_config` | key=`platform` JSON：SMTP、`publicWebOrigin` 等 **系统配置唯一真源**（`npm run config:import` / `config:show`） |

---

## 7. API（Phase 0）

**Web（Cookie 会话）** — 命名可对齐 aiugc：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/request` | 发邮件码 |
| POST | `/api/auth/verify` | 验码 + Set-Cookie |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | |
| POST | `/api/auth/tokens` | 签发 Agent token（返回明文一次） |
| POST | `/api/auth/tokens/:id/revoke` | |
| POST | `/api/uploads` | 传图 |
| POST | `/api/ingest-jobs` | 或由 upload 自动创建 |
| GET | `/api/cards?mine=1` | 列表 |

**openclaw-agent（Bearer + email 头/body）**

| 方法 | 路径 |
|------|------|
| GET | `/api/agent/ingest-jobs?status=pending` |
| PATCH | `/api/agent/ingest-jobs/:id` |
| POST | `/api/agent/cards` |

鉴权实现：**reuse `authorizeAgent` 语义**（email + token → user_id）。

---

## 8. 实施顺序

| 周 | 内容 |
|----|------|
| W1 | Postgres + 迁移；从 aiugc **移植** `lib/auth` + `agent-channel` 核心到 `knot-platform`；SMTP |
| W2 | Web Login（参考 Login.jsx）+ 会话 |
| W3 | 上传 + ingest_job + 账户页签发 Agent token |
| W4 | openclaw-agent 接 API；假解读打通 |
| W5 | 真解读 + 卡片列表展示 + 验收 |

**Coding 状态（仓库）：** W1–W5 代码已齐 — `apps/openclaw-agent` 支持 OpenAI 视觉 / Ollama / stub；Web 轮询卡片；`openclaw-skills/knot-photo-ingest`；`npm run smoke:phase0` 可测鉴权。部署与 §9 验收在目标机执行。

---

## 9. 验收

- [ ] 邮件验证后才能保持登录态（SMTP 或日志验码）  
- [ ] 上传产生 `pending` ingest_job  
- [ ] openclaw-agent 完成至少 1 条 job → card  
- [ ] Web 可见新卡片  
- [ ] Agent token 不能跨用户访问（`smoke:phase0` 含交叉 401 检查）  

---

## 10. 待拍板（少量）

- 邮件：生产 SMTP 还是内网 Mailhog  
- 验证：**6 位码（与 aiugc 一致）** vs **邮件内链接 token**  
- 上传目录：`/var/knot/uploads` 等  
- 展示快照：`refreshAfterMs` 默认值、各 surface 字段（见 KNOT_WEB_UI.md）  

---

## 11. 与主规划关系

Email 验证用户 → 日后 **注册档**；`information_cards` → **卡片域**；Agent 事务 → 日后合规 + 匹配 + Msgbox + 交钥匙。
