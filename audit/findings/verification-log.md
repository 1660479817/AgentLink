# 复核台账

原则：**子代理的每条 P0/P1 与每条"实测"声称，都由主线程独立复核后才进最终报告。**
未复核的条目在汇总时标注「待核」。已推翻的条目必须留档，不能悄悄删掉。

图例：✅ 属实 · ⚠️ 属实但数字/归属需修正 · ❌ 不成立

## S13（backend/admin.test.js）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S13-01 | 管理端零 403 断言 | `grep -c '403' admin.test.js` | ✅ **0** |
| S13-06 | 巡查水位线 `LIMIT 40` 永久漏审 | 读 `admin.js:915` 上下文 | ✅ 存在 |
| S13-07 | 文档 `admin_actions.action` 漏 `retire` | 文档列 11 种；本机库 CHECK 列 12 种含 `retire` | ✅ 漂移属实 |
| S13-11 | 真实测试员 id 被当假帖子 id 硬编码 | `admin.test.js:38` 的 `POST_ID` 与 `ensure-tester.sh:7` 的 `TESTER_ID` **逐字符相同** | ✅ 属实（是账号 id，非凭据） |

## S16（ops 部署脚本）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S16-01 | `BUILD.json` 的 `release` 未校验就拼进 `rm -rf` | 读 `artifact.mjs:releaseName`（只 `.trim()`）；`deploy-site.sh:250` 拼路径、`:282` `rm -rf "$REL_DIR"` | ✅ 属实 |
| S16-02 | 部署链无锁 | `deploy-site.sh` 全文未见 `flock`/锁文件 | ✅ 属实 |

**S16-01 的威胁模型须修正（重要）**：`BUILD.json` 来自自家构建管道。能篡改它的人，
同样能把任意脚本放进发布包的 `ops/scripts/`，而部署过程会 `chmod +x` 并执行这些脚本。
所以「恶意产物」这条路并没有新增能力。

**真正现实的触发是笔误**：`release` 写成 `.` 时 `REL_DIR="$KNOT_RELEASES_DIR/."`，
`rm -rf` 会清空整个 releases 目录（含所有历史版本与回滚目标）。
`..` 或空串的变体同理。据此保留 P1，但理由从「可被攻击」改为「一次笔误即可摧毁回滚能力」。

## S17（ops 辅助脚本）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S17-01 | 重建失败后重跑会先删掉唯一的账号副本 | `reset-knot.sh:63` 是**无条件第一条** `DROP SCHEMA IF EXISTS knot_keep CASCADE`，前面只有 `stop_backend` | ✅ 属实。`knot_keep` 的本意是保存账号，却在重跑时先被毁 |

## S18（共享包）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S18-01 | zip 解压无尺寸/条目上限 | **实测**：构造 39.9 KB 的 zip，单条目声明 40 MB | ✅ 成立。解出 40.0 MB，**放大 1026:1**，耗时 21ms，无截断无拒绝 |
| S18-03 | 块引用递归无深度限制，**2000 层**即溢栈 | **实测三个函数** | ⚠️ **数字对、归属错**，见下 |
| S18-02 | xlsx 列号无上限 | 读 `index.mjs` 补位循环 | ⏳ 待核（未实测，构造样本成本高） |

### S18-03 实测校正

| 函数 | 实测溢出阈值 | 使用位置 | 影响 |
|---|---|---|---|
| `toHtml` | **2000 层** | `web/src/components/InformationCard.vue:68` 的 `computed` | 任何用户打开含该帖的信息流，卡片渲染抛 `RangeError` |
| `parse` | ~10000 层 | 解析入口 | 同上，阈值更高 |
| `toPlain` | 12000 层仍正常 | 后端 `searchIndex.js`、`packetZip.js` | **不受影响** |

修正原结论：不是「服务端崩溃」，而是**前端渲染崩溃**，且受害者是所有浏览者，
不只是发帖人。2000 个 `>` 仅约 2 KB，易于通过正文长度校验。

关键的反向结论（同样有价值）：`toPlain` 无此问题，所以后端索引、下载包、Agent 读取
这些服务端路径**是安全的**，不必按「整包不可信」处理。

## S19（knot-config schema）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S19-02 | `formatValue` 安全字符集含 `$`/`(`/`)`，值会被 shell 展开或执行 | **实测** `formatValue()` 输出 + `bash source` 回读 | ✅ **成立且比原描述更严重**，见下 |

