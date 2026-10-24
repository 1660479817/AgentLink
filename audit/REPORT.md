# XKnot 全仓审计报告

审计对象：`/Users/wangjunhui/Work-Sync/active/AgentLink` @ `e944be8`（v0.6.0，与两站线上版本一致）
审计日期：2026-10-23
方式：全量切片 + 并行深读 + 主线程逐条复核关键项 + 两套线上库与运行时实测

---

## 一、覆盖证明

「没有漏」不靠承诺，靠可复跑的核对。

| 项 | 数字 |
|---|---|
| git 跟踪文件 | **619** |
| 代码/文档总行数 | **110,589** |
| 切片数 | **35** |
| 切片并集 vs 清单 | `missing=0 extra=0` |
| 报告「已读清单」覆盖 | **619 / 619 个文件，缺失 0** |
| 报告份数 | **35 / 35** |

## 二、发现总量

| 级别 | 条数 |
|---|---|
| **P0** | **1**（复核后；原报 2 条，1 条降为 P1，见复核台账） |
| P1 | 32 |
| P2 | 195 |
| P3 | 241 |
| 合计 | **469** |

P0/P1 集中在四处：**上传与文件服务**、**联邦中枢的签发与凭据**、**部署脚本的破坏性操作**、**配置与协议契约**。

## 三、最需要先看的 10 条

### 1. P1 · 六位登录码可在线穷举，可接管任意账号（含主理人）

`knot-platform/backend/src/login.js:33-45,162-171`、`routes/web.js:180-186`

| 事实 | 依据 |
|---|---|
| 码只有 6 位数字，空间 **1,000,000** | `login.js:39` `randomInt(0, 1_000_000)` |
| 兑换只按 `(email, key_hash)` 查一张表 | `login.js:163-171` |
| **兑换无失败计数** | 该函数内无 attempt 列、无计数 |
| **`/login/key` 无任何限流** | `routes/web.js:180-186` 无 `allow()`；全文件只有 `:575` 的 `/search` 用了 |
| **入口 nginx 无 `limit_req`/`limit_conn`** | `ops/entry/site.conf.template` 全文没有 |
| 只有“重新申请码”有冷却 | `login.js:119-123` |

攻击路径：给受害者邮箱申请一个登录码（码发到受害者邮箱，攻击者不需要看到）→ 在无限次数下穷举兑换 → 命中即拿到该账号的会话。主理人账号同样适用，因为主理人也走这条登录路径。

命中概率与速率：1e6 空间，若能做到 100 次/秒，期望约 **1.4 小时**；1000 次/秒约 **8 分钟**。每次尝试只是一条带索引的 UPDATE，成本极低。

这是本次审计中最该先修的一条：它是**直接账号接管**，且不需要任何前置条件（如上传权限）。

**修复**：按 email + IP 双维度加失败计数（如 5 次即锁 15 分钟），或把码长提到 8 位以上，并在 nginx 加 `limit_req`。

### 2. P0 · 上传绕过导致同源存储型 XSS

`knot-platform/backend/src/uploadStore.js:138-152`、`information.js:107-112`、`routes/web.js:497-509`

攻击链四环，已逐环实测：

1. `uploadStore.js:138` 的 `mime` 直接取 `file.mimetype`，即客户端 multipart 里的 `Content-Type`。
2. 非图片分支只判 `if (!mime)`（`:150`），`text/html` 非空即放行。
3. `isAudioUpload`（`information.js:110-111`）在 mime 不是 `audio/*` 时**按扩展名兜底**。实测 `x.mp3 + text/html` → `true`；只有 `.html` 扩展名被拒。
4. `routes/web.js:507` 用 `res.type(opened.row.mime)` **内联**回源，无 `Content-Disposition: attachment`。

`index.js:65` 的 `nosniff` 不构成防护——它只强制浏览器遵守声明类型，而声明就是 `text/html`。入口 nginx 模板也没有 CSP（只有 `X-Content-Type-Options` 与 `Referrer-Policy`）。

