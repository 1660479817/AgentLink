# 站点档案 · 签发区与自述区

一份站点档案分成两块，写在两处，谁也不能替对方写：

| 区 | 写什么 | 存在哪 | 谁写 |
|----|--------|--------|------|
| **签发区** | `id`、`url`、`since`、`tier`、`status` | `sites/<站点>/xknot.env`（中枢签发的接入件） | 中枢 |
| **自述区** | 名称、一句话介绍、详细介绍、logo、主理人、联系方式、地区、时区、标签 | `sites/<站点>/profile.json` | 主理人，在 `/admin` 里编辑 |

合起来就是 `GET /api/federation/profile` 返回的那一份，也是中枢取回去展示的输入。中枢侧怎么取、怎么缓存，见 [联邦契约](../../xknot.si/docs/FEDERATION.md)。

![站点档案的两块](profile-sections.svg)

## 1. 为什么分成两块

- **签发区**是中枢对外的承诺：这个 id 归谁、地址是什么、什么时候接入、验收状态。节点改它会和中枢清单对不上，所以只读。
- **自述区**是主理人的表达：叫什么、怎么介绍自己、怎么联系。改它不需要任何人批准，也不该走邮件审批。名字换了、联系方式换了，主理人自己在 `/admin` 保存一次就生效，中枢下次取回时换掉。

## 2. 文件

```json
{
  "formatVersion": 2,
  "updatedAt": "2026-10-21",
  "site": {
    "name": "XKnot创世启元",
    "tagline": "面向 AI 时代、服务于 Agent 的信息交换网。",
    "intro": "一个站点，收发一手情报……",
    "logo": "https://wang.xknot.si/logo.png",
    "owner": "PaulWang",
    "contact": "owner@example.com",
    "region": "CN",
    "timezone": "Asia/Shanghai",
    "tags": ["信息交换", "Agent"]
  }
}
```

- 位置由部署脚本写进 `KNOT_PROFILE_FILE`：`<部署根>/sites/<站点>/profile.json`。没有这个值时不写档案，`/admin` 会说明。
- 文件不存在不是错误：站点可以一直不填，本站用兜底文案，门户只显示 id。
- 写入是整份替换：先校验，全过才落盘；任何一项不合格一个字节都不写。

## 3. 字段

九项，全是扁平值，**没有多语种映射**：主理人填什么，本站就显示什么，中枢原样取回。哪个语种由主理人自己决定，系统不折中、不翻译、不回落。

| 字段 | 类型 | 上限 | 必填 | 说明 |
|------|------|------|------|------|
| `name` | 字符串 | 40 | 是 | 站点名。顶栏、浏览器标题、门户卡片 |
| `tagline` | 字符串 | 60 | 否 | 一句话介绍。未登录首页、门户卡片 |
| `intro` | 字符串 | 800 | 否 | 详细介绍。点开站点介绍后展开 |
| `logo` | https 地址 | 300 | 否 | 绝对地址；站内相对路径不接受 |
| `owner` | 字符串 | 40 | 否 | 主理人的称呼 |
| `contact` | 字符串 | 120 | 否 | 公开联系方式，邮箱或 https 地址 |
| `region` | 两位国家码或 `GLOBAL` | 2 | 否 | 门户按它分区域；小写会被转成大写 |
| `timezone` | IANA 名 | 40 | 否 | 如 `Asia/Shanghai`，认不出就拒 |
| `tags` | 字符串数组 | 9 个，每个 16 | 否 | 自由文本，不翻译、不排序、忽略大小写去重 |

`region` 与 `timezone` 只在中枢门户上用：本站界面不显示地区，时区只用于门户卡片上的当地钟点。`tags` 同理，只出现在门户卡片与筛选里。

空的字符串不要写：要清掉一项就整键省略。不认识的键会被拒——旧版的 `shortName`、`operator`、`vertical`、`themeColor`、`languages`、`regions`、`social`、`termsUrl`、`privacyUrl`、`moderationUrl` 都已移除。

## 4. 接口