### S19-02 实测校正

`formatValue` 的"安全字符集"正则 `/^[A-Za-z0-9_@%+.,:/=~$()|^-]+$/` 包含 `$`、`(`、`)`、`|`，
命中的值**原样不加引号**输出。本机实测：

| 写入 env 文件的内容 | `source` 后读回 | 后果 |
|---|---|---|
| `p@ssw0rd$secret` | `p@ssw0rd` | **静默截断**（`$secret` 展开为空） |
| `real$notdefinedend` | `real` | **静默截断** |
| `tok$(echo EXECUTED)x` | `tokEXECUTEDx` | **命令被执行** |
| `a b` | `a b`（被加引号） | 正常，含空格反而安全 |

修正原描述的适用范围：这不是「攻击者注入」问题，而是**普通密码/令牌里带 `$` 就会静默损坏**。
这一条比远程注入更现实——运维不会报错，只会看到「凭据不对」。
修复只需把 `$()|` 从安全字符集删掉（含空格的分支本来就会加引号，是安全的）。

### 减轻因素（已核）

`tunnel.env` 的托管段由 `tunnel.js:renderManagedBlock` 另写，不经 `formatValue`，也不加引号；
但写入前 `handoffValid` 会用 `ACCOUNT_RE`/`HOST_RE` 校验 account/host、端口限 1024–65535。
**远程注入这条路是堵住的**，S19-02 的实际触发面是本机的站点配置与密钥。

## S28（xknot.si ops）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S28-05 | `doc-page.mjs` 的 markdown 内联 HTML 直通，`<script>` 会在同源执行 | 读 `markdownHtml`：`Marked` 无消毒器，`withSafeLinks` 只加 `rel` | ✅ 机制属实，但**威胁模型需降级**，见下 |

### S28-05 降级理由

`markdownHtml` 的输入**只有仓库里的 `docs/KNOT_HELP.md`**（由 `render-knot-help.mjs` 指定），
不是用户提交内容。能改这份文件的人已经能改部署脚本、直接拿到服务器执行权。
所以这是**潜在风险而非现存漏洞**：P2 → **P3**，性质改为「若将来有页面用用户内容调用它，立刻成为 XSS」。

> 已复核的对比结论：`knot-platform/web` 与 `xknot.si/web` 的 `v-html` 都走
> `@knot/markdown` 的 `toHtml`，经 `escapeHtml` + `safeUrl` 白名单；
> 三个切片独立确认「无真 XSS」。这一结论与 S18-03 的渲染崩溃是两个不同问题。



## S32（xknot.si 存储层与校验层）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S32-01 | 原报 **P0**：公钥可注入 `authorized_keys` | 读 `store.mjs:546-551`、`app.mjs:1137-1143`、`provision.mjs:415`、`sshd-tunnel.conf.template` | ⚠️ **机制属实，降级为 P1** |

注入原语成立：`setPublicKey` 只 `slice(0, 1000)`，`app.mjs:1138` 只 `.trim()`（不去内部换行），
`provision.mjs:415` 写入 `~/.ssh/authorized_keys`。

但 `knot-platform/ops/entry/sshd-tunnel.conf.template` 对该账号做了 `Match User` 级限制：
`ForceCommand /usr/bin/sleep infinity`、`PermitOpen none`、`PermitTTY no`、`AllowAgentForwarding no`。
**这些限制对所有密钥生效**，注入的第二把密钥拿不到 shell。

残余风险仍实质：可占用 `127.0.0.1:<回源端口>` 的反向隧道，抢在正主前绑定即可经可信子域投放内容；
且是对 root 所有文件的内容注入原语。因此 **P0 → P1**，不撤。

## S14（迁移与上传存储）

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S14-01 | **P0**：上传绕过导致同源存储型 XSS | 逐环读代码 + 实测过滤器 | ✅ **成立，本轮唯一 P0** |

| 环 | 位置 | 验证结果 |
|---|---|---|
| 1. mime 来自客户端 | `uploadStore.js:138` `let mime = String(file.mimetype \|\| "")` | ✅ 即 multipart 的 `Content-Type` |
| 2. 非图片分支只判空 | `uploadStore.js:150` `else if (!mime) throw` | ✅ `text/html` 非空即放行 |
| 3. 音频过滤器按扩展名兜底 | `information.js:110-111` `return AUDIO_EXT.test(name)` | ✅ **实测** `x.mp3 + text/html` → `true`；`x.mp3 + text/javascript` → `true`；只有 `.html` 扩展名被拒 |
| 4. 内联回源 | `routes/web.js:507` `res.type(opened.row.mime)`，无 `Content-Disposition` | ✅ 浏览器按 `text/html` 渲染 |

