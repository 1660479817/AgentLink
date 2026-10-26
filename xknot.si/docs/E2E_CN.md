# 本地部署与端到端测试

这份文档说明怎么在本机把中枢完整跑起来，以及自动化测试覆盖了什么、没覆盖什么。
验收清单在 [HUB.md](HUB.md) 第 8 节；这里把其中可自动化的部分落成脚本。

## 1. 本地部署形态

线上是两个进程：`systemd` 的 `xknot-api` 只监听回环，nginx 提供静态站并把
`/api/`、`/admin/` 反代过去。本地按同样的分工拆成两个进程：

```text
浏览器
  │  http://127.0.0.1:5190
  ▼
ops/local-hub.mjs        静态站 + 反代 + 安全头（复刻 ops/xknot.si.conf）
  │  /api/*  /admin/*
  ▼
server/index.mjs         127.0.0.1:5181，SQLite 在 var/e2e/<run>/data
```

`ops/local-hub.mjs` 不是生产服务器，但它刻意对齐了线上行为：

| 路径 | 行为 |
|------|------|
| `/` | 302 到 `/en/` |
| `/en/`、`/zh-CN/`、`/zh-TW/` | 目录索引，`cache-control: no-cache` |
| `/assets/*` | 长缓存 `max-age=31536000, immutable` |
| `/data/hub.json` | 构建写出的快照，`no-cache` |
| `/admin` | 301 到 `/admin/`（对应 nginx 的精确匹配） |
| `/admin/*` | 反代，只补 HSTS 与 `X-Robots-Tag`，CSP 由接口自己发 |
| `/case/*`、`/claim/*` | 反代到接口，补 `X-Robots-Tag: noindex`；页面自己发 CSP 与 `no-store` |
| `/api/*` | 反代，补 server 级安全头与 `X-Forwarded-For`（追加，不覆盖） |
| 其它 | 404，`..` 与 `%2e%2e` 出不了 `web/dist` |

一键启动：

```bash
cd xknot.si
npm run deploy:local                 # 校验 → 构建 → 起接口 → 起入口，127.0.0.1:5190
npm run deploy:local -- --no-build   # 复用 web/dist
npm run deploy:local -- --preview    # 门户并入 fixtures 样例
npm run deploy:local -- --admin paul:correct-horse-battery
npm run deploy:local -- --port 8080 --data-dir /tmp/xknot
```

启动后终端会打印门户、控制台、接口与数据目录。`Ctrl-C` 一起收掉两个进程。
数据落在 `var/local/`（`--data-dir` 可换），**不删**：重启后申请、发信记录、
委托发信日志都还在。`5180/5181` 留给 `npm run dev`，部署默认占 `5190`。
端到端测试另起随机端口与临时目录，跑完即删。

### 测试清单覆盖

接口默认读仓库根目录的 `instances.json`，名册读 `federation.json`。本地联调与端到端可以用
`XKNOT_INSTANCES_FILE` 与 `XKNOT_FEDERATION_FILE` 指向临时副本，接口与 `admin-cli`（含 `publish`）
都认这两个变量，仓库里的文件不会被改。控制台的「编辑」会写回接口正在读的那两份文件，
所以浏览器用例启动时把两份清单各拷一份到临时目录，再通过
`node ops/local-stack.mjs --instances <file> --federation <file>` 指过去。

```bash
XKNOT_DATA_DIR=/tmp/xknot-data \
XKNOT_INSTANCES_FILE=/tmp/xknot-instances.json \
XKNOT_FEDERATION_FILE=/tmp/xknot-federation.json \
npm run api
```

## 2. 测试分层

| 层 | 命令 | 跑什么 | 依赖 |
|----|------|--------|------|
| 单元 | `npm test` | 清单与名册校验、页面数据、接口与邮件纯函数 | Node，无网络 |
| 接口端到端 | `npm run test:e2e` | 真 HTTP、真 SQLite、真 SMTP 会话、真 CLI | Node + `web/dist` |
| 浏览器端到端 | `npm run test:ui` | 真 Chromium 跑门户、申请表、控制台 | Playwright + Chrome + `web/dist` |
| 全量 | `npm run test:all` | 上面三项依次跑 | 同上 |

两套端到端都从 `web/dist` 读静态站，干净检出先构建一次：

```bash
npm run build -- --offline   # 跳过伙伴探活，其余与 npm run build 相同
```

缺 `web/dist` 时本地栈会直接报「先 npm run build」，不会只在某条断言上失败。

浏览器测试首次使用需要装依赖：

```bash
npm --prefix e2e install
```

默认借本机已装的 Chrome，不下载浏览器。要用 Playwright 自带的那份：

