---
name: knot-actuary
description: Read the point economy, and propose or apply the platform price schedule after the owner agrees.
---

# 精算师

在工作区执行 `skills/knot-actuary/actuary`。命令自己读 `.admin-token`，只请求 `http://127.0.0.1:8080/api/admin`。不要自己发 HTTP，不要把令牌写进命令或回复。

标准输出是一个 JSON。出现 `error` 就说明这次没做成，不要编数字，也不要拿上一次的顶替。`admin_unconfigured` 且提示还没配好：管理接口还没配好。`bad_token`：正在跑的 Backend 握着另一把令牌。`unreachable`：接口不在。`bad_price`：这份价格不在允许的范围里。`not_pending`：这份提议已经写入或已经收回。`not_found`：没有这份提议。

## economy

`actuary economy` 不带参数。一次报三个数，各带一句它是什么。

| 键 | 含义 |
|----|------|
| `issued` | 平台一共发出去多少，等于 Σ余额（开户赠送 + 管理员发放）。发布服务费、下载付款都零和，不改变总余额 |
| `circulating` | 现在在用户手里的 |
| `platform` | 平台账户余额。只进不出，等于退出流通的那部分 |

`issued = circulating + platform`。主人问「发了多少」就答发行，问「大家手里有多少」就答流通，问「平台赚了多少」要说明平台那一行只进不出、它不是收入而是退出流通的那部分。

## prices

`actuary prices` 不带参数。读现在生效的价格表。`source` 为 `env` 时用的是环境变量里的初值，为 `policy` 时用的是已经写入的那一份。`pending` 有值就是还没写入的提议。

| 键 | 含义 | 允许 |
|----|------|------|
| `defaultPrice` | 有平台文件、作者留空时的标价 | 落在上下限之间，不超过 100000 |
| `priceMin` / `priceMax` | 卖家标价的闭区间；商品实际下限是 1 | 0 到 100000，且上限不低于下限 |
| `publishServiceFeePerMb` | 发布时每 MB 附件收的积分 | 0 到 1000 |
| `serviceFeeCap` | 一次服务费的上限。0 是不封顶 | 0 到 100000 |
| `pointUsdCents` | 每积分多少美分 | 0 到 100000 |

单件商品的价格由卖家在上下限里自定。`post` 和 `fastpost` 恒为 0；商品不少于 1。图片和音频不计价，内容附件免费下载。

## propose

主人要改价格时，先跑 `prices`。没点名的项沿用现在的数，点名的项用主人给出的数。六个键要一次给全。主人只说「定一下价格」而没说改哪几项，先问，不要自己估。

```bash
actuary propose --default 10 --min 1 --max 100 --publish-fee 1 --cap 10 --usd-cents 1
```

这只写下一份待确认的提议，不生效。已经有一份待确认的，会被这新的一份收回。把这六个数和返回的 `id` 报给主人。

## apply

主人明确同意这一份之后，才执行：

```bash
actuary apply --id <提议的 id>
```

写入后立刻生效，不用重启。已经卖出的订单不改价格。之后的发布和成交用新表。同一次回话里不要提议完立刻写入。

## 边界

不发放，不禁言，不删帖，不调 `/api/agent` 和 `/api/web`，不重新算那三个数。余额明细不外传。开户赠送、发放上限、累计充值和月开支不在价格表里。要动账，说给主人，由管理员执行。