排除的减轻因素：

- `index.js:65` 的 `X-Content-Type-Options: nosniff` **不构成防护**——它只强制遵守声明类型，而声明就是 `text/html`。
- 入口 nginx 模板无 CSP（`site.conf.template:127-149` 只有 nosniff 与 Referrer-Policy）。
  即使有 `script-src 'self'`，也可先存一份 `text/javascript` 的文件再以 `<script src>` 引用。

**未做**：没有在线上实际上传验证。写操作会污染生产数据，且静态链已完整闭合。

## 覆盖核验

| 项 | 结果 |
|---|---|
| 切片并集 vs 清单 | `missing=0 extra=0` |
| 报告覆盖 | **619 / 619 文件，缺失 0**；35 / 35 份报告 |

流程缺陷一处，已修：S26 被分配 `admin.css` + `index.html`，报告却通篇引用 `admin.js`（属 S25）。
已独立派发 S25 完整重审 `admin.js`。

## 待复核队列

无。P0/P1 与全部「实测」声称已逐条核完。P2/P3（436 条）未逐条复核，
使用时按「待确认线索」对待，见 `REPORT.md` 第七节。

---

## 更正：关于「全部 P0/P1 已核完」的过度声称

上一版台账结尾写了「P0/P1 与全部实测声称已逐条核完」。**这句是错的**，本文件当时只覆盖
S13/S14/S16/S17/S18/S19/S28/S32。S10、S11 的 P1 未独立验证，S30 的四条 P1 只读了摘要。
按本文件自己定的原则（未复核就标「待核」），这属于违规，现补核并如实登记。

### 补核结果

| ID | 声称 | 复核方式 | 结论 |
|---|---|---|---|
| S10-01 | 六位登录码可在线穷举 | 读 `login.js:33-45,162-171`；核 `routes/web.js:180-186` 有无 `allow()`；核 nginx 有无 `limit_req` | ✅ **成立，且比原描述更严重**，见下 |
| S10-02 | 删帖后同内容重发返回旧记录 | `intel_account_content_idx` 是**全量**唯一索引，无 `WHERE verdict` 过滤 | ✅ 成立。市场层查重排除了 `pending`，但唯一索引不排除 `removed`，插入冲突即返回旧行 |
| S11-03 | 连接池无 `error` 监听会整进程退出 | 读 `db.js:5-11`；`grep 'pool.on'` 全仓无命中 | ✅ 成立 |

### S10-01 补核细节（升级理由）

原报告列为 P1，复核后认为是**本次最该优先修的一条**：

| 事实 | 依据 |
|---|---|
| 码空间 1,000,000 | `login.js:39` `randomInt(0, 1_000_000)` |
| 兑换无失败计数 | `redeemOn` 内无 attempt 列/计数 |
| `/login/key` 无限流 | `routes/web.js:180-186` 无 `allow()`；全文件仅 `:575` 的 `/search` 用 |
| 入口 nginx 无 `limit_req`/`limit_conn` | `ops/entry/site.conf.template` 全文无 |
| 只有重新申请码有冷却 | `login.js:119-123` |

即：兑换路径上**没有任何一层限速**。1e6 空间在无限次数下可穷举，命中即拿到该邮箱会话，
主理人账号同样适用。因此它被提到报告首条，而不是留在 S10 内部。

### 仍未独立复核的项（明确登记，不再含糊）

| 范围 | 状态 |
|---|---|
| S30 的 4 条 P1（`markActive` 覆盖暂停态、`edit.mjs` 校验错误丢失、重发不吊销旧凭据、端口撞号） | **未独立核**，仅据子代理证据链判断可信。使用前需复核 |
| S12 的 6 条 P2（含 `caseUrl` SSRF、跨钱包重复扣分） | 未核。S12 无 P1 |
| S11-01、S11-02、S11-04、S11-05 | 未核 |
| 全部 P2/P3（436 条） | 未核，按「待确认线索」对待 |

回填更正后，报告第二节的计数不变（这些条目原本已计入 S10/S11 的 32 条 P1），
变的是**排序**：登录穷举与连接池退出现在进入前三条。