后果：任何登录用户上传一个 `.mp3`、正文写 `<script>` 或 `<script src="/api/web/uploads/<另一份 text/javascript>">`，挂到公开帖的音频位，把 `/api/web/uploads/<id>` 发给受害者，脚本就在站点同源执行。管理员点开即等于交出管理权。

修复方向：按 `kind` 设 MIME 白名单并用魔数复核；非图片/音频一律 `Content-Disposition: attachment`；用户媒体换到独立源。

### 3. P1 · 连接池没有 `error` 监听，空闲连接被中断即整进程退出

`knot-platform/backend/src/db.js:5-11`

```js
export function getPool(databaseUrl) {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl });
  }
  return pool;
}
```

`pg.Pool` 在空闲连接出错（数据库重启、网络抖动、连接被服务端 kill）时会 `emit('error')`。Node 的 EventEmitter 在没有监听器时会把 `error` 抛成**未捕获异常**，直接终止进程。全文未见 `pool.on("error", …)`。

后果：一次数据库重启或超过 `idleTimeoutMillis` 的连接被回收出错，就足以让 Backend 进程退出。这属于可用性隐患，通常表现为「服务莫名其妙自己重启」。

### 4. P1 · 公钥可注入 `authorized_keys`（原报 P0，已降级）

`xknot.si/server/store.mjs:546-551`、`provision.mjs:415`

`setPublicKey` 只做 `String(publicKey).slice(0, 1000)`，**不校验内容**；`app.mjs:1138` 只 `.trim()`（不去内部换行）；随后写入入口主机的 `~/.ssh/authorized_keys`。含换行的公钥可追加第二行。

**降级理由（已核）**：`knot-platform/ops/entry/sshd-tunnel.conf.template` 对该账号做了 `Match User` 级限制——`ForceCommand /usr/bin/sleep infinity`、`PermitOpen none`、`PermitTTY no`。这些限制**对所有密钥生效**，所以注入的密钥拿不到 shell。

残余风险仍实质：注入的密钥能占用 `127.0.0.1:<回源端口>` 的反向隧道。若抢在正主之前绑定，可经可信子域投放任意内容（钓鱼/挂马）。且这是一个对 root 所有文件的内容注入原语，一旦日后放宽 sshd 限制即变成完整后门。
**修复**：按 `^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/=]+( \S+)?$` 严格校验，拒绝含 `\r`/`\n` 的输入。

### 5. P1 · Agent 协议的「重试安全」承诺在关键窗口失效

`docs/KNOT_HELP.md:84` vs `knot-platform/backend/src/market.js:444-446`

文档明确承诺「同一账号重复提交相同内容返回已有记录、超时重试是安全的」。实现里查重条件带 `AND verdict <> 'pending'`——而刚提交完的记录正是 `pending`。

也就是说：**只有最需要幂等的那一刻（提交后超时重发）不幂等**。重发会新建第二条记录并另起一个检索 job。这是对外协议承诺与实现直接矛盾。

### 6. P1 · 部署链无锁，且发布包名未校验就进 `rm -rf`

`knot-platform/ops/scripts/deploy-site.sh:250,278,282`

`REL_NAME` 取自 `BUILD.json` 的 `release`，`artifact.mjs:releaseName` 只 `.trim()`，随后拼成 `releases/<name>` 交给 `rm -rf`。

原报告按「恶意产物」定 P1，复核后修正理由：能改 `BUILD.json` 的人同样能改发布包里的脚本（部署时会 `chmod +x` 并执行），恶意路径并未新增能力。**真正现实的触发是笔误**——`release` 写成 `.` 时 `rm -rf "releases/."` 会清空整个 releases 目录，连回滚目标一起消失。

同时全链无 `flock`（`:272-286`，另见 `backup-knot.sh:91`、`ensure-openclaw.sh:56`）：两个部署并发会互相删除对方刚装好的目录，`current` 可能指向已删目录。

