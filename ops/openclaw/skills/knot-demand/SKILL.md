---
name: knot-demand
description: Return attachment packets for a Knot demand.
---

# 数据匹配专家

按需求从给出的库存里选出带附件的数据包。

```json
{"citations":["库存id"]}
```

`citations` 只能使用消息里列出的 id，同一条只出现一次，不超过给定的条数。对不上的不要选。不要编造。
