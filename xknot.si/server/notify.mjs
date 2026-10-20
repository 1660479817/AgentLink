// 发给伙伴与运营方的邮件正文。
//
// 这里是运行时的唯一真源：事件名、收件人、主题与正文都在 TEMPLATES 里。
// 可读版本（含每个事件的触发条件与变量表）见 docs/PARTNER-MAIL.md，
// 改文案要两边一起改，并升 TEMPLATE_VERSION。
//
// 两条硬规则：
//  1. 发信人恒为中枢的 MAIL_FROM，Reply-To 用 no-reply；正文一律写明「不接收回复」。
//     因此所有需要申请人动作的事都必须给链接，不能写「请回复本邮件」。
//  2. 正文只放事实：不放内部备注、审核人、IP、哈希，也不放任何凭据明文。

export const TEMPLATE_VERSION = "1.1.0";

const LOCALES = ["zh-CN", "zh-TW", "en"];

// 申请只按子域走；老数据没有 subdomain 时从 URL 取回标签。
function subdomainLabelOf(application) {
  const label = String(application?.subdomain || "").trim().toLowerCase();
  if (label) return label.replace(/\.xknot\.si$/, "");
  try {
    const host = new URL(String(application?.url || "")).hostname.toLowerCase();
    return host.endsWith(".xknot.si") ? host.slice(0, -".xknot.si".length) : "";
  } catch {
    return "";
  }
}

export function normalizeLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  if (locale.startsWith("zh-tw") || locale.startsWith("zh-hk") || locale.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (locale.startsWith("zh")) return "zh-CN";
  return "en";
}

// 补材料只认条目码。运营方勾条目，避免自由文本把手写评价带进对外邮件。
export const HOLD_ITEMS = {
  site_unreachable: {
    "zh-CN": "站点地址从公网打不开",
    "zh-TW": "站點位址從公網打不開",
    en: "the site URL is not reachable from the public internet",
  },
  health_missing: {
    "zh-CN": "站点没有提供可用的 /api/health",
    "zh-TW": "站點沒有提供可用的 /api/health",
    en: "the site does not expose a working /api/health",
  },
  intro_unclear: {
    "zh-CN": "一句话简介与实际内容不一致",
    "zh-TW": "一句話簡介與實際內容不一致",
    en: "the one-line intro does not match the site",
  },
  name_conflict: {
    "zh-CN": "名称或标识可能与已有成员冲突",
    "zh-TW": "名稱或標識可能與已有成員衝突",
    en: "the name or mark may conflict with an existing member",
  },
  contact_invalid: {
    "zh-CN": "联系邮箱无法送达",
    "zh-TW": "聯絡信箱無法送達",
    en: "the contact address is not deliverable",
  },
  region_mismatch: {
    "zh-CN": "区域或时区与实际运营地不符",
    "zh-TW": "區域或時區與實際營運地不符",
    en: "the region or timezone does not match where you operate",
  },
  other: {
    "zh-CN": "材料不足",
    "zh-TW": "材料不足",
    en: "the information provided is not sufficient",
  },
};

export const HOLD_ITEM_CODES = Object.keys(HOLD_ITEMS);

// 拒绝只给三个类别，不给审核人、不给内部备注。
export const REJECT_REASONS = {
  incomplete: {
    label: {
      "zh-CN": "材料不足",
      "zh-TW": "材料不足",
      en: "insufficient information",
    },
    hint: {
      "zh-CN": "申请表缺少关键信息，或所选子域与站点用途不符。",
      "zh-TW": "申請表缺少關鍵資訊，或所選子網域與站點用途不符。",
      en: "The application is missing key information, or the chosen subdomain does not fit the site.",
    },
  },
  unreachable: {
    label: {
      "zh-CN": "站点不可达",
      "zh-TW": "站點不可達",
      en: "site unreachable",
    },
    hint: {
      "zh-CN": "所选落点无法从公网访问，或子域没有按约定接通。",
      "zh-TW": "所選落點無法從公網存取，或子網域沒有按約定接通。",
      en: "The chosen landing point is not reachable from the public internet, or the subdomain was not connected as agreed.",
    },
  },
  policy: {
    label: {
      "zh-CN": "不符合联邦约定",
      "zh-TW": "不符合聯邦約定",
      en: "does not fit the federation terms",
    },
    hint: {
      "zh-CN": "站点用途或内容与 XKnot 联邦的收录约定不符。",
      "zh-TW": "站點用途或內容與 XKnot 聯邦的收錄約定不符。",
      en: "The site's purpose or content does not fit the XKnot Federation listing terms.",
    },
  },
};