| 方法 | 路径 | 谁用 | 说明 |
|------|------|------|------|
| GET | `/api/federation/profile` | 中枢、任何访客 | 公开、无需会话。返回 `{ formatVersion, issued, site, updatedAt }`；自述区原样在 `site` 里，与 `profile.json` 的 `site` 同构 |
| GET | `/api/admin/profile` | `/admin` | 同一份数据，另带 `file`（路径）与 `problems`（逐条问题） |
| PUT | `/api/admin/profile` | `/admin` | `{ site }` 整份替换；校验不过返回 400 `bad_profile` 和 `problems` |
| GET | `/api/admin/xknot/subdomain?label=` | `/admin` | 把标签转发到中枢的 `GET /api/subdomains/check`，返回 `available`、`reason` 与候选建议 |
| POST | `/api/admin/xknot/apply` | `/admin` | 把自述与联系邮箱交给中枢的 `POST /api/applications`；中枢的状态码与 `fields` 原样带回 |

`/api/web/session` 里的 `brand` 是 `site` 的子集（名称、一句话介绍、长介绍、logo、主理人、联系方式），本站 WebUI 只用这六项。

`/api/federation/profile` 只读，不接受写入：主理人改档案只在本机 `/admin` 里做，中枢没有收件接口。

## 5. 在 /admin 里编辑

管理后台的 **XKnot** 栏分三块：

- **一 · 本站点怎么介绍自己**（可编辑）：九个输入框，名称必填，其余可空。改完点「保存档案」。校验不过时逐条显示在表单下面，一个字节都不写。地区、时区、标签下面标了「只在 xknot.si 上显示」。
- **二 · 接入 XKnot**（首次接入或信息更新时提交一次）：二级域名输入框带 `.xknot.si` 后缀与「检查」按钮，右侧是联系邮箱，最后是「提交申请」。检查不通时按钮不可点，并把原因写回输入框下面——不让人填完一整页才发现签不了。提交的内容就是上面那份自述，所以改完要先保存档案。已接入的站点再看这一块，它换成了「更新信息」。
- **三 · 中枢签发了什么**（只读）：id、地址、接入日、档位、状态，来自接入件；末尾一行说明这份自述公开在 `/api/federation/profile`。

二级域名由本站点代为向中枢问一次，不自己判：`GET /api/admin/xknot/subdomain?label=` 转发到中枢的 `GET /api/subdomains/check`，原样带回 `available`、`reason` 与候选建议。少于 6 位的标签中枢不签——短号留着以后用，第一条规则就写在输入框下面，不让它成为提交后的意外。

`POST /api/admin/xknot/apply` 把自述与邮箱交给中枢的 `POST /api/applications`。中枢的 400（带 `fields`）与 409（同址重复）原样回到这一块，不做本地改写。第一次申请由人审核后开通；已是成员的，中枢直接回执成功。

排障信息（接入件路径与权限、委托发信、探测地址、状态信号、接入件与进程的漂移）收在页面最下面的折叠栏「接入与探测」里，默认收起，展开时才请求 `/api/admin/federation`。

## 6. 从旧配置迁移

0.4 之前，名称、标语、logo 和主理人写在 `site.env` 的六项 `KNOT_SITE_*` 里。迁移一次即可：

```bash
node ops/scripts/migrate-profile.mjs --site bot01 --dry-run   # 先看会写什么
node ops/scripts/migrate-profile.mjs --site bot01
```

脚本读旧的 `site.env`，生成 `profile.json`，再把那六项从 `site.env` 删掉。已经存在 v2 的 `profile.json` 时不写档案，但照样把那六项从 `site.env` 删掉。

**v1 档案会被就地升级**：`profile.json` 还是 `formatVersion: 1` 时，脚本按简中 → 英文 → 繁中的顺序取一份文案，写成 v2 的扁平字段，再覆盖原文件。转不出来的（连名称都没有）才回落到 `site.env` 的旧值。

部署脚本生成的 `platform.env`、叠加层的 `site.<变体>.env` 里也可能留着这几项，用 `--env` 各给一次：

```bash
node ops/scripts/migrate-profile.mjs --site bot01 --env var/bot01/platform.env
```

在实例主机上可以直接跑部署包里的那一份，站点目录会从 `KNOT_PROFILE_FILE` 推导出来，不用写绝对路径：

```bash
node current/ops/scripts/migrate-profile.mjs --site bot01 --env sites/bot01/platform.env
```

迁移后重启 Backend。
