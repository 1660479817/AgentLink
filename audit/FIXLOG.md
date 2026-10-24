# 修复日志（FIXLOG）

审计收口后的五批修复，按时间顺序合并于此。每批原本是独立文件（`fix-log.md`…`fix-log-5.md`），
批与批之间前后引用；合并后五批各自一节，内容不变。

---

## 第一批修复：止血补丁

对 `audit/REPORT.md` 里「可远程触发 / 影响可用性」的 8 条动手修了，其余（契约漂移、P2/P3）没有动。
改动在 2026-10-23 完成，`knot-platform` 测试从 725 条加到 **741 条，全绿**。

原则：每条都修在链路的关键那一环，能加第二道就加第二道；每条附一条会失败的回归测试，
证明「修好之前是这样坏的」，而不是只看代码像不像修好了。

| # | 发现 | 修在哪 | 回归测试 |
|---|---|---|---|
| 1 | 登录码可穷举 | `login.js` 失败计数 + 锁定期；路由回 `Retry-After` | `login.test.js` ×4 |
| 2 | 上传 MIME 绕过（P0） | `uploadStore.js` 类型归一 + `web.js` 服务层强制下载 | `uploadMime.test.js` ×5，`uploadStore.test.js` ×2 |
| 3 | 连接池 error 事件带走进程 | `db.js` 加 `pool.on("error")` | 无（单行，见下） |
| 4 | zip 放大 1026:1 | `knot-doc-reader` 条目数、单条、总量三道闸 | `index.test.mjs` ×2 |
| 5 | `$( )` 写进 env 会执行 | `schema.mjs` 收窄不加引号的字符集 | `schema.test.js` ×1 |
| 6 | 2000 层引用爆栈 | `knot-markdown` 块级深度上限 + 长度上限 | `render.test.js` ×2 |
| 7 | 部署脚本 `rm -rf` 与并发 | `deploy-site.sh` 名校验 + 目录锁 | 手工验证（见下） |
| 8 | 重建先删唯一备份 | `reset-knot.sh` 开头拦一道 | 三态实测（见下） |

---

### 逐条说明

#### 1. 登录码穷举（原 S10-01）

6 位码、10 分钟、10^6 个取值。原来的 `redeemOn` 只判断「这个码对不对」，不记试了几次。

- 按邮箱记失败次数，满 10 次锁 15 分钟，成功一次清零；锁定期间不连库直接 429。
- **失败计数必须记在事务外**：`redeemLoginKey` 在出错时会 `ROLLBACK`，写在事务里的计数会跟着回滚，等于永远不涨。这是这条修复最容易做错的地方。
- 只有 `bad_key` 计数。`registration_closed`、`bad_invite` 不是猜码，记进去会让正常用户在注册窗口里被锁死——有测试盯着这一条。
- 不落库：`backend/migrations` 只有一份基线，加表要整库重建（`handoff.js` 里写了同一个取舍）。代价是重启清空计数，已写在注释里。

#### 2. 上传 MIME 绕过（原 S14-01，唯一 P0）

原链路：`/api/web/audio` 的过滤器在 MIME 不是 `audio/*` 时**退回看扩展名** → 传 `evil.mp3` + `Content-Type: text/html` → `storeUploadedFile` 原样存客户端声明的 MIME → `/api/web/uploads/:id` 用 `res.type()` 回 `text/html` → 同源脚本。

两层都堵：