### 7. P1 · 配置生成器把 `$` 当安全字符，密钥静默损坏

`knot-platform/packages/knot-config/src/schema.mjs:1414-1418`

`formatValue` 的「安全字符集」含 `$`、`(`、`)`、`|`，命中的值原样不加引号。实测：

| 写入 | `source` 后读回 |
|---|---|
| `p@ssw0rd$secret` | `p@ssw0rd` |
| `tok$(echo EXECUTED)x` | `tokEXECUTEDx` |

含 `$` 的密码/令牌被静默截断，含 `$(...)` 的直接执行命令。运维侧只会看到「凭据不对」，不会意识到文件已被写过。
**修复**：把 `$()|` 从安全字符集删掉（含空格的取值本来就会走加引号分支，是安全的）。

> 交叉核对：`tunnel.env` 的托管段由 `tunnel.js:renderManagedBlock` 另写，不经此函数；且写入前 `handoffValid` 会校验 account/host 格式与端口范围，**远程注入这条路是堵住的**。

### 8. P1 · 前端渲染可被一条帖子打挂所有浏览者

`knot-platform/packages/knot-markdown` + `web/src/components/InformationCard.vue:68`

块引用递归无深度上限。实测三个函数：

| 函数 | 溢出阈值 | 使用位置 |
|---|---|---|
| `toHtml` | **2000 层** | 前端卡片渲染 |
| `parse` | ~10000 层 | 解析入口 |
| `toPlain` | >12000 层，正常 | 后端索引/下载包/Agent 读取 |

一帖正文写 2000 个 `>`（约 2 KB），任何用户刷到该帖，卡片渲染即抛 `RangeError`。受害者是所有浏览者，不只是发帖人。
**反向结论同样重要**：`toPlain` 无此问题，后端服务端路径是安全的。

### 9. P1 · zip 解压无任何上限

`knot-platform/packages/knot-doc-reader/src/index.mjs:52-58`

实测：39.9 KB 的 zip 解出 **40.0 MB**（放大 **1026:1**），21ms 完成，无截断无拒绝。10 MB 输入即可撑出约 10 GB。评审流程会同步处理用户上传的文档，这是内存型拒绝服务。
**修复**：解压前按中央目录累计声明大小设上限（如 64 MB），设条目数上限（如 1000），超出即拒。

### 10. P1 · 重建脚本重跑会先毁掉唯一的账号副本

`knot-platform/ops/scripts/reset-knot.sh:63`

`DROP SCHEMA IF EXISTS knot_keep CASCADE` 是**无条件第一条语句**（前面只有 `stop_backend`）。`knot_keep` 的设计意图是保存账号，但重建中途失败后重跑，第一步就把上次留下的唯一账号副本删掉。

同类问题另见 `reset-knot.sh:287`（DROP 后任一步失败即退出，后端不再拉起，站点停在空库）、`push-entry.sh:130` 与 `push-discover.sh:57`（固定 `/tmp` 中转再 `sudo` 安装，多子域并发互覆）。

---

## 四、通过的部分（同样要记）

审计的价值一半在「确认没问题」。以下是**核实过**的结论：

| 项 | 结论 |
|---|---|
| 两站 schema 漂移 | **无**。30 表 / 196 列 / 68 索引 / 127 约束完全一致 |
| 迁移可信度 | **通过**。空库重跑 `node scripts/migrate.js` 得到的结构与线上逐列一致 |
| 幽灵表 | **无**。30 张表全部在 `KNOT_DATABASE.md` 有描述 |
| 两站运行时 | **全绿**。`/api/admin/*` 入口 404、直连 401、未登录 `submissions` 401 |
| 前端 XSS（渲染层） | **无**。`v-html` 只有一处，走 `toHtml` 的 `escapeHtml` + `safeUrl` 白名单 |
| 管理后台 XSS | **无**。`knot-platform/admin` 与 `xknot.si/admin` 全文无 `innerHTML` 类 sink，第三方文本全走 `textContent` |
| 依赖供应链 | **干净**。362 条 registry 依赖全为官方源、integrity 全齐（sha512）；无 git/http/私有源/`file:` |
| 版本库敏感文件 | **无**。真实站点目录、`*.local.env`、`var/*.db` 均已忽略；已跟踪的只有空值模板 |
| i18n 完整性 | **通过**。`knot-platform/web` 三语各 403 键，缺 0 |
| 内容安全（渲染） | 链接与图片经 `safeUrl` 白名单，`javascript:`/`data:` 已挡 |

