# 待修清单

审计发现（469 条）的逐条台账，数据源是 `todo.json`。已修 430 条已从本清单清除，只留未收口的 39 条。

| 项 | 数字 |
|---|---|
| 原始发现 | 469 |
| 已修（已清除） | 430 |
| **待修** | **39** |
| 部分 | 23 |
| 暂缓 | 13 |
| 复核不成立 | 3 |

级别分布（待修 39 条）：

| P0 | P1 | P2 | P3 |
|---|---|---|---|
| 1 | 0 | 17 | 21 |

## 没有完全收口的

### 部分完成

| ID | 级 | 结论 | 说明 |
|---|---|---|---|
| S03-04 | P2 | 部分 | 凭据可走文件，但仍受 --base 支配 |
| S10-05 | P2 | 部分 | 查询已加 LIMIT 50；无键集分页与保留期，第 51 条以前的未读在界面上不可达且不提示 |
| S10-08 | P2 | 部分 | zip 加密头不再整份转码；readFile 整份读入与 zipNames 同步扫描未改 |
| S10-12 | P3 | 部分 | 可见性口径已统一；附件口径（HAS_ATTACHMENT 等）语义不同，未合并 |
| S10-14 | P3 | 部分 | 补了 points/requests/market 用例；下载打包与计费的端到端用例仍缺 |
| S13-02 | P2 | 部分 | 路由有内外网门；测试只覆盖纯函数与 127.0.0.1，删掉那两行门判断不会红 |
| S13-03 | P2 | 部分 | /api/admin 约三十条端点仍无 HTTP 级覆盖 |
| S13-04 | P2 | 部分 | 删帖与警告已入事务；令牌换发要先落授权码文件，只能是补偿路径 |
| S14-01 | P0 | 部分 | 存储层按 kind 定类型、服务层非媒体强制 attachment；音频仍不校验魔数 |
| S14-06 | P3 | 部分 | 上传响应的附件 url 已置 null；帖子附件视图仍拼 /api/web/uploads/:id，取回 404 |
| S16-04 | P2 | 部分 | 只在 README 约束「一个部署根一个站点」，按站点分槽位未做 |
| S19-06 | P2 | 部分 | 超安全整数已挡；TTL、宽限天数类键仍无 max，能推出 Invalid Date |
| S21-07 | P3 | 部分 | AppButton 的 to 分支补了禁用态；弹窗内分享/打赏仍是自有皮肤 |
| S21-10 | P3 | 部分 | resize 监听改 ResizeObserver；首屏同步整份 JSON.parse 未改 |
| S21-12 | P3 | 部分 | 下载状态机已补测试；打赏弹窗仍未抽成可测模块 |
| S22-07 | P3 | 部分 | 死规则删掉大部分；`.information-preview`、`.demand-reply` 仍有 9 个选择器 |
| S23-20 | P3 | 部分 | reopen 的错误码已能读出；isSale 仍在前端复刻，等后端给字段 |
| S24-06 | P3 | 部分 | 整目录同步 + 部署前拦截越界 import；纯函数下沉未做 |
| S30-07 | P2 | 部分 | 写入顺序已统一；第二份写失败时未回滚第一份 |
| S30-15 | P3 | 部分 | 清单解析失败改为 fail-closed，但没有可注入路径，只做静态核对 |
| S32-07 | P2 | 部分 | 标签长度已上限；字符串入参按空格拆分、数组入参不拆，两种入口不一致 |
| S33-06 | P2 | 部分 | 补了视图清洗用例；组件测试缺依赖 |
| S33-10 | P3 | 部分 | 占位符已接 t()；`portal.title` 仍是只被测试引用的死键 |

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
| S03 | 2 |
| S05 | 2 |
| S08 | 1 |
| S10 | 5 |
| S11 | 1 |
| S13 | 3 |
| S14 | 2 |
| S16 | 3 |
| S19 | 1 |
| S21 | 4 |
| S22 | 2 |
| S23 | 1 |
| S24 | 1 |
| S28 | 1 |
| S29 | 3 |
| S30 | 2 |
| S32 | 1 |
| S33 | 4 |

## 清单

