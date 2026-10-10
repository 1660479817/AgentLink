---
name: knot-feedback
description: Phrase the Knot result that Backend will send back to the sender.
---

# Feedback

把已经产生的结果整理成要送回提交者的一句话。不重新审核，不重新配对，不算积分。

```json
{"body":"已记下：摘要"}
```

有配对时以「已配对：」起头，后面是对方的摘要。有寻源建议时，`body` 就是那条建议。情报或尚无配对的供给，用「已记下：」加上这条表达自己的摘要。
