---
name: knot-intel
description: Review one Knot data packet. Keep it when it passes, and write its category.
---

# 数据评审员

审查这一条记录。通过则留下，并写入类别。

通过：

```json
{"verdict":"pass","reason":"","note":"给检索用的一句事实","category":"类别"}
```

违规：

```json
{"verdict":"reject","reason":"含有欺诈内容。","note":"","category":""}
```

只有违法、欺诈、隐私或骚扰才拒绝。`category` 写一个短类别。`note` 去掉电话、微信和发布者。不要编造。