export const REJECT_REASON_CODES = Object.keys(REJECT_REASONS);

export const ACCESS_LABEL = {
  direct: {
    "zh-CN": "固定公网 IP 直连",
    "zh-TW": "固定公網 IP 直連",
    en: "direct connection on a fixed public IP",
  },
  tunnel: {
    "zh-CN": "边缘 + SSH 反向隧道",
    "zh-TW": "邊緣 + SSH 反向隧道",
    en: "edge host with an SSH reverse tunnel",
  },
  unknown: {
    "zh-CN": "尚未确定",
    "zh-TW": "尚未確定",
    en: "not decided yet",
  },
};

const CLOSING = {
  "zh-CN": "本邮件由系统发出，不接收回复。",
  "zh-TW": "本郵件由系統發出，不接收回覆。",
  en: "This message was sent automatically; replies are not monitored.",
};

const SIGN = {
  "zh-CN": "—— XKnot 联邦",
  "zh-TW": "—— XKnot 聯邦",
  en: "— XKnot Federation",
};

const HELLO = {
  "zh-CN": "{operator} 你好：",
  "zh-TW": "{operator} 你好：",
  en: "Hello {operator},",
};

/**
 * 模板：subject / text 按语种分键，占位符用 {name}。
 * companion: 该事件是否需要案例页（没有案例页就不发，避免给死链）。
 */