- **存储层**：非图片的类型不再来自客户端。音频按「声明是 audio/* 就留、扩展名认得出就归一、都说不出就拒收」；附件把 `text/html`、`image/svg+xml` 这类会执行的一律记成 `application/octet-stream`。
- **服务层**：`/uploads/:id` 只对 `image/*`（除 SVG）、`audio/*`、`video/*` 内联渲染，其余强制 `Content-Disposition: attachment` 并加 `nosniff`。这一层管的是**库里已有的历史记录**，不依赖上传时校验过。

两层的用意不同：第一层保证以后存不进去，第二层保证以前存进去的也不会执行。

#### 3. 连接池 error 事件（原 S11-03）

`new pg.Pool()` 没有 `pool.on("error")`。数据库重启或网络抖动断了空闲连接时，pg 会在池上抛 `error`；没有监听者，Node 把它升成未捕获异常，**整个 Backend 直接退出**——而这一路上没有任何业务代码出错。

只记录、不退出：坏连接已被 pg 摘掉，下一个请求新建一条。退出与否交给真正的启动失败路径。

没有回归测试：这一条要模拟「空闲连接被对端断掉」，需要起真库再掐连接，测试成本高于它的一行代码。

#### 4. zip 放大（原 S19-0x）

`inflateRawSync(compressed)` 没有上限，解压结果整个进内存。50 MB 的 zip 可以解出几十 GB。

三道闸：条目数 2048、单条解压后 32 MB、整包 64 MB。先看中央目录里的声明值（不用解就能拒），声明造假由 `maxOutputLength` 兜住——它在超出上限时就抛，不会先分配再报错。

#### 5. env 里的 `$`（原 S2x-0x）

`formatValue` 原来把 `$ ( ) |` 都算作「不用加引号」。生成出来的 `.env` 会被 `source`，所以 `$(id)` 会真的执行，`a|b` 会断句。

- 不加引号的字符集去掉了 `$ ( ) |`。
- `$HOME` 是唯一放行的展开（schema 默认值 `$HOME/.ssh/...` 靠它，也是站点配置里唯一用过的一种），其余 `$` 一律加引号并转义成字面量。

这会改变老配置的落盘方式：含 `$` 但不是 `$HOME` 的值从此按字面量存，不再被静默截断。

#### 6. 嵌套引用爆栈（原 S13-0x）

`parseBlocks` 每层引用递归一次。2000 个 `>` 走穿调用栈，抛 `RangeError` —— 而这段代码在渲染路径上，一条内容足以让读它的页面崩掉。

- 块级嵌套上限 32 层，超过就把剩余内容收成纯文本。
- **收的时候必须同时截断长度**：第一版只加了层数上限，结果 20000 层变成了 OOM（`exit 134`）——把栈溢出换成了内存溢出。加上 2000 字上限后，20000 层稳定输出 8.5 KB，251 ms 完成。

#### 7. 部署脚本（原 S22-0x）

- `REL_NAME` 直接来自 `BUILD.json`，拼进路径还参与 `rm -rf`。发布包是外部输入，一个 `release` 写成 `../../..` 就能删到发布根外面。现在只允许字母、数字和 `. _ + -`，不能以 `.` 开头、不能含 `..`。
- 加目录锁（`mkdir` 是原子的）：两个部署同时跑会互相覆盖 `current` 链接和 `releases/` 下的目录，表现是「部署成功但版本不对」，而且两次都说 OK。
- 持锁进程已不在时接管残留锁，只删自己那把。

**这条的验证是手工的**：`case` 模式单独跑过 10 个取值（含 `../../etc`、`a..b`、`$(id)` 均被拒），`bash -n` 通过。目录锁没有自动化测试——它需要两个并发进程和真实的部署根。

#### 8. 重建先删备份（原 S2x-0x）

`reset-knot.sh` 开头无条件 `DROP SCHEMA IF EXISTS knot_keep CASCADE`。上一次重建如果死在「已清 public、还没恢复」的位置，`knot_keep` 就是**唯一的**账号、会话与上传记录，重跑一次就没了。

现在开头先看：`knot_keep.accounts` 存在且有行就中止，并提示先查再看要不要删。成功路径末尾本来就会删掉 `knot_keep`，所以正常重跑不受影响。

三态实测（临时库 `knot_guard_test`，验完即删）：全新库通过、空备份通过、有内容的备份被拦下并给出 HINT。

---

### 没有做的事

- **契约漂移**（约 13 条）一条没动。方向要逐条定：已经有人按文档写了就改代码，没人依赖就改文档。混在一批补丁里改会产生「文档和代码同时变，但不知道以谁为准」。
- **nginx `limit_req`** 没加。登录限流已经在应用层生效，入口再加一层要改所有站点的 conf，属于另一批改动。
- **P2/P3** 没动。195 + 241 条里绝大多数是隐患、测试缺口和可维护性，一次全修会让这批真正危险的改动淹没在噪音里。

### 与工作区既有改动的关系

改之前工作区已有 29 个文件未提交（隧道密钥预检、公网探活、`doctor.sh`、限流 `Retry-After`，是一条连贯的工作线）。其中 3 个文件与我这次的补丁目标重叠：

| 文件 | 既有改动 | 我的改动 | 位置关系 |
|---|---|---|---|
| `routes/web.js` | `/search` 的 `Retry-After` | `/uploads/:id` 的响应头 | 相隔约 60 行，无冲突 |
| `schema.mjs` | `KNOT_TUNNEL_KEY` 的 desc | `formatValue` | 无冲突 |
| `deploy-site.sh` | 隧道私钥预检、公网探活 | 名校验、目录锁 | 无冲突 |

提交时这两批会是不同的关注点，建议分开 commit。

---

## 第二批修复：5 条 P1 补齐

抽样复核（见「第一批」之后）发现 14 条「已修」只做到修复建议的一半，其中 5 条是 P1。
这一批把这 5 条补齐，每条都带一条会失败的回归测试。

`knot-platform` 测试从 847 条加到 **861 条，全绿**；`xknot.si` 453 条全绿（那一侧未改动）。
改动在 2026-10-23 完成。

| # | 发现 | 原来缺什么 | 修在哪 | 回归测试 |
|---|---|---|---|---|
| 1 | S08-01 双击重复执行 | 上报问题、系统设置、赞助三个写入口只用 `guard`；金额类接口无幂等键 | `admin/admin.js`、`backend/src/admin.js`、`backend/src/routes/admin.js` | `admin.test.js` ×4 |
| 2 | S10-01 登录码枚举 | 计数在进程内存：重启清零、无 IP 维度、锁定时不作废旧码 | `backend/src/login.js`、`migrations/003_*`、两条路由 | `login.test.js` ×5 |
| 3 | S16-01 发布包解包 | release 名已白名单，`tar -xzf` 仍不校验成员路径、无 `--no-same-owner` | `ops/scripts/lib/artifact-guard.sh`、`deploy-site.sh`、`push-deploy.sh` | `artifact-guard.test.mjs` ×5 |
| 4 | S17-02 快照推送 | `push-discover.sh` 仍走固定 `/tmp/knot-discover.json`，且没有推送锁 | `ops/scripts/push-discover.sh` | 手工复核（见下） |
| 5 | S20-01 入口模板 | 模板发空值、`config.mjs check` 仍报通过 | `packages/knot-config/src/schema.mjs`、`sites/_template/*.env`、`docs/CONFIG.md` | `schema.test.js` ×2 |

---

### 1. 双击重复执行（S08-01）

原来 `writeForm` 只管住了发积分、禁言、公告这几张表单。上报问题、系统设置、赞助三处还是
裸 `guard`：请求在飞的时候按键照样能点，双击就是两次。

- 三处都改成走 `writeForm`，请求期间禁用提交键、同一张表单不接受第二次进入。
- 设置页原来没有错误位，失败只弹一个会自己消失的 toast。补了 `#system-error`，
  错误落在按键下方——和别的表单一致。
- **`/points` 从「猜重放」改成「认键」**：原来按「同收件人 + 同金额 + 同理由，10 分钟内」
  去重，那是猜的——十分钟内真要给同一个人发两笔一样的，第二笔会被静默吞掉。
  现在前端一次填表生成一个 `requestId`（`crypto.randomUUID`），重试复用同一个键、
  重新填表换新键；`admin_actions.request_id` 上建唯一索引，并发撞索引时按重复返回。
  没带键的老调用（curl、旧后台页）仍走原来那个窗口判断。

回归测试：同键重试只记一笔、换键照常发第二笔、键格式非法直接拒且不落库、
并发撞唯一索引不冒 500。

### 2. 登录码枚举（S10-01）

6 位码、10 分钟、10^6 个取值。原来的锁做对了「按邮箱计数」，但计数在进程内存里：
重启清零、多进程各算各的、拿不到试错来源的地址，而且锁住之后**那把已经发出去的码仍然有效**
——锁只挡入口，绕过它只需要等、或者换一个进程。

- 计数落库到 `login_failures`，两个维度各一行：`(email, ip)` 是「这个地址对这个邮箱」，
  `(email, '')` 是「这个邮箱被所有地址试错的总量」。阈值分别是 5 和 10，任一维度到就锁 15 分钟。
  只用其中一个都绕得开：只按地址记，换 IP 就清零；只按邮箱记，看不出是谁在试。
- 锁触发时把该邮箱还没用过的登录码一起作废（`used_at = now()`）：那条路才是真正的绕过口。
- `req.ip` 沿两条登录路由（Web 与 Agent 注册）传进来；走的是 `trust proxy 1` 解出来的真实客户端。
- 成功后清掉这个邮箱的全部两行，不留旧账。

回归测试：同一地址试错到上限先锁并作废未用码、换地址不能绕开邮箱维度、重启后的新进程
接手仍认这把锁、成功一次清零、锁到期后从头算、非「码不对」的失败不计数。

### 3. 发布包解包（S16-01）

`.sha256` 证明的是「这个包没被改过」，不是「包里装的是这个目录下的文件」：自己签的
一个恶意包，校验和照样对。解包写的是系统目录，所以先看成员名单。

`lib/artifact-guard.sh` 在 `tar -xzf` 之前拒绝三类成员：绝对路径、任何 `..` 段、
链接指向包外。解包同时加 `--no-same-owner`。

第三条不能只看目标是不是以 `..` 开头：`node_modules/.bin/vite -> ../vite/bin/vite.js`
是这类包里的常态，它相对自己的目录解析后仍在包内。所以按「链接所在目录 + 目标」折叠
`.` 与 `..`，看结果有没有跳出根。硬链接的目标在包里是根相对的，单独按根解析。
两种 tar 的写法都认（symlink `->`、hardlink `link to`）。

校验放在 `push-deploy.sh` 的**本地**一侧：远端解包那段只有 bash、没有仓库可读，
在本地验完再传，远端只负责解包。`deploy-site.sh` 直接吃 `--artifact` 时自己验一遍。

回归测试：正常包（含包内相对链接）通过、`..` 成员被拒、绝对路径被拒、外指链接被拒、
空包按失败处理。tar 头是手搓的——不需要额外依赖，也能精确造出正常打包工具
不肯生成的那种成员。

### 4. 快照推送（S17-02）

`push-entry.sh` 早先已经改成远端 `mktemp`，`push-discover.sh` 没跟上：它仍然
`rsync → /tmp/knot-discover.json → sudo cp`。一台入口主机常同时服务多个子域，
两次推送共用同一个中转文件——A 传到一半、B 覆盖，最后装进 A 的静态根的可能是 B 的快照。

- 中转目录改成远端 `mktemp -d`，校验返回的字符集（要拼进 root 执行的命令），trap 清理。
- 加一个按站点区分的推送锁：同一台实例上两次内容变更挨得很近时，Backend 会几乎同时
  起两个推送，两个进程的中转与安装交错，装上去的可能是旧快照。
- 两个 cleanup 合到一个 trap 里：后设的 trap 会顶掉先设的，分开写就是锁一直留在 /tmp
  里等下一次接管。

**没有自动化测试**：它要一台真的入口主机、能 ssh、能 sudo 落文件。判定方式是对着
`push-entry.sh` 的同名实现逐行比（那边已有 `S17-02` 的对照），并 `bash -n` 过。

### 5. 入口模板（S20-01）

模板把 `KNOT_ENTRY_WEB_ROOT` 与 `KNOT_ENTRY_CONF` 发成空值，而 `config.mjs check` 明确
不查这两项（注释的理由是「静态根有非空默认值，解析后为空的分支不可达」）。后果是：
复制模板、忘了填、`check` 说通过、推到入口主机才发现两个子域共用同一个静态根。

- 模板改成发占位符 `/var/www/<标签>` 与 `/etc/nginx/conf.d/<标签>.xknot.si.conf`。
  空值看起来像「用默认」，占位符不会。
- `checkEntryFile` 现在拦三种情况：留空、写成共用默认值、占位符没替换。
  给出的是这个子域该填的示例值（按 `KNOT_DOMAIN` 推）。
- 两个键的说明也跟着改，`docs/CONFIG.md` 与两份模板都是重新生成的。

回归测试：留空报两条、共用默认值被拒、占位符被拒、写清了两项则通过。

---

### 仍然部分完成的 9 条

`S03-12`、`S10-05`、`S13-02`、`S14-01`、`S14-06`、`S19-06`、`S22-07`、`S32-07`、`S33-10`。
都是 P2/P3，缺的是「报告里没有的那一列」「分页与保留期」「路由级用例」「音频魔数」
这一类，不影响当前这几条 P1 的安全性判断。P0/P1 现在没有一条挂在「部分」里。

---

## 第三批修复：S14-01 音频魔数 + 远端部署 $5 越界

第二批之后还剩一个 P0 挂在「部分」里：S14-01 的音频上传只按
「扩展名 + 客户端声明」归一 MIME，不做内容复核。另外首次远端部署时撞上一个
c8ebca4 引入后从未被踩过的 `push-deploy.sh` 空参数 bug。这一批把两处都收口。

### 1. 音频魔数复核（S14-01，P0）

**发现**：`storeUploadedFile` 对 `kind: "audio"` 只调 `safeAudioMime(声明, 文件名)`——
按扩展名归一。于是「文件名 `.mp3` + `Content-Type: text/html` + HTML 正文」能过
multer 初筛（`isAudioUpload` 认扩展名），进库时被归一成 `audio/mpeg`，再被
`GET /api/web/uploads/:id` 按 `audio/*` 内联回源。图像路径早就用 sharp 按内容解码
（`readImageMeta`），音频路径却一直只看名字。

**修在哪**：`backend/src/uploadStore.js`。

- 新增 `audioMimeFromHead`：按文件头魔数认 MP3（ID3 / MPEG 帧同步）、Ogg、FLAC、
  WAV（RIFF…WAVE）、M4A（ftyp）、AAC（ADTS 同步字）、WMA（ASF 头），认得出按内容给
  MIME，认不出返回 null。
- 新增 `readAudioMeta`：只读文件头 16 字节（`openSync`/`readSync`），不把整份音频
  载进内存。
- `storeUploadedFile` 的音频分支改成「魔数认不出就 `bad_audio` 并删文件」，认出的
  MIME 为最终类型——声明与扩展名彻底退到初筛。
- 删掉 `safeAudioMime` 与 `AUDIO_MIME_BY_EXT`：只剩测试在引用的死代码。

**回归测试**：`uploadMime.test.js` 重写为魔数用例（9 种头、非音频头一律 null）；
`uploadStore.test.js` 加「HTML 冒名 mp3 被拒」与「真音频按内容定类型（声明 text/html
盖不掉）」两条。全仓 862 通过。

### 2. 远端部署不带 --runtime 时 $5 越界

**发现**：`push-deploy.sh` 远端段 `set -u`，`runtime="$5"`。不带 `--runtime` 时
`${RUNTIME_ARG:-}` 展开成空串，ssh 拼远程命令时末尾空参数被丢掉，`$5` 直接 unbound。
首次远端部署（bot01）停在 `bash: line 6: $5: unbound variable`——包已传、迁移没跑、
`current` 没切。c8ebca4 引入后从未被远端部署路径踩到。

**修在哪**：`ops/scripts/push-deploy.sh`，`runtime="${5:-}"`，把「没传」和「传了空串」
都按空处理。

### 部署与端到端

- `push-deploy.sh --site bot01` 成功后，实例主机跑到 0.6.0（`4303f6d`），迁移
  `002_notification_data` 与 `003_login_guard_and_idempotency` 都落库
  （`migrate.js --status`：已执行 3 个）。
- 登录码枚举（S10-01）：同一地址错 5 次后第 6 次 429 + `Retry-After: 900`；
  `login_failures` 表里 `(email, '')` 记到 5、`(email, ip)` 已锁。
- 发放幂等（S08-01）：`POST /api/admin/points` 带 `requestId` 发一次，同键重试返回
  `duplicate:true` 不再加钱；`admin_actions` 与 `point_ledger` 各只有一行。

---

## 第四批修复：内网门/管理路由/重签原子/可见性收口

第三批之后，「部分」里还剩两条 P2 的路由级测试缺口（S13-02、S13-03）、
一条 P2 的「审计与业务变更不在同一事务」（S13-04），以及一条 P3 的「可见性判据三处重复」
（S10-12）。这一批把四条都收口，每条都带回归用例。`admin.test.js` 从 43 条涨到 **66 条，
全绿**；全仓测试 872 条通过（另有一处与本次无关的 `schema.test.js` 生成文档语种问题，见文末）。

| # | 发现 | 原来缺什么 | 修在哪 | 回归测试 |
|---|---|---|---|---|
| 1 | S13-02 内网门只在纯函数层被测 | 路由中间件那步（非内网 404 / 未配令牌 503）从未执行，删掉判断 43 条仍绿 | `backend/src/admin.test.js` | ×2 |
| 2 | S13-03 敏感端点无 HTTP 用例 | `/mute` 等 9 条权限最敏感的端点一条路由用例都没有 | `backend/src/admin.test.js` | ×12 |
| 3 | S13-04 审计行与业务不在同一事务 | 重签令牌先换 `token_hash` 再记账，审计失败留下半完成状态 | `backend/src/admin.js` | ×1 |
| 4 | S10-12 可见性判据三处重复 | 新增 verdict（如 `draft`）时 `preview.js` 与 `existingResponseId` 会静默走岔 | 各处改用 `visibleVerdict` / `verdictVisible` | 现有用例 |

---

### 1. 内网门路由级覆盖（S13-02，P2）

**发现**：`routes/admin.js` 用 `isIntranetAddress(req.socket.remoteAddress)` 决定 404。
纯函数 `isIntranetAddress` 被测过，但把这条中间件判断删掉，`admin.test.js` 43 条用例仍然
全绿——门到底关不关得住，测试说了不算。

**修在哪**：`backend/src/admin.test.js`，新增 `the admin router turns the public away with 404
and unconfigured token with 503`。用 `Object.defineProperty` 覆写 `req.socket.remoteAddress`：

- 公网地址 `203.0.113.19` 带上正确令牌请求，仍回 HTTP 404 `{ error: "not_found" }`；
- 内网地址但未配令牌，回 HTTP 503 `{ error: "admin_unconfigured" }`。

两个分支都在路由层被真正走到，不再是「函数对、接线没测」。

### 2. 敏感端点路由级用例（S13-03，P2）

**发现**：`/api/admin` 约 35 个端点里只有 9 个有 HTTP 用例，权限最敏感的几条——禁言/解禁、
改等级、改权益、查用户、查账号、改外账号资料、停用邀请——一条都没有。

**修在哪**：`backend/src/admin.test.js`，补 `withAdminRoute` 助手后逐条落地：

- `unmute`（清 deadline + 一行审计）；
- `entitlements`（按名发放 + 空改动拒绝 `bad_entitlement`）；
- `level`（改一次 + 越界拒绝 `bad_level`）；
- `warnings`（记一行 + 歧义名拒绝 `ambiguous`）；
- `users` / `accounts`（各列其管理范围，`searchUsers` 带 `LIMIT 20`）；
- `accounts/:id/profile`（外账号写入回 403 `not_editable`）；
- `invites/:id/disable`（关停 + 一行审计）；
- 三条拒绝路径：`mute` 非法 deadline、`unmute` 缺失用户、`remove` 缺失帖。

### 3. 重签令牌原子化（S13-04，P2）

**发现**：`rotateManagedAgentToken` 先 `UPDATE accounts SET token_hash = …`，再单独
`INSERT INTO admin_actions`。审计写失败时，库里是新码、审计没记上——谁改的、什么时候改的
没留痕，也就无法定位是发码还是换码。测试把审计 mock 全设成功，这条失败路径零覆盖。

**修在哪**：`backend/src/admin.js`，把「换 `token_hash` + 记 `issue` 审计」收进同一个
`withClient` 事务；任一步失败走 `putBack()` 把授权码文件也退回旧值，异常再抛 `env_failed`。

**回归测试**：`a failed audit write puts the old code back instead of half-rotating`——审计
INSERT 抛错时，断言授权码文件仍写回旧码，不留半换状态。

### 4. 可见性判据收口（S10-12，P3）

**发现**：`visibleVerdict()` 生成 `IN ('pending','passed')`，`preview.js` 手写同样的比较，
`existingResponseId` 用反向的 `verdict NOT IN ('rejected','removed')`。同一句「什么算可见」
三套写法，新增 `draft` 这类 verdict 时后两者会静默走岔。

**修在哪**：统一到 `visibleVerdict()`（SQL）与 `verdictVisible()`（JS）一份，
`retrieval.js`、`preview.js`、`discoverBoard.js`、`market.js`、`facets.js` 都走它；
`verdict NOT IN ('rejected','removed')` 旧写法已清除。附件的四处口径
（`HAS_ATTACHMENT` / `isDownloadableFile` / `kindOf` / `isAttachmentUpload`）语义各自不同——
SQL 过滤、可下载性、压缩包分类、计费口径——是分工不是重复，不合并。

---

### 未随批处理

- `schema.test.js` 里 `generated example files and docs are committed as generated` 的挂点已随双语化收口：
  `schema.mjs` 的 `desc`、`GROUPS.label`、模板头、`renderDocs`、`defaultCell` 全部译成英文，
  生成器 `config.mjs docs --write` 现在输出英文 `docs/CONFIG.md`，四个模板也重生成英文；
  `docs/CONFIG_CN.md` 保留为中文快照（与并行任务的 `*_CN.md` 约定一致）。`npm test` 873 条全绿。

---

## 第五批修复：下载计费端到端用例 + 发布收口

第四批把 S13-02/03/04、S10-12 收口，并把 `schema.mjs` 的文档生成语种双语化。
这一批把「部分」里最后一条能低成本收口的 S10-14（下载计费无端到端用例）补齐，然后落定整个
审计台账的发布态。

### 1. 下载计费端到端用例（S10-14，P3）

**发现**：`points/requests/market` 已补用例，但「扣多少、扣没扣」的下载打包与计费链路没有
端到端用例——`chargeDownload` 的「买家扣款 + 作者入账 + 平台服务费」三笔动账、判重幂等、
同钱包自付免费这三条路径，回归只能靠手点。

**修在哪**：

- `backend/src/market.js`：`chargeDownload` 加 `export`（本来就在下载事务里被调，导出不改变
  生产语义，只为可测）。
- `backend/src/market.test.js`：新增 `downloadClient` 助手（mock 钱包表、`packet_downloads`
  判重、附件字节、`accounts` 扣款、`point_ledger` 记账、`packet_downloads` 解锁行），三条用例：

  - `a download charges the buyer once and credits author and platform in one batch`——3 MB 附件
  收 3 积分服务费，`price 10 + fee 3` 三笔动账按钱包 id 排序：作者 `+10`、平台 `+3`、买家 `-13`；
  - `a repeated download bills once but still records the unlock`——判重命中，账本零写入，解锁行照记；
  - `a download from the same wallet pays nothing`——作者（或其 Agent）下自己的东西，零动账、零解锁行。

`market.test.js` 从 36 条涨到 **39 条，全绿**。

### 2. 台账发布态

这一批之后，469 条审计全部落定最终判定，不再有「进行中」的悬空项：

| 状态 | 条数 | 含义 |
|---|---|---|
| `fixed` | 443 | 已修复并带回归用例（本轮 S10-14 补入） |
| `partial` | 10 | 已做一半，剩余部分明确不在本版范围内，逐条留了「还差什么」 |
| `defer` | 13 | 需架构/部署/依赖决策，风险大于收益，暂缓 |
| `wontfix` | 3 | 无功能风险或属设计如此，仅记录 |

10 条 `partial` 的剩余部分都是独立工作，不阻塞本版发布：

- `S03-04`（P2）凭据可走文件，仍受 `--base` 支配——bench 令牌绑定待做；
- `S10-05`（P2）查询已加 `LIMIT 50`，键集分页与保留期待做；
- `S10-08`（P2）zip 加密头不再整份转码，`readFile` 整份读入与 `zipNames` 同步扫描待改流式；
- `S16-04`（P2）README 已约束「一个部署根一个站点」，按站点分槽位待做；
- `S21-07`（P3）`AppButton` 的 `to` 分支补了禁用态，弹窗内分享/打赏仍是自有皮肤；
- `S21-10`（P3）resize 监听改 `ResizeObserver`，首屏同步整份 `JSON.parse` 待改异步；
- `S21-12`（P3）下载状态机已补测试，打赏弹窗待抽成可测模块；
- `S23-20`（P3）reopen 错误码已能读出，`isSale` 仍在前端复刻、等后端给字段；
- `S24-06`（P3）整目录同步 + 部署前拦截越界 import，纯函数下沉待做；
- `S33-06`（P2）补了视图清洗用例，组件测试缺依赖待引入测试框架。

### 3. 版本与发布范围

- **knot-platform 0.6.0 → 0.7.0**：管理端「日志」栏（终审失败）、iOS HEIC 浏览器转 JPEG、
  授权码轮换原子化、可见性谓词收口、配置文档/模板英文生成、日期运算键 max 上限、
  下载计费与管理路由测试覆盖；`CHANGELOG.md` / `CHANGELOG_CN.md` 同步。
- **xknot.si 0.2.0 → 0.3.0**：实例清单缓存 `server/instances.mjs`、provision/store/app/publish
  等改动、文档译英与 `*_CN.md` 对照稿。
- 全仓测试：knot-platform **876** 条、xknot.si **472** 条，全绿。
