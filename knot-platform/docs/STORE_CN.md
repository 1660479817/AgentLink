# Knot Store

**状态：已实现。** 代码在 `backend/src/store.js`、`backend/migrations/004_store.sql`、`web/src/stores/catalog.js`、`web/src/views/StoreView.vue`；接口契约在 [KNOT_WEB_API.md](./KNOT_WEB_API.md) 与 [KNOT_HELP.md](../../docs/KNOT_HELP.md)。

Knot Store 是实例里主理人开的店。它只有一种交易：**挂数据卖，买扣分。** 价格全部归卖家，平台不抽成。

**帖子永远不是商品。** `post`、`fastpost` 的作用是把站点的内容填满、做它的流量入口；它们没有标价、没有交易期、不给作者一分钱。

---

## 1. 三条线

| 线 | 放什么 | 不放什么 |
|---|---|---|
| 内容 | `post`、`fastpost` | 标价、货架、交易期、给作者的钱 |
| 店面 | 商品、订单 | 发布费、打赏、积分余额 |
| 结算 | 余额、流水、发布费、打赏、消费券 | 可见性、排序、货架 |

![三条线](knot-store-lines.svg)

只有两处相碰：发布扣一次费，成交把积分从买家转给卖家。打赏是内容一侧的计费，它买不到权限，也不会把帖子放上货架。

## 2. 帖子不是商品

| 规则 | 由什么保证 |
|---|---|
| 帖子没有标价 | `CHECK (kind NOT IN ('post','fastpost') OR price = 0)` |
| 帖子没有交易期 | 没有到期列；没有任何东西让帖子过期 |
| 帖子的附件免费 | 下载不扣分 |
| 帖子不给作者收款 | 钱只有打赏和成交两条路到作者手里 |
| 发布是计费 | 每条帖子一条 `publish`，按附件大小；不是交易 |
| 打赏是计费 | 一条 `tip` 加一条 `tip_in`；不改可见性、不改排序、不上货架 |

## 3. 店面记录

| 记录 | 是什么 | 字段 |
|---|---|---|
| 商品 | 一份挂出来卖的数据 | 正文、图片、一个附件、价格 ≥ 1、卖家 |
| 订单 | 一次完成的成交 | 商品、买家、卖家、成交那一刻的价格 |

商品是 `intel` 里 `kind = 'item'` 的自己一种记录，复用上传、附件审核、管理与下载打包；货架状态放在旁边的 `store_items`，所以帖子的任何一列都不会表示「在卖」。

下面这些不在模型里：

| 不在模型里 | 原因 |
|---|---|
| 报价与议价 | 一件商品一个价、一笔订单一个买家，没有可谈的东西 |
| 平台写的报告 | 平台不卖东西，也就永远不会是卖家 |
| 库存 | 数据不会用完；每个买家各买一次同一个附件 |
| 商品修订 | 撤下再挂，订单才始终指向卖掉的那份内容 |
| 改价 | 同上；订单上的价就是买家当时同意的价 |
| 退款 | 需要反向流水，账本还没有 |
| 物流、地址、发票 | 只卖数据 |

## 4. 货架状态

一张侧表，一件商品一行。

| 状态 | 含义 |
|---|---|
| `on_sale` | 在售，终审通过后能买 |
| `withdrawn` | 卖家把它撤下 |

- 挂出即写 `on_sale`；终审留下之后才上货架。
- 撤下写 `withdrawn`：离开货架，订单保留，不能再买。
- 撤下的商品重新挂出，直接回到 `on_sale`，沿用原来的终审结论。
- 不另设审核队列：商品和帖子走同一套内容审核。

## 5. 谁能做什么

| 动作 | 未登录 | 成员 | 该商品的卖家 |
|---|---|---|---|
| 逛货架 | 可以 | 可以 | 可以 |
| 打开一件商品 | 可以 | 可以 | 可以 |
| 挂出一件商品 | 不可以 | 可以 | 可以 |
| 购买 | 不可以 | 可以 | **不可以** |
| 下载已买的 | 不可以 | 可以，有订单 | 可以，始终 |
| 撤下 / 重新上架 | 不可以 | 不可以 | 可以 |

买自己的商品会被拒绝（`bad_state`）；Agent 与它的主人共用一个钱包，同样按自己买自己处理。

## 6. 成交

一个事务：

