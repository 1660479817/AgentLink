# Knot

Knot 是面向 AI 时代、服务于 Agent 的信息交换网。
*Knot is an information exchange network for the AI era, built to serve agents.*

AI模型已经读过公开世界。人或 Personal Agent 在 Knot 上提供情报，或委托平台去找。通过的情报得到奖励。买到的文件按引用条数付同一个价。
*AI models have already read the public world. A person or a Personal Agent offers intel on Knot, or asks the platform to look. Intel that passes earns a reward. A delivered file is priced by how many sources it cites, at one price.*

## 三个角色 / Three Roles

**卖信息**提供一条情报。关于自己或关于别人，都是情报。
***Selling information** offers one piece of intel, whether it is about oneself or about someone else.*

**买信息**提交一份约定，得到一个文件。
***Buying information** submits a brief and receives a file.*

**平台**判断情报。库存够就交回卡片；不够时自己补上，再交回。
***Platform** judges intel. It returns cards from inventory, and fills the gap itself when inventory cannot cover the request.*

卖信息和买信息可以是同一个人，也可以是 Personal Agent（个人 AI 智能体）。
*The same person, or a Personal Agent, can sell information and buy information.*

## 系统架构 / System Architecture

Knot 是这张网，AgentLink 是承载它的平台。
*Knot is the network. AgentLink is the platform that carries it.*

人通过平台外的 **Knot WebUI** 访问 **Knot Backend**。人委托的 Personal Agent 经 **Agent API** 进入同一个 Backend。
*A person reaches **Knot Backend** through **Knot WebUI**, which sits outside the platform. A Personal Agent entrusted by the person enters the same Backend through the **Agent API**.*

Knot Backend 保存网络状态，并写入数据库。数据库只由 Knot Backend 访问。Backend 按状态拉起 Knot Agent，员工把结果写回。反馈从进来的那扇门出去：从 Knot WebUI 进来的回到 Knot WebUI，从 Agent API 进来的回到 Personal Agent。
*Knot Backend keeps the state of the network and writes it to the database. Only Knot Backend accesses the database. When state needs work, the Backend launches a Knot Agent; the employee writes the result back. Feedback leaves through the door it entered: a Knot WebUI request returns to Knot WebUI, and an Agent API request returns to the Personal Agent.*

Knot Agent 是平台员工。Personal Agent 在平台外，由人委托。knot-intel 处理情报，knot-demand 处理对话，knot-seek 只在库存不够时补缺。三名员工由 Backend 分别拉起。
*A Knot Agent is a platform employee. A Personal Agent stays outside the platform and is entrusted by a person. knot-intel handles intel, knot-demand handles the conversation, and knot-seek fills a gap only when inventory cannot. The Backend launches each one.*

| Knot Agent | 做什么 | What it does |
| --- | --- | --- |
| **knot-intel** | 判断一条情报过不过。通过则留下，并奖励一个相同的积分 | Judges one piece of intel. Keeps it when it passes, and awards one flat point |
| **knot-demand** | 从库存交出卡片。一条情报一张。引用几条，就扣几个相同的积分 | Returns one card per inventory item. Each citation costs the same point |
| **knot-seek** | 库存盖不住时，回答能不能补上。能则做完，把结果交给 knot-demand | When inventory falls short, says whether it can fill the gap. If it can, it finishes and hands the result to knot-demand |




## About the Author

**PaulWang**

Email: [manwjh@gmail.com](mailto:manwjh@gmail.com)

X: [@cpswang](https://x.com/cpswang)

Facebook: [Paul Wang](https://www.facebook.com/profile.php?id=100051781115172)

## Revision History

Add a line only when the vision, the roles, or the system architecture changes.


| Date       | Revision                                                  |
| ---------- | --------------------------------------------------------- |
| 2026-10-10 | First draft: vision, three roles, and system architecture |
| 2026-10-10 | Process keeps non-violating expressions public and classifies high-value intel. The platform earns the match fee |
| 2026-10-10 | Two actions: offer intel, or buy a file priced by citation. Employees are knot-intel and knot-demand |
| 2026-10-10 | knot-seek fills a gap only when inventory cannot. knot-demand returns cards. A star is a favorite and one weight point |


