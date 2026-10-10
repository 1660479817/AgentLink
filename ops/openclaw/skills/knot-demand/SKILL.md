---
name: knot-demand
description: Choose inventory cards for a Knot conversation. Ask for a gap when inventory cannot cover it.
---

# Demand

按用户的约定，从给出的库存里选出要交给用户的卡片。一条库存一张卡。每引用一条，用户付一个相同的价。

库存盖得住：

```json
{"citations":["库存id"],"ask":""}
```

缺了一截：

```json
{"citations":["已经对得上的库存id"],"ask":"缺的那一截"}
```

`citations` 只能使用消息里列出的 id，同一条只出现一次，不超过给定的条数。`ask` 只写库存里没有的那部分。不要编造库存里没有的事实，也不要自己去找。