export const TEMPLATES = {
  "partner.received": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已收到加入申请",
      "zh-TW": "[XKnot] {id} 已收到加入申請",
      en: "[XKnot] {id} application received",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

我们已收到你提交的 XKnot 联邦加入申请。

编号：{id}
站点：{name}
地址：{url}

接下来三步：

1. 用下面的链接确认邮箱。{verifyTtl} 内未确认，申请会自动结束。
   {verifyUrl}

2. 邮箱确认后进入人工审核，通常 {reviewSla} 内给出结果。

3. 通过后签发你选的子域，再按所选落点接通。清单条目先以「未接通」状态写入，公网 /api/health 验证通过后才显示为在线。

申请状态随时可查：
{caseUrl}

{supportLine}

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

我們已收到你提交的 XKnot 聯邦加入申請。

編號：{id}
站點：{name}
位址：{url}

接下來三步：

1. 用下面的連結確認信箱。{verifyTtl} 內未確認，申請會自動結束。
   {verifyUrl}

2. 信箱確認後進入人工審核，通常 {reviewSla} 內給出結果。

3. 通過後簽發你選的子網域，再按所選落點接通。清單條目先以「未接通」狀態寫入，公網 /api/health 驗證通過後才顯示為上線。

申請狀態隨時可查：
{caseUrl}

{supportLine}

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

We have received your application to join the XKnot Federation.

Reference: {id}
Site: {name}
URL: {url}

Next, three steps:

1. Confirm your email address using the link below. The application closes automatically if it is not confirmed within {verifyTtl}.
   {verifyUrl}

2. After confirmation the application enters manual review. We usually reply within {reviewSla}.

3. Once approved, we issue the subdomain you picked and then connect the landing mode you chose. The listing entry is written as not yet connected; it shows as online only after the public /api/health check passes.

You can check the status at any time:
{caseUrl}

{supportLine}

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.verified": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已进入审核",
      "zh-TW": "[XKnot] {id} 已進入審核",
      en: "[XKnot] {id} is under review",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

申请 {id}（{name}）的邮箱已确认，现在进入人工审核。

审核会核对三件事：站点可以从公网访问、一句话简介与实际内容一致、名称与标识不与其他成员冲突。

结果会寄到这个邮箱，通常在 {reviewSla} 内。

这期间要改信息或补材料：
{caseUrl}

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

申請 {id}（{name}）的信箱已確認，現在進入人工審核。

審核會核對三件事：站點可以從公網訪問、一句話簡介與實際內容一致、名稱與標識不與其他成員衝突。

結果會寄到這個信箱，通常 {reviewSla} 內。

這期間要改資訊或補材料：
{caseUrl}

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

The email address for application {id} ({name}) is confirmed, and the application is now under manual review.

Review checks three things: the site is reachable from the public internet, the one-line intro matches the site, and the name or mark does not conflict with an existing member.

We will write to this address with the result, usually within {reviewSla}.

To change details or send additional material meanwhile:
{caseUrl}

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.hold": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 需要补充材料",
      "zh-TW": "[XKnot] {id} 需要補充材料",
      en: "[XKnot] {id} needs more information",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

申请 {id}（{name}）需要补充材料，审核暂时搁置。

需要补充：
{items}

请在 {dueAt} 前通过申请页补齐：
{caseUrl}

逾期未补，申请会在 {expireAt} 结束。之后可以重新提交，编号会换新的。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

申請 {id}（{name}）需要補充材料，審核暫時擱置。

需要補充：
{items}

請在 {dueAt} 前透過申請頁補齊：
{caseUrl}

逾期未補，申請會在 {expireAt} 結束。之後可以重新提交，編號會換新的。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Application {id} ({name}) needs more information, so review is on hold.

Still needed:
{items}

Please send it through the application page by {dueAt}:
{caseUrl}

If nothing arrives, the application closes on {expireAt}. You can apply again afterwards with a new reference.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.approved": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已通过收录审核",
      "zh-TW": "[XKnot] {id} 已通過收錄審核",
      en: "[XKnot] {id} was approved for listing",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

你提交的 XKnot 联邦加入申请（{id}）已通过审核。

站点：{name}
地址：{url}

接下来由工作人员把实例写进实例清单并重新构建门户。收录当天，门户的实例目录里会出现这个条目。

收录不包含下面三项，需要时另行确认：

- 签发 *.xknot.si 子域
- 边缘主机与 SSH 反向隧道
- 委托发信凭据

需要其中任何一项，请在申请页说明：
{caseUrl}

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

你提交的 XKnot 聯邦加入申請（{id}）已通過審核。

站點：{name}
位址：{url}

接下來由工作人員把實例寫進實例清單並重新建置入口。收錄當天，入口的實例目錄裡會出現這個條目。

收錄不包含下面三項，需要時另行確認：

- 簽發 *.xknot.si 子網域
- 邊緣主機與 SSH 反向隧道
- 委託發信憑證

需要其中任何一項，請在申請頁說明：
{caseUrl}

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Your application to join the XKnot Federation ({id}) has been approved.

Site: {name}
URL: {url}

A staff member will now add the instance to the instance manifest and rebuild the portal. The entry appears in the portal's instance directory on the day it is listed.

Listing does not include the following, which are confirmed separately:

- a *.xknot.si subdomain
- an edge host and SSH reverse tunnel
- a relay token for delegated mail

If you need any of them, say so on the application page:
{caseUrl}

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.rejected": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 的审核结果",
      "zh-TW": "[XKnot] {id} 的審核結果",
      en: "[XKnot] result for {id}",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

你提交的 XKnot 联邦加入申请（{id}）本次未通过审核。

站点：{name}
地址：{url}
原因类别：{reasonLabel}

{reasonHint}

情况有变化时可以修改后重新提交，{reapplyAfter} 之后开放。
申请页：{caseUrl}

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

你提交的 XKnot 聯邦加入申請（{id}）本次未通過審核。

站點：{name}
位址：{url}
原因類別：{reasonLabel}

{reasonHint}

情況有變化時可以修改後重新提交，{reapplyAfter} 之後開放。
申請頁：{caseUrl}

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Your application to join the XKnot Federation ({id}) was not approved this time.

Site: {name}
URL: {url}
Reason: {reasonLabel}

{reasonHint}

You can revise and apply again from {reapplyAfter}.
Application page: {caseUrl}

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.issuance": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 的接入信息已确定",
      "zh-TW": "[XKnot] {id} 的接入資訊已確定",
      en: "[XKnot] access details for {id} are set",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

实例 {id}（{name}）的接入信息已确定。

子域：{subdomain}
连通方式：{accessLabel}
边缘主机：{edgeHost}
隧道账号：{account}
专属端口：{port}

「隧道账号」「专属端口」两行只在隧道方式下出现。

下一步需要你做两件事：

1. 在本机生成密钥，私钥留在本机：
   ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-{id} -N ''

2. 把 ~/.ssh/knot-edge-{id}.pub 的内容交给我们：
   {caseUrl}

只交 .pub。不要交私钥，也不要贴进邮件或网页。

我们确认公钥已装、端口已就绪后，会再发一封交付信。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

實例 {id}（{name}）的接入資訊已確定。

子網域：{subdomain}
連通方式：{accessLabel}
邊緣主機：{edgeHost}
隧道帳號：{account}
專屬埠：{port}

「隧道帳號」「專屬埠」兩行只在隧道方式下出現。

下一步需要你做兩件事：

1. 在本機產生金鑰，私鑰留在本機：
   ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-{id} -N ''

2. 把 ~/.ssh/knot-edge-{id}.pub 的內容交給我們：
   {caseUrl}

只交 .pub。不要交私鑰，也不要貼進郵件或網頁。

我們確認公鑰已裝、埠已就緒後，會再發一封交付信。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Access details for instance {id} ({name}) are set.

Subdomain: {subdomain}
Connectivity: {accessLabel}
Edge host: {edgeHost}
Tunnel account: {account}
Dedicated port: {port}

The account and port lines appear only for tunnel mode.

Two things to do next:

1. Generate a key pair on your own machine, keeping the private key local:
   ssh-keygen -t ed25519 -f ~/.ssh/knot-edge-{id} -N ''

2. Send us the contents of ~/.ssh/knot-edge-{id}.pub:
   {caseUrl}

Send the .pub file only. Never send the private key, and never paste it into mail or a web page.

Once the key is installed and the port is ready, we will send a handoff message.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.handoff": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 的接入资料已就绪",
      "zh-TW": "[XKnot] {id} 的接入資料已就緒",
      en: "[XKnot] access material for {id} is ready",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

实例 {id}（{name}）的接入资料已就绪。

请在 {claimTtl} 内领取：
{claimUrl}

领取页只显示一次，内容包含：

- 委托发信凭据（如已开通）
- 接入件（实例 id、中枢地址、签发日期）
- 连通参数（隧道账号、专属端口；直连为空）
- 接通前的验收命令

领取后请立即写进实例配置，不要转发、截图或存进版本库。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

實例 {id}（{name}）的接入資料已就緒。

請在 {claimTtl} 內領取：
{claimUrl}

領取頁只顯示一次，內容包含：

- 委託發信憑證（如已開通）
- 接入件（實例 id、中樞位址、簽發日期）
- 連通參數（隧道帳號、專屬埠；直連為空）
- 接通前的驗收命令

領取後請立即寫進實例設定，不要轉發、截圖或存進版本庫。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Access material for instance {id} ({name}) is ready.

Claim it within {claimTtl}:
{claimUrl}

The claim page is shown once and contains:

- the relay token, if delegated mail is enabled
- the access material (instance id, hub origin, issue date)
- the connectivity parameters (tunnel account and port; empty for direct)
- the acceptance commands

Write it into the instance configuration right away. Do not forward, screenshot, or commit it.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.live": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已在联邦上线",
      "zh-TW": "[XKnot] {id} 已在聯邦上線",
      en: "[XKnot] {id} is live on the federation",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

实例 {id}（{name}）已接入 XKnot 联邦。

公网地址：{url}
门户条目：{portalUrl}
运行状态：{statusLabel}

之后中枢按实例清单探测 {healthUrl}。连续不可达时运行状态会变成中断，条目保留，不自动删除。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

實例 {id}（{name}）已接入 XKnot 聯邦。

公網位址：{url}
入口條目：{portalUrl}
運行狀態：{statusLabel}

之後中樞按實例清單探測 {healthUrl}。連續不可達時運行狀態會變成中斷，條目保留，不自動刪除。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Instance {id} ({name}) is now part of the XKnot Federation.

Public URL: {url}
Portal entry: {portalUrl}
Runtime status: {statusLabel}

The hub keeps probing {healthUrl} as listed in the instance manifest. If the instance stays unreachable, its runtime status becomes down; the entry stays and is not removed automatically.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.contact_revalidate": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] 请确认 {id} 的联系人",
      "zh-TW": "[XKnot] 請確認 {id} 的聯絡人",
      en: "[XKnot] please confirm the contact for {id}",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

我们每 180 天确认一次成员的联系人是否有效。

实例：{id}（{name}）
请确认这个邮箱仍然可用：{contactMasked}
{confirmUrl}

{confirmTtl} 内未确认，我们会把实例标记为联系人待确认，并暂停向该地址发送运营通知。站点本身、收录与运行状态都不受影响。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

我們每 180 天確認一次成員的聯絡人是否有效。

實例：{id}（{name}）
請確認這個信箱仍然可用：{contactMasked}
{confirmUrl}

{confirmTtl} 內未確認，我們會把實例標記為聯絡人待確認，並暫停向該位址發送營運通知。站點本身、收錄與運行狀態都不受影響。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

We confirm member contacts every 180 days.

Instance: {id} ({name})
Please confirm that this address still works: {contactMasked}
{confirmUrl}

If it is not confirmed within {confirmTtl}, we mark the instance contact as stale and stop sending operational notices to that address. The site, its listing, and its runtime status are unaffected.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.suspended": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已暂停收录",
      "zh-TW": "[XKnot] {id} 已暫停收錄",
      en: "[XKnot] {id} is suspended",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

实例 {id}（{name}）已在联邦中暂停收录。

生效时间：{effectiveAt}

影响：

- 门户不再展示该条目的站点档案与热点橱窗
- 委托发信凭据已吊销
- 隧道账号暂停

不受影响：

- 实例自己的库、账号、内容与积分
- 实例自己的域名与证书

恢复条件：{resumeCondition}

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

實例 {id}（{name}）已在聯邦中暫停收錄。

生效時間：{effectiveAt}

影響：

- 入口不再展示該條目的站點檔案與熱點櫥窗
- 委託發信憑證已吊銷
- 隧道帳號暫停

不受影響：

- 實例自己的庫、帳號、內容與積分
- 實例自己的網域與憑證

恢復條件：{resumeCondition}

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Instance {id} ({name}) is suspended from the federation.

Effective: {effectiveAt}

Affected:

- the portal no longer shows this entry's site profile or showcase
- the relay token is revoked
- the tunnel account is disabled

Not affected:

- the instance's own database, accounts, content, and points
- the instance's own domain and certificate

To resume: {resumeCondition}

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.retired": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已退出联邦",
      "zh-TW": "[XKnot] {id} 已退出聯邦",
      en: "[XKnot] {id} has left the federation",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

实例 {id}（{name}）已退出 XKnot 联邦。

生效时间：{effectiveAt}
子域回收：{reclaimAt}
运行状态与橱窗缓存：已删除

你的实例、内容与用户数据仍在自己的机器上，中枢不保留副本。
需要导出中枢侧与该实例相关的记录（申请单、审计事件），请在 {exportUntil} 前提出。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

實例 {id}（{name}）已退出 XKnot 聯邦。

生效時間：{effectiveAt}
子網域回收：{reclaimAt}
運行狀態與櫥窗快取：已刪除

你的實例、內容與使用者資料仍在自己的機器上，中樞不保留副本。
需要匯出中樞側與該實例相關的紀錄（申請單、稽核事件），請在 {exportUntil} 前提出。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Instance {id} ({name}) has left the XKnot Federation.

Effective: {effectiveAt}
Subdomain reclaimed: {reclaimAt}
Runtime status and showcase cache: deleted

Your instance, content, and user data remain on your own machine. The hub keeps no copy.
If you need an export of hub-side records for this instance (application, audit events), ask before {exportUntil}.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  // ---- 运行状态通知：由 ops/watch-health.mjs 发出，不是审核动作。 ----

  "partner.unreachable_24h": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已连续 24 小时无法访问",
      "zh-TW": "[XKnot] {id} 已連續 24 小時無法存取",
      en: "[XKnot] {id} has been unreachable for 24 hours",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

中枢探测不到实例 {id}（{name}）。

公网地址：{url}
健康检查：{url}/api/health
首次失败：{firstSeenAt}
最近一次探测：{checkedAt}

门户上现在显示为中断。若 7 天内仍未恢复，该条目会从联邦列表中暂时关闭；
恢复探测后自动回到列表，不需要重新申请。

先在本机确认实例在运行，再确认公网地址与隧道是否通。
需要变更落点或请人协助，回复本信或联系 {outbox}。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

中樞探測不到實例 {id}（{name}）。

公網位址：{url}
健康檢查：{url}/api/health
首次失敗：{firstSeenAt}
最近一次探測：{checkedAt}

入口現在顯示為中斷。若 7 天內仍未恢復，該條目會從聯邦清單中暫時關閉；
恢復探測後自動回到清單，不需要重新申請。

先在本地確認實例在執行，再確認公網位址與通道是否通。
需要變更落點或請人協助，回覆本信或聯絡 {outbox}。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

The hub cannot reach instance {id} ({name}).

Public URL: {url}
Health check: {url}/api/health
First failure: {firstSeenAt}
Last probe: {checkedAt}

The portal now shows it as down. If it is still down after 7 days, the entry is hidden
from the federation list until a probe succeeds again; no new application is needed.

Check that the instance is running locally, then that the public address and tunnel are up.
To change the landing setup or ask for help, reply to this message or write to {outbox}.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  "partner.hidden_7d": {
    audience: "partner",
    subject: {
      "zh-CN": "[XKnot] {id} 已从联邦列表暂时关闭",
      "zh-TW": "[XKnot] {id} 已從聯邦清單暫時關閉",
      en: "[XKnot] {id} is temporarily hidden from the federation list",
    },
    text: {
      "zh-CN": `${HELLO["zh-CN"]}

实例 {id}（{name}）已连续 7 天不可达，条目已从联邦列表暂时关闭。

公网地址：{url}
首次失败：{firstSeenAt}
最近一次探测：{checkedAt}

这不影响你的实例、内容、账号与数据。清单条目仍然保留，
探测恢复后会自动重新出现在列表里；也可以写信给 {outbox} 请人核对。

${CLOSING["zh-CN"]}

${SIGN["zh-CN"]}`,
      "zh-TW": `${HELLO["zh-TW"]}

實例 {id}（{name}）已連續 7 天不可達，條目已從聯邦清單暫時關閉。

公網位址：{url}
首次失敗：{firstSeenAt}
最近一次探測：{checkedAt}

這不影響你的實例、內容、帳號與資料。清單條目仍然保留，
探測恢復後會自動重新出現在清單裡；也可以寫信給 {outbox} 請人核對。

${CLOSING["zh-TW"]}

${SIGN["zh-TW"]}`,
      en: `${HELLO.en}

Instance {id} ({name}) has been unreachable for 7 days, so the entry is now hidden
from the federation list.

Public URL: {url}
First failure: {firstSeenAt}
Last probe: {checkedAt}

Your instance, content, accounts, and data are unaffected. The manifest entry is kept;
once a probe succeeds the entry returns to the list automatically. You can also write
to {outbox} if you want a human to check.

${CLOSING.en}

${SIGN.en}`,
    },
  },

  // ---- 内部信：发给运营方。只有这一类允许 Reply-To 指向真人。 ----

  "internal.application_new": {
    audience: "operator",
    subject: {
      "zh-CN": "[XKnot] 待审申请 {id} · {name}",
      "zh-TW": "[XKnot] 待審申請 {id} · {name}",
      en: "[XKnot] new application {id} · {name}",
    },
    text: {
      "zh-CN": `有一条新的加入申请，等待审核。

编号：{id}
站点：{name}
地址：{url}
运营方：{operator}
联系邮箱：{email}
区域 / 时区：{region} / {timezone}
简介：{intro}
标签：{tags}
申请接入：{requestSummary}

审核台：{origin}/admin/`,
      "zh-TW": `有一條新的加入申請，等待審核。

編號：{id}
站點：{name}
位址：{url}
營運方：{operator}
聯絡信箱：{email}
區域 / 時區：{region} / {timezone}
簡介：{intro}
標籤：{tags}
申請接入：{requestSummary}

審核台：{origin}/admin/`,
      en: `A new application is waiting for review.

Reference: {id}
Site: {name}
URL: {url}
Operator: {operator}
Contact: {email}
Region / timezone: {region} / {timezone}
Intro: {intro}
Tags: {tags}
Requested access: {requestSummary}

Review console: {origin}/admin/`,
    },
  },

  "internal.application_verified": {
    audience: "operator",
    subject: {
      "zh-CN": "[XKnot] 申请 {id} 邮箱已确认",
      "zh-TW": "[XKnot] 申請 {id} 信箱已確認",
      en: "[XKnot] application {id} email confirmed",
    },
    text: {
      "zh-CN": `申请 {id}（{name}）的邮箱已确认，可以开始审核。

地址：{url}
区域 / 时区：{region} / {timezone}
申请接入：{requestSummary}
审核台：{origin}/admin/`,
      "zh-TW": `申請 {id}（{name}）的信箱已確認，可以開始審核。

位址：{url}
區域 / 時區：{region} / {timezone}
申請接入：{requestSummary}
審核台：{origin}/admin/`,
      en: `The email address for application {id} ({name}) is confirmed; review can start.

URL: {url}
Region / timezone: {region} / {timezone}
Requested access: {requestSummary}
Review console: {origin}/admin/`,
    },
  },

  "internal.instance_alert": {
    audience: "operator",
    subject: {
      "zh-CN": "[XKnot] {id} 运行状态异常",
      "zh-TW": "[XKnot] {id} 運行狀態異常",
      en: "[XKnot] {id} needs attention",
    },
    text: {
      "zh-CN": `实例 {id}（{name}）需要关注。

现象：{alertLabel}
首次出现：{firstSeenAt}
最近一次探测：{checkedAt}（{httpStatus}，{latencyMs} ms）
公网地址：{url}

处置面板：{origin}/admin/`,
      "zh-TW": `實例 {id}（{name}）需要關注。

現象：{alertLabel}
首次出現：{firstSeenAt}
最近一次探測：{checkedAt}（{httpStatus}，{latencyMs} ms）
公網位址：{url}

處置面板：{origin}/admin/`,
      en: `Instance {id} ({name}) needs attention.

Signal: {alertLabel}
First seen: {firstSeenAt}
Last probe: {checkedAt} ({httpStatus}, {latencyMs} ms)
Public URL: {url}

Console: {origin}/admin/`,
    },
  },
};

