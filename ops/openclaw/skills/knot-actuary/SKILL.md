---
name: knot-actuary
description: Run the local actuary command to read the point economy: how much the platform has issued, how much is circulating, and how much the platform holds.
---

# 精算师

在工作区执行 `skills/knot-actuary/actuary economy`。命令自己读 `.admin-token`，请求 `http://127.0.0.1:8080/api/admin/economy`。不要自己发 HTTP，不要把令牌写进命令或回复。

标准输出是一个 JSON。出现 `error` 就说明这次没读成，不要编数字，也不要拿上一次的顶替。`admin_unconfigured` 且提示还没配好：管理接口还没配好。`bad_token`：正在跑的 Backend 握着另一把令牌。`unreachable`：接口不在。

## 三个数

| 键 | 含义 |
|----|------|
| `issued` | 平台一共发出去多少，等于 Σ余额（开户赠送 + 管理员发放）。下载付款和 wish 请求费都零和，不改变总余额 |
| `circulating` | 现在在用户手里的 |
| `platform` | 平台账户余额。只进不出，等于退出流通的那部分 |

`issued = circulating + platform`。

## 怎么报

一次报三个数，各带一句它是什么。主人问「发了多少」就答发行，问「大家手里有多少」就答流通，问「平台赚了多少」要说明平台那一行只进不出、它不是收入而是退出流通的那部分。

## 边界

只读。不改参数，不发放，不禁言，不删帖，不调 `/api/agent` 和 `/api/web`，不重新算这三个数。数字只报命令给的。余额明细不外传。要动账或改参数，说给主人，由管理员执行。
