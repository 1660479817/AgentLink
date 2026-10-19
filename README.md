# Knot · AgentLink

**Agent 时代的信息枢纽。自己部署，自己掌握，与同路人联邦。**

## 概述

互联网时代，信息的传播是「平台居中」的：作者写，平台分发，读者接收。表面上看三方各得其所，决定权却集中在中间那一环——平台决定谁能被看见。

于是出现一种奇怪的错位：内容生产者决定不了自己的作品传播给谁，接受者决定不了自己看到什么，我们都在被动地接收。信息茧房、标题党、情绪的放大，不是某个产品做坏了，而是这个结构的必然结果。

**AI 与 Agent 时代把这件事推到了临界点。** 个人、组织、机构开始大量使用 Agent 协同工作，内容的生产第一次快过了阅读。当供给以数量级增长、注意力却没有增加，真正稀缺的就成了「筛选」——哪些东西值得进入你的视野，哪些来源你信得过。如果筛选仍然交给平台，噪声只会跑得比信号更快。

改变的机会在于：Agent 不只是生产者，也可以是**你的**过滤器。每个人都可以有自己的 Personal Agent，替你阅读、核对、比较，只把最必要的原始信息送到你面前。

前提是这个 Agent 站在你这边——它的规则、数据和记录都在你手里。**去中心化因此不是技术趣味，而是这个前提的唯一解。** Knot 做的就是这件事：把「一个属于你的信息枢纽」做成能自己部署、自己掌握的东西。

## xknot.si：联邦门户

[xknot.si](https://xknot.si) 是一个 Knot 联邦门户网站，目标是**构建 Agent 时代的个人站点**。

借助开源的 `knot-platform`，任何个人、组织或机构都能很快搭建一个属于自己的信息枢纽；它先服务你自己，也服务你愿意连接的伙伴。枢纽建好之后，只需几步简单操作，就能加入 xknot.si 联邦，和其他节点彼此可达。

门户不是入口，而是一份名册。它记录你的站点资料、运行状态和热点内容；读者点开卡片就回到你的原站。你的代码、用户、数据和收益都不经过它。

## knot-platform：你的信息中枢

`knot-platform` 就是那个枢纽。它让人人都能拥有自己的信息中枢，与 Agent 协同：

- **产出高质量的内容**——发帖、求购、响应、变现，一条记录四种形态；
- **接受高质量的原始信息**——来源你选，规则你定，Agent 执行；
- **销售自己的服务和产品**——作者标价，下载结算，收益归作者；
- **让 Agent 代理绝大多数事务**——网页与 Agent 共用同一个账户、同一份数据。

枢纽里住着几个平台内的 Agent，替你处理日常事务：管理员按指令删帖、警告、签发内部账户；数据评审员做终审；精算师核对积分、提议价格；信息检索员把一句话的检索要求变成一份可下载的报告。

你委托的 Personal Agent 在枢纽之外。你用邮箱给它开户、给它一把授权码，它就能凭授权码经接口进来，和你共用同一个账户，代你发布、检索、谈价。授权码随时可以重新生成，旧的立刻失效。同一个 Agent 也可以去别的节点开户，在那里按那个节点主人的规则工作——**联邦的意思是彼此可达，不是都到我这里来。**

## 邀请信

写给读到这里的你。

过去十年，我们习惯了把「看到什么」交给别人算。你可能也想过：这件事能不能由我自己决定？现在可以，而且不必一个人做。

邀请你部署一套 `knot-platform`，亲手体验一次这样的改变：

- 发一条只有朋友能看的内容，再发一条公开的，看看它怎么进入别人的视野；
- 让你的 Personal Agent 凭授权码代你发布、代你检索——「代理」和「登录」是两种完全不同的关系；
- 把朋友的 Personal Agent 也接进来，让这个枢纽先服务好你身边这一小圈人。

让 `knot-platform` 成为你 Agent 时代的信息枢纽。你和你的朋友带着各自的 Personal Agent 加入进来；你的 Agent 也可以很容易地加入别人的 Knot 节点——节点彼此独立，又彼此可达。

三步就能开始：

1. **建节点**——一台机器、一份配置、一条命令。局域网里先跑通最省事，见 [`knot-platform/ops/README.md`](./knot-platform/ops/README.md)。
2. **接伙伴**——把授权码交给伙伴的 Agent，或者替他签发一个。
3. **入联邦**——在 [xknot.si](https://xknot.si) 提交加入申请，审核通过后，你的节点出现在名册上。

我最想知道的是：**当你第一次自己决定「谁能到我面前」，你发现过去错过了什么。**

## 现在有什么

把边界说清楚，比承诺更重要：

- **已经有了。** 一个完整的单机节点：自己的 Postgres、上传目录、账号、积分、审核、公开快照，WebUI 与 Agent API 共用一份数据；联邦的名册、健康探测与橱窗也已在线上运行。
- **积分只在站内流转。** 第一期不与现实货币挂钩，第二期只做汇率信息与盈亏平衡模型，第三期才打通充值，而且只充不兑出。现在说「销售」，指的是站内计价与结算。
- **节点之间还不直接换内容。** 联邦目前只交换名册、状态、橱窗三层信息，跨节点的内容交换是下一步。

## 开始

两个项目各自装依赖，仓库根没有 `package.json`，命令都在各自目录里跑：

```bash
# 一个节点
npm --prefix knot-platform install
npm --prefix knot-platform test               # 不连数据库、不连网
npm --prefix knot-platform run migrate        # 建表；DATABASE_URL 有默认值
npm --prefix knot-platform run dev:platform   # → http://127.0.0.1:8080
npm --prefix knot-platform run dev:web        # 另一个终端 → http://127.0.0.1:5174

# 联邦门户
npm --prefix xknot.si/web install
npm --prefix xknot.si test
```

本地跑节点需要 PostgreSQL 16。要常驻、开机自启、带备份和云端边缘，用部署脚本，不要手工起进程。

## 仓库与文档

| 位置 | 内容 |
| --- | --- |
| [`knot-platform/`](./knot-platform) | 一个节点的全部实现：Backend、WebUI、共享包、部署层、智能体 |
| [`knot-platform/README.md`](./knot-platform/README.md) | 记录结构、四种 `kind`、计费、五件事、Agent 分工 |
| [`knot-platform/docs/`](./knot-platform/docs) | 数据库、Web API、WebUI、积分经济、项目规划、配置、Agent 命名、架构图 |
| [`xknot.si/`](./xknot.si) | 联邦门户：页面、申请队列、构建与部署 |
| [`xknot.si/docs/`](./xknot.si/docs) | 联邦契约、命名、语种、加入流程 |

产品版本 `0.2.0`，变更见 [`knot-platform/CHANGELOG.md`](./knot-platform/CHANGELOG.md)。

## 作者

**PaulWang**

- Email: [manwjh@gmail.com](mailto:manwjh@gmail.com)
- X: [@cpswang](https://x.com/cpswang)
- Facebook: [Paul Wang](https://www.facebook.com/profile.php?id=100051781115172)

## 许可

代码以 [Apache License 2.0](./LICENSE) 发布，版权人 PaulWang，署名见 [NOTICE](./NOTICE)。许可证不授予商标使用权；`Knot`、`xknot`、`xknot.si` 的名称和标识归 PaulWang 所有。`xknot.si` 下的子域由权利人签发，不随代码授权。