export const PARTNER_EVENTS = Object.keys(TEMPLATES).filter((name) => TEMPLATES[name].audience === "partner");
export const INTERNAL_EVENTS = Object.keys(TEMPLATES).filter((name) => TEMPLATES[name].audience === "operator");
export const ALL_EVENTS = Object.keys(TEMPLATES);

export const ALERT_LABELS = {
  down_24h: {
    "zh-CN": "连续 24 小时不可达",
    "zh-TW": "連續 24 小時不可達",
    en: "unreachable for 24 hours",
  },
  down_7d: {
    "zh-CN": "连续 7 天不可达，已暂时关闭",
    "zh-TW": "連續 7 天不可達，已暫時關閉",
    en: "unreachable for 7 days, temporarily hidden",
  },
  never_14d: {
    "zh-CN": "签发后 14 天仍未接通",
    "zh-TW": "簽發後 14 天仍未接通",
    en: "not connected 14 days after issuance",
  },
  never_30d: {
    "zh-CN": "签发后 30 天仍未接通，已暂时关闭",
    "zh-TW": "簽發後 30 天仍未接通，已暫時關閉",
    en: "not connected 30 days after issuance, temporarily hidden",
  },
  relay_quota_80: {
    "zh-CN": "委托发信额度已用掉 80%",
    "zh-TW": "委託發信額度已用掉 80%",
    en: "relay quota is 80% used",
  },
  cert_expiring_14d: {
    "zh-CN": "边缘证书 14 天内到期",
    "zh-TW": "邊緣憑證 14 天內到期",
    en: "the edge certificate expires within 14 days",
  },
};

