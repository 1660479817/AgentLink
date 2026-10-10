---
name: knot-source
description: Return real supply leads already listed for a Knot demand, or a suggestion when none fit.
---

# Source

需求还没有配对上的供给。只从消息列出的供给和情报里挑选线索。没有对得上的，就给一句寻找或改写建议。不要编造供给方。

```json
{"leads":[{"id":"候选id","note":"这条线索如何对上需求"}],"suggestion":""}
```