```bash
npm --prefix e2e run install:browser
E2E_CHANNEL= npm run test:ui
```

## 3. 隔离与夹具

每个端到端文件自己起一套部署，互不共享端口、数据库与限流计数：

- 端口由内核分配；数据目录是 `var/e2e/<随机>`，退出时删除（`startStack({ keep: true })` 可保留）。
- 接口环境里的 `SMTP_*`、`XKNOT_*` 会被清空再按用例注入，不受开发机 shell 影响。
- `DEFAULT_MANIFEST` 提供两个实例：`e2e-node`（active）与 `e2e-paused`（paused），
  用来验证委托发信的放行与拒绝。
- 浏览器测试用 `--preview`：`fixtures/` 的样例条目、健康状态、橱窗与活动数据并进
  当次快照，不依赖外网和伙伴站点。
- 委托发信不 mock `mailer`：`e2e/smtp-sink.mjs` 起一个最小 SMTP 收信端，
  `server/mail.mjs` 的完整会话（EHLO → MAIL FROM → RCPT TO → DATA）都会被走到。
- 限流用例单独一个文件：接口按来源地址计数，同一进程里所有请求共享一个桶。

## 4. 用例清单

### 4.1 静态站与快照（`e2e/api.e2e.test.mjs`）

- 根路径 302 到 `/en/`；三个语种入口都能打开，`lang` 与 `hreflang` 一致。
- HTML 带齐 CSP、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、HSTS。
- 带哈希的 `/assets/` 长缓存，HTML 与 `hub.json` 每次回源。
- `hub.json` 只含清单里的实例；没有探测/橱窗/活动数据时是 `null` 与 `[]`，不写 0。
- 未知路径、路径穿越、`/admin` 白名单外的文件都是 404。

### 4.2 申请与自动通过（`e2e/api.e2e.test.mjs`）

- 缺少字段按字段返回错误码；跨站 POST 403；蜜罐填了回 201 但不落库。
- 正常提交 201，编号形如 `XK-YYYY-XXXXXX`，状态直接是 `approved`；同一子域再提 409。
- 提交后收到两封信：申请人拿到批准信（含地址、档位与 `/case/` 链接），运营方拿到新成员提醒；伙伴信 `Reply-To` 是 `XKNOT_MAIL_REPLY_TO`（缺省取 `MAIL_FROM`，即 `no-reply@<中枢域名>`），正文写明不接收回复。
- 没有 `/verify/` 页面与 `/api/verify` 接口；申请不会停在待确认。
- `/case/<caseKey>` 可看状态、提交公钥与撤回。
- 未登录 401，伪造 Cookie 401，错密码 401；登录 Cookie 带 `HttpOnly`、`SameSite=Strict`、`Path=/`。
- 已通过列表能看到申请，`reviewedBy` 为 `auto`；生成的清单条目过 `checkManifestEntry`，默认 `tier: free`。
- 审核接口已移除，再调返回 404；退出后会话立刻失效。
- `handoff` 生成一次性领取链接：`GET /claim/<token>` 不消费，`POST /api/claim` 只返回一次明文，再取 409；邮件正文不含凭据。
- 重发交付会作废上一封里的链接：再领返回 410，且不透露任何内容；`notify` 拒绝 `partner.handoff`。

### 4.3 委托发信（`e2e/relay.e2e.test.mjs`）

- 运维命令 `admin-cli relay-token` 签发的凭据能发信；收件方看到 `From` 是 `MAIL_FROM`，
  `Reply-To` 默认用实例 `contact`，报文带 `X-XKnot-Instance`。
- `GET /api/federation/mail` 返回 24 小时额度；同一幂等键重试不重复发信。
- 字段非法按字段拒绝：`to` 带显示名、`subject` 带换行、`replyTo` 落到外部域名。
- 缺凭据、伪造凭据 401；实例暂停后立刻 403（改清单不用重启接口）；吊销后 401。
- 按实例开关：`relay-disable` 后 403 `relay_disabled`，`relay-enable` 后同一个凭据直接能继续发，不需要重签或重启。
- 中枢总闸：`/admin` 点 OFF（或 `settings.mail=off`）后，代发与额度查询都 503 `relay_unavailable`，伙伴信不发也不写 `notify_log`；点回 ON 后同一个凭据立刻能发。
- 每日额度用完 429；单凭据每分钟第 7 封 429。
- SMTP 不可用 502，`relay-log` 记 `failed`，日志里没有正文与完整地址。

### 4.4 限流（`e2e/limits.e2e.test.mjs`）

- 提交每小时第 9 次起 429，带 `retry-after`。
- 登录每 15 分钟第 13 次起 429。