| 勾选 | ID | 级 | 位置 | 问题 | 处理 |
|---|---|---|---|---|---|
| [ ] | S03-04 | P2 | ``bench/scripts/run.mjs:169-180,231`；`bench/scripts/probe.mjs:306-310`；`bench/human/visitor.mjs:31`` | 授权码与会话 cookie 不和 `--base` 绑定：`runK6` 把 `KNOT_AGENT_TOKEN` 放进子进程环境，`probeSite(BASE, { token })` 先发 `Authorization: Bearer` 再按 401 判断有效性——目标是哪台就把码发给哪台（`--base` 打错一位就等于把码交给陌生主机记日志）。另外 `probe.mjs --token <码>`、`visitor.mjs --cookie <sid>` 走 argv，会进 `ps` 和 shell 历史，与 README「只从环境变量或显式 `--token-file` / `--cookies-file` 读，不打印、不落盘」相矛盾。 | 部分 |
| [ ] | S03-10 | P2 | ``bench/human/visitor.mjs:128-145`` | `--allow-writes` 会对 `/api/web/uploads` 上传一张 PNG，从不删除，也没有对应的删除调用。每次 `human` 跑 `VIEWPORTS × RUNS` 次就多若干张孤儿图，只能等后端 `gc-uploads.mjs` 在 24h 宽限期后回收（前提是 GC 被定时跑到）。k6 侧的 `write.js` 同类：上传了图却从不把它挂到帖子上。 | 暂缓 |
| [ ] | S05-03 | P3 | ``knot-platform/package-lock.json:2928`<br>`knot-platform/package-lock.json:3619`` | `qrcode` 把它的**命令行**依赖 `yargs@15` 一起拖进生产闭包，26 个包只为一个从未被调用的 CLI 服务，占生产闭包 205 条的 14%，每个发布包都随身携带 | 暂缓 |
| [ ] | S05-05 | P3 | ``knot-platform/package-lock.json:1588`<br>`knot-platform/package-lock.json:3574`<br>`knot-platform/package-lock.json:2532`<br>`knot-platform/package-lock.json:3065`` | 3 组同包多版本共存，均为 dedupe 未命中，无功能风险，记录以免后续被误当成漏洞重复计数 | 不成立 |
| [ ] | S08-16 | P3 | ``admin.js:669`` | 管理端展示的帖子正文被 Backend 裁到 400 字，页面没有任何「已截断」标记。管理员据残缺内容决定删帖或警告，长文的后半段从未被看到 | 暂缓 |
| [ ] | S10-05 | P2 | ``src/notifications.js:25-32`；`src/requests.js:11,39,78,131`` | 通知箱与 wish 四张列表（我发出的、我响应的、我看过的、某条 wish 的响应）都没有 `LIMIT`/分页，全量取回后在内存里 map。`notifications` 只增不删且无清理任务，单账号长期使用可到万级，每次 `/api/web/notifications` 都整箱穿过入口隧道 | 部分 |
| [ ] | S10-08 | P2 | ``src/readable.js:114-127`；`src/market.js:113-126`` | 发布路径的附件校验把整个文件读进内存（`readFile`，附件上限 50 MiB），随后 `encryptDict` 两次 `buffer.toString("latin1")` 全量复制（头部再一份），`zipNames` 也是全量扫描。一次发布最坏产生数百 MB 字符串并同步阻塞事件循环；`pdfOpens`/`zipNames` 全同步，期间整个 Backend 不响应其它请求 | 部分 |
| [ ] | S10-10 | P3 | ``src/handoff.js:86-100`` | 30 天管理凭据是无状态 HMAC，没有任何吊销手段：登出、换机器、怀疑泄漏都只能整体轮换 `KNOT_ADMIN_TOKEN`，会把所有在用凭据与票据一起作废。凭据里也没有绑定「发给谁/哪台机器」 | 暂缓 |
| [ ] | S10-12 | P3 | ``src/information.js:9-11`；`src/preview.js:39-41`；`src/retrieval.js:147`` | 同一句「什么算可见」有三套写法：`visibleVerdict()` 生成 `IN ('pending','passed')`、`preview.js` 手写同样的比较、`existingResponseId` 用 `verdict NOT IN ('rejected','removed')`。后两者在新增 verdict（如 `draft`）时会静默走岔；附件判据更散（`HAS_ATTACHMENT` SQL、`isDownloadableFile`、`packetZip.kindOf`、`isAttachmentUpload` 计费口径，代码注释自己也写了「三处必须一致」） | 部分 |
| [ ] | S10-14 | P3 | ``src/market.test.js`；缺 `retrieval.test.js`、`requests.test.js`` | 账务与发布主路径无测试：`createIntel`、`downloadPacket`/`chargeDownload`/`unlockRequest`、`applyPoints` 的「扣款 + 入账 + 幂等」在片内没有用例（`market.test.js` 只覆盖列表/搜索/删除/重开）；`retrieval.js`（重试上限、`existingResponseId` 去重、失败通知）与 `requests.js`（wish 列表与查看权限）整文件无测试。S10-02/S10-04/S10-07 都能被一条用例抓住 | 部分 |
| [ ] | S11-12 | P3 | ``admin.js:601`、`routes/admin.js:491`` | 管理端删除不记操作者：`removePost` 的 `actorId` 默认 `null`，管理面调用不传，`admin_actions.actor_account_id` 恒为 `NULL`；只有 WebUI 的 `/api/web/intel/:id/close` 会填 | 不成立 |
| [ ] | S13-02 | P2 | ``knot-platform/backend/src/admin.test.js:588`` | 内网门（非内网一律 404）只在纯函数层被测，路由中间件那一步从未执行 | 部分 |
| [ ] | S13-03 | P2 | ``knot-platform/backend/src/admin.test.js:588-621`、`:1082-1125`、`:1127-1188`` | `/api/admin` 约 35 个端点只有 9 个有 HTTP 用例，权限最敏感的几条一个都没有 | 部分 |
| [ ] | S13-04 | P2 | ``knot-platform/backend/src/admin.js:396-401`、`:531-534`、`:614-624`、`:899-900`` | 审计行与业务变更不在同一事务，失败会留下半完成状态；测试把所有 `admin_actions`/`notifications` 的 mock 都设成成功，这条路径零覆盖 | 部分 |
| [ ] | S14-01 | P0 | ``uploadStore.js:150-152`；`routes/web.js:167-175`、`385-399`、`506-507`` | 非图片上传（`kind` 为 audio/file）既不做内容校验，也不归一 MIME：客户端 multipart 里的 `Content-Type` 原样入库。`/api/web/audio` 的过滤器按**扩展名**放行（`isAudioUpload`），于是「文件名 `.mp3` + `Content-Type: text/html` + HTML 正文」能通过；`GET /api/web/uploads/:id` 用 `res.type(row.mime)` 内联回源。音频会写进 `intel_files`，公开帖上的音频被 `mediaAudience` 判为 `public`，任何访客/管理员打开该 URL 就在站点同源执行脚本（Cookie 是 HttpOnly，但可代受害者调接口、以管理员身份操作） | 部分 |
| [ ] | S14-06 | P3 | ``uploadStore.js:210`；`routes/web.js:450-467`` | 所有 `kind` 都返回 `/api/web/uploads/{id}`。附件的 `original_name` 命中 `isAttachmentUpload` 时 `readableUpload` 直接返回 null，所以 `/api/web/files` 与 `/api/agent/uploads` 给附件返回的 `url` 恒为 404，而文档把它写成正常返回字段 | 部分 |
| [ ] | S16-04 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:250`、`:371`、`:544`–`:556`；`knot-platform/ops/launchd/com.knot.platform.plist:8`` | `--site` 只区分配置目录，运行实例（`current`、`releases/`、`deployed.json`、`var/run/backend.pid`、LaunchAgent label `com.knot.platform`）按部署根共用。同一部署根下两个站点会互相顶掉：部署 B 把 A 的 `current` 也切走，A 的服务重启后跑的是 B 的代码；`KNOT_DEPLOY_KEEP` 清理只保护「本站点」的 current 与 previous，另一个站点的活动版本会被当旧包删掉 | 部分 |
| [ ] | S16-10 | P2 | ``knot-platform/ops/scripts/ensure-openclaw.sh:104`–`:110`；`knot-platform/ops/openclaw/skills/knot-admin/admin.mjs:277`–`:286`；`knot-platform/ops/openclaw/agents/knot-admin/USER.md:7`` | 管理与精算两个智能体共用同一把 `KNOT_ADMIN_TOKEN`，并各自落在同一 OS 用户的工作区里；`knot-intel` 处理的是外部提交的不可信文本，却与这两个目录同用户、同父目录，权限模型上没有任何隔离。而 `USER.md` 把「操作这台机器上 OpenClaw 的人」一律当主人 | 暂缓 |
| [ ] | S16-13 | P2 | ``knot-platform/ops/scripts/deploy-site.sh:1`–`:550`；`knot-platform/ops/scripts/backup-knot.test.mjs:61`–`:75`` | 风险最高的 550 行部署脚本（`rm -rf`、切换 `current`、KEEP 清理、迁移失败/探活失败回滚）没有任何自动化测试；备份测试全程只跑 `--config-only`，`pg_dump`、上传目录、全量 KEEP 清理都不在执行路径上 | 暂缓 |
| [ ] | S19-06 | P2 | ``schema.mjs:1032-1041`` | `int`/`port`/`bytes` 只做 `/^\d+$/` 与 `Number()`，没有 `Number.isSafeInteger`；无 `max` 的键也没有任何上限。超出安全整数的值通过校验后进入金额、TTL 与日期运算 | 部分 |
| [ ] | S21-07 | P3 | ``CardShareDialog.vue:100-116`、`CardTipDialog.vue:166-177`、`ShareComposer.vue:229-253`、`SnapComposer.vue:177-185`、`MentionPicker.vue:57-64`、`AppButton.vue:17-21`` | 弹窗与编辑器里的主/次操作自绘皮肤，没走 `AppButton`：分享弹窗三个动作（`.card-share-action`）、打赏金额预设（`.tip-preset`）、分享条五个动作（`.share-action`）、快拍的提及触发器（`.mention-trigger`）、提及胶囊（`.mention-chip`）。这些不属于规则里明确豁免的导航/胶囊/`.post-action`，属于「另写一套按钮皮肤」。另外 `AppButton` 的 `to` 分支不接 `disabled`/`aria-disabled`，链接形态下禁用会静默失效。 | 部分 |
| [ ] | S21-09 | P3 | ``discoverBoard.js:90-104`、`routes/web.js:811-812`、`docs/KNOT_WEB_API.md:96-97`` | 「点赞」是完整的一条链：后端 `POST/DELETE /api/web/intel/:id/like` 有实现、文档有写、公开快照与 `discover-self` 都回 `liked`，`applyDiscoverSelf` 也把它贴到每条卡片上——但 WebUI 没有入口，`api.js` 里没有对应函数，卡片模板也不渲染。等于每次快照都多带一个没人用、没人写的字段。 | 暂缓 |
| [ ] | S21-10 | P3 | ``InformationCard.vue:136-141`、`boardCache.js:29-36`` | 两条与体量有关的小开销：①信息流里每张卡各挂一个 `window.resize` 监听，回调里同步读 `scrollHeight`/`clientHeight`，30 张卡拖窗口就是 30 次强制重排；②`readBoardCache` 在首屏同步 `JSON.parse` 整份快照（30 条信息+图片宽高+wish），在低端机上会占住主线程。 | 部分 |
| [ ] | S21-12 | P3 | ``download/consent.js:61-75`、`download/consent.test.js`、`CardTipDialog.vue:111-130`` | 钱相关的两个交互没有测试：下载确认的状态机（`acceptDownload`/`settleDownload`/`dismissDownload`/`runTask`）只测了纯函数 `downloadOffer` 四条；打赏弹窗（改金额、并发摘要、成功后回写余额）没有任何测试。这两处恰好是「扣多少、扣没扣」的地方，回归只能靠手点。 | 部分 |
| [ ] | S22-07 | P3 | ``knot-platform/web/src/styles.css:1372`–`:3445` 区间内 73 条规则` | 已删除组件的整段样式还留着，共 73 条规则、429 行 | 部分 |
| [ ] | S22-08 | P3 | ``knot-platform/web/src/styles.css:266`、`:289`、`:298`、`:321`、`:345`` | 顶栏搜索整套样式（`.header-search`、`.search-field`、`.search-backdrop`、`.search-sheet`、`.search-history`、`.search-recent`，以及 `:259` 的 `body:has(.release-note) .search-sheet`）当前永不渲染 | 不成立 |
| [ ] | S23-20 | P3 | ``views/SubmissionsView.vue:51`、`views/SubmissionsView.vue:72`` | `isSale` 在前端复刻了一遍后端「出售帖」规则（`post/fastpost` + 有 `stored` 附件 + 价格 > 0），后端规则一改这里就漂；`reopen` 的 `catch` 丢掉 `error.code`，任何失败都显示 `error.request_failed`（`bad_state`、`not_found` 都读不出来） | 部分 |
| [ ] | S24-06 | P3 | ``server/validate.mjs:13`、`ops/deploy-api.sh:80-81`` | 接口进程直接 `import "../web/src/lib/regions.js"`（另有 `i18n.js`），跨过「server 只读 dist」的边界。部署靠 `deploy-api.sh` 手工列举两个文件；接口再引入第三个 `web/src/lib/*` 时本地与单测全绿、远端 `ERR_MODULE_NOT_FOUND` 起不来 | 部分 |
| [ ] | S28-07 | P2 | ``xknot.si/ops/fetch-guard.mjs:131`、`:190`` | 校验与实际请求是两次独立解析：先 `resolve(host)` 判公网，再按主机名 `fetch(url.toString())`，中间可被 DNS rebinding 换成内网地址；检查结果没有钉到已校验的 IP | 暂缓 |
| [ ] | S29-05 | P2 | ``xknot.si/ops/xknot-provision.service:13-22`` | 这个单元把一个常驻、由网络输入驱动的进程放在无沙箱位置：`NoNewPrivileges=no`、无 `ProtectSystem`/`ReadWritePaths`、`Restart=always`，而它要「建账号、写 sshd 与 nginx 配置」。同机还托管 `wang`、`zjj`、`aiugc`，worker 手里的权限等于整机 nginx/sshd 的写权限——它出一次错，受伤的不止 xknot.si。仓库里没有 sudoers 白名单，实际授权面在主机上（见「需运行验证」） | 暂缓 |
| [ ] | S29-08 | P2 | ``xknot.si/ops/xknot.si.conf:127-128`` | `/case/`、`/claim/` 只关掉了访问日志，注释的理由是「链接本身就是能力凭据，不能写进访问日志」。但 nginx 在 upstream 超时/连接失败时写的 error 级日志会带 `request: "GET /claim/<token> HTTP/1.1"`，整条能力凭据就落到 `/var/log/nginx/error.log`（`adm` 组可读、会被日志采集收走）。`access_log off` 管不到这一路；接口重启、SQLite 锁、`proxy_read_timeout 20s` 到期都会触发 | 暂缓 |
| [ ] | S29-14 | P3 | ``xknot.si/ops/xknot.si.conf:62`` | CSP 里 `script-src 'self' 'unsafe-inline'`，同源任何一处 HTML 注入都能直接执行脚本；这个源上同时挂着 `/admin` 与 `/api/admin`。`/knot-help` 由 markdown 直出 HTML（S28-05 报告了那条未清洗的渲染路径），这条 `unsafe-inline` 正好去掉了剩下的那道闸 | 暂缓 |
| [ ] | S30-07 | P2 | ``admin-cli.mjs:284-287`` | CLI 先写清单、后写名册，中途失败留下「清单有、名册无」，不回滚；与 `publish.mjs` 的顺序正好相反 | 部分 |
| [ ] | S30-15 | P3 | ``index.mjs:104-120`` | 清单解析失败时静默沿用上一次缓存，暂停/下架的实例仍可继续委托发信（fail-open） | 部分 |
| [ ] | S32-07 | P2 | ``validate.mjs:48`<br>`validate.mjs:113`` | 单个标签没有长度检查：`tagLength:16` 只用于截断，`text(item,16)` 返回最多 17 字符并直接入库，比文档的 16 多一位且永不报错；另外数组入参里的标签可以带空格，字符串入参会被按空白拆开，同一个人同样输入两种结果 | 部分 |
| [ ] | S33-06 | P2 | ``src/components/`（整个目录无测试）` | 组件层零测试，XSS 回归没有一条用例兜着 | 部分 |
| [ ] | S33-10 | P3 | ``src/components/JoinPanel.vue:278`、`src/locales/*.json:131`` | 三份 locale 里的 `join.codePlaceholder` 没人用，输入框仍旧写死 | 部分 |
| [ ] | S33-11 | P3 | ``src/lib/i18n.js:26`、`src/components/NetworkMap.vue:66`、`src/lib/world.js:529`、`src/lib/regions.js:65`、`public/logos/xknot-icon.png`` | 多语种/多国分支与若干导出已无生产调用点，母版图还跟着上生产 | 暂缓 |
| [ ] | S33-14 | P3 | ``index.html:13`` | 根入口是一张 200 + `<meta http-equiv="refresh">` 的跳转页，生产上永远不被访问 | 暂缓 |