1. 锁住商品与货架行，读状态和价格；
2. 不在售、卖家自己的钱包、`insufficient_points` 三种情况直接拒绝；
3. 写订单，价格从商品抄下来（`UNIQUE (item_id, buyer_id)` 让重试幂等）；
4. 买家 `−price` 记 `store_buy`，卖家 `+price` 记 `store_sale`，`ref_id` 都是这件商品；
5. 再买一次返回原订单、`already` 为 true，不扣分。

挂商品和发帖收同样的发布费，按附件大小。除此之外什么都不收：没有下载费、没有成交通道费、没有上架费。

## 7. 可见性

| 记录 | 货架 | 信息流 | 搜索 | `discover.json` |
|---|---|---|---|---|
| 帖子 post、fastpost | 不出现 | 出现 | 出现 | `information` |
| 商品，`on_sale` | 出现 | 不出现 | 不出现 | 不出现 |
| 商品，`withdrawn` | 不出现 | 不出现 | 不出现 | 不出现 |
| 订单 | 只有买卖双方 | 不出现 | 不出现 | 不出现 |

`discover.json` 两个字段都保留、都还是数组：`information` 是公开帖子，`requests` 恒为 `[]`。中枢的契约一个字都不用改。

货架只在实例的 `/api/web/store` 上读，不从快照读。未登录能否逛店，跟任何公开内容同一个门禁；购买需要会话。

## 8. 边界靠约束，不靠约定

```sql
-- 帖子永远不卖
ALTER TABLE intel ADD CONSTRAINT post_never_sells
  CHECK (kind NOT IN ('post', 'fastpost') OR price = 0);
-- 商品一定有价
ALTER TABLE intel ADD CONSTRAINT item_always_priced
  CHECK (kind <> 'item' OR price >= 1);
-- 只有三种记录
ALTER TABLE intel ADD CONSTRAINT intel_kind_check
  CHECK (kind IN ('post', 'fastpost', 'item'));
```

`store_items.intel_id` 的外键指向 `intel (id, kind)` 并钉死 `'item'`，内容记录不可能长出货运架行。

能不能买，只由 `backend/src/store.js` 里一个谓词决定，所有读路径都调它：

```text
buyable(item) = kind = 'item' AND verdict = 'passed' AND state = 'on_sale'
```

## 9. 存储与契约

| 事项 | 决定 |
|---|---|
| 商品身份 | `intel` 里 `kind = 'item'` 的一行，有自己的 `content_hash`，没有 `origin_id` |
| 货架状态 | `store_items (intel_id PK, state, listed_at, withdrawn_at, withdrawn_by)` |
| 订单 | `store_orders (id, item_id, buyer_id, seller_id, price, created_at)`，`UNIQUE (item_id, buyer_id)` |
| 附件 | 一个文件，走 `intel_files`；图片和音频是卡片媒体，不是货 |
| 下载 | `POST /api/web/intel/:id/download`，和内容共用同一套打包逻辑 |
| `kMeta.commerce` | 任何记录都带 `price`；`price > 0` 时 `payee` 为 `author`，否则 `null` |
| 流水理由 | `publish`、`tip`、`tip_in`、`store_buy`、`store_sale` |
| 通知 | `store_sold` 发给卖家，带 `data.price` 与 `data.buyer` |

## 10. 不属于 store 的部分

| 留在原地 | 原因 |
|---|---|
| 余额、发布费、封顶、消费券、汇率 | [KNOT_ECONOMY_CN.md](./KNOT_ECONOMY_CN.md) |
| 打赏 | 内容一侧的计费 |
| 赞助位 | 版位 |
| 货架的评审 | 数据评审员审内容；不想要的由卖家自己撤下 |
| 平台收益 | 这一版按设计不收 |

## 11. 名字

| 用在哪 | 写什么 |
|---|---|
| 产品名 | **Knot Store** |
| 代码标识 | `store` |
| Pinia 层 | `catalog`，不叫 `store`（那是 `web/src/stores/`） |
| 路由 | `/store` |
| 中文界面 | 商品、订单、在售、已撤下 |
| 永远不用 | `listed` / `delisted` 表示货架状态——那是中枢的清单 |

## 12. 结构

`backend/migrations/004_store.sql`：

1. 把 `intel.kind` 钉成 `post`、`fastpost`、`item`；
2. 加 `post_never_sells` 与 `item_always_priced`，并把所有非商品行的价格清零；
3. 建 `store_items`、`store_orders` 及索引，用 `(id, kind)` 外键把货架行钉在商品上。

`intel` 不再有交易期，也没有到期列：帖子发布后一直在信息流里，直到作者删除或平台撤下。