### 4.5 浏览器（`e2e/browser/*.spec.mjs`）

| 文件 | 覆盖 |
|------|------|
| `portal.spec.mjs` | 按 `hub.json` 渲染全部卡片、地图可见、入口回原站；三语切换与 `aria-current`；深浅色；区域筛选与「只看在线」；「只看热点」；360/390/768/1280 无横向溢出；键盘可达与表单 label；CSP 下无脚本错误 |
| `member.spec.mjs` | 右栏只有邮箱一格与四步加入指引、没有申请表；邮箱不完整不发请求；从真实邮件取授权码登录后看到本站状态、健康与计数；退出后状态不残留；390px 下两格与登录键不小于 44px、右栏不溢出 |
| `admin.spec.mjs` | 登录失败提示；登录 → 打开已通过申请 → 生成清单条目 → 退出；点实例就地展开配置；就地编辑配置、非法值不落盘、草稿不丢；已通过的申请不再给审核动作、列表也不重复；CSP 下无脚本错误 |

浏览器用例还会断言页面**没有** `pageerror`、没有 CSP 违规。这条断言抓到过两类真实问题：
内联样式被控制台 CSP 拦截、字体被 Vite 内联成 `data:` 后被 `font-src 'self'` 拦截。

## 5. 与 HUB.md 验收清单的对应

| HUB.md 第 8 节 | 自动化 |
|----------------|--------|
| 清单/名册校验返回码、名册规则 | `npm test`（`ops/*.test.mjs`） |
| 区域筛选、卡片网格、热点开关、`只看在线` | `portal.spec.mjs` |
| 360/390/768/1280 可读可点、不横向溢出 | `portal.spec.mjs` |
| 除申请外不发写请求、只请求同源数据 | `portal.spec.mjs` 的网络与渲染断言、CSP |
| 申请表逐项报错、编号格式、重复提示 | `join.spec.mjs`、`api.e2e.test.mjs` |
| 未登录 401、自动通过与清单条目 | `api.e2e.test.mjs`、`admin.spec.mjs` |
| 跨站 POST 403、连续提交 429 | `api.e2e.test.mjs`、`limits.e2e.test.mjs` |
| 凭据签发/吊销、额度、幂等、SMTP 故障 | `relay.e2e.test.mjs` |
| 接口重启后数据仍在 | 由 SQLite 落盘保证；`relay-log` 与申请用例跨 CLI/接口读同一库 |

## 6. 仍需要人工或上线前的检查

自动化不替代这些：

- **真实伙伴探测**：`check-health.mjs`、`fetch-cards.mjs`、`fetch-stats.mjs` 对外网的
  SSRF 守卫与超时，只在真实构建里验证；端到端用的是 `--offline`/`fixtures`。
- **TLS、DNS、证书**：Cloudflare、Certbot、HSTS 的真实生效。
- **nginx 与 systemd**：配置语法（`nginx -t`）、开机自启、日志轮转、备份与回滚
  （`ops/README-deploy-aws.md`）。
- **真实 SMTP**：服务商的 AUTH、STARTTLS、退信；本地 sink 只验证协议与业务规则。
- **浏览器矩阵**：自动化只跑 Chromium；Safari/Firefox 的 `Intl.DisplayNames`、
  `container-type`、`datalist` 表现仍需抽查。
- **大体量数据**：上千实例时地图与目录的性能。

## 7. CI 建议

```bash
npm ci                 # 或按现有流程
npm --prefix web ci
npm --prefix e2e install
npm run build -- --offline
npm test
npm run test:e2e
npm run test:ui
```

- 浏览器默认用系统 Chrome；runner 没有 Chrome 时先 `npm --prefix e2e run install:browser`
  并设 `E2E_CHANNEL=`。
- `e2e/test-results/`、`e2e/report/` 是失败产物与 HTML 报告，不进版本库。
- 端到端不访问外网；CI 可以断网跑（`--offline` 构建 + `--preview` 数据）。

## 8. 排障

| 现象 | 原因与处理 |
|------|------------|
| `web/dist 不存在` | 先 `npm run build`，或去掉 `--no-build` |
| `listen EADDRINUSE` | 上一次的栈没退干净；`lsof -iTCP:<port> -sTCP:LISTEN` 后结束进程 |
| 浏览器用例报 “Executable doesn't exist” | 本机没有 Chrome：装 Chrome，或 `install:browser` 后 `E2E_CHANNEL=` |
| 429 出现在不该出现的用例里 | 同一套栈里的提交/登录共享计数桶；给该用例单独 `startStack()` |
| 页面字体与设计稿不符 | 检查 CSP 是否为 `font-src 'self'`，以及构建是否又把字体内联成了 `data:` |
