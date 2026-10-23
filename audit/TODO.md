# 待修清单

由 `audit/inventory/todo.mjs` 从 35 片报告的表里抽取。**这是「全部修完」的核对基准**。

| 项 | 数字 |
|---|---|
| 原始行数 | 469 |
| 去重后 | **469** |
| 已修 | 438 |
| 部分 | 15 |
| 暂缓 | 13 |
| 复核不成立 | 3 |

级别分布（含已处理的，用来说明这批问题的形状）：

| P0 | P1 | P2 | P3 |
|---|---|---|---|
| 1 | 32 | 195 | 241 |

## 没有完全收口的

### 部分完成

| ID | 级 | 结论 | 说明 |
|---|---|---|---|
| S03-04 | P2 | 部分 | 凭据可走文件，但仍受 --base 支配 |
| S10-08 | P2 | 部分 | zip 加密头不再整份转码；readFile 整份读入与 zipNames 同步扫描未改 |
| S10-12 | P3 | 部分 | 可见性口径已统一；附件口径（HAS_ATTACHMENT 等）语义不同，未合并 |
| S10-14 | P3 | 部分 | 补了 points/requests/market 用例；下载打包与计费的端到端用例仍缺 |
| S13-03 | P2 | 部分 | /api/admin 约三十条端点仍无 HTTP 级覆盖 |
| S13-04 | P2 | 部分 | 删帖与警告已入事务；令牌换发要先落授权码文件，只能是补偿路径 |
| S16-04 | P2 | 部分 | 只在 README 约束「一个部署根一个站点」，按站点分槽位未做 |
| S21-07 | P3 | 部分 | AppButton 的 to 分支补了禁用态；弹窗内分享/打赏仍是自有皮肤 |
| S21-10 | P3 | 部分 | resize 监听改 ResizeObserver；首屏同步整份 JSON.parse 未改 |
| S21-12 | P3 | 部分 | 下载状态机已补测试；打赏弹窗仍未抽成可测模块 |
| S23-20 | P3 | 部分 | reopen 的错误码已能读出；isSale 仍在前端复刻，等后端给字段 |
| S24-06 | P3 | 部分 | 整目录同步 + 部署前拦截越界 import；纯函数下沉未做 |
| S30-07 | P2 | 部分 | 写入顺序已统一；第二份写失败时未回滚第一份 |
| S30-15 | P3 | 部分 | 清单解析失败改为 fail-closed，但没有可注入路径，只做静态核对 |
| S33-06 | P2 | 部分 | 补了视图清洗用例；组件测试缺依赖 |

### 暂缓（需要主机、架构决定或新产品交互）

| ID | 级 | 结论 | 说明 |
|---|---|---|---|
| S03-10 | P2 | 暂缓 | 白名单要改浏览器启动参数 |
| S05-03 | P3 | 暂缓 | 换二维码库要改渲染，风险大于收益 |
| S08-16 | P3 | 暂缓 | 截断标记需后端回传字段 |
| S10-10 | P3 | 暂缓 | 无状态 HMAC 无法单独吊销，要新增凭据表或改短期+续期 |
| S16-10 | P2 | 暂缓 | 管理与精算共用令牌与 OS 用户，拆分属部署架构决定 |
| S16-13 | P2 | 暂缓 | 缺「临时部署根 + 真 tar 包」的部署集成测试 |
| S21-09 | P3 | 暂缓 | 点赞没有前端入口，补键属新交互（产品取舍） |
| S28-07 | P2 | 暂缓 | 要把连接层钉在固定 IP，当前无依赖可用 |
| S29-05 | P2 | 暂缓 | 收窄权限需入口主机 sudoers 配合 |
| S29-08 | P2 | 暂缓 | error 日志在 nginx 层无法脱敏 URI |
| S29-14 | P3 | 暂缓 | 去掉内联脚本会超出该切片范围 |
| S33-11 | P3 | 暂缓 | 删导出与挪母版影响面大 |
| S33-14 | P3 | 暂缓 | 根跳转页仅本地预览用 |

### 复核不成立

| ID | 级 | 结论 | 说明 |
|---|---|---|---|
| S05-05 | P3 | 不成立 | 多版本共存无风险，仅记录 |
| S11-12 | P3 | 不成立 | 本机管理令牌本身没有账号身份，actor_account_id 为空是设计 |
| S22-08 | P3 | 不成立 | 顶栏搜索仍在渲染，样式不是死代码 |

## 按片分布

| 片 | 条数 |
|---|---|
| S01 | 16 |
| S02 | 8 |
| S03 | 18 |
| S04 | 18 |
| S05 | 5 |
| S06 | 5 |
| S07 | 9 |
| S08 | 17 |
| S09 | 9 |
| S10 | 16 |
| S11 | 13 |
| S12 | 16 |
| S13 | 11 |
| S14 | 10 |
| S15 | 7 |
| S16 | 23 |
| S17 | 23 |
| S18 | 13 |
| S19 | 12 |
| S20 | 7 |
| S21 | 15 |
| S22 | 11 |
| S23 | 24 |
| S24 | 17 |
| S25 | 13 |
| S26 | 12 |
| S27 | 13 |
| S28 | 18 |
| S29 | 18 |
| S30 | 17 |
| S31 | 11 |
| S32 | 17 |
| S33 | 15 |
| S34 | 4 |
| S35 | 8 |

## 清单