// 占位符替换。缺值一律替换成空串，避免把 {foo} 原样寄给伙伴。
export function render(template, vars) {
  return String(template).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, key) =>
    vars[key] == null ? "" : String(vars[key])
  );
}

function pick(copy, locale) {
  return copy[locale] ?? copy.en;
}

export function maskEmail(address) {
  const raw = String(address || "");
  const at = raw.indexOf("@");
  if (at <= 0) return raw;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export function describeHoldItems(codes, locale) {
  const list = (Array.isArray(codes) ? codes : [])
    .map((code) => HOLD_ITEMS[code] && pick(HOLD_ITEMS[code], locale))
    .filter(Boolean);
  if (!list.length) list.push(pick(HOLD_ITEMS.other, locale));
  return list.map((line) => `- ${line}`).join("\n");
}

export function describeRequest(application, locale) {
  // 申请一律按子域走，只剩落点方式需要说明。
  const access = ACCESS_LABEL[application.requestAccess || "unknown"] || ACCESS_LABEL.unknown;
  return pick(access, locale);
}

/**
 * 补齐所有变量的默认值。调用方只需要给 links 与少量覆盖项。
 */
export function buildVars(application, options = {}) {
  const locale = normalizeLocale(application.locale);
  const origin = String(options.origin || "https://xknot.si").replace(/\/+$/, "");
  const links = options.links || {};
  const caseUrl = links.caseUrl || `${origin}/case/${application.caseKey || ""}`;
  const reason = REJECT_REASONS[application.rejectReason || "incomplete"] || REJECT_REASONS.incomplete;
  const created = Date.parse(application.createdAt || "") || Date.now();

  return {
    id: application.id,
    name: application.name,
    url: application.url,
    operator: application.operator,
    email: application.email,
    region: application.region,
    timezone: application.timezone,
    intro: application.intro,
    tags: Array.isArray(application.tags) && application.tags.length ? application.tags.join(", ") : "—",
    locale,
    origin,
    caseUrl,
    verifyUrl: links.verifyUrl || "",
    claimUrl: links.claimUrl || "",
    confirmUrl: links.confirmUrl || caseUrl,
    portalUrl: links.portalUrl || `${origin}/${locale === "en" ? "en" : locale}/`,
    supportUrl: options.supportUrl || "",
    // 伙伴来信的落点：运营方地址。申请阶段的提醒都指向它。
    outbox: options.outbox || options.adminEmail || "",
    // 没有支持入口时整行省略，别在信尾留一个空的「可选的联系入口：」。
    supportLine: options.supportUrl
      ? `${pick({ "zh-CN": "可选的联系入口：", "zh-TW": "可選的聯絡入口：", en: "Optional contact: " }, locale)}${options.supportUrl}`
      : "",
    reviewSla: options.reviewSla || { "zh-CN": "3 个工作日", "zh-TW": "3 個工作日", en: "3 business days" }[locale],
    verifyTtl: { "zh-CN": "30 天", "zh-TW": "30 天", en: "30 days" }[locale],
    confirmTtl: { "zh-CN": "30 天", "zh-TW": "30 天", en: "30 days" }[locale],
    claimTtl: { "zh-CN": "72 小时", "zh-TW": "72 小時", en: "72 hours" }[locale],
    dueAt: (application.reviewedAt || new Date(created).toISOString()).slice(0, 10),
    expireAt: String(application.openUntil || "").slice(0, 10),
    reapplyAfter: new Date(created + 7 * 86400000).toISOString().slice(0, 10),
    items: describeHoldItems(application.holdItems, locale),
    reasonLabel: pick(reason.label, locale),
    reasonHint: pick(reason.hint, locale),
    subdomain: options.subdomain || (subdomainLabelOf(application) ? `${subdomainLabelOf(application)}.xknot.si` : ""),
    accessLabel: pick(ACCESS_LABEL[application.requestAccess || "unknown"] || ACCESS_LABEL.unknown, locale),
    edgeHost: options.edgeHost || "—",
    account: options.account || "—",
    port: options.port || "—",
    healthUrl: options.healthUrl || `${application.url}/api/health`,
    statusLabel: options.statusLabel || "up",
    contactMasked: maskEmail(application.email),
    effectiveAt: options.effectiveAt || new Date().toISOString().slice(0, 10),
    reclaimAt: options.reclaimAt || "",
    exportUntil: options.exportUntil || "",
    resumeCondition: options.resumeCondition || "—",
    requestSummary: describeRequest(application, locale),
    alertLabel: options.alertLabel || "",
    firstSeenAt: options.firstSeenAt || "",
    checkedAt: options.checkedAt || "",
    httpStatus: options.httpStatus ?? "",
    latencyMs: options.latencyMs ?? "",
  };
}

/**
 * 组装一封可以交给 mailer.send 的信。
 *
 * @returns {{ event, audience, to, replyTo, subject, text, templateVersion, locale } | null}
 */
export function buildMail(eventName, application, options = {}) {
  const template = TEMPLATES[eventName];
  if (!template) throw new Error(`unknown_mail_event:${eventName}`);
  const vars = buildVars(application, options);
  const locale = vars.locale;

  const subject = render(pick(template.subject, locale), vars);
  // 可选行没填时会留下一个空行；段落间距是空行，收掉多余的那一处。
  const text = render(pick(template.text, locale), vars).replace(/\n{3,}/g, "\n\n");

  if (template.audience === "operator") {
    const adminEmail = String(options.adminEmail || "").trim();
    if (!adminEmail) return null;
    return {
      event: eventName,
      audience: "operator",
      to: adminEmail,
      // 内部信要能直接回给申请人，这是唯一允许真人 Reply-To 的地方。
      replyTo: options.adminReplyTo || application.email,
      subject,
      text,
      templateVersion: TEMPLATE_VERSION,
      locale,
    };
  }

  return {
    event: eventName,
    audience: "partner",
    to: application.email,
    // 对外一律 no-reply：xknot.si 的 MX 只发信，回信会退。
    replyTo: options.replyTo || "",
    subject,
    text,
    templateVersion: TEMPLATE_VERSION,
    locale,
  };
}

// 兼容旧调用点与旧测试：审核结果信、给管理员的新申请信。
export function newApplicationMail(application, { adminEmail, origin, supportUrl } = {}) {
  return buildMail("internal.application_new", application, { adminEmail, origin, supportUrl });
}

export function applicantReviewMail(application, decision, { adminEmail, origin, replyTo, supportUrl } = {}) {
  const event =
    decision === "approved"
      ? "partner.approved"
      : decision === "rejected"
        ? "partner.rejected"
        : null;
  if (!event) return null;
  if (!application?.email) return null;
  return buildMail(event, application, { adminEmail, origin, replyTo, supportUrl });
}

export { LOCALES };