> 注意 P0 与「渲染层无 XSS」并不矛盾：渲染层是安全的，**问题出在上传与文件服务**——它绕过了渲染层，直接让浏览器把用户文件当 HTML 执行。

## 五、工作区状态（非代码缺陷，但影响部署）

- 线上两站跑的是 `e944be8` = 本地 HEAD，**同源**。本次审计的基准就是 HEAD。
- 工作区在审计期间**继续变动**：开始时 18 个修改文件，审计结束（约 15:05）时 **29 个修改文件 + 7 个未跟踪**，涉及 `routes/web.js`、`routes/agent.js`、`rateLimit.js`、`tunnel.js`、`deploy-site.sh`、`site-config.sh`、`schema.mjs`、`run-entry-tunnel.sh`、locale 三份、`DiscoverView.vue`、`api.js`、`docs/KNOT_HELP.md` 等。
- 意味着**下次部署的代码不是现在线上跑的代码，也不是本次审计的代码**。这 333+ 行改动未经审计覆盖。
- 已重新确认：本报告的 P0 在**当前工作区**仍成立（`uploadStore.js:138/150`、`information.js:111`、`routes/web.js:507` 四处逐条复查；`routes/web.js` 的改动是给 `/search` 加 `Retry-After`，与上传路径无关）。
- 但其余发现描述的是 HEAD 版本。若这 29 个文件的改动涉及某条发现的位置，需以当前代码复核后再据此行动。

## 六、产出索引

| 路径 | 内容 |
|---|---|
| `audit/REPORT.md` | 本报告 |
| `audit/RUBRIC.md` | 审计口径（10 个维度、4 级严重度） |
| `audit/TODO.md` | 待修清单（`todo.json` 的核对基准，全部修完的台账） |
| `audit/FIXLOG.md` | 五批修复日志（合并自原 `fix-log*.md`） |
| `audit/findings/verification-log.md` | **复核台账**：哪些已证实、哪些修正、哪些推翻 |

## 七、诚实说明局限

1. **深度是不均匀的，但不是按我说的分**——是你要求的 uniform，每片都完整读。差别在于「能否实证」：数据库、接口、上传过滤器、zip、Markdown 这些我能实际跑的，结论是实证的；并发、限流、账务原子性这些必须起实例并发压测才能定，报告中标为「需运行验证」，共约 40 项。
2. **真实生产库的数据内容未审**。只看结构不看数据，所以「同一用户能否重复打赏」「余额是否曾有负数」这类只能靠约束推断，不能断言。
3. **部署态不在仓库里**。bot01 与本机的实际 conf、LaunchAgent 状态、证书有效期未逐项核；只验证了隧道通断与接口可达。
4. **未提交的 333 行改动不在本次范围内**。
5. **复核不是"全部 P0/P1"**。实际独立核实的是：唯一的 P0、S10/S11/S13/S14/S16/S17/S18/S19/S28/S32 的 P1，以及全部「实测」声称。**S30 的四条 P1 只读了子代理的证据链，未逐条复核**；S11-01/02/04/05 与 S12 的 P2 同样未核。台账里已逐项登记，不再用「全部已核」这种说法。
6. **P2/P3 共 436 条未逐条复核**。可按 `TODO.md` 的逐条记录当「待确认线索」看，而非结论。