| 勾选 | ID | 级 | 位置 | 问题 | 处理 |
|---|---|---|---|---|---|
| [x] | S01-01 | P2 | ``.cursor/rules/knot-frontend-ui.mdc:19-22`` | 规则的唯一 `<button>` 示例是裸按钮，与本文件第 40 行「操作按键只用 `AppButton`」、`knot-buttons.mdc:8`「不要给裸 `<button>` 填主色」直接冲突；示例里的 `PlazaIcon` 与 `t('nav.plaza')` 在代码里都不存在，照抄会 import 失败、或把键名直接渲染到页面 | 已修 |
| [x] | S01-02 | P2 | ``.cursor/rules/knot-buttons.mdc:29-30`` | 示例引用 `t("home.publish")`、`t("home.close")`，两个键在 zh-CN/zh-TW/en 里都不存在；`t()` 缺键时返回键名，照抄的按钮会显示 `home.publish` 字样 | 已修 |
| [x] | S01-03 | P2 | ``.cursor/rules/knot-frontend-ui.mdc:38`` | 「主列（首页 `/`）上方是供需对话框，紧接着一栏情报缩略，再下面是供需卡片」——`/` 现在是登录门页（轮播 + AuthForm），这套结构在 `/discover`。代理按规则改「首页」会改错文件 | 已修 |
| [x] | S01-04 | P2 | ``.cursor/rules/knot-frontend-ui.mdc:38`` | 「标识即回首页，旁边是搜索」+「顶栏搜索在同一页用 `?q=` 过滤」：顶栏已经没有搜索入口，`openSearch()` 定义了却无任何调用点 | 已修 |
| [x] | S01-05 | P2 | ``.cursor/rules/knot-agent-doc.mdc:22`（对 `~/.cursor/rules/knot-entry.mdc:17`）` | 同一件事实两份规则说反了：仓库规则说「实例不提供文档端点，`/help` 落到 SPA 兜底」，用户级入口规则说「`/api/` 和 `/help` 反代到 `127.0.0.1:18080`」。入口模板里确实没有这个 location | 已修 |
| [x] | S01-06 | P2 | ``.cursor/rules/xknot-blog.mdc:8,77,83`（对 `blog/_index.md:8`）` | 规则把「站点」和「账号」都写死成唯一：只发 `wang.xknot.si`、账号固定 PaulWang-AI、「不要用网页会话代发」。实际已有一篇发在 **cpswang.xknot.si**、用的是「cpswang 站新签发的 Internal Personal Agent」；本地索引又写成「登录靠站点寄到邮箱的六位密钥」（网页会话），与规则相反 | 已修 |
| [x] | S01-07 | P3 | ``.cursor/rules/knot-buttons.mdc:14`` | 规则说图标按钮是 `--header-control`（44px），但规则点名要用的顶栏按钮被 CSS 覆盖成 40px，照 44px 排版会对不齐 | 已修 |
| [x] | S01-08 | P3 | ``.cursor/rules/knot-frontend-ui.mdc:13`` | 「支持 `className`」是 React 写法。图标组件只把 `class` 传真名，`className` 会退化成 `setAttribute('className', …)`，在 SVG 上不生效——`:className="nav-icon"` 静默丢样式，不报错 | 已修 |
| [x] | S01-09 | P3 | ``.cursor/rules/xknot-blog.mdc:35,77`` | 两处计数/篇幅数字没跟内容走：「已发出的十六篇」实际 20 篇中文日志 + 2 篇发布稿；「一篇约 1.8–2.3 KB」实际 10 篇超过 2.3 KB（最长 4.1 KB），另有 2 篇不足 1.8 KB | 已修 |
| [x] | S01-10 | P3 | ``.cursor/rules/xknot-blog.mdc:13,51`` | 命名只定义两种：`NN-YYYY-MM-DD.md` 与 `YYYY-MM-DD-HHMM.md`；实际有两篇 `YYYY-MM-DD-<英文短名>.md` 的发布稿，规则无处归类。配图只允许 `aN-主题.png\ | 已修 |
| [x] | S01-11 | P3 | ``.cursor/rules/xknot-blog.mdc:77`` | 规则用 `users.side` 描述发布账号身份；库里没有 `users` 表，身份列在 `accounts.side`。按 `users.side` 去查会查不到，误判账号 | 已修 |
| [x] | S01-12 | P3 | ``.cursor/rules/knot-agent-doc.mdc:47`` | 「现在约 21KB」实际 23201 字节（约 22.7KB），「加一节就压旧的」这条约束从第一句起就失真 | 已修 |
| [x] | S01-13 | P3 | ``.cursor/rules/xknot-repo-structure.mdc:8,11-17`` | 结构树只列 README/LICENSE/NOTICE/docs/knot-platform/xknot.si，且断言「根目录只做网络总览和公共资产，不放任一项目的实现代码」。根目录实际还有 `bench/`——一个自带 `package.json`、`node_modules`、k6 脚本的测速项目，`bench/README.md` 明说「放在仓库根目录，是因为它测的是一个子域」。代理按树判断归属会把 bench 当无主目录 | 已修 |
| [x] | S01-14 | P3 | ``.cursor/rules/knot-buttons.mdc:8`、`.cursor/rules/knot-frontend-ui.mdc:8`` | 两份 UI 规则都写「只适用于 `knot-platform/web`」，但仓库里还有第二套 UI `knot-platform/admin`（2247 行 `admin.css`、自带 `i18n/{zh-CN,zh-TW,en}.js` 与 `data-i18n` 静态标记、自己的 `t()`），规则完全不提。代理进后台会把「未打包、不引 WebUI i18n 包」的约定当成违规去改 | 已修 |
| [x] | S01-15 | P3 | ``.cursor/rules/knot-agent-doc.mdc:58`` | 错误码表与代码的一致性只能靠人跑 `rg` 手工对；没有测试护栏。目前表是齐的（agent.js 的 32 个 `error:` 全部在表里），但下一次改端点没人拦 | 已修 |
| [x] | S01-16 | P3 | ``.cursor/rules/knot-frontend-ui.mdc:28-29`` | 「三份 locale 齐全」只靠人眼；没有测试扫 `t("…")` 的键是否真的存在——S01-01/S01-02 那三个不存在的键，正是这条缺口漏出来的 | 已修 |
| [x] | S02-01 | P2 | ``.gitignore:15`、`.gitignore:39-40`` | 只靠「落在 `var/` 或 `artifacts/` 下」来兜住数据库与备份，没有按扩展名的通用规则。放在别处的 `.db`／`.sqlite`／`.sql` 转储／`.sql.gz`／`.dump`／`*.tar.gz` 全部不被忽略，`git add -A` 会直接收进版本库 | 已修 |
| [x] | S02-02 | P2 | ``.gitignore:31-35`` | `sites/_template/` 用「先忽略整目录、再逐文件 `!`」的白名单，且第 31 行的忽略是**多余**的：`sites/*` 只匹配一层，`!_template/` 已足够放行整个目录。结果是模板目录新增任何文件（新的 `*.env`、nginx 片段、示例 json）都被静默忽略，提交时不会报错，别人 clone 下来模板缺文件 | 已修 |
| [x] | S02-03 | P2 | ``LICENSE`／`NOTICE` 整体；`knot-platform/ops/scripts/build.sh:121-136`` | 发布包不含项目自己的 `LICENSE` 与 `NOTICE`。`build.sh` 用 rsync 打 `knot-platform/` 全目录，而这两份文件只在仓库根，从未进入包内。Apache-2.0 第 4(a) 条要求向接收方附许可证副本 | 已修 |
| [x] | S02-04 | P3 | ``knot-platform/backend/.env.example:7`、`knot-platform/docs/KNOT_PROJECT_PLAN.md:42`、`.cursor/rules/xknot-blog.mdc:59`、`.cursor/rules/xknot-blog.mdc:77`` | 已跟踪文件里出现真实个人邮箱。后三处与 `README.md:88`、`knot-platform/README.md:166` 是作者有意公开的联系方式，可接受；`.env.example` 把真实邮箱当「示例管理员邮箱」写进模板，会把所有人照着填成同一个值 | 已修 |
| [x] | S02-05 | P3 | ``knot-platform/backend/src/tunnel.test.js:130,147,180`、`knot-platform/backend/src/adminHosts.test.js:9`、`knot-platform/backend/src/admin.test.js:45,66-67,71`、`knot-platform/web/src/adminEntry.test.js:6,16-17`、`knot-platform/backend/src/routes/adminPage.test.js:43`、`knot-platform/docs/CONFIG.md:225`、`knot-platform/docs/KNOT_WEB_API.md:21`、`knot-platform/packages/knot-config/src/schema.mjs:842-843`、`knot-platform/sites/_template/platform.env:116-117`、`knot-platform/backend/src/handoff.js:6`` | 同一个真实内网地址（bot01 的 RFC1918 地址）被当作示例值写进测试断言、配置文档、schema 默认示例与模板 env；另有入口主机的真实公网 IPv4 出现在 `tunnel.test.js` 的三处断言里。两者都不是凭据，但把真实拓扑固化进了公开仓库 | 已修 |
| [x] | S02-06 | P3 | ``docs/png/60bade14e9523f821afcd248d6b80fb1.jpg`` | 一份 700×624 的 JPEG，文件名是内容哈希，落在「品牌栅格化成品」目录里。全仓无任何引用，也不是 `docs/README.md:63-70` 列出的任何一档 LOGO 成品，与 README 对 `docs/` 的定位（LOGO 母版与生成物）不符 | 已修 |
| [x] | S02-07 | P3 | ``README.md:70-77`` | 「仓库与文档」表只列 `knot-platform/`、`xknot.si/`、`docs/`、`bench/`、`LICENSE`/`NOTICE`，漏掉已跟踪的 `.cursor/rules/`（6 份规则文件，编码了前端口径、作图层级、Agent 文档契约、仓库结构，属于团队工作契约）。新人 clone 后看不到这套规则从哪来 | 已修 |
| [x] | S02-08 | P3 | ``.gitignore:6`、`.gitignore:14`、`.gitignore:15`` | `dist/`、`*.log`、`var/` 都按「任意层级」匹配：将来任何名为 `dist`/`var` 的源码目录、任何测试夹具 `.log` 都会被静默忽略，且不报错。目前只影响不存在的路径，属隐患 | 已修 |
| [x] | S03-01 | P1 | ``bench/scripts/run.mjs:311-314` + `bench/scripts/report.mjs:154-168,224`` | 某一档 k6 跑失败（超时、被 kill、导出文件缺失）时只 `console.log` 后 `continue`，既不进 `runs` 也不进 `meta.skipped`。报告的列由 `runs` 反推，于是这一档连表头都不出现；`判定` 段仍按剩下的档打印「未超过验收线」。100 并发跑崩了，读报告的人看到的是 5–50 全部通过。 | 已修 |
| [x] | S03-02 | P1 | ``bench/scripts/report.mjs:214-225`；`bench/scripts/summary.mjs:40,47,77`` | 无样本的一轮会被判为通过。整档 100% 429 时 `ep_<name>_ms` 一条样本都没有，`p95` 落成 `null`，而判定是 `if (ep.p95 > limit)`——`null > 1000` 为 false，不触发；同时 `errorRate: servedCount ? errCount / servedCount : 0` 把「一个请求都没被服务」记成 0% 错误。判定段于是打印「未超过验收线」。 | 已修 |
| [x] | S03-03 | P1 | ``bench/k6/write.js:92-101`；`knot-platform/backend/src/market.js:710-741`` | 写场景声称「跑完即删」，但删除链路有三处静默：① 发帖成功而 `intelId` 解析不出 id 时，整段 `if (id)` 跳过，一条不公开记录留下且不计任何错误；② `DELETE` 撞上 429 时按 `probe.js:28` 记成 `throttled` 而非 `err`，`ep_write_delete_err` 阈值不会响；③ 删除本身是软删（`verdict='removed'`，行留在库里），`enqueueReview` 已经把这条 `[bench]` 送进审核队列。在真实站点上跑一轮，留下的不是「零痕迹」。 | 已修 |
| [ ] | S03-04 | P2 | ``bench/scripts/run.mjs:169-180,231`；`bench/scripts/probe.mjs:306-310`；`bench/human/visitor.mjs:31`` | 授权码与会话 cookie 不和 `--base` 绑定：`runK6` 把 `KNOT_AGENT_TOKEN` 放进子进程环境，`probeSite(BASE, { token })` 先发 `Authorization: Bearer` 再按 401 判断有效性——目标是哪台就把码发给哪台（`--base` 打错一位就等于把码交给陌生主机记日志）。另外 `probe.mjs --token <码>`、`visitor.mjs --cookie <sid>` 走 argv，会进 `ps` 和 shell 历史，与 README「只从环境变量或显式 `--token-file` / `--cookies-file` 读，不打印、不落盘」相矛盾。 | 部分 |
| [x] | S03-05 | P2 | ``bench/scripts/run.mjs:295-306`；`bench/README.md:100`` | README 说预热是「DNS、TLS、隧道、连接池，各档共用」，实际每档都 `spawnSync` 一个全新的 k6 进程，TCP/TLS/keep-alive 连接全在这一档内新建。预热只热了服务端的缓存与连接池，客户端侧的握手成本一点没省，每档开头仍有一批冷连接样本混进 p95。 | 已修 |
| [x] | S03-06 | P2 | ``bench/scripts/run.mjs:184-191`；`bench/k6/agent-read.js:52-54`` | 成功时 `res.stdout/stderr` 被直接丢弃，只有非 0 退出码才取末尾 8 行。于是 k6 侧的 `console.warn`（「Agent 信息流为空，卡片详情将跳过」「只有一份授权码…」「setup: base=… ids=0」）全部消失；对应端点的 `ep_*` 指标压根不产生，报告里整行 `GET /api/agent/intel/:id` 就此不见，没有任何说明。 | 已修 |
| [x] | S03-07 | P2 | ``bench/k6/lib/probe.js:27-31`` | 成功判定只有 `status >= 200 && status < 400`，从不校验响应体。3xx 被当成功（k6 默认还跟随重定向），`304`、入口维护页回 200 的 HTML、任何 `200 {"error":…}` 都算通过。整套报告因此可能测的是「一个回 200 的页面」，而错误率仍是 0%。 | 已修 |
| [x] | S03-08 | P2 | ``bench/scripts/probe.mjs:41-58`；`bench/scripts/compare.mjs:65,70`` | `timedRequest` 的 `ttfbMs` 在 `res.on("end")` 里计算，是整个响应下载完的耗时，不是首字节。这个数被 `compare.mjs` 标成「首页 TTFB」「路由中位」、被 `summaryLines` 当链路指标输出——名字与事实不符，看到 384ms 会以为服务端慢，实际可能只是包体大。同一函数的 `bytes` 来自被 `MAX_BODY=400_000` 截断后的字符串，超过 400KB 的页面字节数偏小。 | 已修 |
| [x] | S03-09 | P2 | ``bench/scripts/compare.mjs:89-129`` | `--runs` 把两份 `summary.json` 并排时，表头只有 host，不比压测机（`meta.machine`）、每档时长（`meta.duration`）、身份模式（`meta.identity.mode`）、版本（`meta.git`）。两份档位不同只落成 `-`；一份 5s、一份 30s 也能并排成一张表。末尾只有一句通用提醒。 | 已修 |
| [ ] | S03-10 | P2 | ``bench/human/visitor.mjs:128-145`` | `--allow-writes` 会对 `/api/web/uploads` 上传一张 PNG，从不删除，也没有对应的删除调用。每次 `human` 跑 `VIEWPORTS × RUNS` 次就多若干张孤儿图，只能等后端 `gc-uploads.mjs` 在 24h 宽限期后回收（前提是 GC 被定时跑到）。k6 侧的 `write.js` 同类：上传了图却从不把它挂到帖子上。 | 暂缓 |
| [x] | S03-11 | P2 | ``bench/human/visitor.mjs:276-277,290-291`（对照 `:11`）` | 文件头声明这一层回答「含重定向、失败请求、控制台错误」，实际 `requestfailed` 与 `console` error 只推进 `failed` / `consoleErrors` 数组写进 `human.json`，`summarize()` 的 `errors` 只数 `i.error \ | 已修 |
| [x] | S03-12 | P2 | ``bench/scripts/report.mjs:156-168,224`` | 总览把「RPS」和 p50/p95/p99 放在同一张表，判定段对每一档分别下「通过」，却没有任何一处说明 RPS 是「实际到达的请求速率」而非「系统能承载的容量」，也没有吞吐是否随并发线性增长、是否已饱和的判定。实测产物里 100 并发 Agent 读到 175.8 RPS，这张表最容易被引用成「该站能承载 176 QPS」。 | 已修 |
| [x] | S03-13 | P3 | ``bench/scripts/report.mjs:38,218`` | 判定用未取整的 `ep.p95`，展示用 `Math.round`，于是产物里出现自相矛盾的一行：「p95 1000ms > 1000ms」（`bench/results/2026-10-23T01-36-11/summary.md` 判定段）。 | 已修 |
| [x] | S03-14 | P3 | ``bench/k6/lib/common.js:39-46` / `bench/scripts/probe.mjs:104-108`；`bench/scripts/run.mjs:134-143` / `bench/scripts/probe.mjs:118`` | `assetPaths` 在 k6 与 scripts 各写一份；`arg()` 在 `run.mjs:26`、`compare.mjs:14`、`visitor.mjs:20`、`make-image.mjs:68` 各写一份，语义还不一致（前者把空值也当缺省取 fallback，后者不校验）。「是不是直连源站」也有两套：`isDirectBase` 认 10./192.168./172.16-31，`probe.mjs` 的 `isLoopback` 只认 127./localhost/::1，所以直接对 `192.168.3.91` 探测会误报「管理入口可达」。 | 已修 |
| [x] | S03-15 | P3 | ``bench/package-lock.json:6` / `bench/package.json:3`` | lock 顶部仍写 `"version": "0.1.0"`，`package.json` 已到 `0.2.0`。依赖本身干净：只有 `playwright@1.57.0` → `playwright-core@1.57.0` + 可选 `fsevents`，全部来自 registry.npmjs.org，无 install 脚本（`fsevents` 除外，macOS 常规）。 | 已修 |
| [x] | S03-16 | P3 | ``bench/k6/write.js:39-41` / `bench/k6/lib/common.js:22-23`` | `common.js` 注释明确「阈值不在这里设，由 `scripts/report.mjs` 的 LIMITS 统一判定」，`write.js` 却自带 `thresholds: { "ep_write_delete_err": ["rate<0.02"] }`。于是同一条「删除失败」有两条线：k6 侧 2%（触发退出码 99）与 report 侧按 `write_` 前缀套 `LIMITS.writeErrorRate`。 | 已修 |
| [x] | S03-17 | P3 | ``bench/scripts/run.mjs:168`` | k6 超时按 duration 字符串里的数字 +120s 估：`30s`→150s 正常，`5m`→`125s`，而实际要跑 300s，会在第 125 秒被 `spawnSync` 杀掉，这一档按 S03-01 静默消失。 | 已修 |
| [x] | S03-18 | P3 | ``bench/k6/read.js` 全篇；`knot-platform/backend/src/market.js:892,815`` | 「读」场景在库里有写：每次卡片详情触发 `recordIntelRead`（`intel_reads` 表，ON CONFLICT 去重），每次检索触发 `recordSearchEvent`（`search_events` 表，缓存命中照记，不去重）。README 的场景配比表把这一组描述成纯 GET，没提服务端写；测出的 p95 里含这些 INSERT 的成本。 | 已修 |
| [x] | S04-01 | P1 | ``docs/KNOT_HELP.md:84`<br>`docs/KNOT_HELP.md:146`` | 文档把「重复提交返回同一条记录」写成无条件承诺，实现却把 `pending` 记录排除在幂等查询之外。预审通过后记录正是 `pending`（文档同页写「a pass at pre-review is pending」），所以**刚发完就重试**会新建一条重复记录；检索同理，会新建 wish 并起第二个 job | 已修 |
| [x] | S04-02 | P2 | ``docs/KNOT_HELP.md:201`` | 文档称 `displayName` 传空字符串「去掉称呼」，实现返回 400 `bad_name`，空串无法清名；实例 Web 文档也是「空称呼返回 `bad_name`」 | 已修 |
| [x] | S04-03 | P2 | ``docs/KNOT_HELP.md:82`` | `kMeta.expiresAt` 写成「`wish` only；最长 24 小时」，实际出售帖（有可下载附件且标价 >0）也带 `expiresAt`，默认 72 小时 | 已修 |
| [x] | S04-04 | P2 | ``docs/KNOT_HELP.md:86`` | 文档称「历史版本仍可按 id 读」。实际按旧版 id 读会**返回该修订链最新的可见版本**，读不到旧稿 | 已修 |
| [x] | S04-05 | P2 | ``docs/KNOT_HELP.md:156`` | 文档说 `/information` 是「最新 30 条公开 post / fastpost」，漏掉「出售帖不进信息流」：有附件且标价 >0 的记录一条都不会出现，Agent 发完在信息流里找不到 | 已修 |
| [x] | S04-06 | P2 | ``docs/KNOT_HELP.md:65`` | 文档称单图/单音频/单文件上限「由实例设定（缺省 8/8/50MB）」。Agent 路由把三个值写死在代码里，不读实例配置；同一实例把 Web 上限调大后，Agent 门仍在旧值处返回 `file_too_large` | 已修 |
| [x] | S04-07 | P2 | ``docs/KNOT_HELP.md:185`<br>`docs/KNOT_HELP.md:67`` | 文档承诺同一账户对同一条「只付一次」、`granted` 按账户算；实现把 `packet_downloads` / `request_unlocks` / `intel_reads` 都记在 Agent 行 id 上，而扣款走主人钱包（`walletOf` 归一到 `owner_id`）。同一个钱包下，主人在网页下载 Agent 已付过的同一条会再付一次，`granted` 也不互认 | 已修 |
| [x] | S04-08 | P2 | ``docs/KNOT_HELP.md:234-260`` | 错误码表缺两个 `/register/key` 会真实返回的码：`403 bad_owner`、`503 agent_unavailable`。Agent 拿到未列出的码无法按文档分支处理 | 已修 |
| [x] | S04-09 | P3 | ``docs/KNOT_HELP.md:42`<br>`docs/KNOT_HELP.md:73-82`` | 响应字段表不全：`register/key` 实际还返回 `agentId`、`displayName`、`email`；`kMeta` 还有 `topics`、`commerce.fee`；`author` 还带 `role` | 已修 |
| [x] | S04-10 | P3 | ``docs/KNOT_HELP.md:80`` | 文档说作者删除且无原因时 `rejectReason` 为 `"deleted by the author"`，实际写入中文 `作者删除`。英文版读者按字面匹配会失败 | 已修 |
| [x] | S04-11 | P3 | ``docs/KNOT_HELP.md:144`` | 文档称检索响应的 `actor` 与 `payee`「都是 `platform`」。`payee` 由 kind 推出，`wishRespond` 恒为 `author`，所以平台产出的检索结果 `payee` 是 `author` | 已修 |
| [x] | S04-12 | P3 | ``docs/KNOT_HELP.md:122`` | 文档说「自己发出的才带 `responseCount`」，实际每条都带，别人的恒为 0。按字段存在性判断归属会误判 | 已修 |
| [x] | S04-13 | P3 | ``docs/KNOT_HELP.md:253`` | `bad_state` 的释义里列了「a duplicate response」，实现没有任何重复响应拦截：同一 wish 可以交多条不同内容的响应，内容相同则走幂等返回旧记录 | 已修 |
| [x] | S04-14 | P3 | ``docs/KNOT_HELP.md:203`<br>`docs/KNOT_HELP.md:204`` | 文档按「字符」计长度，`specialties` 与 `bio` 用的是 UTF-16 `length`，一个 emoji 算 2；`displayName` / `agentType` 却按码点算。11 个 emoji 的特长（11 字）会被判超 20 字 | 已修 |
| [x] | S04-15 | P3 | ``docs/KNOT_HELP_CN.md:77`` | 中文对照稿 `commerce.payee` 行多出「平台。」，读起来像「payee 恒为平台」，与后半句「`author` 或 `platform`」自相矛盾；英文版无此句 | 已修 |
| [x] | S04-16 | P3 | ``docs/concepts.md:11`<br>`docs/concepts.svg:30`<br>`docs/API.md:12`` | 概念稿把中枢定义成「只读入口服务」，API 索引写「对公网只开放申请」。中枢实际既收申请落库，也对公网开了健康、位置、子域查重、成员换码、claim 等端点 | 已修 |
| [x] | S04-17 | P3 | ``docs/png/60bade14e9523f821afcd248d6b80fb1.jpg`` | 700×624 的孤立 JPG，文件名是 32 位十六进制（像上传内容哈希），全仓无任何引用，也不在 `docs/README.md` 的 PNG 清单里；仓库公开，属于误入的幽灵资源 | 已修 |
| [x] | S04-18 | P3 | ``docs/knot-federation-map.svg:64-65`<br>`docs/knot-federation-map.svg:126-128`` | 地图图例写「在线 6 / 延迟 2 / 不可达 2」，但 10 个点的 `fill` 全是 `#64748b`（`unknown`），没有一个是绿/黄/红。生成脚本从同一 `placed` 数组同时算图例和点的颜色，一次运行不可能产出这种文件，说明提交的 SVG 与当前脚本/输入不一致 | 已修 |
| [x] | S05-01 | P2 | ``knot-platform/package-lock.json:2538`<br>`knot-platform/backend/package.json:21`` | 生产上传链路上的 `multer` 锁在已被上游宣告受漏洞影响的 1.x 线，且 manifest 的 caret 范围**在数学上无法进入 2.x**，重新解析也修不掉 | 已修 |
| [x] | S05-02 | P2 | ``knot-platform/ops/scripts/build.sh:45`<br>`knot-platform/ops/scripts/build.sh:159`<br>`knot-platform/ops/scripts/deploy-site.sh:124`` | 「发布包自带生产依赖」这条交付前提没有任何校验：`--no-modules` 的包在 BUILD.json 里留下 `modules: false`，但部署脚本全文不读这个字段，解包后既不装依赖也不会自举，只会在探活处失败 | 已修 |
| [ ] | S05-03 | P3 | ``knot-platform/package-lock.json:2928`<br>`knot-platform/package-lock.json:3619`` | `qrcode` 把它的**命令行**依赖 `yargs@15` 一起拖进生产闭包，26 个包只为一个从未被调用的 CLI 服务，占生产闭包 205 条的 14%，每个发布包都随身携带 | 暂缓 |
| [x] | S05-04 | P3 | ``knot-platform/package-lock.json:4`<br>根 / `backend` / `web` / 5 个 `packages/*` 的 `package.json`` | 8 份 manifest 全都没有 `engines`，根也没有 `packageManager`，仓库无 `.npmrc`、无 `.nvmrc`；而 lock 里多个包有硬性 Node 下限，版本不对时 `npm ci` 只警告，装完在 require 时才崩 | 已修 |
| [ ] | S05-05 | P3 | ``knot-platform/package-lock.json:1588`<br>`knot-platform/package-lock.json:3574`<br>`knot-platform/package-lock.json:2532`<br>`knot-platform/package-lock.json:3065`` | 3 组同包多版本共存，均为 dedupe 未命中，无功能风险，记录以免后续被误当成漏洞重复计数 | 不成立 |
| [x] | S06-01 | P2 | ``package.json:1-25`、`README.md:110-113`` | 根 manifest 没有 `engines`，README 快速开始也没写 Node 版本，而部署脚本把 22 当硬门槛。开发者照 README 在 Node 18/20 上跑 `npm install` + `npm test`，npm 不告警、构建不报错，直到部署或在运行时踩到新 API 才炸；仓库也没有 `.nvmrc`/`.node-version` 兜底 | 已修 |
| [x] | S06-02 | P2 | ``package.json:16-22`` | `deploy`、`push`、`rollback` 三条别名都不带 `--site`。本仓库 `sites/` 下有 `bot01`、`local` 两个站点，别名一执行就停在站点选择；即使在只有单站点的机器上，`deploy` 也仍会撞「这是源码目录，不是发布包」——别名给出的两条路都不通向部署 | 已修 |
| [x] | S06-03 | P3 | ``package.json:3`、`CHANGELOG.md:3`、`CHANGELOG.md:240`` | 产品版本在三个 manifest 里手抄，而根 `package.json` 的 `version` 没有任何读取方：发布包名与 `/api/health` 都读 `backend/package.json`。CHANGELOG 两处却写「跟着 `package.json` 走」「读自 `knot-platform/package.json`」，读者会改错那一份；改错后构建、测试、探活全都看不出来 | 已修 |
| [x] | S06-04 | P2 | ``README.md:152-157`（关键句 `:155`）` | README 把管理后台写成「XKnot 栏只看接入件与状态信号……XKnot 栏只读，改动仍走 `ops/scripts/join-xknot.sh`」。0.4.0 起这一栏已经是可写的站点档案表单（名称/简介/地区/时区/标签/默认语种）+ 子域接入申请 + 隧道与进度；用户栏还多了授权码查看/重签与改资料。照着读的人会放弃界面、去手改文件 | 已修 |
| [x] | S06-05 | P3 | ``backend/package.json:14-19`、`web/package.json:10-12`（本片从根 manifest 的 workspace 声明追进去）` | 内部包用精确版本钉死（`@knot/config: "0.4.0"`，其余 `@knot/*: "0.1.0"`），外部依赖用 `^`，两套策略并存；产品已到 `0.6.0`，共享包仍停在 `0.4.0`/`0.1.0`，CHANGELOG 0.4.0 那句「共享包 `@knot/config` 同步抬版本」已不再成立。只抬共享包、忘改引用时，npm 不会用 workspace 而是去 registry 找未发布的 `@knot/*`，`npm ci` 直接 404 | 已修 |
| [x] | S07-01 | P2 | ``i18n/en.js:528-588`、`i18n/zh-CN.js:528-588`、`i18n/zh-TW.js:528-588`` | 管理接口会返回的错误码没有全部落进文案表，管理员会看到裸码 | 已修 |
| [x] | S07-02 | P2 | ``index.html:24`` | 管理令牌输入框声明成浏览器密码字段，长期 Bearer 令牌可能被密码管理器保存/云同步到管理机之外 | 已修 |
| [x] | S07-03 | P2 | ``index.html:478-559`` | 发放积分、永久禁言、改等级、改权益都是「填原因 + 一次点击」直接生效，没有带对象与数量的确认；同页删除类操作反而都有确认 | 已修 |
| [x] | S07-04 | P2 | ``i18n.js:97-101`（并 103-108）` | `fmtInt(null)` / `fmtInt("")` 显示 `0` 而不是 `—`：`Number(null) === 0` 能通过 `isFinite`，概览与积分把「没有这个数」显示成「0」 | 已修 |
| [x] | S07-05 | P3 | ``index.html:404`、`412`、`858`` | `maxlength` 按 UTF-16 码元计数，校验与后端按码点计数：emoji、扩展 B 汉字组成的称呼到 40 码元就被输入框截住，实际只允许一半；二级域名框允许 40，中枢上限是 32 | 已修 |
| [x] | S07-06 | P3 | ``index.html:738-743`` | 赞助图只给了 `accept`，没有体积与类型预检；8MB 上限只有服务端把，超限要等整个文件传完才报错 | 已修 |
| [x] | S07-07 | P3 | ``index.html:8`、`862`；`i18n.test.mjs:111-124`` | `placeholder="your-site"` 与 `<title>` 是硬编码、没进三份字典；「页面里没有硬编码中文」的测试只扫 `admin.js`，`index.html` 只校验 key 存在，查不出这类遗漏 | 已修 |
| [x] | S07-08 | P3 | ``i18n.js:50-52`、`110-112`；`i18n.test.mjs:81`` | `isLocale`、`dictionary` 导出后全仓无引用；对应测试的断言恒真 | 已修 |
| [x] | S07-09 | P3 | ``index.html:412-415`` | 简介 200 字上限硬编码三处（`maxlength`、静态 `0 / 200`、`updateBioCount` 的模板串），改名一处就漂 | 已修 |
| [x] | S08-01 | P1 | ``admin.js:1427`、`admin.js:1444`、`admin.js:1461`、`admin.js:1499`、`admin.js:1522`、`admin.js:1833`、`admin.js:829`、`admin.js:817`` | 写操作按钮在请求期间不禁用，双击即重复提交。`/points` 每次调用都追加一条 `point_ledger`，双击就是发两笔积分；`/mute`、`/warnings`、`/invites` 同样会重复落库与重复通知 | 已修 |
| [x] | S08-02 | P1 | ``admin.js:692-701`、`admin.js:628`` | 「按账号查帖」只回最近 30 条（给了时间窗时 200 条），摘要却写「共 N 条」，既不说被截断，也没有翻页或游标。更早的帖子在管理端根本调不出来，删不掉 | 已修 |
| [x] | S08-03 | P2 | ``admin.js:452-456`` | `enter()` 在**任意**异常（隧道 502、`bad_response`、断网）下都执行 `state.token = ""; forget();`，把存在 localStorage 的 30 天凭据直接删掉。一次临时断线就要回到 WebUI 重新换票 | 已修 |
| [x] | S08-04 | P2 | ``admin.js:1427`、`admin.js:1522`、`admin.js:1586-1594`` | 发积分、改权益（含收回）、停用 Agent（令牌立刻作废）都没有二次确认；而同页的删帖（`admin.js:718`）、禁用邀请码（`admin.js:1845`）、应用价格（`admin.js:2075`）、删赞助（`admin.js:2002`）、换令牌（`admin.js:1710`）都有 `confirm`，同一类风险两套标准 | 已修 |
| [x] | S08-05 | P2 | ``admin.js:626-629`、`admin.js:989-995`` | 列表请求没有代次校验，先发后到的响应会盖掉后发先到的结果。连续改查询条件、连点刷新后，屏幕上的名单可能是上一次查询的 | 已修 |
| [x] | S08-06 | P2 | ``admin.js:420-421`、`admin.js:471-477`、`admin.js:1693`` | 30 天管理凭据写 `localStorage`；换票票据经地址栏（`#t=`）传入；而本文件自己承认会以明文 HTTP 在局域网使用（剪贴板失败退路的注释：「局域网里可能是 http」）。凭据与 Bearer 令牌都在明文信道里走，同网段可嗅探 | 已修 |
| [x] | S08-07 | P2 | ``admin.js:2263-2272`、`admin.js:2832`、`admin.js:2729`` | 站点档案表单的字段标签与提示是 `fieldLabel()` 用 `t()` 在 boot 时生成的一次性 DOM，没有 `data-i18n`；切语种只 `applyI18n()` + `setView()` + `fillProfileForm()`，从不重建表单，标签永远停在启动时的语言 | 已修 |
| [x] | S08-08 | P2 | ``admin.js:2653`、`admin.js:2563-2567`` | 初次接入申请提交成功后 `join-submit` 被设为 `hidden = true`，全文件没有任何地方再把它显示出来。申请被中枢判拒或之后要重交时，卡片还在、按钮没了，只能整页刷新 | 已修 |
| [x] | S08-09 | P3 | ``admin.js:370-382`、`admin.js:989-995`、`admin.js:2353-2361`` | 「失败」被当成「空数据」。`api()` 对 200 空响应体返回 `{}`，`/accounts` 于是渲染成「名册为空」而不是报错；`loadJoinApplication` 把所有异常吞掉只把 `application` 置 null，接入记录无声消失 | 已修 |
| [x] | S08-10 | P3 | ``admin.js:1404-1410`` | 任何 `updateUser`（发积分、警告、禁言、改等级后）都会走 `renderUserPanel()` → `fillIdentityForm(record)`，用库里的值重填称呼/简介/特长，并把 `level-value` 重置成当前等级。正在编辑的草稿被静默丢弃 | 已修 |
| [x] | S08-11 | P3 | ``admin.js:2533-2540`、`admin.js:2638-2646`` | `application.caseUrl` 直接作为 `<a href>` 写入，未校验 scheme。它是中枢响应字段，被污染时 `javascript:` 链接可点。当前 CSP `script-src 'self'`（`backend/src/routes/adminPage.js:10`）会拦住，属纵深缺口而非可利用漏洞 | 已修 |
| [x] | S08-12 | P3 | ``admin.js:661`、`admin.js:2137`` | 接口字段直接插进 `class` 名（`pill ${post.verdict}`、`signal is-${signal.level}`）。只能注入 class，不能执行脚本，也不会进入 `innerHTML` | 已修 |
| [x] | S08-13 | P3 | ``admin.js:185`、`admin.js:189`、`admin.js:200-207`、`admin.js:212`、`admin.js:219` vs `admin.js:876`、`admin.js:710` vs `admin.js:792`` | `GLYPHS` 里 `link`/`image`/`up`/`down`/`clock` 五个图标没有任何引用（`index.html` 也没用）；两套几乎相同的 SVG 构建器与两张图标表（`GLYPHS`+`svgNode` / `IDENTITY_ICONS`+`iconNode`）；删帖逻辑两份（`removePost` 与 `patrolRemove`）逐行重复，只差最后刷新哪一个列表 | 已修 |
| [x] | S08-14 | P3 | ``admin.js:351-396`、`admin.js:589-601`` | `fetch` 没有超时也没有 `AbortController`，一次挂住的请求会让 `#users-list` 的 `aria-busy` 永远停在 true；概览用 `Promise.all` 聚合三个接口，任一个失败就把已拿到的经济数据丢掉，整页回到「加载中」 | 已修 |
| [x] | S08-15 | P3 | ``admin.js:2524`` | 申请提交时间直接截 ISO 串前 10 位当日期显示，取的是 UTC 日期。东八区 00:00–08:00 提交的申请会显示成前一天 | 已修 |
| [ ] | S08-16 | P3 | ``admin.js:669`` | 管理端展示的帖子正文被 Backend 裁到 400 字，页面没有任何「已截断」标记。管理员据残缺内容决定删帖或警告，长文的后半段从未被看到 | 暂缓 |
| [x] | S08-17 | P3 | ``admin.js:2739-2826`、`admin.js:2111-2113`、`admin.js:2671`` | `bindEvents()` 与多处 render 对 `byId(...)` 结果不判空，直接 `.addEventListener`/`.replaceChildren`。`index.html` 与脚本一旦不同步（改名、裁剪版页面），`boot()` 在绑定阶段抛错，登录框都不会出现，控制台之外无任何提示 | 已修 |
| [x] | S09-01 | P2 | ``admin.css:206`、`admin.css:1263`、`admin.css:1267`、`admin.css:2235`` | 粘性偏移量按「没有顶栏」算的，粘住后被 64px 的顶栏盖掉上半截（约 40–48px）：左导航最上面一条、详情卡片头部（身份标识 + 姓名 + 关闭键）滚到上方就永久落在顶栏后面 | 已修 |
| [x] | S09-02 | P2 | ``admin.css:1639`、`admin.css:1646`、`admin.css:1654`、`admin.css:1664`` | 登录页语种下拉「白底另给一套颜色」这一整块被后面同权重规则覆盖，实际没生效：边框仍是给深色顶栏用的 `rgba(255,255,255,0.18)`（白卡片上等于没有边框），地球图标仍是 `#9ca3af`（白底 2.5:1，几乎看不见） | 已修 |
| [x] | S09-03 | P2 | ``admin.css:454-458`` | 输入框/下拉/多行文本的焦点环用 `--accent-soft`（`#eef2ff`）画在白底上，对比度约 1.06:1，等于不可见；屏幕上只剩 1px 边框变色（`#d1d5db`→`#1d4ed8`）作为唯一提示，弱视/键盘用户难以判断焦点在哪 | 已修 |
| [x] | S09-04 | P3 | ``admin.css:1322`、`admin.css:2220`、`admin.css:1311`、`admin.css:1870`、`admin.css:467`、`admin.css:1280`、`admin.css:1299`、`admin.css:1976`` | 多轮迭代留下的同选择器两处定义：`.price-grid` 的 160px 列宽被文件末尾的 150px 覆盖，**永不生效**；其余四组是「先定义一处、后来在别处补一段」，读的时候要跨 900 行拼 | 已修 |
| [x] | S09-05 | P3 | ``admin.css:332`、`admin.css:475`、`admin.css:534-546`、`admin.css:670`、`admin.css:675`、`admin.css:1291`、`admin.css:1316`、`admin.css:1329`、`admin.css:1505-1514`、`admin.css:1984`` | 7 组类名（12 条规则，约 55 行）在 `index.html` 与 `admin.js` 里都不存在，`.check` 那组连带桌面与窄屏两份、以及 `.stack-form .check` 的组合选择器一起作废 | 已修 |
| [x] | S09-06 | P3 | ``admin.css:505`、`admin.css:1210`、`admin.css:2110`` | `--font-mono` 全文（含 `web/src/styles.css`）没有定义，靠 `var()` 的兜底值工作，声明不会失效但会误导：同一套等宽字体在三处出现两种写法，日后往 `:root` 补定义只会改到其中两处 | 已修 |
| [x] | S09-07 | P3 | ``admin.css:480-508`` | 子域输入要「视觉上是一条完整地址」，但实现自相矛盾：输入端去掉右边框并把右侧圆角置 0、后缀端去掉左边框并把左侧圆角置 0，中间却又留了 `gap: 8px`。结果是两个各缺一条边的框被 8px 空白隔开，接缝处没有边框 | 已修 |
| [x] | S09-08 | P3 | ``admin.css:681-689`、`admin.css:206`` | 浅灰正文落在浅灰底上，比 AA 的 4.5:1 差一点：`.pill` 的 `#6b7280` 配 `#f3f4f6` 约 4.39:1；页面底色 `#f3f4f6` 上直接放的 `.muted`（`.view-head` 的说明段）同样 4.39:1，字号 12–14px，不满足大字号豁免 | 已修 |
| [x] | S09-09 | P3 | ``admin.css:858`、`admin.css:1266`` | 没有 `@media print`：名册 `.user-list { max-height: min(62vh, 720px); overflow-y: auto }` 与 `.detail-card { max-height: calc(100vh - 48px); overflow-y: auto }` 打印时只输出可视区，其余行被裁掉；顶栏与左导航是 sticky，会跟着每页重复。管理员把名册/详情打印或「另存为 PDF」留档时拿到的是残缺内容 | 已修 |
| [x] | S10-01 | P1 | ``src/login.js:161-172`（调用点 `src/routes/web.js:180`）` | 六位数字登录密钥的校验没有任何失败计数或锁定：`/api/web/login/key` 只做 `normalizeEmail`/`normalizeLoginKey`，随后直接进 `redeemLoginKey`。密钥 10 分钟有效、空间 1e6，攻击者拿到任意邮箱即可在窗口内穷举；命中即替该邮箱建会话，`role = 'owner'` 的账号同样适用。`requestLoginKey` 只限制「同一邮箱 60 秒内只寄一次」，不构成尝试上限 | 已修 |
| [x] | S10-02 | P1 | ``src/market.js:443-452`` | 作者删除（`verdict='removed'`）或被终审撤销（`rejected`）后，用**完全相同的内容**再发一次，`createIntel` 不新建记录，而是把那条已不可见的旧记录当「重复提交」返回：接口 201、`kMeta.verdict` 为 `removed`/`rejected`，信息流与「我的提交」都不会出现新帖。库上 `intel_account_content_idx` 是 `(account_id, content_hash)` **全量唯一**（无 `verdict` 谓词），即使绕开预检也会在 INSERT 撞 23505 走同一条返回 | 已修 |
| [x] | S10-03 | P2 | ``src/market.js:386-408`` | 修订版本号是「先查 MAX(version) 再 +1」，两步之间没有行锁也没有事务包裹（代码注释承认「先不做跨事务行锁」）。两笔并发修订会拿到同一个 `version`；而信息流「同 origin 只留最新版」的判据是 `newer.version > i.version`，同版本的两行互相不排除，会**同时留在信息流/搜索里**（库里 `intel_origin_idx` 是普通索引，不拦重复） | 已修 |
| [x] | S10-04 | P2 | ``src/market.js:1034-1056`` | `chargeDownload` 固定按「先买家、后作者」改 `accounts`。两个用户互相下载对方的出售帖时，两笔事务加锁顺序相反（A→B 与 B→A），Postgres 判定死锁并回滚其中一笔，用户看到 500 `internal`。资金不会错（整体回滚），但这是正常业务下可复现的失败路径 | 已修 |
| [x] | S10-05 | P2 | ``src/notifications.js:25-32`；`src/requests.js:11,39,78,131`` | 通知箱与 wish 四张列表（我发出的、我响应的、我看过的、某条 wish 的响应）都没有 `LIMIT`/分页，全量取回后在内存里 map。`notifications` 只增不删且无清理任务，单账号长期使用可到万级，每次 `/api/web/notifications` 都整箱穿过入口隧道 | 已修 |
| [x] | S10-06 | P2 | ``src/market.js:291-305, 349-352`` | 终审队列没有次数上限：`reviewAttempts` 只用来算退避，一条永远失败的 `pending` 会每 15 分钟重跑一次评审员直到进程重启（对比 `retrieval.js` 有 `retrievalMaxAttempts = 3` 就放弃）。`resumePendingReviews` 又在每次启动把**全部** `verdict='pending'` 一次性塞进内存队列（无 LIMIT） | 已修 |
| [x] | S10-07 | P2 | ``src/market.js:444-446, 503-510`；`src/points.js:119-121`` | 价格只按**平台上传附件数**（`billable.length`）判定，而「什么算附件」在库里/展示层是另一套（非图片非音频）。只有外链附件（`links.attachments`，`routes/web.js:521` 明确接受）的帖子 `billable.length === 0`，`packetPrice(0, price)` 直接返回 0：作者填的价格被静默丢弃，既不报 `bad_price` 也不进出售区，卡片上却仍列着附件名 | 已修 |
| [ ] | S10-08 | P2 | ``src/readable.js:114-127`；`src/market.js:113-126`` | 发布路径的附件校验把整个文件读进内存（`readFile`，附件上限 50 MiB），随后 `encryptDict` 两次 `buffer.toString("latin1")` 全量复制（头部再一份），`zipNames` 也是全量扫描。一次发布最坏产生数百 MB 字符串并同步阻塞事件循环；`pdfOpens`/`zipNames` 全同步，期间整个 Backend 不响应其它请求 | 部分 |
| [x] | S10-09 | P3 | ``src/packetZip.js:156-205, 236-247`` | 打包把全部附件 `readFileSync` 进内存，再 `Buffer.concat` 出 locals、centrals、end 三份拷贝；`writeUInt32LE` 写大小、`writeUInt16LE` 写条目数都没有上限校验，超过 4 GiB 或 65535 条目会抛 `RangeError` → 500。当前 `MAX_FILES = 1`、附件 50 MiB 兜住了边界，但这是巧合而非校验 | 已修 |
| [ ] | S10-10 | P3 | ``src/handoff.js:86-100`` | 30 天管理凭据是无状态 HMAC，没有任何吊销手段：登出、换机器、怀疑泄漏都只能整体轮换 `KNOT_ADMIN_TOKEN`，会把所有在用凭据与票据一起作废。凭据里也没有绑定「发给谁/哪台机器」 | 暂缓 |
| [x] | S10-11 | P3 | ``src/middleware/session.js:29-36`` | 会话 Cookie 没有 `secure`（只有 `httpOnly` + `sameSite=lax`）。实例本身只监听回环、入口是 https，现实风险有限；但按 CONFIG 把 `KNOT_BIND_HOST` 设成 `0.0.0.0`（文档明确允许，用于内网打开 `/admin`）后，同一 Cookie 就能从内网明文 http 被截获 | 已修 |
| [ ] | S10-12 | P3 | ``src/information.js:9-11`；`src/preview.js:39-41`；`src/retrieval.js:147`` | 同一句「什么算可见」有三套写法：`visibleVerdict()` 生成 `IN ('pending','passed')`、`preview.js` 手写同样的比较、`existingResponseId` 用 `verdict NOT IN ('rejected','removed')`。后两者在新增 verdict（如 `draft`）时会静默走岔；附件判据更散（`HAS_ATTACHMENT` SQL、`isDownloadableFile`、`packetZip.kindOf`、`isAttachmentUpload` 计费口径，代码注释自己也写了「三处必须一致」） | 部分 |
| [x] | S10-13 | P3 | ``src/market.js:165-166`` | `judgeIntel` 遇到非 `pending` 记录直接 `return presentIntel(intel)`，这条路径不带 `files`，返回的卡片没有图片/附件（只有 `loadPresentedIntel` 有）。管理端「重新终审」或并发重入时会拿到一份残缺卡片 | 已修 |
| [ ] | S10-14 | P3 | ``src/market.test.js`；缺 `retrieval.test.js`、`requests.test.js`` | 账务与发布主路径无测试：`createIntel`、`downloadPacket`/`chargeDownload`/`unlockRequest`、`applyPoints` 的「扣款 + 入账 + 幂等」在片内没有用例（`market.test.js` 只覆盖列表/搜索/删除/重开）；`retrieval.js`（重试上限、`existingResponseId` 去重、失败通知）与 `requests.js`（wish 列表与查看权限）整文件无测试。S10-02/S10-04/S10-07 都能被一条用例抓住 | 部分 |
| [x] | S10-15 | P3 | ``src/retrieval.js:178, 199-207`` | 内部检索用平台账号调 `searchPublicIntel`，会把平台自己的检索写成 `search_events` 一行（`account_id = 平台`），污染「谁搜过什么」与精算师的检索计数；报告先落盘 + 先写 `uploads` 行，后续 `createIntel` 失败时该行与文件成为孤儿（只能等 `gc-uploads.mjs`），每次重试再写一份 | 已修 |
| [x] | S10-16 | P3 | ``src/index.js:190-204`` | 没有 `SIGTERM`/`SIGINT` 处理：`deploy-site.sh` 重启时进程被直接结束，进行中的请求（上传、下载、发布事务）断在半路，`pg.Pool` 也没有 `end()`。另外 500 兜底用 `console.error(err)` 打整个错误对象，pg 的 `detail` 会把冲突行的取值（邮箱、内容片段）写进日志 | 已修 |
| [x] | S11-01 | P1 | ``admin.js:601-611`、`market.js:593-604`` | 撤下一条修订版，旧版会重新对外可见：`removePost` 只把当前 id 置为 `removed`，而「有更新版本就隐藏旧版」的条件只认 `pending`/`passed` 的新版 | 已修 |
| [x] | S11-02 | P1 | ``agentAccount.js:138-141`、`agentAccount.js:143-176`` | 「取令牌」在事务外先查后写：两个并发 POST 都能进到 `rotateAgentToken`，第二次把第一次刚返回的令牌作废，而第一次的响应已告诉调用方「明文只此一次」 | 已修 |
| [x] | S11-03 | P1 | ``db.js:6-10`` | 连接池没有 `error` 监听，空闲连接被中断（Postgres 重启、网络抖动、`pg_terminate_backend`）时 `pg` 会向池 emit `error`，无监听即抛未捕获异常，整个 Backend 进程退出 | 已修 |
| [x] | S11-04 | P2 | ``card.js:63-66`` | 官方支持的 `attachments:[{url}]`（外链附件）走到三处都不给：卡片只留文件名、下载包只打包 `intel_files`、纯外链时标价被归零 —— Agent 照文档发「带附件的帖 + price」会得到一条读不到文件、也不进出售区的免费帖 | 已修 |
| [x] | S11-05 | P2 | ``admin.js:903-929`` | 巡逻队列的水位取「提交报告那一刻」，不是「队列读出来的那一刻」：巡逻期间新发的帖、以及积压超过 `LIMIT 40` 的那些，创建时间都早于新水位，从此不再进队列 | 已修 |
| [x] | S11-06 | P2 | ``admin.js:601-628`` | 删除不是原子的：`UPDATE` 单独提交，之后 `discardExtract`、`recordNotification`、`writeAction` 各自一条语句。中途失败会留下「已撤下、作者没收到通知、没有审计流水」，并向管理端返回 500，管理员以为没删成 | 已修 |
| [x] | S11-07 | P2 | ``agents/openclaw.js:206-233`` | 子进程超时只发一次 `SIGTERM` 就 `reject`，没有 `SIGKILL` 兜底，也不清管道：OpenClaw 忽略 SIGTERM 时进程会一直挂着，`out`/`err` 继续无上限累积，每条待审内容再 spawn 一个 | 已修 |
| [x] | S11-08 | P2 | ``facets.js:9-19`、`discoverBoard.js:32-36`` | 两条无界查询把整窗口内容读进内存：`/api/web/facets` 每次请求都把 7 天内所有 `post` 的 `detail` 全量取回、无 `LIMIT` 无缓存；公开快照的 `WISH_SQL` 取全部在效 wish | 已修 |
| [x] | S11-09 | P2 | ``scripts/gc-uploads.mjs`、`scripts/purge-intel.mjs`、`scripts/milestone-clean.mjs`` | 三份会真删数据（GC 还删磁盘文件）的脚本没有任何测试：引用集合漏一项就会删掉仍在用的原件，而这一步没有回滚 | 已修 |
| [x] | S11-10 | P2 | ``package.json:19`` | `multer` 锁在 1.x（`^1.4.5-lts.1`）。1.x 已不再收上游修复，multipart 解析相关的 DoS 类通报只发在 2.x；而上传端点（`/api/web/uploads`、`/api/agent/uploads`、`/api/admin/uploads`）是公网可打的 | 已修 |
| [x] | S11-11 | P3 | ``scripts/backfill-uploads.mjs:146-162`` | 这份「审计」脚本的「无引用」口径比 GC 少一条：漏了「正文里嵌的 `/api/web/uploads/<id>`」，报出的孤儿数偏大；照它的人工清单清理会删掉仍被正文引用的图 | 已修 |
| [ ] | S11-12 | P3 | ``admin.js:601`、`routes/admin.js:491`` | 管理端删除不记操作者：`removePost` 的 `actorId` 默认 `null`，管理面调用不传，`admin_actions.actor_account_id` 恒为 `NULL`；只有 WebUI 的 `/api/web/intel/:id/close` 会填 | 不成立 |
| [x] | S11-13 | P3 | ``admin.js:890-901`` | `warnUser` 的通知与审计流水是两条独立语句，不在一个事务里；`writeAction` 失败时用户已收到警告、流水缺失 | 已修 |
| [x] | S12-01 | P2 | ``routes/agent.js:592`（`requireAccess` 在 `:89`）` | Agent 反馈邮件里的账户与回信地址永远是 `undefined`：`requireAccess` 只回 `{ userId, accountId, side }`，路由却读 `access.email` | 已修 |
| [x] | S12-02 | P2 | ``tunnel.js:65`（调用点 `routes/admin.js:302`、`310`、`386`）` | 中枢给的 `caseUrl` 被原样当作服务端请求目标，只校验协议与 `/case/<key>/` 路径，不校验 origin 是否等于配置的 `KNOT_HUB_ORIGIN`。一个响应过申请的中枢（或 `join.json` 被改成内网地址）就能让实例对它发 `GET .../progress`、`POST .../public-key` | 已修 |
| [x] | S12-03 | P2 | ``routes/agent.js:451`、`tips.js:17`、`market.js:1029`` | 「同一钱包同一件东西只付一次」只对打赏做了钱包归一，下载没有：WebUI 下载记 `packet_downloads(account_id=人)`，Agent 再下载同一条记 `(agent_id)`，两条命中不了彼此的 `prior` 检查，同一钱包为同一份附件付两次 | 已修 |
| [x] | S12-04 | P2 | ``routes/web.js:556`、`831`、`858`` | 三条按账户的全量查询没有 `LIMIT`：`/submissions` 返回该账户全部 WebUI 提交（含 `detail`、`videos`、全部列）并按 `created_at DESC` 全排序，再为每一行批量取附件；`/stars` 同理；`/friends` 无上限 | 已修 |
| [x] | S12-05 | P2 | ``routes/web.js:103`（`contentGate`）、`220`、`748`；`routes/home.test.js:88`` | WebUI 的门禁分支一条都没测：`contentGate` 在 `guestBrowsing=false` 时回 401 `no_session`（文档 §1 逐条列出了受影响的 8 条路径）、`/admin-handoff` 的 401 `no_session` / 403 `not_admin` / 503 `admin_unconfigured`、`/intel/:id/close` 的 403 `not_admin`、`PATCH /profile` 与上传路由的 401，全部没有用例 | 已修 |
| [x] | S12-06 | P2 | ``retrieval.test.js:37`、`retrieval.test.js:52`` | 检索是付费服务，本片对它的测试只覆盖提示词排版、空查询、`existingResponseId`；文档明确承诺的「同一句重复提交返回同一个 wish 与 job」与「价格随响应返回」没有任何用例，`createRetrieval` 的 wish 落库、job 建行、`retrievalRatePerHour` 限流（`agent.js:545`）也无覆盖 | 已修 |
| [x] | S12-07 | P3 | ``routes/admin.js:191`、`routes/adminPage.js:24`` | 「内网限定」用的是 `req.socket.remoteAddress`；实例前面只要有一层本机反代（入口隧道的设计就是把远端请求落到 `127.0.0.1:8080`），这个值恒为回环，判定必然放行。`index.js:58` 设了 `trust proxy 1` 但两处守卫都没用 `req.ip` | 已修 |
| [x] | S12-08 | P3 | ``routes/xknot.test.js:110`` | `/xknot/apply` 的成功用例会真的跑 `ssh-keygen`：`deliverPublicKey` 没有可注入的 exec，测试只 stub 了 `globalThis.fetch`。且 `admin.js:266` 用 `.catch()` 吞掉这把钥匙交付的失败，这条 201 用例即使公钥一个字节都没交上去也照样通过 | 已修 |
| [x] | S12-09 | P3 | ``searchCache.test.js:38`` | 用例名声称验证「命中后挪到队尾，最老的先淘汰」，实际从未触及 `MAX_ENTRIES=500`，`cacheSet` 里 `while (store.size > MAX_ENTRIES)` 的淘汰分支零覆盖；注释也自认「这里只验证顺序语义」 | 已修 |
| [x] | S12-10 | P3 | ``sponsors.js:105`` | 先 `SELECT count(*), max(position)` 再 `INSERT`，两步之间没有事务或锁：并发签发可以越过 `SPONSOR_LIMIT`（8），`position` 也会取到同一个 `max+1` 而重复 | 已修 |
| [x] | S12-11 | P3 | ``routes/admin.js:707-750`` | 开关、签发邀请码、停用邀请码都是「先改业务状态，再写 `admin_actions`」。审计写失败时响应 500，但配置已经生效、邀请码已经可用：管理端看到失败，线上已经变了，还留不下操作记录 | 已修 |
| [x] | S12-12 | P3 | ``system.js:119`` | `saveSystemPolicy` 用进程内 `current` 做读改写：`const next = { ...current, ...patch }`。两个并发 PATCH（一个改 `registrationMode`、一个改 `guestBrowsing`）会互相覆盖，后写的一方把前一次的变更从库里抹掉 | 已修 |
| [x] | S12-13 | P3 | ``sharePoster.js:439`、`sharePoster.js:36`` | `widthCache` 是模块级 Map，键是「字号+字重+任意文本」（称呼、类别、站点名、附件名），只增不减；海报每画一次就可能新增 N 条，进程会随长尾文本持续占用内存。另外 `shareSite()` 每次调用都同步 `readProfileSync` 读 `profile.json`，而它被 `shareMetaKey` 在每次取图时调用 | 已修 |
| [x] | S12-14 | P3 | ``routes/agent.js:44`` | `feedbackAt` 只写不删（仅发送失败时 `delete`），每个提交过反馈的账号在 Map 里留一条，永不清理：常驻进程里的无界状态 | 已修 |
| [x] | S12-15 | P3 | ``tunnel.js:149`` | 托管段只有 START 没有 END 时（文件被手工截断、写入中途断电）会走「追加一段」的分支，`tunnel.env` 里出现两段 `KNOT_TUNNEL_*`；后续每次写入都保着这两段，shell 下 source 时以最后一段为准，`changed` 判定也跟着失真 | 已修 |
| [x] | S12-16 | P3 | ``searchIndex.js:74`、`searchIndex.js:58`` | 回填是逐行的 SELECT + `readExtract` + UPDATE，且每行都重新 `loadBootstrapConfig()`；`reindexSearch` 在本片和全仓都没有测试（唯一调用点是 `scripts/reindex-search.mjs`），`ANALYZE intel` 也在逐行提交之后单独跑 | 已修 |
| [x] | S13-01 | P2 | ``knot-platform/backend/src/admin.test.js:1502`` | 管理面没有一条 HTTP 403 断言：拒绝只在内部函数层按 `error.code` 校验 | 已修 |
| [x] | S13-02 | P2 | ``knot-platform/backend/src/admin.test.js:588`` | 内网门（非内网一律 404）只在纯函数层被测，路由中间件那一步从未执行 | 已修 |
| [ ] | S13-03 | P2 | ``knot-platform/backend/src/admin.test.js:588-621`、`:1082-1125`、`:1127-1188`` | `/api/admin` 约 35 个端点只有 9 个有 HTTP 用例，权限最敏感的几条一个都没有 | 部分 |
| [ ] | S13-04 | P2 | ``knot-platform/backend/src/admin.js:396-401`、`:531-534`、`:614-624`、`:899-900`` | 审计行与业务变更不在同一事务，失败会留下半完成状态；测试把所有 `admin_actions`/`notifications` 的 mock 都设成成功，这条路径零覆盖 | 部分 |
| [x] | S13-05 | P2 | ``knot-platform/backend/src/admin.js:637-670`` | 发积分没有幂等键也没有行锁，用例名 "grant adds the amount once" 只证明了单次调用 | 已修 |
| [x] | S13-06 | P2 | ``knot-platform/backend/src/admin.js:903-928`` | 巡查的水位线 + LIMIT 40 会永久漏审；测试只覆盖空队列 | 已修 |
| [x] | S13-07 | P2 | ``knot-platform/backend/src/admin.test.js:1568`` | `admin_actions.action` 的文档枚举漏了 `retire` | 已修 |
| [x] | S13-08 | P3 | ``knot-platform/backend/src/admin.js:342`` | `action='config'` 同时承载"站点开关"和"改资料"两种语义，文档只写了前者 | 已修 |
| [x] | S13-09 | P3 | ``knot-platform/backend/src/admin.test.js:717-746`` | 断言过弱：economy 的注意力计数恒为 0，禁言期限只断非空 | 已修 |
| [x] | S13-10 | P3 | ``knot-platform/backend/src/routes/admin.js:558-565`` | 读内部 Agent 的明文令牌不留任何记录，测试只断言 200 与 `no-store` | 已修 |
| [x] | S13-11 | P3 | ``knot-platform/backend/src/admin.test.js:38`` | 真实测试员账号 id 被当假帖子 id 硬编码；其余无凭据泄漏 | 已修 |
| [x] | S14-01 | P0 | ``uploadStore.js:150-152`；`routes/web.js:167-175`、`385-399`、`506-507`` | 非图片上传（`kind` 为 audio/file）既不做内容校验，也不归一 MIME：客户端 multipart 里的 `Content-Type` 原样入库。`/api/web/audio` 的过滤器按**扩展名**放行（`isAudioUpload`），于是「文件名 `.mp3` + `Content-Type: text/html` + HTML 正文」能通过；`GET /api/web/uploads/:id` 用 `res.type(row.mime)` 内联回源。音频会写进 `intel_files`，公开帖上的音频被 `mediaAudience` 判为 `public`，任何访客/管理员打开该 URL 就在站点同源执行脚本（Cookie 是 HttpOnly，但可代受害者调接口、以管理员身份操作） | 已修 |
| [x] | S14-02 | P2 | ``videoPoster.js:9-42`` | `publicUrl` 的私有地址判断只覆盖 `::1`、`fe80:`、`fc`、`fd`，漏掉 `::`、IPv4-mapped `::ffff:a.b.c.d`、NAT64 `64:ff9b::/96`、6to4 `2002::/16`；且先 `lookup()` 校验、再由 `fetch()` 二次解析，存在 DNS rebinding 窗口。结合 `resolveVideo` 的落地页解析，后端会被引去抓内网地址。同一函数还有死分支：`URL.hostname` 对 IPv6 字面量保留方括号，`net.isIP("[::1]")` 返回 0，所有 IPv6 直链都走 DNS 查询失败被拒（注释声称处理了 IPv6） | 已修 |
| [x] | S14-03 | P2 | ``videoPoster.js:88-111`` | `readHtml` 先把整个响应体读进内存再截断，没有 `Content-Length` 或流式上限；重定向分支与 `!response.ok` 分支都不 `cancel()` 响应体，连接不复用；每跳 4 秒、最多 4 跳，发布路径最长阻塞约 16 秒。同一条视频 URL 在 `resolveVideo` 与 `assertReachable`（`links.js:79`）各抓一次 | 已修 |
| [x] | S14-04 | P2 | ``uploadStore.js:155-163`；`107-118`` | 配额是「先查后写」：`SELECT sum(size)` 与 `INSERT` 不在一个事务里，也没有锁或约束。同一钱包并发 N 个上传各读到同一 `used`，全部通过，实际用量可超上限 N 倍；Agent 与主人共用额度时同样成立 | 已修 |
| [x] | S14-05 | P2 | ``uploads.js:147-195`` | `acceptAvatar` 原地改写既有 `uploads` 行（`storage_name`、`mime`、`size`、`sha256`、`width`、`height`）并删除旧文件，但不检查该行是否已被帖子引用。把一张旧帖图设为头像，会让那条帖子的图片变成 512×512 裁图，原件不可恢复；`uploads.sha256/size` 与 `intel.content_hash` 从此对不上，审计与去重口径失真 | 已修 |
| [x] | S14-06 | P3 | ``uploadStore.js:210`；`routes/web.js:450-467`` | 所有 `kind` 都返回 `/api/web/uploads/{id}`。附件的 `original_name` 命中 `isAttachmentUpload` 时 `readableUpload` 直接返回 null，所以 `/api/web/files` 与 `/api/agent/uploads` 给附件返回的 `url` 恒为 404，而文档把它写成正常返回字段 | 已修 |
| [x] | S14-07 | P3 | ``wish.js:20-27`；`discoverBoard.js:260-268`` | `wishLive` 为旧行兜底 `created_at + 24h`，但公开快照的到期扫描只匹配 `expires_at` 非空的行。`expires_at IS NULL` 的 wish 到期不会触发快照重写，会留在 `discover.json` 直到别的内容变动，与文档「到期后一分钟内重写」不符。另外注释写「018 迁移前」，本仓库只有 `001_accounts.sql`，`intel.expires_at` 本就在基线里 | 已修 |
| [x] | S14-08 | P3 | ``xknotJoin.js:60-90`` | `applicationPayload` 先把 `email` 截到 120 码点，`missingFields` 再对截断后的值跑正则。超长邮箱会被截成一个「看起来合法」的地址交给中枢，申请里的联系方式是错的，本地也不报错 | 已修 |
| [x] | S14-09 | P2 | ``uploads.test.js:12-41`；`uploadStore.test.js:126-149`；`wish.test.js:27-32`；`videoPoster.js`（无测试文件）` | 高风险路径没有断言：非图片上传的 MIME 是否归一（S14-01 那条路径零覆盖）；`acceptAvatar` 只测 happy path，没有「不是本人上传」「该 upload 已被帖子引用」；`wishLive` 只对 SQL 字符串做正则，不验证 NULL 兜底与到期边界；`readHtml`/`resolveVideo` 的重定向、超大响应、失败分支没有任何测试 | 已修 |
| [x] | S14-10 | P3 | ``uploads.js:74-133`` | `imageSize` 只读文件头（PNG 只要求 24 字节），`avatarBufferError` 因此可被「24 字节伪造 PNG + 声称 64×64」通过，与上传入口用 sharp 真解码的口径不一致；也不校验像素上限。后果限于坏头像，不越权 | 已修 |
| [x] | S15-01 | P2 | ``knot-platform/docs/KNOT_DATABASE.md:7`` | 开头称 `UPLOAD_DIR` 默认 `data/uploads`，与同一文件 237 行、配置生成器、`CONFIG.md` 三处冲突。照第 7 行排查会在仓库里找一个不存在的目录 | 已修 |
| [x] | S15-02 | P2 | ``knot-platform/docs/KNOT_WEB_API.md:17`、`:18`` | `/api/web/session` 与 `/api/web/home` 的字段清单都没写 `agentDoc`。WebUI 里 Agent 指引进址必须从这两个接口拿（规则明确不许页面拼 `location.origin`），漏写会让实现方自己去拼 | 已修 |
| [x] | S15-03 | P2 | ``knot-platform/docs/KNOT_WEB_API.md:147-153`` | 错误码表按 HTTP 分行列举，却缺整档 404 与 429，也缺多个在用的 400/503 码。客户端照表写错误分支会漏掉最常见的一类失败 | 已修 |
| [x] | S15-04 | P3 | ``knot-platform/docs/KNOT_WEB_API.md:40`` | `/api/web/intel` 入参表列了 12 项，没有 `revises`；后端接受它（改自己的 post/fastpost），根 `KNOT_HELP.md` 也写了同一字段。同一能力两扇门文档不一致 | 已修 |
| [x] | S15-05 | P3 | ``knot-platform/docs/KNOT_PROJECT_PLAN.md:44`` | 把管理员邮箱写成「初期为 `manwjh@gmail.com`」。schema 里该项缺省是空串且 `required: true`，实例取值应写在 `sites/<站点>/site.env`，不进版本库文档；照着写会把个人邮箱固化成「默认值」 | 已修 |
| [x] | S15-06 | P3 | ``knot-platform/docs/KNOT_PROJECT_PLAN.md:132-150`` | 第 9 节「Agent API」表只列 15 个端点，漏了上传三件套和通知两条。Agent 只读这一节会以为没有上传入口、取不到通知 | 已修 |
| [x] | S15-07 | P3 | ``knot-platform/docs/profile-sections.svg:6-8`` | 该 SVG 的 `<title>`、`<desc>` 里混入 59 个非法 UTF-8 字节（`d9 b9 63 48 84 24 57 1a …`）。图内 16 个 `<text>` 正常，但 `aria-labelledby="title desc"` 指向的内容是乱码，读屏与检索拿到的是替换字符；工具链（`file`/diff/部分渲染器）把整份当二进制，`S15.tsv` 也标成 `binary 0 行` | 已修 |
| [x] | S16-01 | P1 | ``knot-platform/ops/scripts/deploy-site.sh:124`、`:250`、`:282`、`:371`；`knot-platform/ops/scripts/build.sh:105`` | 发布目录名取自发布包内的 `BUILD.json`，只校验非空、不校验字符集，随后直接拼进路径交给 `rm -rf` 和 `ln -sfn`。`release` 写成 `../../x` 会删掉部署根之外的目录，`current` 也会指向外部 | 已修 |
| [x] | S16-02 | P1 | ``knot-platform/ops/scripts/deploy-site.sh:272`–`:286`；`knot-platform/ops/scripts/backup-knot.sh:91`；`knot-platform/ops/scripts/ensure-openclaw.sh:56`–`:80`` | 整条部署链没有任何互斥锁（`ops/scripts` 下没有 `flock`/锁目录）。两个部署同时跑同一条发布包时共用同一个 `REL_DIR`：A 的 `rm -rf "$REL_DIR"` 会删掉 B 刚 `mv` 进去的目录，B 的 `ln -sfn` 又可能指向已被删除的目录，launchd 一旦重启就是崩溃循环 | 已修 |
| [x] | S16-03 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:272`–`:286`、`:333`` | 同名发布包重装时，`rm -rf "$REL_DIR"` 发生在停服务（`:333`）之前，删的正是当前在跑的那一份代码目录；且「解包 → 删旧 → mv」不是原子替换，中途中断会让 `current` 指向不存在的目录 | 已修 |
| [ ] | S16-04 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:250`、`:371`、`:544`–`:556`；`knot-platform/ops/launchd/com.knot.platform.plist:8`` | `--site` 只区分配置目录，运行实例（`current`、`releases/`、`deployed.json`、`var/run/backend.pid`、LaunchAgent label `com.knot.platform`）按部署根共用。同一部署根下两个站点会互相顶掉：部署 B 把 A 的 `current` 也切走，A 的服务重启后跑的是 B 的代码；`KNOT_DEPLOY_KEEP` 清理只保护「本站点」的 current 与 previous，另一个站点的活动版本会被当旧包删掉 | 部分 |
| [x] | S16-05 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:332`–`:441`` | 停服务之后、起服务之前全是 `set -e` 直落的步骤（storage 布局迁移、切 `current`、写 `platform.env`、`config check --platform`、装 unit、`chmod`）。任一步失败脚本直接退出，没有 trap 收尾，站点保持停止且 `current` 可能已切到新版本 | 已修 |
| [x] | S16-06 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:458`–`:468`` | 探活发现运行中的 release 与本次安装的不一致时只 `knot_warn`，随后照常打印 `OK` 并写 `deployed.json`。旧进程占着端口时，部署被记为成功，实际跑的是旧代码 | 已修 |
| [x] | S16-07 | P2 | ``knot-platform/ops/openclaw/apply-config.mjs:188`–`:192`；`knot-platform/ops/scripts/config.mjs:205`–`:207`` | 覆盖 `~/.openclaw/openclaw.json` 用的是「写临时文件再 `rename`」，临时文件没给 mode，`rename` 会把整份配置的权限换成缺省 `0644`；这份文件里有 gateway/auth 等本机凭据。`config.mjs` 的 `writeOut` 同样是先 `writeFileSync` 后 `chmod`，新建 `platform.env` 时有一个 `0644` 窗口 | 已修 |
| [x] | S16-08 | P2 | ``knot-platform/ops/openclaw/agents/knot-intel/tools/read-lib.mjs:24`–`:57`、`:288`–`:302`` | 手写 zip 解析只信任中央目录里的 `compSize`，对解压结果没有任何上限：一个 49 MB 的 docx（限值 50 MB）可以解出数 GB，撑爆评审智能体进程；PDF 也按页数全量取文本，没有页数上限 | 已修 |
| [x] | S16-09 | P2 | ``knot-platform/ops/openclaw/agents/knot-admin/AGENTS.md:48`–`:52`、`:18`；`knot-platform/ops/openclaw/agents/knot-admin/ORDERS.md:3`；`knot-platform/ops/scripts/ensure-openclaw.sh:114`–`:137`` | 管理员智能体有删帖、警告、发积分、禁言、改等级、签发内部 Agent、改站点开关的完整权限；每天 09:00 的巡查由模型自行判断「违法、欺诈、隐私、骚扰」并直接删帖+警告，没有人工复核；`ORDERS.md` 把对话里的一句「以后都…」变成无人值守 cron 长期执行的删除规则 | 已修 |
| [ ] | S16-10 | P2 | ``knot-platform/ops/scripts/ensure-openclaw.sh:104`–`:110`；`knot-platform/ops/openclaw/skills/knot-admin/admin.mjs:277`–`:286`；`knot-platform/ops/openclaw/agents/knot-admin/USER.md:7`` | 管理与精算两个智能体共用同一把 `KNOT_ADMIN_TOKEN`，并各自落在同一 OS 用户的工作区里；`knot-intel` 处理的是外部提交的不可信文本，却与这两个目录同用户、同父目录，权限模型上没有任何隔离。而 `USER.md` 把「操作这台机器上 OpenClaw 的人」一律当主人 | 暂缓 |
| [x] | S16-11 | P2 | ``knot-platform/ops/scripts/backup-knot.sh:47`、`:232`–`:238`` | 保留策略按目录数、不分快照类型。`--config-only` 与全量快照同名同目录，升级前习惯性跑几次只含配置的快照，就能把唯一一份含 `knot.dump` 的全量快照挤出 `KEEP` 之外删掉 | 已修 |
| [x] | S16-12 | P2 | ``knot-platform/ops/scripts/ensure-knot-postgres.sh:20`–`:21`、`:25`` | 本机库用 `initdb --auth-local=trust --auth-host=trust` 建，超级用户 `knot` 无口令；实例主机上任何本地用户都能直接连库读到全部内容（会话、令牌哈希、私信、附件元数据），而实例主机是多人共用的开发机时更明显 | 已修 |
| [ ] | S16-13 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:1`–`:550`；`knot-platform/ops/scripts/backup-knot.test.mjs:61`–`:75`` | 风险最高的 550 行部署脚本（`rm -rf`、切换 `current`、KEEP 清理、迁移失败/探活失败回滚）没有任何自动化测试；备份测试全程只跑 `--config-only`，`pg_dump`、上传目录、全量 KEEP 清理都不在执行路径上 | 暂缓 |
| [x] | S16-14 | P3 | ``knot-platform/ops/openclaw/apply-config.mjs:172`–`:181`` | 授权码目录的兜底路径少一层：`root` 是 `ops/openclaw`，`path.join(root, "../sites")` 得到 `ops/sites`，而真实目录是 `<deploy>/sites/<站点>/agents`。`KNOT_AGENT_ENV_DIR` 未设时会读不到，ENOENT 又被静默吞掉，内部 Agent 于是没有 `.knot-agent.env`，同步照样报成功 | 已修 |
| [x] | S16-15 | P3 | ``knot-platform/ops/openclaw/agents/knot-admin/AGENTS.md:11`` | 指令层写「`label` 为 `platform` 的账户不能禁言」，实际字段是 `role`（`SKILL.md:20` 与后端 `assertNotPlatform` 都用 `role`）。智能体按 `label` 去判会判空，对平台账户照常发起禁言，只能靠后端 409 `protected` 兜住 | 已修 |
| [x] | S16-16 | P3 | ``knot-platform/ops/scripts/ensure-tester.sh:35`–`:42`` | 测试员 SID 未转义直接拼进 SQL，并被写成十年有效会话；SID 里只要有一个单引号，整段 SQL 就断（脚本没有校验会话值形态） | 已修 |
| [x] | S16-17 | P3 | ``knot-platform/ops/openclaw/skills/knot-admin/admin.mjs:226`、`:311`–`:327`` | `upload` 只按扩展名猜 MIME，不在 `IMAGE_TYPES` 里的一律交 `application/octet-stream`，与 SKILL.md「只收 JPEG、PNG、GIF、WebP」不一致；被后端 `bad_mime` 拒后 `HINTS` 里也没有对应解释，智能体只能原样报错 | 已修 |
| [x] | S16-18 | P3 | ``knot-platform/ops/scripts/ensure-openclaw.sh:99`–`:103`` | `platform.env` 里若已有空的 `KNOT_ADMIN_TOKEN=`（手改或中断写入），判断不通过就追加第二行；随后 `head -1` 取到的是**空值**，两个工作区的 `.admin-token` 被写成空文件，管理与精算智能体全部不可用，且不改回 | 已修 |
| [x] | S16-19 | P3 | ``knot-platform/ops/openclaw/agents/knot-intel/tools/read:3`；`knot-platform/ops/openclaw/skills/knot-admin/admin:3`；`knot-platform/ops/openclaw/skills/knot-actuary/actuary:3`` | 三个包装脚本都没有 `set -euo pipefail`，`dir="$(cd "$(dirname "$0")" && pwd)"` 失败时 `dir` 为空，下一行会把 `/read.mjs`、`/admin.mjs` 交给 node，报的是「模块找不到」而不是真实原因 | 已修 |
| [x] | S16-20 | P3 | ``knot-platform/ops/scripts/audit-knot-storage.sh:29`` | `find … -exec stat -f%z {} +` 只用 BSD 语法。项目支持 Linux + systemd 实例主机，在那边这一行恒报错并被 `2>/dev/null` 吞掉，汇总永远显示 `0.0 MB`，巡检结论失真 | 已修 |
| [x] | S16-21 | P3 | ``knot-platform/ops/entry/sshd-knot-tunnel.conf:4`–`:5`；`knot-platform/ops/entry/README.md:53`` | 仓库里的「成品」用通用账号名 `knot-tunnel` + 固定 `18080`，而 README 与 `ops/README.md:504` 都要求「一个子域一个账号、一个回环端口」。照着这份成品装第二台实例时，两份 `Match` 会抢同一个账号与同一个 `PermitListen` | 已修 |
| [x] | S16-22 | P3 | ``knot-platform/ops/entry/site.conf.template:77`、`:110`` | 入口在 Cloudflare 后面（模板里读 `$http_cf_ipcountry`），但没有 `real_ip`/`set_real_ip_from`，`X-Real-IP` 与追加的 `X-Forwarded-For` 记的是 Cloudflare 边缘地址。后端按 IP 做的限流、封禁与审计都会退化成「一个 CF 网段」 | 已修 |
| [x] | S16-23 | P3 | ``knot-platform/ops/openclaw/apply-config.mjs:102`–`:106`` | 每个内部 Agent 的 `allowAgents` 被设成「其余全部内部 Agent」，与 `bravesearch` 自己的边界（不把任务交给 `knot-intel`/`knot-admin`）相反，等于给每个签发出来的账户开了互相委派的口子 | 已修 |
| [x] | S17-01 | P1 | ``reset-knot.sh:63`` | 重建脚本第一句就删暂存区。上一次重建若在 `DROP SCHEMA public` 之后、回灌之前失败，账号、会话、授权码、头像的唯一剩余副本只在 `knot_keep` 里；脚本自己的异常文案就是让人"修好再重跑"，而重跑第一步把这份副本删掉。全程没有 `pg_dump`。 | 已修 |
| [x] | S17-02 | P1 | ``push-entry.sh:130`（`:109`、`:122`、`:148`）；`push-discover.sh:57`` | 推入口用固定的远端 `/tmp` 名字中转，再由 root 装进系统目录。一台入口主机服务多个子域时，两个站点的推送共用同一份暂存目录，后到的覆盖先到的；`/tmp/knot-web/` 里可能是另一个站的 dist，带 `--delete` 直接落进本站静态根。`/tmp` 里其他人也可预置/替换，而安装动作是 `sudo`。全流程无锁。 | 已修 |
| [x] | S17-03 | P2 | ``reset-knot.sh:62`（`:295`、`:330`）` | 三处 `psql "$DATABASE_URL"` 都不校验非空。`set -u` 只拦"未定义"，拦不住"定义为空"：空串等于 libpq 全默认（本机 socket + 系统用户 + 默认库），此时 `DROP SCHEMA public CASCADE` 打在哪套库上取决于环境。 | 已修 |
| [x] | S17-04 | P2 | ``reset-knot.sh:287`（`:295`、`:367`）` | 破坏性重建没有失败保护：`DROP SCHEMA public CASCADE` 后任意一步失败（migrate.js、回灌、ensure-tester），`set -e` 直接退出，`restart_backend` 不会执行，站点停在"后端已停 + 库为空"；也没有自动回灌路径。 | 已修 |
| [x] | S17-05 | P2 | ``push-entry.sh:177`（`:186`、`:114`、`:124`）` | nginx 配置"先落地再校验"：`sudo cp` 覆盖 `$CONF` 后才 `nginx -t`。测试失败（证书未签、语法错、端口冲突）时坏 conf 已留在 `conf.d/`，运行中的 nginx 还是旧配置，但下一次任何 reload（证书续期、别人推入口）都会失败。`knot-log.conf` / `knot-cache.conf` 连 `nginx -t` 都没有。 | 已修 |
| [x] | S17-06 | P2 | ``push-entry.sh:174`；`push-discover.sh:54-55`` | `KNOT_ENTRY_WEB_ROOT` 的缺省 `/var/www/knot` 在同一台入口主机上被所有站点共享。新站点漏写这一项时，`knot_entry_value` 会回落到该默认值，`sudo rsync -a --delete` 把这个目录清成自己的 dist。`push-discover` 的兜底判断是死代码——第一个取值已经带回默认值，永远不会为空。 | 已修 |
| [x] | S17-07 | P2 | ``push-deploy.sh:243`（`:251`、`:147`）；`join-xknot.sh:172`` | 凭据文件都是"先写内容、后 chmod 600"。`cat > file && chmod 600` 与 `config.mjs --out ...; chmod 600` 之间，文件按 umask（通常 644）存在，内容含 `DATABASE_URL` 与委托发信令牌；远端是多人共用的实例主机时，这个窗口能被本机其他用户读到。部署根的 `cp` 那处同样。 | 已修 |
| [x] | S17-08 | P2 | ``join-xknot.sh:166`` | `--dry-run` 声称不改文件，实际把接入件真值写进 `$JOIN_ENV.dryrun`：没有先 `chmod 600`，只在成功路径上 `rm -f`。`config.mjs` 报错（键缺失、格式不对）时留下一个含令牌的 `.dryrun` 文件，脚本也没有 trap 清理。 | 已修 |
| [x] | S17-09 | P2 | ``rollback.sh:165`` | 回滚只把 `current` 指过去并重启，探活 30 秒失败就退出，`current` 仍停在"刚切过去的版本"，既不回到 `$CURRENT_NAME` 也不提示手工命令。一次坏回滚把站点留在坏版本上。 | 已修 |
| [x] | S17-10 | P2 | ``migrate-profile.mjs:176`（`:279`）` | 读 `profile.json` 的 `catch` 把"JSON 解析失败"与"文件不存在"当成一回事。主理人手工编辑出一个尾逗号后，脚本按"没有档案"重新生成并覆盖原档案，站点名称、介绍、主理人被 `site.env` 旧值替换。 | 已修 |
| [x] | S17-11 | P2 | ``migrate-profile.mjs:263`（`:280`、`:216`）` | 一次性迁移就地覆盖 `site.env`、`platform.env`：`writeFileSync` 非原子（不写临时文件再 rename），也没有备份。中途失败或磁盘满会留下被截断的站点配置，而 `platform.env` 是运行时唯一来源。 | 已修 |
| [x] | S17-12 | P2 | ``push-deploy.sh:255`（`:261-267`、`:214`）` | 远端命令用单引号把变量拼成一段 shell 文本。`REL_NAME` 来自发布包文件名，含 `'` 就能跳出引号在实例主机上以部署用户执行任意命令，紧随其后是 `rm -rf "$INCOMING"`。同一主机并发部署时 `.incoming/$REL_NAME` 是同一路径，先到的解包目录会被后到的删掉，全流程无锁。`REMOTE_HOME` 取远端 stdout 整段也不校验，登录 banner 会被当成路径的一部分。 | 已修 |
| [x] | S17-13 | P2 | ``push-deploy.sh:285`` | 远端健康检查失败只报错退出，`current` 已指向新版本，不回滚到部署前的版本（`deploy-site.sh` 只在迁移失败时回滚）。线上就是 502 直到有人手工跑 `rollback.sh`。 | 已修 |
| [x] | S17-14 | P2 | ``retag-topics.mjs:74`（`:64`）` | 一次把所有带 topics 的 `intel` 行整表读进内存（SQL 无 `LIMIT`，`--limit` 只是 JS 侧切片）；`--limit abc` 被 `Number(...) \ | 已修 |
| [x] | S17-15 | P2 | ``knot-backup.service:6`` | 备份单元是 oneshot，没有 `TimeoutStartSec`/`RuntimeMaxSec`、没有 `OnFailure=`、没有产物检查。`pg_dump` 卡在锁上时单元一直 active，之后每天的 timer 触发被 systemd 忽略，备份静默停摆，失败也无人知晓。 | 已修 |
| [x] | S17-16 | P3 | ``rollback.sh:141`；`reset-knot.sh:29`` | "用哪种运行时"靠 `var/run/backend.pid` 是否存在推断。从 `--runtime none` 切到 launchd/systemd 后残留的 pid 文件会让脚本走手工路径：kill 一个早已不存在的 pid、删掉 pid 文件，而真正在跑的服务不受影响——`current` 已换但进程没重启；在 reset 里更糟，systemd 的 `Restart=always` 会把后端拉回来，接着对正在用的库 DROP。 | 已修 |
| [x] | S17-17 | P3 | ``local-login.sh:101`（`:112`）` | 把管理员会话 cookie 明文打到 stdout，`--url` 直接给出可用地址。这是设计意图，但输出常被贴进工单/聊天；限制只靠 `KNOT_PUBLIC_ORIGIN` 一个配置值，与 `KNOT_BIND_HOST` 的实际绑定无关。 | 已修 |
| [x] | S17-18 | P3 | ``local-login.sh:76`` | `KNOT_SESSION_TTL_DAYS` 未校验就作为 psql 变量拼进 SQL；`-v` 是文本替换，值里带 `)`/`;` 即可注入。来源是 `platform.env`（运维可写），风险低但机制成立。 | 已修 |
| [x] | S17-19 | P3 | ``render-config.mjs:55`` | 变量值原样替换，不做转义。站点配置里一个含 `;` 或换行的值就能给 nginx 配置注入额外指令（自由文本键最容易）。变量名拼错会报错，这一点是对的；值本身没有任何约束。 | 已修 |
| [x] | S17-20 | P3 | ``lib/site-config.sh:68`；`migrate-profile.mjs:148`` | 站点名校验只排除"含非法字符"，`.` 与 `..` 都能通过，而站点名随后被直接拼进 `$KNOT_SITES_DIR/$KNOT_SITE`、远端 `sites/$KNOT_SITE`。`--site ..` 把站点目录指到部署根，`--site ../../x` 把文件写到 `sites/` 之外。 | 已修 |
| [x] | S17-21 | P3 | ``lib/site-config.sh:303`` | `sed` 替换串里的 `&` 与分隔符 `\ | 已修 |
| [x] | S17-22 | P3 | ``join-xknot.sh:87`` | `mask()` 对长凭据显示前 8 后 4 共 12 个字符，`--status` 的输出又常被贴进工单。前缀不敏感，但后 4 位属于真随机段。 | 已修 |
| [x] | S17-23 | P3 | ``knot-backend.service:20`` | `ReadWritePaths=__KNOT_HOME__/var` 只放开部署根的 `var/`。`UPLOAD_DIR` 是普通路径键，配到 `var/` 之外时后端在 `ProtectSystem=full` 下写不了，上传直接失败；部署脚本不校验这一点。单元也没设 `UMask`。 | 已修 |
| [x] | S18-01 | P1 | ``knot-platform/packages/knot-doc-reader/src/index.mjs:53`` | zip 解压没有任何尺寸上限：每个条目直接整份解压，条目数、单条解压后大小、总解压量都不看。上传一个 50 KB 的 docx 就能让进程申请几十 MB，按 50 MiB 附件上限可要求 GB 级内存，`inflateRawSync` 还是同步的，期间事件循环停摆 | 已修 |
| [x] | S18-02 | P1 | ``knot-platform/packages/knot-doc-reader/src/index.mjs:117`、`:137`` | xlsx 单元格列号来自文件里的 `r="…"`，没有任何上限，用来给行补空单元格。构造一个 `r="AAAAAAA"` 的单元格即可让同步 `while` 循环推 8.4e9 个空字符串：内存耗尽或长时间卡死 | 已修 |
| [x] | S18-03 | P1 | ``knot-platform/packages/knot-markdown/src/parse.js:603`` | 块引用按「剥一层 `>` 再递归」实现，没有深度上限。一行里写约 2000 个 `>` 就让 `parse` 抛 `RangeError`；`toHtml`/`parse` 的调用点在浏览器的 computed 里，且工程没有 `errorHandler`/`onErrorCaptured` 兜底，一条这样的帖子会让所有打开它的人渲染失败 | 已修 |
| [x] | S18-04 | P2 | ``knot-platform/packages/knot-doc-reader/src/index.mjs:8`、`:358`、`:321`` | `MAX_BYTES`（50 MB）只在 CLI 的 `allowedPath` 里检查。真实调用方 `backend/src/extracts.js:74` 自己 `readFile` 整个文件后直接调 `extractDocumentText`，完全绕过这道闸；库函数本身对入参长度不做任何判断 | 已修 |
| [x] | S18-05 | P2 | ``knot-platform/packages/knot-markdown/src/parse.js:183`` | 行内解析在每遇到一个强调符时都向全文重扫一遍找闭合，且 `pushText` 反复拼接同一个字符串节点，整体是二次以上。正文长度在 Backend 侧没看到上限，一条 2 万字符的帖子能让每个看到它的浏览器卡一秒以上，且每次重渲染重算 | 已修 |
| [x] | S18-06 | P2 | ``knot-platform/packages/knot-config/src/schema.mjs:1109`` | 「附件上限必须小于入口请求体上限」这条跨键约束实际上只对默认值生效：`KNOT_UPLOAD_ATTACHMENT_MAX_BYTES` 是 platform 键，而 `WARNINGS` 只在 `checkSite`（site.env）里跑；用户把附件上限调到 100 MB 时既不报错也不提醒，大文件在 nginx 被截断 | 已修 |
| [x] | S18-07 | P2 | ``knot-platform/packages/knot-config/src/schema.mjs:1361`` | 启动闸口不校验 `DATABASE_URL`：它是 `type: "string"`、无 `pattern`，`validateValue` 落到 default 分支直接放行；`external-db` 那条跨键规则只在 `checkSite` 跑。外部库连接串写错（缺主机、拼错端口、密码里有未转义字符）时进程照常启动，第一条 SQL 才失败 | 已修 |
| [x] | S18-08 | P3 | ``knot-platform/packages/knot-config/src/schema.mjs:1243`` | 公网入口文件是叠加层，允许覆盖 `SITE_KEYS`，但只对 `ENTRY_KEYS` 做类型校验。`KNOT_PORT=eighty` 写在 `entry.<域名>.env` 里静默通过，部署脚本按这个值渲染 nginx/隧道 | 已修 |
| [x] | S18-09 | P3 | ``knot-platform/packages/knot-config/src/schema.mjs:1414`` | `formatValue` 只转义反斜杠、双引号、`$` 与反引号，不处理换行与其它控制字符；值里带换行时写出的 env 文件被截成两行，读回时值被截断、后半行成了另一个键。值来自中枢接入件（`backend/src/issued.js:81` 先 `renderJoinFile` 再 `checkJoin`） | 已修 |
| [x] | S18-10 | P3 | ``knot-platform/packages/knot-doc-reader/src/index.mjs:15`` | XML 数字实体不校验码点范围，越界即抛 `RangeError`；外层只有一个笼统的 catch，于是一个畸形实体让整份文档变成 `unreadable` | 已修 |
| [x] | S18-11 | P3 | ``knot-platform/packages/knot-doc-reader/src/index.mjs:297`` | PDF 逐页抽取按 `pageCount` 循环，页数来自文件本身，没有上限；`getPageText` 是同步调用，声明页数虚高的 PDF 会长时间占住进程 | 已修 |
| [x] | S18-12 | P3 | ``knot-platform/packages/knot-photo-layout/src/index.js:132`` | 切行是 `2^(n-1)` 穷举，包内对图片张数没有上限，只靠调用方的 `MAX_IMAGES = 9`。20 张图就是 52 万次评估，纯同步计算 | 已修 |
| [x] | S18-13 | P3 | ``knot-platform/packages/knot-photo-layout/src/index.js:179`` | `planPhotoBoxes` 不校验 `width`，缺省时 `Math.round(row.height * undefined)` 得 NaN，`Math.max(1, NaN)` 仍是 NaN，坐标与整块高度全成 NaN 静默传给 sharp | 已修 |
| [x] | S19-01 | P1 | ``schema.mjs:1073`、`:1165`、`:1271`` | `external-db` 跨键规则永不触发：它在 `checkSite` 里读 `KNOT_DB_MODE`，而该键登记在 `platform.env`。外部库模式漏填连接串时，部署校验全绿，Backend 静默改连本机库——数据写进错误的库，且没有任何日志区分两者 | 已修 |
| [x] | S19-02 | P1 | ``schema.mjs:1414-1418`` | `formatValue` 判定「不必加引号」的字符集里包含 `$`、`(`、`)`、`\ | 已修 |
| [x] | S19-03 | P2 | ``schema.mjs:1109`、`:1094`` | 跨键告警的条件在错误的文件视图里求值，恒为假（已知线索复核成立，与 S18-06 同根因）。同类还有 `tunnel-same-port`：它要求 `KNOT_TUNNEL` 与 `KNOT_ENTRY_ENABLED` 同处 site.env，而文档规定的正规形态是把隧道写进 `tunnel.env`，那里不会被任何 WARNINGS 读到 | 已修 |
| [x] | S19-04 | P3 | ``schema.mjs:1204-1209`` | 入口文件是 site.env 的叠加层，但 `checkEntryFile` 只校验 `ENTRY_KEYS`（仅 `KNOT_ENTRY_SERVE` 一项）。`KNOT_ENTRY_SSL`、`KNOT_ENTRY_MAX_BODY`、`KNOT_ENTRY_CERT`、`KNOT_ENTRY_PROXY_PORT` 写进 `entry.<域名>.env` 后不做任何类型/取值校验（同根因见 S18-08） | 已修 |
| [x] | S19-05 | P2 | ``schema.mjs:601-605`、`:667-673`` | 价格三元组没有顺序校验，代码侧再做一次静默夹取，两边结果可以不同。`KNOT_COUPON_FACE` 的推导用未夹取的 `KNOT_DEFAULT_PRICE`，`points.js` 用的是夹进 `[min,max]` 之后的值 | 已修 |
| [x] | S19-06 | P2 | ``schema.mjs:1032-1041`` | `int`/`port`/`bytes` 只做 `/^\d+$/` 与 `Number()`，没有 `Number.isSafeInteger`；无 `max` 的键也没有任何上限。超出安全整数的值通过校验后进入金额、TTL 与日期运算 | 已修 |
| [x] | S19-07 | P2 | ``schema.mjs:103-111`、`:869-876`` | 同一语义有两个中枢地址、两套来源，彼此没有一致性校验：`KNOT_HUB_ORIGIN`（申请去哪个中枢）与 `XKNOT_HUB_ORIGIN`（联邦与委托发信用哪个中枢）默认值相同，掩盖了「申请在 A、发信去 B」的错配 | 已修 |
| [x] | S19-08 | P3 | ``schema.mjs:21-27`、`:479-523`` | `sites/<站点>/tunnel.env` 是实际存在的第五份配置文件（由 `/admin` 的 XKnot 栏写入），但登记表的四文件清单里没有它，`checkSite`/`checkPlatform`/`checkJoin` 也都不读它。隧道键写错只能等 `ssh -R` 失败 | 已修 |
| [x] | S19-09 | P3 | ``schema.mjs:1003-1012`、`:205-210`、`:304-311`` | `resolve` 在调用方没给 `ctx` 时会用空 `root`/`deployRoot` 拼出根目录下的绝对路径，得到一个合法但几乎一定错误的默认值，且不报错 | 已修 |
| [x] | S19-10 | P3 | ``schema.mjs:1226-1238`` | `checkEntryFile` 里两条「取不到路径」的闸口都不可达，真正该拦的（证书/私钥文件不存在、静态根不可写）没有检查 | 已修 |
| [x] | S19-11 | P3 | ``schema.mjs:269`` | `KNOT_DEPLOY_DIR` 的默认值在登记表（及由它生成的 CONFIG.md、site.env 模板）里是 `~/knot/site`，shell 库实际回落的是源码仓库路径 `~/knot/AgentLink/knot-platform`。省略该项时部署落到仓库目录，而文档说落到部署根 | 已修 |
| [x] | S19-12 | P3 | ``schema.mjs:415`、`:675`、`:1016-1024`` | `0` 的语义在不同层不一致：`size` 类型接受 `0`，`sizeToBytes` 返回 0 后跨键检查直接跳过；而 nginx 的 `client_max_body_size 0` 是「不限制」。同一组 TTL 里 `KNOT_SALE_TTL_HOURS` 是 `min: 1`，`KNOT_COUPON_TTL_DAYS` 却是 `min: 0`（允许发放立即过期的券） | 已修 |
| [x] | S20-01 | P1 | ``_template/entry.example.env:7,14,17`；`_template/site.env:95,97`` | 入口模板把 `KNOT_ENTRY_WEB_ROOT` 与 `KNOT_ENTRY_CONF` 留空，注释说「由部署脚本按这个子域使用」；实际没有按子域推导，回落到**同一台入口主机上所有子域共用**的 `/var/www/knot` 与 `/etc/nginx/conf.d/knot.conf`。第二个子域照模板留空部署时，`rsync --delete` 会清掉第一个子域的静态根，`cp` 会覆盖它的 nginx conf，前一个站点直接换品牌或停站。 | 已修 |
| [x] | S20-02 | P2 | ``_template/platform.env:116-117`` | 唯一进版本库的运行时配置样例里，把真实实例主机的内网地址当「例」写了两遍，等于把生产内网拓扑固化进公开仓库。 | 已修 |
| [x] | S20-03 | P2 | ``_template/site.env:74`；`ops/scripts/lib/site-config.sh:176`；`ops/README.md:117`` | `KNOT_DEPLOY_DIR` 的三处默认值不一致，且默认值不带站点名。同一份 `site.env` 少写这一行，shell 与 `config.mjs` 会算出两个不同部署根；两个站点照模板复制后共用同一个部署根（`releases/ current deployed.json var/uploads` 全共享），部署/回滚会串站。 | 已修 |
| [x] | S20-04 | P2 | ``_template/site.env:86,123`；`packages/knot-config/src/schema.mjs:1150-1156`；`ops/scripts/deploy-site.sh:482`` | 入口相关校验只有单向：`KNOT_ENTRY_ENABLED=1` 必须 `KNOT_TUNNEL=1`。反过来，`KNOT_DOMAIN` 非空、`KNOT_ENTRY_ENABLED=0`、又**没有** `tunnel.env` 时零报错；部署后的公网探活又只在 `KNOT_TUNNEL` 为真时执行，于是「本机好、公网 502」这种最误导的部署照旧静默通过。模板把两个开关写成互不相干的两行，还断言「接子域用 `KNOT_ENTRY_ENABLED=1`」，与 `CONFIG.md` 里「开发机接子域时可以是 0，隧道由中枢写」的口径相反。 | 已修 |
| [x] | S20-05 | P2 | ``_template/site.env:19,27`` | 对外地址把端口写死成 8080，端口却另有一行 `KNOT_PORT`；改端口时没有任何提示把两者对齐，两者之间也没有交叉校验。本机形态下公网探活分支为空，错了也发现不了：分享链接、邮件里的登录链接、sitemap 全部指向死端口。 | 已修 |
| [x] | S20-06 | P3 | ``_template/site.env:91`` | `KNOT_ENTRY_SSH_KEY` 默认 `$HOME/.ssh/id_rsa`。本仓库的入口主机运维规则明确写了 `id_rsa` 会被拒、要用专用 pem，所以照抄模板的人第一步就是 auth 失败；同时这是把个人主身份钥当部署钥用。 | 已修 |
| [x] | S20-07 | P3 | ``_template/entry.example.env:23`` | 四份模板里只有入口样例是手写的：没有生成函数、没有字节比对测试，已经漂了一条描述；下次改 `ENTRY_KEYS` 时它会静默落后。 | 已修 |
| [x] | S21-01 | P2 | ``composers/packet.js:4`、`routes/web.js:144`、`i18n/locales/zh-CN.json:419`` | 图片上限三处不一致：前端硬编码 5 MiB 并据此拒绝文件、文案写死「不能超过 5MB」，后端默认放行 8 MiB 且可用环境变量改。6–8 MiB 的图在浏览器里就被挡下，实例调大上限也不生效；文案与实例真实上限脱钩。 | 已修 |
| [x] | S21-02 | P2 | ``components/VideoFrame.vue:68`、`packet.js:90-103`` | 「跳到站外观看」分支把记录里的 URL 原样绑到 `:href`，`videoFrame()` 只判 `new URL()` 是否成功与文件名后缀，不判协议。今天三条写入路径（`web.js`、`agent.js`、`market.js`）都经 `videoItemsOf` 限死 http/https，所以现在打不通；一旦有别的写入/导入路径或校验回退，`javascript:` 链接会变成一次点击就能在站点源上执行的存储型 XSS。 | 已修 |
| [x] | S21-03 | P3 | ``boardCache.js:52`、`discoverBoard.js:5`、`stores/session.js:164`` | `clearBoardCache()` 没有任何调用点（全仓仅定义与测试引用）。退出登录只清 `user`，`knot.board` 快照与 `discoverBoard` 的模块级 `hidden` 集合都留着，同一浏览器换人登录后首屏仍画上一个人的快照状态、被 dismiss 的卡继续隐藏。内容本身是公开的，所以不是越权，只是状态串会话。 | 已修 |
| [x] | S21-04 | P3 | ``api.js:5`、`api.js:127-175`` | 两个小问题同源（同一个文件里的请求封装）：①`headers` 先合并、`...options` 后展开，调用方一旦传 `headers` 就把合并好的 `Content-Type` 整体顶掉；②同一类端点里 `encodeURIComponent` 有的加有的不加（`getInformation`/`reopen`/`tips` 加了，`dismiss`/`close`/`star`/`removeFriend`/`addCardFriend`/`download`/`share` 没加），id 一旦带 `/`、`?` 或 `#` 就打到别的路径上。 | 已修 |
| [x] | S21-05 | P3 | ``i18n/locales/*.json` `error`、`routes/web.js:224`` | 先说结论：三份 locale 各 403 个键，键集合完全相同、占位符也一致（`locale.test.js` 里有断言），模板里 `t("…")` 的静态键 270 个全部命中，没有漏键。唯一的口径缺口是「错误码 ↔ locale」没有对照：后端 64 个 `error:` 码里 `admin_unconfigured`（`/api/web/admin-handoff` 503）与 `bad_agent_type`（仅 Agent API）没有 `error.*` 键。实际影响接近 0——前者被 `MineView` 的 `mine.admin.failed` 专向兜住，后者不进 WebUI——但新加码会静默落成「请求没有完成」，没人会发现。 | 已修 |
| [x] | S21-06 | P3 | ``components/DownloadConsent.vue:31`、`index.html:2,6`、`i18n/locales/*.json` `nav.wish`` | 本切片模板里几乎全部文案都走了 `t()`（扫过所有 `.vue` 的文本节点，没有裸中文/英文），剩下三处零散：①下载确认把全角括号拼在 JS 字符串里，英文界面会出现中文标点；②`index.html` 的 `lang="en"` 与中文 meta description 是静态的，首帧被 `applyLang()` 覆盖但分享抓取读到的仍是英文声明+中文描述；③`nav.wish` 三份都写英文 `wish`，与同一功能的 `wish.title`「市场」不一致。 | 已修 |
| [ ] | S21-07 | P3 | ``CardShareDialog.vue:100-116`、`CardTipDialog.vue:166-177`、`ShareComposer.vue:229-253`、`SnapComposer.vue:177-185`、`MentionPicker.vue:57-64`、`AppButton.vue:17-21`` | 弹窗与编辑器里的主/次操作自绘皮肤，没走 `AppButton`：分享弹窗三个动作（`.card-share-action`）、打赏金额预设（`.tip-preset`）、分享条五个动作（`.share-action`）、快拍的提及触发器（`.mention-trigger`）、提及胶囊（`.mention-chip`）。这些不属于规则里明确豁免的导航/胶囊/`.post-action`，属于「另写一套按钮皮肤」。另外 `AppButton` 的 `to` 分支不接 `disabled`/`aria-disabled`，链接形态下禁用会静默失效。 | 部分 |
| [x] | S21-08 | P3 | ``PhotoGallery.vue:61-70`、`MentionPicker.vue:69-81`` | 图片格 9 个按钮共用同一个 `aria-label`（「查看大图」），读屏听不出是第几张；提及候选是一个 `role="listbox"` 的 `<ul>`，里面套 `<li><button role="option">`，`option` 不是 `listbox` 的直接子元素，语义链断了。图标按钮的 `aria-label`、装饰图标的 `aria-hidden` 其余位置都齐（含 `AppButton` 的 icon 变体、播放器、灯箱、顶栏）。 | 已修 |
| [ ] | S21-09 | P3 | ``discoverBoard.js:90-104`、`routes/web.js:811-812`、`docs/KNOT_WEB_API.md:96-97`` | 「点赞」是完整的一条链：后端 `POST/DELETE /api/web/intel/:id/like` 有实现、文档有写、公开快照与 `discover-self` 都回 `liked`，`applyDiscoverSelf` 也把它贴到每条卡片上——但 WebUI 没有入口，`api.js` 里没有对应函数，卡片模板也不渲染。等于每次快照都多带一个没人用、没人写的字段。 | 暂缓 |
| [ ] | S21-10 | P3 | ``InformationCard.vue:136-141`、`boardCache.js:29-36`` | 两条与体量有关的小开销：①信息流里每张卡各挂一个 `window.resize` 监听，回调里同步读 `scrollHeight`/`clientHeight`，30 张卡拖窗口就是 30 次强制重排；②`readBoardCache` 在首屏同步 `JSON.parse` 整份快照（30 条信息+图片宽高+wish），在低端机上会占住主线程。 | 部分 |
| [x] | S21-11 | P3 | ``SnapComposer.vue:33-63`、`composers/packet.js:4-9`、`packet.js:2-9`` | 同一套「预览图 objectURL 生命周期 + 上限常量」有三份：`usePacketMedia`（分享条/求购）、`SnapComposer` 自己一套（`clearPreviews`/`syncPreviews`），上限常量也有两份（`packet.js` 的 `PACKET_LIMITS` 与 `composers/packet.js` 的 `MAX_IMAGES`/`MAX_FILES`）。现在数值都是 9/1，改一处漏一处就会两边筛得不一样、下标错位。 | 已修 |
| [ ] | S21-12 | P3 | ``download/consent.js:61-75`、`download/consent.test.js`、`CardTipDialog.vue:111-130`` | 钱相关的两个交互没有测试：下载确认的状态机（`acceptDownload`/`settleDownload`/`dismissDownload`/`runTask`）只测了纯函数 `downloadOffer` 四条；打赏弹窗（改金额、并发摘要、成功后回写余额）没有任何测试。这两处恰好是「扣多少、扣没扣」的地方，回归只能靠手点。 | 部分 |
| [x] | S21-13 | P3 | ``download/consent.js:29-36`` | `settleDownload(true)` 在 `job.short` 为真时既不 `finish()` 也不改 phase，只 `return`；那条 `new Promise` 永远不会 resolve，界面停在 confirm 且没有任何提示。今天靠确认按钮 `:disabled="short"` 兜住，属于「UI 状态与 job 状态一旦不同步就悬挂」的防御缺口。 | 已修 |
| [x] | S21-14 | P3 | ``composers/cardDialog.js:22-28`` | `show()` 在 `onOpen` 之后 `await nextTick()`，回来只看 `dialog.value.open`，不看重试时记录是否还是同一条。若 `await` 期间 store 被清空（用户点开又立刻关掉/按 Esc），`watch` 里的 `closeDialog()` 先跑（此时 `open` 还是 false，空操作），随后 `showModal()` 把空弹窗打开。 | 已修 |
| [x] | S21-15 | P3 | ``adminEntry.js:21-26`` | 内网判断对内网 IPv6 的前 16 位做整数与运算，但压缩写法会算错：`fd::1`、`fc::1` 这类把 `fc00`/`fd00` 压成两三个字符的地址，`Number.parseInt("fd", 16)` 得 `0xfd`，与 `0xfe00` 相与为 0，被判成公网。界面会因此改口吻（提示「不在内网」），不改变后端放行，属于提示错误。 | 已修 |
| [x] | S22-01 | P2 | ``knot-platform/web/src/styles.css:1477`、`:1496`` | 首页发布框的同意勾选行文字强制不换行，列宽装不下时压到发送键上；360px 英文文案下右缘正好顶到视口 | 已修 |
| [x] | S22-02 | P2 | ``knot-platform/web/src/styles.css:115`、`:119`、`:161`` | 顶栏站点名用固定 `19.5rem`/`18.5rem` 预留两侧空间，与两侧实际宽度（约 90px + 132px = 222px）不符，手机上站点名被压到几乎不可读 | 已修 |
| [x] | S22-03 | P2 | ``knot-platform/web/src/styles.css:2895`` | 引用了未定义的 `--radius-md`，且无 fallback，该声明整条失效 | 已修 |
| [x] | S22-04 | P2 | ``knot-platform/web/src/styles.css:1214`、`:1588`` | 首页发布框的主输入在聚焦时既无 outline 也无任何替代视觉，键盘用户看不到焦点 | 已修 |
| [x] | S22-05 | P2 | ``knot-platform/web/src/styles.css:195`、`:3916`、`:3938`、`:4436`、`:1490`` | 手机上多处可点区域小于规则要求的 44×44，且没有 ≤480px 的补丁 | 已修 |
| [x] | S22-06 | P3 | ``knot-platform/web/src/styles.css:217`、`:1038`、`:1300`、`:1448`、`:2033`、`:3626`、`:3952`、`:4220`、`:4720` 等` | 调色板变量已定义，但仍有 112 处直接写死同色字面量，改主题时这些位置不跟随 | 已修 |
| [x] | S22-07 | P3 | ``knot-platform/web/src/styles.css:1372`–`:3445` 区间内 73 条规则` | 已删除组件的整段样式还留着，共 73 条规则、429 行 | 已修 |
| [ ] | S22-08 | P3 | ``knot-platform/web/src/styles.css:266`、`:289`、`:298`、`:321`、`:345`` | 顶栏搜索整套样式（`.header-search`、`.search-field`、`.search-backdrop`、`.search-sheet`、`.search-history`、`.search-recent`，以及 `:259` 的 `body:has(.release-note) .search-sheet`）当前永不渲染 | 不成立 |
| [x] | S22-09 | P3 | ``knot-platform/web/src/styles.css:413`、`:2171`、`:2206`、`:4637`` | 四处字号低于 12px，其中一处是对比不可控的白字压半透明黑底 | 已修 |
| [x] | S22-10 | P3 | ``knot-platform/web/src/styles.css:3026`` | 容器 `overflow: hidden` 裁掉子元素焦点框 | 已修 |
| [x] | S22-11 | P3 | ``knot-platform/web/src/styles.css`（全文）` | 没有打印样式；`color-scheme: light`（:2）已固定浅色，未声明深色规则属于跟随「参照 Facebook 浅色」的设计决定，不算残缺 | 已修 |
| [x] | S23-01 | P2 | ``views/LandingView.vue:51`、`views/MineView.vue:165`、`src/share.js:11`` | 剪贴板逻辑有三份，且行为不同：`share.js` 有 `execCommand` 回退、`MineView` 自己又抄了一份、`LandingView` 只有 `navigator.clipboard` 一条路。站内浏览常开在 `http://192.168.x.x` 上（`MineView.vue:163` 的注释自己写明了），此时 `navigator.clipboard` 是 `undefined`，`LandingView` 的「复制给 Agent」是首屏主 CTA，按下去**什么都不发生也不报错** | 已修 |
| [x] | S23-02 | P2 | ``views/DiscoverView.vue:639`、`views/StarsView.vue:128`、`views/WishView.vue:687`` | 同一张 `InformationCard` 的 25 个 prop 被手写三遍，三份已经不一致：`StarsView` 漏 `topics`/`category-selected`/`active-topic`/`author-selected`/`can-star`/`notice`/`can-close`/`closing`，也没有 `@category`/`@topic`/`@close` 监听；`WishView` 的出售栏也没有 `@author`/`@category`/`@topic`/`@close`，卡片上点作者名、点分类、点关闭都没有反应（组件 emit 存在，父级没人接） | 已修 |
| [x] | S23-03 | P2 | ``views/DiscoverView.vue:161`` | 翻页游标取的是**去重后**最后一条的 id，而不是本页最后一条。当 `refreshFeed` 已经把本页新增的几条并进 `items` 时，`fresh` 的末项早于 `incoming` 的末项，下一页又从中间开始，重复返回同一批 → `fresh` 为空 → 游标不动 → 「加载更多」按多少次都还是那一页 | 已修 |
| [x] | S23-04 | P2 | ``views/DiscoverView.vue:103`、`views/DiscoverView.vue:248`` | 过滤器与搜索词一变就 `load()`，但 `load()`/`loadLive()` 没有请求序号保护：连点两个筛选胶囊（或 `author` 与 `category` 相继变化）时，先发的慢请求回来会覆盖后发的结果，列表与 URL 上的筛选项对不上。同文件里 `MineView.vue:308` 的 `agentLoad` 已经有正确的票据写法可参照 | 已修 |
| [x] | S23-05 | P2 | ``views/DiscoverView.vue:386-394`` | 横滑拖拽结束时给容器挂一个捕获阶段的 `click` 拦截器，只在**真的收到 click** 时才 `removeEventListener`。若指针在轨道外松开（拖到页面下方再松手），click 不会落在容器上，拦截器就永久留着，之后在这个轨道上的**任何一次正常点击**都被 `preventDefault` 吃掉（点人像、点「新建」都没反应） | 已修 |
| [x] | S23-06 | P2 | ``stores/outbox.js:48`、`stores/outbox.js:77`` | `dismiss(id)` 只把任务从列表里删掉，**不中止**已经在跑的 `run()`：上传继续、`current()` 返回 undefined 后进度回调只是不再更新，最后的 `createIntel` 照发。用户点了「关闭/取消」，内容仍然发布出去 | 已修 |
| [x] | S23-07 | P2 | ``views/WishView.vue:243-255`` | 「我发出」每张 wish 单发一次 `listRequestResponses`，`Promise.all` 全并发。一个常发 wish 的账号有 30 条待回应就是 30 个跨境请求；隧道限流时这些请求失败被 `catch { item.responses = [] }` 吞掉，卡片显示「还没有回应」——把「没取到」画成「没有」 | 已修 |
| [x] | S23-08 | P2 | ``views/WishView.vue:166`、`views/WishView.vue:257`、`stores/notifications.js:15`` | 三处把请求失败直接落到空数据：`loadSales` 的 `catch { salesLoaded = true }` 让出售栏显示「还没有出售」；`load()` 的 `catch` 把 `wishes/looks/replies` 清空；通知列表 `load()` 把 `unread` 设 0 并 rethrow，`open()` 没人接，`onMounted` 里变成未捕获的 rejection。用户看到的是「你什么都没有」，而不是「没连上」 | 已修 |
| [x] | S23-09 | P2 | ``views/WishView.vue:53`` | `busy` 从来没有被写成 `true`（全文只有读取），于是 `:disabled="busy"` 的那一排按钮、`when: () => !busy.value` 的轮询条件全是常量。表单没有「提交中」互斥，`submit()`/`submitReply()` 只靠清空输入后 `canSend()` 变 false 来挡第二次点击 | 已修 |
| [x] | S23-10 | P3 | ``views/DiscoverView.vue:652`、`views/StarsView.vue:136`、`views/StarsView.vue:37`、`views/WishView.vue:522`` | 「这条是不是已经付过」有四套写法：卡片 prop `granted !== false`（缺省当真）、确认框 `granted === true`（缺省当假）、`Boolean(wish.granted) && !wish.mine`、以及用 `canFriend === false` 反推 `mine`。首屏快照 `paintDiscover` 不带 `granted`，卡片先画成「已获取」而点下载弹的是收费确认；`canFriend` 反推 `mine` 对 `role=platform` 的帖会把别人的帖当成自己的 | 已修 |
| [x] | S23-11 | P3 | ``views/NotificationsView.vue:29`` | 通知的 `href` 直接交给 `RouterLink`，前端不校验。文档写明只有 `/wish`、`/mine`、`/discover?post=`、`/` 这几种，但 `/api/web/notifications` 原样返回库里的字符串，后端 `recordNotification` 也不校验；库里一旦出现 `javascript:` 或外链，这里会被渲染成可点的 `<a>` | 已修 |
| [x] | S23-12 | P3 | ``src/time.js:3`、`src/time.js:9`` | 超过 7 天的日期固定按 `Asia/Shanghai` 格式化，浏览器在别的时区时「几月几日」会差一天；`timeAgo` 用 `Date.now()` 取值但不是响应式的，卡片画好之后「刚刚」「3 分钟前」不会自己变，只有别的原因触发重渲染才更新 | 已修 |
| [x] | S23-13 | P3 | ``views/EconomyView.vue:16`、`views/EconomyView.vue:22`、`views/MineView.vue:75`` | 数字格式写死 `zh-CN`，界面切成 `en` 后千分位与小数点仍按中文习惯；`MineView` 用中文顿号 `、` 拼多项权益，en 下也是 `、` | 已修 |
| [x] | S23-14 | P3 | ``views/WishView.vue:637`、`views/LandingView.vue:164`、`views/EconomyView.vue:100`` | 三处 ARIA 用法不完整：wish 三栏是 `role="tablist"`+`role="tab"`，但三个 tab 都在 Tab 序列里、没有方向键与 roving `tabindex`，也不响应左右键；着陆页轮播点同样 `role="tab"` 却没有对应 `tabpanel`/`aria-controls`；经济页的 `role="progressbar"` 没有可访问名称（读屏只念「进度条 42%」） | 已修 |
| [x] | S23-15 | P3 | ``views/DiscoverView.vue:482`、`views/StarsView.vue:63`、`views/StarsView.vue:86`、`views/WishView.vue:625`` | 同一套「先改本地再回滚」里，`401` 被特意排除在回滚之外：服务端没执行成功，本地却保留删除/取消星标的结果，直到刷新才回来。四处各写一遍 | 已修 |
| [x] | S23-16 | P3 | ``views/FriendsView.vue:18`` | 点一下就删好友，无确认、无撤销；`friends.remove` 失败才回滚。手机上这个按钮是 44px 的正圆 `CloseIcon`，紧挨着好友名 | 已修 |
| [x] | S23-17 | P3 | ``stores/session.js:110`、`stores/session.js:160`` | 会话请求**任何**失败都当成「未登录」：`user=null`、`site` 回到最保守的 `INITIAL_SITE`，`ready` 仍置 true，之后不再自动重试。隧道抖一下就表现为被登出并锁在登录页；`setBalance(undefined)` 也会把余额直接写成 0 | 已修 |
| [x] | S23-18 | P3 | ``router/index.js:5`` | 路由表没有 catch-all，`/wish/xxx`、`/nope` 之类落到空 `<RouterView>`，页面全白且无返回入口 | 已修 |
| [x] | S23-19 | P3 | ``views/WishView.vue:178`、`views/SubmissionsView.vue:42`、`views/MineView.vue:101`、`views/MineView.vue:299`、`composers/packet.js:41`` | `verdict → statusKey` 抄了两份（内容逐字相同），`error.${code}` 查表抄了三份（`errorText` 已有一份完整实现，`MineView` 两个 `showError` 又各写一遍，都漏了 `bad_price` 的插值） | 已修 |
| [ ] | S23-20 | P3 | ``views/SubmissionsView.vue:51`、`views/SubmissionsView.vue:72`` | `isSale` 在前端复刻了一遍后端「出售帖」规则（`post/fastpost` + 有 `stored` 附件 + 价格 > 0），后端规则一改这里就漂；`reopen` 的 `catch` 丢掉 `error.code`，任何失败都显示 `error.request_failed`（`bad_state`、`not_found` 都读不出来） | 部分 |
| [x] | S23-21 | P3 | ``views/DiscoverView.vue:133-146`` | 深链 `?post=` 走进 `/api/web/intel/:id`，那条路由把 `granted` 固定成 `false`（`backend/src/routes/web.js:726`）。把这条记录塞进 `items` 后，已购的附件在卡片上变成「未获取」，直到 `personalise()` 的 `discover-self` 结果回来才纠正；两者是并发的，谁后到看时序 | 已修 |
| [x] | S23-22 | P3 | ``views/WishView.vue:471`、`views/WishView.vue:360-367`` | 回应时目标在轮询里过期/被关掉，`target` 变 null，`submitReply()` 第一行就静默 return，页面上没有任何提示；切换 `?respond=` 会把 `replyBody` 与已选附件一起清掉，没有确认 | 已修 |
| [x] | S23-23 | P3 | ``src/release.js:143-158`` | `stop()` 摘了定时器、监听器与 observer，但没有 `stopped` 标记，也没让在飞的 `check()` 失效：`stop()` 之后 `fetchText` 才回来的那次仍可能命中 `settle()` → `reload()`。`polling.js` 用 `stopped` 变量做了这件事，可作为对照 | 已修 |
| [x] | S23-24 | P3 | ``stores/friends.js:33-43`` | `remove(id)` 先存整份数组引用再乐观删除，失败时整份写回。两次移除并发时，后一个失败会把前一个已成功的删除「复活」 | 已修 |
| [x] | S24-01 | P2 | ``README.md:192`、`:124`、`:178`` | README 仍按「门户右侧填表、人工审核、申请表旁展示审核人」描述加入流程，而门户右栏早已改成邮箱 → 授权码登录，申请由实例代交且提交即通过（`reviewed_by: auto`）。照文档来的人在页面上找不到表单 | 已修 |
| [x] | S24-02 | P2 | ``federation.json:31`、`instances.json:17`、`README.md:27`` | 同一个伙伴实例 `cpswang` 在三处是三种状态：名册说「等待接通验收」，清单说 `active`，README 说「隧道已接通」。清单的 `active` 决定门户是否当在线节点展示、委托发信是否放行 | 已修 |
| [x] | S24-03 | P2 | ``instances.json:4`、`:13`、`README.md:44-46`` | README 把「L2 活动数据」「L3 热点橱窗」列为中枢已提供能力（含门户橱窗位、最多 6 张卡片），但真实清单两条都没有 `statsUrl`/`cardsUrl`。生产构建永远拿不到这两层数据，门户对应区块只能落空态 | 已修 |
| [x] | S24-04 | P2 | ``e2e/api.e2e.test.mjs:185-187`` | 会话 Cookie 的 `Secure` 是部署开关（`XKNOT_SECURE_COOKIE=1`）而非代码默认，默认是关；e2e 只断 `HttpOnly`/`SameSite=Strict`/`Path`，没有断 `Secure`。忘了置 1 的部署会发出可在明文 HTTP 上传输的管理员会话，测试仍全绿 | 已修 |
| [x] | S24-05 | P2 | ``README.md:117`、`.gitignore:15`（仓库根）` | README 承诺「`var/`…会话密钥（不入版本库）」，项目里确实没把密钥写进受版本控制的文件。但 `xknot.si/` 没有自己的 `.gitignore`：`var/`、`node_modules/`、`*.local.env` 的规则全在仓库根。README 与 NOTICE 又明确支持「单独取用本目录」，那时 `var/session-secret`、`var/xknot.db`（含申请邮箱）、`ops/mail.local.env` 都会变成可提交文件 | 已修 |
| [ ] | S24-06 | P3 | ``server/validate.mjs:13`、`ops/deploy-api.sh:80-81`` | 接口进程直接 `import "../web/src/lib/regions.js"`（另有 `i18n.js`），跨过「server 只读 dist」的边界。部署靠 `deploy-api.sh` 手工列举两个文件；接口再引入第三个 `web/src/lib/*` 时本地与单测全绿、远端 `ERR_MODULE_NOT_FOUND` 起不来 | 部分 |
| [x] | S24-07 | P3 | ``e2e/playwright.config.mjs:46`、`e2e/browser/constants.mjs:9`` | 管理员口令明文写在 `webServer.command` 里，跑测试时出现在进程表（`ps aux`）与本机 Playwright 日志；同一口令又在 `constants.mjs` 抄了第二份，改一处另一处静默失效（表现为登录用例莫名 401） | 已修 |
| [x] | S24-08 | P3 | ``e2e/playwright.config.mjs:44-48`` | `reuseExistingServer: !CI` 加固定端口 5199 会挂到上一轮留下的旧栈：注释承诺的「每次跑都用新的数据目录」在复用路径上不成立，旧清单/名册与旧会话仍在，用例可能对旧代码绿；`mktemp -d` 建的数据目录也从不清理 | 已修 |
| [x] | S24-09 | P3 | ``e2e/playwright.config.mjs:19-33`` | 没有 `forbidOnly`。误提交的 `test.only`/`describe.only` 会让 CI 只跑一个用例、其余静默跳过，流水线仍绿 | 已修 |
| [x] | S24-10 | P3 | ``e2e/browser/admin.spec.mjs:47`、`:56`、`:71`、`e2e/browser/member.spec.mjs:81`` | 浏览器用例把界面文案硬编码在定位器里，与 `constants.mjs` 自己的约定（「文案从站点自己的 locale 取…不在用例里抄一份中文」）相反，改一句中文就要回来改测试 | 已修 |
| [x] | S24-11 | P3 | ``e2e/browser/portal.spec.mjs:71-72`、`:120-122`` | 前置数据不满足时直接 `return`，用例不失败也不标记 skip。样例数据一旦少了标签或橱窗（例如按 S24-03 清理 fixtures），两条会安静空跑，覆盖悄悄消失 | 已修 |
| [x] | S24-12 | P3 | ``e2e/browser/constants.mjs:33-38`` | `watchErrors` 把所有以 `Failed to load resource` 开头的 console error 一律丢弃，但该前缀不只代表 401/404：5xx、`net::ERR_*`、被 CSP 拦掉的脚本都同前缀。注释称「只看真正的异常与 CSP 拒绝」，实现比注释宽 | 已修 |
| [x] | S24-13 | P3 | ``e2e/relay.e2e.test.mjs:186`` | 用例内把共享 `sink` 关掉且不恢复，靠「它是文件里最后一条」的隐式顺序成立。加一条用例、开并发、或换执行顺序，后面的用例全部红在「没有信」而非业务错误 | 已修 |
| [x] | S24-14 | P3 | ``e2e/smtp-sink.mjs:65`、`:91`` | 收信器宣告 `SIZE 1048576` 但不校验，`buffer`/`data` 无上限，`messages` 不清理。它被 partner/relay/member 三套用例共用，一条异常长的 DATA（无终止符）就能把缓冲撑大而不报错 | 已修 |
| [x] | S24-15 | P3 | ``package.json:39-41`、`package-lock.json:24`` | 根项目没有 `engines`，而唯一依赖 `marked` 18 要求 Node ≥ 20（lock 里写明）。用 Node 18 的机器要到 `npm ci` 才报错，错误指向依赖而非项目；e2e 侧只要求 ≥18，两套要求不同也没写下来 | 已修 |
| [x] | S24-16 | P3 | ``instances.json:2`、`fixtures/preview-instances.json:2`、`federation.json:2`` | 三份 JSON 都有 `version`/`updatedAt`（值为 6、5、2），但校验器只看 `instances` 数组与逐条字段，从不读版本。格式真正变化时旧文件照样通过校验与构建，该字段纯装饰 | 已修 |
| [x] | S24-17 | P3 | ``e2e/limits.e2e.test.mjs:37`、`:72`` | 限流只覆盖申请提交与管理员登录。成员登录的 6 位授权码同样是人可猜的凭据，`member.spec.mjs` 只验正常路径，没有任何「连错 N 次」用例；验证码接口是否限流、阈值多少，测试层无法保证 | 已修 |
| [x] | S25-01 | P1 | ``admin.js:1191`、`:975-995`、`:1032`、`:1176-1183`` | 申请列表加载失败对运维完全静默，且失败时保留上一次的数据：切到「已撤回」后若请求失败，标签是「已撤回」、行却是上次「已通过」的记录，点开详情徽标又写「已通过」。管理员会把错的单当成对的单，还能据此生成清单条目 | 已修 |
| [x] | S25-02 | P2 | ``admin.js:424-441`、`:531-549`、`:1145-1150`` | 表单把草稿的全部字段一次性 POST，且请求里没有清单/名册版本号。①两个人先后编辑不同实例，后保存者会把自己页面加载时的整份快照写回去，静默覆盖先保存者的改动（服务端 `edit.mjs:150-193` 是读-改-写，没有锁或 ETag）；②实例不在名册里时，只改一个无关字段（例如 status）也会补一条名册成员，默认 `role: "partner"`、`listed: true`、`host` 取 url 主机名；③`member.since` 直接取 `inst.since`，改一个「加入时间」输入框会同时改写两份文件的日期 | 已修 |
| [x] | S25-03 | P2 | ``admin.js:479`、`:530`、`:590-601`` | 「状态」下拉可直接把实例改成 `suspended`／`retired`（等于下线／吊销门户橱窗与探测），与改备注共用同一个「保存」按钮，没有二次确认、没有后果说明。点错一格并保存，实例就从门户消失 | 已修 |
| [x] | S25-04 | P2 | ``admin.js:384`、`:391-392`、`:421`、`:476`` | 旧档位 `partner`／`community` 只在 `LABELS` 里有映射，`TIER_OPTIONS` 里没有。遇到这种旧记录，编辑表单的分级下拉显示第一项「示例」，而草稿里仍是 `partner`：界面显示 demo，提交的是非法值，服务端 `checkIssued` 会以 `tier: must be one of demo, free, paid` 拒绝，导致该实例任何字段都改不了，直到运维自己意识到要先动一下下拉。`LABELS.partner/community` 两行永远走不到（死代码） | 已修 |
| [x] | S25-05 | P2 | ``admin.js:165-180`、`:1149-1152`、`:733-739`、`:627-648`` | `api()` 把「200 但响应体不是 JSON」当成成功（`data = null` 被返回），`loadOverview` 不做校验直接赋给 `state.overview`。此时 `overview` 为 null 且 `overviewError` 为空，`renderOverview` 走「正在读取总览…」分支——永远转圈，没有错误也没有重试按钮。全文件没有任何超时／`AbortController`：一个挂住的请求会让 `state.overviewBusy`／`applicationsBusy` 永不复位（申请列表的标签与行全部 `disabled`，整页无法操作），登录或「生成」按钮的 `state.busy` 同理 | 已修 |
| [x] | S25-06 | P2 | ``admin.js:1088-1097`` | 生成清单条目失败时服务端会说明哪一项不合规（422 `manifest_invalid` + `problems`），前端 `catch` 不接收 `error`，只写一句「生成清单条目失败。」，把唯一可操作的信息丢掉。运维只能去翻服务器日志 | 已修 |
| [x] | S25-07 | P2 | ``admin.js:1046-1075`` | 申请详情没有展示 `requestServices`（申请人要 relay／cards／stats，其中 relay 等于发信凭据）、`caseKey`（案例页，公钥与领取都在那）与 `locale`。运维在这个页面上判断「这个伙伴要什么、走没走完流程」时缺关键一项，容易给错权限或漏发交付资料 | 已修 |
| [x] | S25-08 | P2 | ``admin.js:1177`、`:974-991`` | 申请列表请求不带任何 `limit`／游标，服务端默认硬上限 200 条（`store.mjs:452-461`），而顶部的计数是全量 `countByStatus()`。申请超过 200 条后「全部」标签显示的总数与实际行数不一致，多出来的记录没有任何提示地看不到，也没有翻页 | 已修 |
| [x] | S25-09 | P2 | ``admin.js:713-722`` | 「退出」把 `POST /api/admin/logout` 的失败整个吞掉，随后照样清空本地状态。若是网络错误或 5xx，服务端会话与 Cookie 仍然有效，刷新页面 `boot()` 会直接回到已登录状态——共用电脑上会以为已经退出 | 已修 |
| [x] | S25-10 | P3 | ``admin.js:185-192`、`:205-207`` | 所有时间强制按 `Asia/Shanghai` 渲染，忽略申请自带的 `timezone`（详情另起一行显示原始值，读的人很容易当成同一时区）；`since` 是 `YYYY-MM-DD` 日期，被 `new Date()` 按 UTC 解析后渲染成「…日 08:00」，凭空多出 08:00（当前 `instances.json` 两条 `since` 都是这种值）；未来时间算出负分钟，落进 `< 1` 分支显示「刚刚」 | 已修 |
| [x] | S25-11 | P3 | ``admin.js:288`、`:1050`、`:1054`` | 三个 `href` 直接取数据，没有协议白名单。当前申请地址由服务端据子域重算、清单地址写入前校验 https，所以不可利用；但 `store.mjs:343` 对 2.0 之前的老单「直接用它自己存的 url」——这些行没有再过一遍校验。`mailto:` 同理没有过滤（`validate.mjs` 的邮箱正则未加 `$` 锚点，允许带 `?subject=` 尾巴）。CSP `script-src 'self'` 是唯一兜底 | 已修 |
| [x] | S25-12 | P3 | ``admin.js:151`` | `el()` 保留 `html` → `innerHTML` 通道，文件头注释却写着「所有文本用 textContent 写入」。今天没有调用点，但任何后续为省事传一个 `html:` 就会绕过全部转义，而审阅者会按注释以为没有这条路径 | 已修 |
| [x] | S25-13 | P3 | ``admin.js:1084-1099`` | 「生成清单条目」置 `state.busy = true` 后没有立即 `render()`，按钮在请求期间仍可点，双击会发两次 GET；请求挂住时 `state.busy` 永不复位，而登录按钮也读这个 `state.busy`（`:625`），退出后重登会看到一个禁用的「登录」 | 已修 |
| [x] | S26-01 | P1 | ``xknot.si/admin/admin.js:1192`（渲染处 `:1022-1031`）` | 申请列表加载失败**完全静默**：失败只写 `state.error`，而 `renderApplications` 从不渲染它，管理员看到的是「这个分类下没有记录」的空态；失败时也不清 `state.applications`，切了筛选后旧筛选的行仍留在列表里，tab 却已高亮新筛选 | 已修 |
| [x] | S26-02 | P2 | ``xknot.si/admin/admin.js:151`（跨片，admin.js 属 S25）` | `el()` 保留了 `html` 通道，直接 `node.innerHTML = value`，不做任何转义。**全文件唯一一处 innerHTML 赋值，当前 0 个调用点**，属潜伏 sink；申请内容（名称/介绍/邮箱/网址/公钥）全部走 `textContent` 与 `createTextNode`，因此**现网不存在存储型 XSS** | 已修 |
| [x] | S26-03 | P2 | ``xknot.si/admin/admin.js:715`` | 退出接口失败被吞掉，前端照样清空 `state.admin` 并画登录页；服务端会话仍在，刷新（`boot()` 打 `/api/admin/session`）即回到已登录。共用机器上「以为退出了」是真实风险 | 已修 |
| [x] | S26-04 | P2 | ``xknot.si/admin/admin.js:510-552`、`:573-577`` | 本页没有批准/拒绝/吊销动作（申请提交即通过，`:1076`），唯一的写操作是实例配置保存；它把 `status`（pending/active/suspended/retired）、`listed` 与其它字段一次性提交，能一次误操作把成员停用、退役或从清单摘掉。无二次确认、无「旧 → 新」变更摘要、无回滚 | 已修 |
| [x] | S26-05 | P2 | ``xknot.si/admin/admin.js:1172-1181`` | 申请列表没有分页，服务端硬上限 200 条；tab 上的计数是全量（`countsByStatus`），列表只是最近 200 条，界面没有任何「已截断」的提示。记录超过 200 条后，管理员会以为看全了 | 已修 |
| [x] | S26-06 | P2 | ``xknot.si/admin/admin.js:452-459`、`:483-486`、`:386-402`` | 编辑器只列新档位/新角色，旧值靠 `LABELS` 映射显示，但 `configSelect` 找不到匹配项时不选中任何项、浏览器回落到第一项：旧档位 `partner`/`community` 显示成 **demo/free**，旧角色 `community` 显示成 **founder**。草稿仍按旧值提交 → 保存必然 400；管理员按提示「改一下」就把实例降级为 demo、把成员提成 founder | 已修 |
| [x] | S26-07 | P2 | ``xknot.si/admin/admin.js:1048-1075`（跨片）` | 申请里勾选的服务（`requestServices`：委托发信/橱窗/统计）在详情里完全不显示，而这是后续签发 relay 凭据、决定要不要接橱窗/统计的唯一依据。审核人只能去翻信或问人 | 已修 |
| [x] | S26-08 | P3 | ``xknot.si/admin/admin.css:859`、`:869`、`:903`` | `--radius-sm` 在本样式表里**没有定义**（`:root` 只有颜色与字体），三处 `border-radius: var(--radius-sm)` 因变量无效整条声明失效，配置表单的圆角回落到 0，与页面其余 6px 圆角不一致。看着像从 `knot-platform` 抄过来时漏了变量 | 已修 |
| [x] | S26-09 | P3 | ``xknot.si/admin/admin.css:10`、`:55`、`:684`、`:800`` | 主色 `#e2611a` 被当作小字文本色（`a`、`.link-btn`、`.cfg-link`、`.login-mark`、`.ov-eyebrow`，字号 0.7–0.85rem），对白底 3.52:1、对 `--accent-soft` 3.16:1，低于 WCAG AA 的 4.5:1 | 已修 |
| [x] | S26-10 | P3 | ``xknot.si/admin/admin.css:272`、`:535`、`:684`` | 390px 下几个高频按钮低于 44px 触控目标：`.tab` 最小高 32px、`.view-tab` 34px、`.link-btn` 只有 0.2rem 内边距（「查看全部」）。胶囊 `.badge` 字号 0.64rem（≈10px）也偏小 | 已修 |
| [x] | S26-11 | P3 | ``xknot.si/admin/admin.js:952-957`` | 有未保存草稿时切视图/切实例会**静默丢弃**草稿（注释写明是有意的），填到一半点一下「申请记录」就没了；`startEditing` 换实例同样直接覆盖 | 已修 |
| [x] | S26-12 | P3 | ``xknot.si/admin/index.html:15-18`` | 页面骨架只有一句「正在连接…」。`admin.js` 加载失败（404、被拦、旧缓存指向不存在的文件）时永远是「正在连接…」，既没有 `<noscript>`，也没有 JS 侧的加载失败提示，管理员会以为是接口慢 | 已修 |
| [x] | S27-01 | P2 | ``FEDERATION.md:519-525`` | §7.4 称「键名固定」，但表里的必填键 `XKNOT_HUB_ISSUED_AT` 实现从不写；实现写的是另外四个文档未列的键 | 已修 |
| [x] | S27-02 | P2 | ``FEDERATION.md:535`` | 称「重领一份新件时，旧的发信地址与凭据一起作废」 | 已修 |
| [x] | S27-03 | P2 | ``JOIN.md:127`；`HANDOFF.md:38`、`:77-78`` | 交付通道两说：JOIN 说「不再另发领取链接」，HANDOFF 说阶段 1 的结束标志是「十项全就绪、交付信已寄」，第 9 项 `access` 生成 `/claim/<token>` 链接、第 10 项寄 `partner.handoff` | 已修 |
| [x] | S27-04 | P2 | ``HANDOFF.md:75`；`handoff-flow.svg:98`、`:126`` | 称子域 conf「静态版，先不加 `/api`」，激活后才「补 `/api` 反代」 | 已修 |
| [x] | S27-05 | P2 | ``JOIN.md:147-156`` | 称「`/`、`/assets/` 由入口磁盘提供，静态在入口主机，只有动态走隧道」 | 已修 |
| [x] | S27-06 | P3 | ``HUB.md:396`` | `check-health` 被写成「读 `instances.json` 与 `federation.json`」 | 已修 |
| [x] | S27-07 | P3 | ``HUB.md:52`` | 称 `notify.mjs` 是「11 + 3，三语」 | 已修 |
| [x] | S27-08 | P3 | ``HUB.md:12`、`HUB.md:661-672`` | 表清单两处都不含 `provision_runs` | 已修 |
| [x] | S27-09 | P3 | ``HUB.md:690-714`` | §9.2 接口表缺 `GET /api/case/:caseKey/progress` | 已修 |
| [x] | S27-10 | P2 | ``I18N.md:201-205`、`I18N.md:231`` | 自述区仍按 v1 多语模型写检查项：`语言键`、`name` 与 `intro.oneLine`、`languages` 每个值白名单 | 已修 |
| [x] | S27-11 | P3 | ``E2E.md:124`` | 称伙伴信「`Reply-To` 为空（不接收回复）」 | 已修 |
| [x] | S27-12 | P3 | ``E2E.md:130-131`` | `handoff` 断言整行连写两遍，逐字相同 | 已修 |
| [x] | S27-13 | P3 | ``federation.svg:41`` | 图上标健康探测「每 2–5 分钟」 | 已修 |
| [x] | S28-01 | P1 | ``xknot.si/ops/deploy-api.sh:147`` | 先覆盖线上 nginx 配置、后跑 `nginx -t`，且旧配置没有任何备份。校验失败时坏文件已经落在 `conf.d/` 里，脚本 `set -e` 退出、不回滚，后续任何一次 `reload`（certbot 续期、别的子域部署）都会因整棵配置树不合法而失败 | 已修 |
| [x] | S28-02 | P1 | ``xknot.si/ops/deploy-hub.sh:31`` | `rsync --delete` 的目标目录完全来自环境变量，没有任何护栏。默认值正确，但 `XKNOT_TARGET` 少写一级（如写成站点父目录）就会把同机 `wang`、`aiugc` 等站点的静态根整目录删掉；写 `/` 也照收不误 | 已修 |
| [x] | S28-03 | P2 | ``xknot.si/ops/deploy-api.sh:90`、`:132`、`:147`、`:158`；`xknot.si/ops/deploy-hub.sh:36`` | 远端路径与主机配置项（`API_ROOT`、`NGINX_CONF`、`SERVICE`、`XKNOT_ENTRY_HOST`）用单引号直接拼进双引号包裹的远端 shell 串，值里的空格、单引号或 `;` 会改变远端执行的命令；`rsync -e "ssh … $KEY"` 是同一类无引号拼接。`NGINX_CONF` 还能被指到别的子域的 conf 上 | 已修 |
| [x] | S28-04 | P2 | ``xknot.si/ops/deploy-api.sh:46`、`:79`` | `ops/` 整目录同步到远端，没有排除 `*.local.env`。本机那份被 `.gitignore` 忽略的邮件凭据文件因此被复制成远端 `/opt/xknot/ops/` 下的一份额外副本（线上实际读的是 `var/mail.env`），且没有 `--delete`，这份副本不会被后续部署清掉 | 已修 |
| [x] | S28-05 | P2 | ``xknot.si/ops/doc-page.mjs:208`` | 渲染只做 `marked.parse`，没有清理内联 HTML：源 markdown 里写 `<script>`、`<iframe>`、`onerror` 会原样进入 `<article>`，并以 `xknot.si` 同源执行——该源同时挂着 `/admin` 与 `/api/admin`。标题、description 走了 `escapeHtml`，正文没走 | 已修 |
| [x] | S28-06 | P2 | ``xknot.si/ops/fetch-profile.mjs:55`；`xknot.si/ops/profile-schema.mjs:195`` | `cleanSite` 只要有一条问题就返回 `site: null`，于是 `cleanProfilePayload` 里「字段级问题不拦整份：能用的字段照收」那段永远走不到；伙伴档案多写一个未知字段（如 `email`）就整份被丢弃、保留旧副本，门户一直显示上一版 | 已修 |
| [ ] | S28-07 | P2 | ``xknot.si/ops/fetch-guard.mjs:131`、`:190`` | 校验与实际请求是两次独立解析：先 `resolve(host)` 判公网，再按主机名 `fetch(url.toString())`，中间可被 DNS rebinding 换成内网地址；检查结果没有钉到已校验的 IP | 暂缓 |
| [x] | S28-08 | P2 | ``xknot.si/ops/build-hub.sh:53`、`:61`` | `npm ci` 只在 `node_modules` 不存在时执行。`package-lock.json` 变了、或上一次安装中断留下半棵树，构建会继续用旧依赖，同一 commit 在不同机器/不同时间产出的 `dist` 不一致 | 已修 |
| [x] | S28-09 | P3 | ``xknot.si/ops/check-health.mjs:110`` | 探测只 `response.json()`，没有大小上限，与同项目 `fetch-guard.mjs` 的 256KB/32KB 上限不一致；伙伴返回超大体时按整份读进内存（每 15 分钟一轮，8 并发） | 已修 |
| [x] | S28-10 | P3 | ``xknot.si/ops/provision-worker.mjs:268`` | `XKNOT_AFTER_ACTIVATE` 直接交给 `/bin/sh -c`，值来自 root 的 unit/`provision.env`；该文件一旦被低权用户改写就是 root 命令执行。脚本其余部分刻意「只走参数数组，不经 shell」 | 已修 |
| [x] | S28-11 | P3 | ``xknot.si/ops/provision-worker.mjs:97`` | 写 root 文件是 `sudo tee` 先建文件、再 `chmod`：600 的目标会有一小段时间按 `tee` 的默认 umask 落在 644 | 已修 |
| [x] | S28-12 | P3 | ``xknot.si/ops/provision-worker.mjs:235`` | 同一份代码里，健康巡检走 `assertPublicUrl`，接通后的探测 `probe(target)` 不带 `resolve`，直接按 `https://${run.host}/api/health` 请求，绕过了 fetch-guard 的私网/回环拦截 | 已修 |
| [x] | S28-13 | P3 | ``xknot.si/ops/fetch-cards.mjs:233`；`xknot.si/ops/fetch-stats.mjs:109`；`xknot.si/ops/fetch-profile.mjs:116`` | 输出文件名直接用清单里的 `instance.id`，未校验字符集；清单里出现 `../` 就会写到 `var/` 之外。清单是人工维护且部署时被仓库副本覆盖，实际可控性低 | 已修 |
| [x] | S28-14 | P3 | ``xknot.si/ops/local-stack.mjs:278`、`:295`` | 退出与失败路径 `rm(dataDir, { recursive: true, force: true })`，`dataDir` 由调用方传入；CLI 侧固定 `keep: true`，测试侧是随机临时目录，但被当成库调用且传了真实目录时就是整目录删除 | 已修 |
| [x] | S28-15 | P3 | ``xknot.si/ops/node-status.mjs:35`` | 流量「最近一天」取的是数组第一个元素，不是日期最大的那个；流量文件被反序写入或追加时，控制台会长期展示旧一天的数据 | 已修 |
| [x] | S28-16 | P3 | ``xknot.si/ops/cards.mjs:14`；`xknot.si/ops/profiles.mjs:15`；`xknot.si/ops/stats.mjs:16`` | 三份「读目录 → 过滤 `.json` → parse → 以文件名为键」与「真实优先、样例补空」的实现逐字相同，改成三处维护 | 已修 |
| [x] | S28-17 | P3 | ``xknot.si/ops/build-federation-map.mjs:259`` | 图注把 `wang` 写死成「唯一的真实实例」，其余一律称为样例；清单现在已有两个真实条目，生成的 SVG 会给出错误说明 | 已修 |
| [x] | S28-18 | P3 | ``xknot.si/ops/deploy-api.sh:52`` | 私钥缺失时把路径打到 stderr（只是路径，不是密钥内容），同时脚本默认取通用的 `id_rsa` 文件名，这台机实际使用的那把不是它，默认值必然失败 | 已修 |
| [x] | S29-01 | P2 | ``xknot.si/ops/xknot.si.conf:17`、`:167-168`` | 按注释是「申请与登录各一条限流」的 `xknot_apply`（12r/m、burst 5）被套在整条 `location /api/` 上，只读接口与运维接口一起限。每次页面加载都会打 `/api/locations`，控制台每次翻页要打 2–4 个 `/api/admin/*`，共享出口 IP（办公室/NAT/多开标签）下第 7 个请求起就要按 5 秒一封排队，超了就是 429，控制台与门户会随机报错 | 已修 |
| [x] | S29-02 | P2 | ``xknot.si/ops/traffic.mjs:156-157`、`:177`、`:187-188`` | 时间样本（`MAX_SAMPLES` 20k）与去重集合（`MAX_UNIQUE` 50k）都有硬帽，但 `paths`、`referers`、`unknownHosts` 三张 Map 无上限。日志里的 `uri`/`Host` 完全由访问者决定（扫 `/x1`、`/x2`…，或发随机 Host 头），每小时一次的聚合进程内存随攻击面线性涨，且 BOT 流量正好是这么打的 | 已修 |
| [x] | S29-03 | P2 | ``xknot.si/ops/traffic.mjs:420-425`、`:276`、`:388-396`` | `--days` 直接 `Number(argv[++i])`，非法值（`--days abc`、`--days` 后无参数）得到 `NaN`；`Math.max(1, NaN)` 仍是 `NaN`，`slice(0, NaN)` 返回空数组，于是每个实例的 `{id}.json` 被写成 `days: []`——历史一次性清空，且下次运行的 `previous` 也是空，无法恢复 | 已修 |
| [x] | S29-04 | P2 | ``xknot.si/ops/validate-federation.mjs:25`、`:83-90`` | 隧道账号只按 `^[a-z_][a-z0-9_-]{0,31}$` 校验字符集，`root`、`ec2-user`、`nginx`、`adm` 全部能通过。名册正是自动接通取账号与端口的唯一来源（`provision-worker.mjs:292` 的 `tunnelFor` 直接读 `federation.json`，写回时用的也是同一套 `validateRoster`，二次校验拦不住），一个手写条目就能让开通流程去操作已有系统账号 | 已修 |
| [ ] | S29-05 | P2 | ``xknot.si/ops/xknot-provision.service:13-22`` | 这个单元把一个常驻、由网络输入驱动的进程放在无沙箱位置：`NoNewPrivileges=no`、无 `ProtectSystem`/`ReadWritePaths`、`Restart=always`，而它要「建账号、写 sshd 与 nginx 配置」。同机还托管 `wang`、`zjj`、`aiugc`，worker 手里的权限等于整机 nginx/sshd 的写权限——它出一次错，受伤的不止 xknot.si。仓库里没有 sudoers 白名单，实际授权面在主机上（见「需运行验证」） | 暂缓 |
| [x] | S29-06 | P2 | ``xknot.si/ops/watch-health.mjs:105-108`、`:150`、`:164-168`；`xknot.si/ops/xknot-health.service:8-15`` | 通知是「先落盘、后投递」：`check()` 先把 `notified` 写进 `health.json`，再发信；无 SMTP 配置、发信抛错、或进程被 systemd 杀掉，这一封就永久消失，下一档要等到 7 天/30 天。而 oneshot 默认 `TimeoutStartSec=90s`，单封信在 `mail.mjs` 里最坏是 6 次往返 × 15s，两个实例就是 180s+，超时正好落在「已标记、未发信」的窗口里 | 已修 |
| [x] | S29-07 | P2 | ``xknot.si/ops/watch-health.mjs:198-207`` | 巡检每 15 分钟为了拿收件人邮箱，用 `openStore` 打开生产 SQLite；`openStore` 不止读，它会 `pragma journal_mode=wal`、执行 `SCHEMA`、跑 `migrate()`（`alter table applications add column`、批量 `update applications set …`）。一个只读的监控任务因此会成为库结构的第二个写入者，与接口进程抢写锁（`busy_timeout=5000`），库升级窗口里两边同时改表还可能撞 `duplicate column` | 已修 |
| [ ] | S29-08 | P2 | ``xknot.si/ops/xknot.si.conf:127-128`` | `/case/`、`/claim/` 只关掉了访问日志，注释的理由是「链接本身就是能力凭据，不能写进访问日志」。但 nginx 在 upstream 超时/连接失败时写的 error 级日志会带 `request: "GET /claim/<token> HTTP/1.1"`，整条能力凭据就落到 `/var/log/nginx/error.log`（`adm` 组可读、会被日志采集收走）。`access_log off` 管不到这一路；接口重启、SQLite 锁、`proxy_read_timeout 20s` 到期都会触发 | 暂缓 |
| [x] | S29-09 | P3 | ``xknot.si/ops/traffic.mjs:392`` | 输出文件名直接把清单里的 `id` 拼进路径，没有过 `ID_RE`；`traffic.mjs` 自己也不校验清单（`--instances` 可指任意文件）。`id: "../../x"` 会写到 `outDir` 之外。清单是人工维护、且部署时被仓库副本覆盖，实际可控性低，但这条路径没有任何一层兜底 | 已修 |
| [x] | S29-10 | P3 | ``xknot.si/ops/traffic.mjs:389-397`、`:286-291`` | 只重写「本次日志里出现过」的实例，于是：断流超过保留期的实例永远不会被裁剪（`mergeTraffic` 的 `slice(days)` 只在写的时候生效）；从清单删掉的实例，其 `var/traffic/{id}.json` 永远留着（README 让人手工删）。目录里会长期堆着早已下架站点的聚合 | 已修 |
| [x] | S29-11 | P3 | ``xknot.si/ops/validate-federation.mjs:77-82`` | `tunnel: null` 报的是「every member is served through the entry tunnel」（必填），而对象分支里的两条报错写的是「must be null or an object」。同一字段两份互相矛盾的口径，运维按提示补 `null` 只会再失败一次 | 已修 |
| [x] | S29-12 | P3 | ``xknot.si/ops/validate-instances.mjs:222-226`；`xknot.si/ops/validate-federation.mjs:160-170`` | 两份校验都只保证「url 是 `<标签>.xknot.si`」与「roster.host 等于 url 的 host」，从不要求标签等于 `id`。`id: "cpswang"` + `url: "https://wang.xknot.si"` 两份校验全绿：门户会把 cpswang 条目指向 wang 的站点与档案，`traffic.mjs` 还会按 host 把它记到 wang 名下 | 已修 |
| [x] | S29-13 | P3 | ``xknot.si/ops/xknot-health.timer:9`；`xknot.si/ops/xknot-traffic.timer:9`` | 两个 timer 都写了 `Persistent=true`，但 `Persistent=` 只对 `OnCalendar=` 生效；这两份用的是 `OnBootSec`/`OnUnitActiveSec`，这一行完全不起作用。留着会让人以为「关机期间错过的轮次会补跑」，排查漏检时方向是错的 | 已修 |
| [ ] | S29-14 | P3 | ``xknot.si/ops/xknot.si.conf:62`` | CSP 里 `script-src 'self' 'unsafe-inline'`，同源任何一处 HTML 注入都能直接执行脚本；这个源上同时挂着 `/admin` 与 `/api/admin`。`/knot-help` 由 markdown 直出 HTML（S28-05 报告了那条未清洗的渲染路径），这条 `unsafe-inline` 正好去掉了剩下的那道闸 | 暂缓 |
| [x] | S29-15 | P3 | ``xknot.si/ops/xknot-provision.service:3`` | `Documentation=` 指向 `https://xknot.si/docs/HANDOFF.md`，但门户只同步 `web/dist`，`dist` 里没有 `docs/`（`web/public/` 只有图标与 favicon），这个地址上线后是 404——`systemctl status` 里给出的第一个排查入口打不开 | 已修 |
| [x] | S29-16 | P3 | ``xknot.si/ops/verify-hub-data.mjs:20`` | 这道守卫要挡的第一类事故是「测试数据被并进生产快照」，但保留域只列了 `.example`/`.test`/`.invalid`/`.localhost`。RFC 2606 同时保留 `example.com`/`.net`/`.org`，而人写样例时最常用的恰恰是这几个；一份 `https://demo.example.com` 的样例条目会顺利通过守卫并发布 | 已修 |
| [x] | S29-17 | P3 | ``xknot.si/ops/traffic.test.mjs:130-244`` | 测试覆盖了解析、轮转、合并、跳过无日志等正常路径，但三条会毁数据的路径一条都没断言：非法 `--days` 清空历史、非清单 `id` 拼进路径、`paths`/`referers` 无上限。用例全绿也不代表这几个入口安全 | 已修 |
| [x] | S29-18 | P3 | ``xknot.si/ops/watch-health.test.mjs:170-188`` | 「没有 SMTP 配置」那条用例只断言「打了一行日志、没发信」，等于把「这一封永不补发」固定成了契约。丢信这件事因此在测试里是绿的，S29-06 那类线上现象不会被 CI 发现 | 已修 |
| [x] | S30-01 | P1 | ``edit.mjs:101-107,187-189`` | 后台保存实例配置时，只要校验错误挂在**别的成员**名下就被过滤掉，可把重复的隧道端口/主机/账号写进名册 | 已修 |
| [x] | S30-02 | P1 | ``publish.mjs:89-99`（调用点 `ops/provision-worker.mjs:168-176`）` | `markActive` 不看当前状态，`suspended` / `retired` 会被接通 worker 每轮自动改回 `active`，暂停与下架无法生效 | 已修 |
| [x] | S30-03 | P1 | ``provision.mjs:121-144`（调用点 `ops/provision-worker.mjs:288-296`）` | 端口按名册**快照**分配，同一轮出现两个待接通申请时都拿到 18090；端口写进 run 后不再重算，后者永久卡在 `roster_invalid` | 已修 |
| [x] | S30-04 | P1 | ``admin-cli.mjs:375-388`` | `access --with-relay` 每执行一次就新签一份委托发信凭据，旧凭据**不吊销**，重新签发后泄露的旧件仍然能用 | 已修 |
| [x] | S30-05 | P2 | ``admin-cli.mjs:393-397`` | `--out` 覆盖**已存在**文件时权限不变（Node 的 `mode` 只对新建生效），可能把接入件写成 0644 | 已修 |
| [x] | S30-06 | P2 | ``publish.mjs:42-81`、`edit.mjs:130-193`、`admin-cli.mjs:85-92,232-287`` | 三个写入者对同一 `instances.json` / `federation.json` 做「读-改-写」，全程无锁，后台保存与 worker 发布并发时丢更新 | 已修 |
| [ ] | S30-07 | P2 | ``admin-cli.mjs:284-287`` | CLI 先写清单、后写名册，中途失败留下「清单有、名册无」，不回滚；与 `publish.mjs` 的顺序正好相反 | 部分 |
| [x] | S30-08 | P2 | ``provision.mjs:441-451`` | `dns` 步骤只要求「解析得到地址」，不与 `entryHost` 比对；任何 A 记录（包括指向别处）都算通过 | 已修 |
| [x] | S30-09 | P2 | ``admin-cli.mjs:365-380`` | 接入件键名与契约不一致：缺 `XKNOT_HUB_ISSUED_AT`，多出三个契约表里没有的键 | 已修 |
| [x] | S30-10 | P2 | ``relay.mjs:44-66`` | `replyTo` 允许落在 `contact` 的**主机**下的任意地址：contact 写成 gmail 时，可把回复指向该域下别人的地址，用中枢的信誉伪造回信对象 | 已修 |
| [x] | S30-11 | P3 | ``notify.mjs:542,560,578`` | 断连提醒让伙伴「回复本信」，但伙伴信 Reply-To 指向 no-reply、正文又声明不接收回复，回信必退 | 已修 |
| [x] | S30-12 | P3 | ``edit.mjs:30,74-78`` | `MEMBER_FIELDS` 不含 `listed`，循环里的 `if (field === "listed")` 永远走不到 | 已修 |
| [x] | S30-13 | P3 | ``backfill.mjs:44-68`` | 补记申请单直接抄 profile 与清单，不过 `validateApplication`：邮箱不校格式、`region` 缺省写成 `GLOBAL`、名称/简介无长度上限 | 已修 |
| [x] | S30-14 | P3 | ``provision.mjs:184-200,281-311,344-357`` | nginx / sshd 模板把 `domain`、`account` 原样插值，写入前不再按签发规则复校；而清单校验用的 `labelFromUrl` 不套 `LABEL_RE`，`a_b`、`a{b` 这类 `checkLabel` 会拒的标签能进清单 | 已修 |
| [ ] | S30-15 | P3 | ``index.mjs:104-120`` | 清单解析失败时静默沿用上一次缓存，暂停/下架的实例仍可继续委托发信（fail-open） | 部分 |
| [x] | S30-16 | P3 | ``admin-cli.mjs:492,501`、`notify.mjs:820`` | `handoff --ttl 24` 时，交付信与终端提示仍写「72 小时」，与真实过期时间不符 | 已修 |
| [x] | S30-17 | P2 | ``server/admin-cli.mjs`（无测试文件）、`edit.test.mjs`、`provision.test.mjs:227-237`、`publish.test.mjs`` | 587 行的签发/凭据 CLI 完全没有测试；三处测试恰好绕开本轮发现的路径 | 已修 |
| [x] | S31-01 | P2 | ``app.mjs:96-97`（影响 `830` `992` `1046` `1221`）` | 请求体超限时先 `req.destroy()` 再 resolve，socket 已在返回前被销毁，四处 `413 too_large` 分支**永远发不出去**；客户端看到的是连接重置，文档承诺的 413 不可达 | 已修 |
| [x] | S31-02 | P2 | ``app.mjs:128-138`` | 进程内限流器的 Map 只增不删：键过期后不会移除，只有同一个键再次命中时才被 `filter` 重写，公网端点可凭大量来源地址把它撑到无界 | 已修 |
| [x] | S31-03 | P2 | ``app.mjs:1274-1276`（对照 `store.mjs:753`）` | 按账号的登录限流键与真实账号不一致：限流键用 `body.username.toLowerCase()`，查库用 `trim().toLowerCase()`，用户名前后加空格即换一个限流桶，同一账号的「每账号 12 次 / 15 分钟」失效，只剩按 IP 一层 | 已修 |
| [x] | S31-04 | P2 | ``app.mjs:706`（调用点 `1240-1247`、`1404-1413`）` | `dispatchMail` 只把 `buildMail` 包在 `try` 里，`store.beginNotify` 在 `try` 外；它抛错（锁、磁盘）会冒泡成 500，而申请单/领取令牌已经落库，客户端重试得到 `409 duplicate`，永远拿不到 case 链接 | 已修 |
| [x] | S31-05 | P3 | ``app.mjs:1381`（模板参数 `691-697`）` | 管理员补信把整份 `body.context` 展开进模板参数，且展开在 `origin`/`adminEmail`/`replyTo` **之后**，可覆盖发信链接的基址与回信地址：一封信里的所有链接可被指向任意域 | 已修 |
| [x] | S31-06 | P3 | ``app.mjs:1136-1146`` | 案例页两个写操作把失败全吞掉：`readBody` 的 `too_large`/`bad_json` 没检查（`body.publicKey` 变空、正则不过即静默 303），`setPublicKey` 的 `{error:"not_found"}` 也被丢掉，撤回后的单子仍可写公钥 | 已修 |
| [x] | S31-07 | P3 | ``app.mjs:671-682`、`740-750`` | 全文件无一处调用 `notify()`；`mailApplicationReceived` 的 `dedupe` 形参从未被传 `false`，注释里「案例页的重新发送传 dedupe:false」指的路径已不存在（现在靠 `stateVersion: null` 允许补发） | 已修 |
| [x] | S31-08 | P3 | ``app.mjs:893-906`、`1196-1201`` | `/case/:key`、`/claim/:token` 的 GET 完全不限流（每次一个库查询，可无限探键）；`POST /api/claim` 先 `await readBody` 再判限流，顺序与其它端点相反 | 已修 |
| [x] | S31-09 | P3 | ``app.mjs:1164`（对照 `387-393`）` | 进度接口用**子域标签**当实例 id 查清单，而同文件判定「这张单对应哪个实例」用的是 URL 主机：两者一旦分叉（id 由 `manifest.mjs` 按主机名推、`edit.mjs` 又允许改 `url`），`tier` 回落 `free`、`since` 回落到 run 创建日 | 已修 |
| [x] | S31-10 | P3 | ``app.mjs:915-922`` | `/api/health` 在方法与来源检查之前命中，任何方法（含 `DELETE`、`PUT`）都回 200，与 `/api/` 下其余端点「非 GET/POST 一律 405」不一致 | 已修 |
| [x] | S31-11 | P3 | ``app.test.mjs`（1050 行，40+ 用例）` | 三个已发现问题没有任何用例覆盖：16KB 之上的请求体、按账号维度的登录限流、`/api/case/:key/progress` 的实例取值；S31-01 能活下来正是因为没人发过 >16KB 的体 | 已修 |
| [x] | S32-01 | P1 | ``store.mjs:547`` | `setPublicKey` 把外部字符串原样落库，只截长度不校验；该列最终被逐字写进入口主机的 `authorized_keys`，含换行的公钥可注入第二条（可带 `command=` 选项） | 已修 |
| [x] | S32-02 | P1 | ``store.mjs:628`` | 一次性领取令牌既不看申请单状态，也不是原子核销：撤回后的申请，未过期的令牌仍能换出委托发信凭据与隧道账号端口；两次核销都能成功 | 已修 |
| [x] | S32-03 | P1 | ``store.mjs:513`<br>`store.mjs:406`` | 状态迁移是"读-改-写"，UPDATE 无 `where status = ?` 守卫；写库与写审计事件不在同一事务里。与 admin-cli 并行（同为独立进程、WAL + busy_timeout 就是为此配置）时会重复迁移、重复发信；进程被杀则留下"状态已变、无事件"的半完成 | 已修 |
| [x] | S32-04 | P2 | ``store.mjs:51`<br>`store.mjs:375`<br>`store.mjs:406`` | 子域唯一性没有任何数据库约束，查重靠调用方"先查后插"。同一进程内因为两行之间没有 `await` 暂时安全，跨进程（接口进程 + `admin-cli backfill`/`publish`）会写出两条同子域的 `approved` 单，此后 `findOpenBySubdomain` 只返回最近一条 | 已修 |
| [x] | S32-05 | P2 | ``store.mjs:642`<br>`store.mjs:708`` | 发信幂等键在"插入占位"时就永久占住 `(event, case_id, state_version)`：发送失败或限流置成 `failed`/`throttled` 后，同键再发一律 `duplicate:true`，SMTP 抖动一次这封信就再也不发；也没有像 relay 那样的 pending 回收 | 已修 |
| [x] | S32-06 | P2 | ``validate.mjs:96`` | 邮箱是唯一没有"超长即报错"的字段：`text(…,120)` 先静默截到 121 字符，再用正则判，截断处恰好落在域名中段时仍合法，于是**存下的是一个不同的地址** | 已修 |
| [x] | S32-07 | P2 | ``validate.mjs:48`<br>`validate.mjs:113`` | 单个标签没有长度检查：`tagLength:16` 只用于截断，`text(item,16)` 返回最多 17 字符并直接入库，比文档的 16 多一位且永不报错；另外数组入参里的标签可以带空格，字符串入参会被按空白拆开，同一个人同样输入两种结果 | 已修 |
| [x] | S32-08 | P2 | ``store.mjs:1137`<br>`store.mjs:375`` | 预检与提交用的"占用"集合不同：`rejected`/`expired` 的历史单在预检里算空闲、在提交时算重复。用户看到"可用"，提交拿 409 —— 正是代码注释里说要避免的那种反馈 | 已修 |
| [x] | S32-09 | P2 | ``store.mjs:568`` | `provision_runs.run` 的坏 JSON 被静默吞成 `null`，且不会重新入队：这一行存在，`applicationsAwaitingProvision` 的 `left join … is null` 就不再选中它，案例页显示 `run: null`，接通永久停住且无任何告警 | 已修 |
| [x] | S32-10 | P2 | ``store.mjs:1027`` | 回收 stale pending 是 `delete`：若 SMTP 其实已收下、只是 `finishRelay` 没跑完，删掉行等于同时删掉幂等键与投递记录，实例用同一 `idempotencyKey` 重试会**重复投递**一封已发出的信 | 已修 |
| [x] | S32-11 | P2 | ``store.test.mjs:47`` | 108 行里只有 2 个用例，都在测"老库能打开"和"改密码生效"。所有写路径——创建申请、迁移、领取令牌、发信去重、成员码、委托发信额度——零覆盖；两个断言里只有一个真的回读落盘内容 | 已修 |
| [x] | S32-12 | P2 | ``store.mjs:221`` | `migrate()` 没有版本号，每次 `openStore` 都重跑全部数据修正语句，包括 `update applications set status='approved' where status in ('pending','verified','hold')`。从旧备份恢复、或有人手工写一条 `pending` 待审单，下次启动即被静默改成通过 | 已修 |
| [x] | S32-13 | P3 | ``store.mjs:741`` | `deleteAdmin` 先 `count(*)` 再删，两个操作员同时删最后两个管理员会删空，之后只能上机器跑 CLI 建号 | 已修 |
| [x] | S32-14 | P3 | ``store.mjs:188`<br>`store.mjs:675`<br>`store.mjs:971`<br>`store.mjs:984`` | 四处导出没有调用点：`STATUSES`（`ops/profile-schema.mjs` 自带同名常量）、`notifySentFor`、`findRelayDelivery`、`logRelay`；`validate.mjs:26` 的 `LIMITS.note` 与老库 `review_note` 列也没有任何读写方 | 已修 |
| [x] | S32-15 | P3 | ``store.mjs:300`` | `ipHash` 的 secret 有默认值常量 `"xknot"`：任何调用点漏传就静默退化成无盐哈希，而 IPv4 空间只有 2³²，落库的 `ip_hash`（申请单）可被穷举回原地址 | 已修 |
| [x] | S32-16 | P3 | ``validate.mjs:75`<br>`validate.mjs:92`<br>`validate.mjs:108`` | `name`/`operator`/`intro` 只判长度，不拒控制字符、`\r\n`、零宽与双向覆盖符。邮件头已由 `mail.mjs` 的 `stripNewlines` 兜住（不构成头注入），但这些值会原样进内部信正文与门户标签/卡片，可伪造换行排版或把显示顺序颠倒 | 已修 |
| [x] | S32-17 | P3 | ``store.mjs:274`` | 申请编号是 6 位 34 进制（约 1.5×10⁹），主键冲突没有重试：老库累积到万条量级时撞号概率约 3%，撞上就是提交接口 500，且用户看到的是"服务器错误" | 已修 |
| [x] | S33-01 | P2 | ``src/components/NetworkMap.vue:64`、`src/App.vue:93`` | 时钟每 20 秒把整张地图的坐标、弧线与邻接图全部重算 | 已修 |
| [x] | S33-02 | P2 | ``src/components/JoinPanel.vue:124`` | 登录被限流时提示「授权码不对」 | 已修 |
| [x] | S33-03 | P2 | ``src/styles.css:23`、`src/components/NodeCard.vue:428`、`src/App.vue:1032`` | 次要数据文字的对比度只有 2.57:1，低于 AA 的 4.5:1 | 已修 |
| [x] | S33-04 | P3 | ``src/components/NodeCard.vue:134`、`src/lib/i18n.js:121`` | 未知 tier/status 会把键名当文案显示给用户 | 已修 |
| [x] | S33-05 | P2 | ``src/locales/zh-CN.json:166`（对 `e2e/browser/member.spec.mjs:81`）` | 浏览器端到端的断言用的是一句已经删掉的文案 | 已修 |
| [ ] | S33-06 | P2 | ``src/components/`（整个目录无测试）` | 组件层零测试，XSS 回归没有一条用例兜着 | 部分 |
| [x] | S33-07 | P3 | ``src/components/NodeCard.vue:133`、`src/components/JoinPanel.vue:196`、`vite.config.js:18`` | 实例地址直接进 `href`，前端不做 scheme 校核 | 已修 |
| [x] | S33-08 | P3 | ``src/App.vue:530`、`src/components/LangSwitch.vue:80`、`src/components/NetworkMap.vue:895`、`src/components/NetworkMap.vue:847`、`src/components/JoinPanel.vue:486`` | 小屏点击区普遍小于 44px | 已修 |
| [x] | S33-09 | P3 | ``src/App.vue:235`、`src/components/NodeCard.vue:104`、`src/components/NetworkMap.vue:218`` | 计数没走 `Intl.NumberFormat`，同一页两套写法 | 已修 |
| [x] | S33-10 | P3 | ``src/components/JoinPanel.vue:278`、`src/locales/*.json:131`` | 三份 locale 里的 `join.codePlaceholder` 没人用，输入框仍旧写死 | 已修 |
| [ ] | S33-11 | P3 | ``src/lib/i18n.js:26`、`src/components/NetworkMap.vue:66`、`src/lib/world.js:529`、`src/lib/regions.js:65`、`public/logos/xknot-icon.png`` | 多语种/多国分支与若干导出已无生产调用点，母版图还跟着上生产 | 暂缓 |
| [x] | S33-12 | P3 | ``src/components/NodeCard.vue:151`、`src/App.vue:307`` | `v-for` 拿站点自报的标签原文当 key | 已修 |
| [x] | S33-13 | P3 | ``src/lib/contact.js:3`、`xknot.si/README.md:124`` | 注释与 README 仍称门户有「申请表」 | 已修 |
| [ ] | S33-14 | P3 | ``index.html:13`` | 根入口是一张 200 + `<meta http-equiv="refresh">` 的跳转页，生产上永远不被访问 | 暂缓 |
| [x] | S33-15 | P3 | ``src/components/JoinPanel.vue:269`` | 授权码输入框的 label 里塞了一个按钮 | 已修 |
| [x] | S34-01 | P2 | ``xknot.si/ops/build-hub.sh:52`（对 `xknot.si/web/package-lock.json`）` | 锁文件的约束被构建脚本绕过：`npm ci` 只在 `web/node_modules` 目录不存在时执行，锁改了而目录还在就复用旧依赖树，产物无法由锁复现 | 已修 |
| [x] | S34-02 | P3 | ``xknot.si/ops/build-hub.sh:54`、`xknot.si/ops/build-hub.sh:61`` | 整条构建链路关掉漏洞审计，仓库里也没有 CI 或任何 `npm audit` 步骤，86 条锁定的依赖没有一处会被检查已知漏洞 | 已修 |
| [x] | S34-03 | P3 | ``xknot.si/web/package-lock.json:509`、`:518`（引自 `xknot.si/web/src/styles.css:1-2`）` | 两个 OFL-1.1 可变字体以整包方式引入，9 个子集 `.woff2` 全部进 `dist/assets`；本站只有 `en`/`zh-CN`/`zh-TW`，其中 5 个（cyrillic×2、greek、vietnamese×2，约 37KB）没有字符命中。`dist` 里也不带 OFL 许可证文本 | 已修 |
| [x] | S34-04 | P3 | ``xknot.si/web/package-lock.json:533`、`:1251`` | 构建工具链的 Node 版本约束只存在于锁里，manifest 与仓库都没有声明；锁中最严的一条还来自一个 rollup 代码里根本没引用的原生包 | 已修 |
| [x] | S35-01 | P2 | ``App.vue:145-157`` | 非关键的 `/api/locations` 把首屏渲染绑在自己身上。`await places` 写在 `try` 里、`loading` 只在 `finally` 落下，且这次 fetch 没有超时也没有 `AbortController`。接口挂起（Node 进程被占、geoip 读 4.5MB 库、反代卡住）时，`hub.json` 早就回来了页面也永远停在骨架屏，`error` 也一直是 false，用户连「重试」都看不到 | 已修 |
| [x] | S35-02 | P3 | ``App.vue:52-62`、`App.vue:97`` | 清单侧 `status` 的四态在门户完全不生效。`snapshot.js:41` 只滤 `pending`，`buildView` 把 `status` 带进视图，但 `web/src` 里没有任何消费点；筛选与在线计数只读 `health.status`。而 `suspended`/`retired` 按设计不再探测，于是被暂停的实例会带着最后一次 `up` 永久留在目录里、并计入「在线」，卡片上也没有任何「暂停」标记 | 已修 |
| [x] | S35-03 | P3 | ``App.vue:68-71`` | 「最近同步」在自己注释要求「不能用生成时间」的下一行就回落到 `generatedAt`。`checkedAt` 缺失时（新部署、`health.json` 没重建）把构建时间当成同步时间，正好复现注释里说的「把旧数据说成刚刚同步」；而且 `formatWhen` 未传 `timeZone`，跨时区读者看到的日期可能差一天 | 已修 |
| [x] | S35-04 | P3 | ``App.vue:307`` | 标签胶囊的 key 用 `chip.key \ | 已修 |
| [x] | S35-05 | P3 | ``App.vue:121-136`、`App.vue:132`` | 点地图上的点只是「滚一下 + 变色」：`highlight` 不移动焦点，目标卡片没有 `tabindex="-1"` 也没有 `focus()`，键盘/读屏用户点完仍停在那颗 pin 上，得不到「跳到了哪一条」的反馈；同一处 `behavior: "smooth"` 也没看 `prefers-reduced-motion`（`@media` 只关了 `pulse` 与骨架 shimmer） | 已修 |
| [x] | S35-06 | P3 | ``App.vue:162-164`、`App.vue:93-101`` | 20 秒一次的 `now` 不只走卡片时钟，也重建整份 `mapItems`（`localTime` 依赖 `now`）。`NetworkMap` 的 `placed`（`spread` 最多 8 次试探）、`mesh`（每点做一次全量距离排序）、`links` 与所有 pin 每 20 秒全量重算重绘一次，只为刷新标签上的分钟；`visible: visible.value.some(...)` 又让每次重算是 O(n²) | 已修 |
| [x] | S35-07 | P3 | ``App.vue:534-535`、`App.vue:993`、`NetworkMap.vue:895`` | 窄屏触控目标普遍小于 44px：主题/语种旁的图标按钮 32×32、重试键 36 高、手机上的地图点 30×30（内部圆点仅 9px）。360–390px 下这几处是点开主题、重试、跳转实例的唯一入口，相邻地图点还会互相抢手指 | 已修 |
| [x] | S35-08 | P3 | ``App.vue:96`（渲染于 `NodeCard.vue:154`、`NetworkMap.vue:301`）` | 自述区 `name` 只经 `cleanText` 去掉 C0 控制符，零宽与双向控制符原样保留。`name` 同时是卡片标题、地图常驻点名和整张卡片点击层的**唯一可见文字**（`url` 不显示），一个已通过审核的实例可以把自己的名字渲染成另一个站，或用 RTL override 把真实后缀藏到左侧——在联邦目录里等同于身份混淆。这不是 XSS（Vue 转义生效），是展示层欺骗 | 已修 |
