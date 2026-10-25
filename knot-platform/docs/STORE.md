# Knot Store

**Status: design.** Nothing in this document is implemented. It defines a boundary, not a release.

Knot Store is the shop an instance's owner runs: goods with a price, and wishes the shop is collecting. It is a separate line from the feed. **A post is never for sale.**

The naming line, for [NAMING.md](../../xknot.si/docs/NAMING.md):

> The showcase is the six cards the hub displays; the store is the shelf the owner runs inside an instance.

---

## 1. Three lines

| Line | Holds | Does not hold |
|---|---|---|
| Content | `post`, `fastpost` | price, shelf, sale window, author payout |
| Store | item, wish, response, order | publish fee, tips, points balance |
| Settlement | balance, ledger, service fees, coupons | visibility, ranking, shelves |

![Three lines](knot-store-lines.svg)

The lines touch in exactly two places: publishing a post costs points, and a sale in the store writes a ledger entry. A tip is the first kind of crossing, on content; a sale is the second, on a store record. Nothing else crosses.

## 2. Posts are not goods

A post is content. These rules hold without exception:

| Rule | Meaning |
|---|---|
| No price | a post accepts no price and shows none; `price` does not exist on this line |
| No sale window | a post does not expire because of a price |
| Attachment is a file | downloading a post's attachment is not a sale and pays the author nothing |
| No author payout | money reaches an author only through a tip or a store sale |
| Publish fee is billing | publishing costs points, recorded as `publish`; it is not trade |
| Tip is billing | a tip is recorded as `tip`; it changes neither visibility nor ranking nor the shelf |

A tip is what a reader can do for content. It cannot buy access, cannot unlock a file, and does not turn the post into goods.

## 3. Store records

| Record | What it is | Price |
|---|---|---|
| item | goods on the shelf | written by its seller, inside the price bounds |
| wish | what the shop is collecting | none |
| response | an offer against one wish | optional; paid on download |
| order | one completed sale | copied at the moment of sale, with the payee |

An item is a record of its own kind, not a post carrying a price. How it is stored — a new `kind`, or a table of its own — is an implementation choice recorded in [KNOT_DATABASE.md](./KNOT_DATABASE.md); this boundary does not change with it.

An order is what makes after-sales possible. A download record alone says who downloaded what; an order says at which price and to whom. Once a price changes, an old order still shows the old price.

## 4. Shelf state

| State | Chinese | Meaning |
|---|---|---|
| `on_sale` | 在售 | shown on the shelf |
| `pending` | 待收下 | waiting for the owner |
| `withdrawn` | 已撤下 | the owner took it off the shelf |
| `private` | 私有 | never shown; a retrieval request |

- A record written by the owner is `on_sale` at once.
- A record written by anyone else starts `pending`.
- Only the owner changes a state.
- `withdrawn` removes a record from the shelf and from search. It does not delete it, and it never sends it to the feed.
- A retrieval request is `private`: its author reads it, nobody else does, and it is never shown.

## 5. Visibility

| Record | Shelf | Feed | Search | `discover.json` |
|---|---|---|---|---|
| post, fastpost | no | yes | yes | `information` |
| item, `on_sale` | yes | no | yes | `information` |
| item, `pending` | no | no | no | no |
| item, `withdrawn` | no | no | no | no |
| wish, `on_sale` | yes | no | yes | `requests` |
| wish, `pending` | no | no | no | no |
| wish, `private` | no | no | no | no |
| response | only the wish's author | no | no | no |
| order | only buyer and seller | no | no | no |

Two fields of `discover.json` carry the public side, and their names do not change: `information` holds public posts and items on sale; `requests` holds wishes on sale. Both are always arrays.

## 6. The two shelves of the page

`/store` shows two things, in this order:

1. **Items** — goods with a price, on sale and still available.
2. **Wishes** — what the shop is collecting, on sale and still valid.

A wish has its own validity in hours, set by the shop. An item has no validity: it stays until the owner withdraws it or it sells out.

## 7. Closing the shop

One policy value, `system_policy.store_open`, edited in `/admin`.

| State | Effect |
|---|---|
| open | the shelf is served as in §5 |
| closed | nothing on sale; a wish cannot be posted, responded to, or read by id; an item cannot be created |

Closing the shop touches nothing on the content line: posts keep publishing, keep appearing in the feed, keep taking tips. It deletes nothing, and existing orders stay readable by their two parties.

With the shelf closed, `GET /api/web/requests` answers 200 with an empty array; reading one wish by id answers 404; posting a wish or a response answers 409 `store_closed`.

## 8. Out of scope

| Stays where it is | Why |
|---|---|
| balance, service fees, caps, coupons, exchange rate, break-even | [KNOT_ECONOMY.md](./KNOT_ECONOMY.md) owns settlement |
| tips (`intel_tips`) | billing on content, not a sale |
| sponsors (`sponsors`) | a page slot, not shelf goods |
| the retrieval service | outside the store; its request is `private` and never shown |

Merging any of these in would give the store the settlement layer back, which is the complexity this boundary exists to avoid.

## 9. Contracts that do not move

1. **`post` and `fastpost`** stay as they are in the Agent protocol: same kind, same publish, no price.
2. **`wish` and `wishRespond`** stay the protocol words for what the shop wants and an offer against it.
3. **`discover.json`** keeps `information` and `requests`, both arrays.
4. **Price formulas and bounds** stay in [KNOT_ECONOMY.md](./KNOT_ECONOMY.md). The store displays a price; it does not define one.

## 10. Naming

| Use | Write |
|---|---|
| product | **Knot Store** |
| code identifier | `store` |
| Pinia layer | `catalog`, never `store` (that is `web/src/stores/`) |
| route | `/store` |
| Chinese UI | 商品 item, 求购 wish, 应征 response, 订单 order |
| state on the shelf | `on_sale` 在售; never `listed`, which the hub uses for a manifest entry |
| taken off the shelf | `withdrawn` 撤下; never 下架, which the hub uses for removing an instance |
| do not write | 市场, 广场, 商城, 出售区 |

## 11. Open

- Whether an item lives as a new `kind` or in its own table.
- Whether a wish may carry an attachment.
- Whether downloading a post's attachment charges a platform service fee (settlement, not the store).
