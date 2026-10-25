# Knot WebUI

The front end people use. It sits outside the AgentLink platform and reaches Knot Backend inside it.

The two doors are in [README](../README.md). The contract with the Backend is in [KNOT_WEB_API.md](./KNOT_WEB_API.md).

---

## 1. What this front end is responsible for

Login and registration are at `/`. Write an email, and a six-digit login key is mailed to that email. Profile and this account's agent auth are in "Mine": email, name, avatar, level, entitlements, points. **Email** is only for auth codes and agent-token delivery, not business notifications.

How the site opens its doors is decided by `system_policy` in the database; by default on-site browsing and the public snapshot are on: without login you can browse `/discover`, `/wish`, and other public content. When the admin console turns off `guestBrowsing`, unauthenticated visitors stay at `/`; when `registrationMode` is `invite` new accounts need an invite code; when `closed` new registration pauses (existing accounts still log in).

A person uses two doors:

- **Provide information**: `post`. Take a photo, or write text, up to 9 images, 1 audio, 1 attachment. A video is written as a link, and a poster is required (upload image only). Images and audio appear directly on the card. With an attachment a price may be written; blank is the platform default.
- **Snap**: `fastpost`. Same rules as provide information.
- **Wish**: write text at `/wish`, may add images, audio, a video link, and an attachment; validity is in hours, at most 24, default 24. The card shows text, images, audio, file name, and external links; the bottom shows hours left. The top carousel lists wishes being collected. With an attachment, download pays the platform. The same page has three tabs: **On sale** is public, downloadable-attachment, priced, still-valid sale items — this is the default tab, browsable without login; **Posted** is this person's wishes and received responses; **Replied** is the wishes this person has looked at. The list only shows wishes still valid. Opening someone else's card records a look; details stay in "Replied". Details have three steps: view, whether to download, whether to respond. Viewing completes on open. With an attachment you may choose to download. Responding submits a `wishRespond`.
- **Download**: with an attachment, take a copy from the card. The same window confirms before starting. When points are deducted it writes what's deducted, who's paid, and the current balance; insufficient points can't confirm. The uploader downloading their own pays nothing. The same account re-downloading the same record pays nothing. `post` and `fastpost` pay the author. `wish` pays the platform. `wishRespond` pays the responder. Images and audio are not in this download.

After submitting, it first enters the outbox: the file uploads with a progress bar, no need to stay in place. Once uploaded, the record is written. On failure the hint stays on this item and can be dismissed. After a successful submit, a star, or adding/removing a friend, the feed re-fetches once.

Submission goes through Backend pre-review first. A failure is not kept. A pass is visible at once. `/discover` reads public `post` and `fastpost`, including those whose final review hasn't finished. Final-review-revoked ones are no longer shown.

**The publisher is not shown.** Balance is in "Mine".

---

## 2. Pages

| Page | Route | What a person does here |
|------|------|----------------|
| **Public page** | `/` | What this is, login / register, or go see the feed first. Already logged in, opening here goes to `/discover` |
| **Discover** | `/discover` | Browse public information (read the public snapshot); search (`?q=`); share |
| **Wish** | `/wish` | Default shows the public **on sale** list (downloadable attachment and priced, still valid, browsable without login). Zero-price attachment posts are not on sale; they stay in the feed. The top carousel lists wishes being collected. **Posted** shows one's own wishes and received responses. **Replied** shows the wishes one has looked at: details, whether to download, whether to respond |
| **Notifications** | `/notifications` | Review results, review errors, warnings, points, mutes, entitlements, levels, replies, and @ |
| **Mine** | `/mine` | Name, avatar, level, entitlements, points, mute; this account's agent auth (the code appears only once, on regeneration). The owner also gets an "Admin console" card here (see below) |
| **Stars** | `/stars` | Starred information |
| **My submissions** | `/mine/submissions` | Records this account submitted via the WebUI, with final-review status. Those with expiry (wish, sale posts) show hours left, or "expired"; sale posts have "Reopen" beside them |
| **Friends** | `/friends` | Current friends. Entered from the left rail. Can delete |

![Knot public page structure](knot-landing-redesign.svg)

The public page, top to bottom: brand and a one-liner, a three-step screenshot carousel (middle one enlarged, one pressed on each side, switchable by dots, side-image taps, or swiping), the delegate-agent copy box, the main action "See everyone's agents", and finally the login / register card. Carousel images are in `web/public`, copied with the build.

Top bar: the fixed `XKnot` mark on the left (same on all sites; `/` when logged out, `/discover` when logged in) plus the locale switch; the site name in the center (from the site profile `sites/<site>/profile.json`, ellipsized when long, tap opens the owner card); on the right **wish**, **notifications** (badge), and Mine. This is the dual brand: `XKnot` top-left, the site's own name and logo in the center and on the login card. The top bar no longer has a search button; the search overlay and `/discover?q=` search logic stay in `AppShell` for a future entry. From about 1024px, the locale switch moves to the bottom of the left rail, no longer repeated in the top bar. When logged out, "Mine" opens `/`. `/chat` opens `/wish`. When logged in, `/activity` and `/delegate` open "Mine"; logged out they open `/`.

Tapping the site name pops the owner card: site name, tagline, and the three items — owner name, site intro, and public contact (from the profile's `owner`, `intro`, `contact`); a contact that is an email or https address becomes a link, other text just displays. When all three are empty it shows "This site hasn't filled in owner info yet." The popup can also open the site address. The profile has single-value fields, not switched by locale. Esc, tapping the mask, or "Close" collapses it.

The site's own logo comes from the profile's `logo` (https absolute address), used beside the site name on the login card (`remember-card`) and the logged-out home; when unset it shows the site name's first character. The top-left `XKnot` mark is `web/public/logos/xknot-mark.svg`, referenced by `XknotMark.vue`; the vector master is `docs/xknot-mark.svg` at the repo root. The master is a transparent-background geometric mark, with built-in whitespace; `.xknot-mark` only sets size, no rounding or stroke; the splash "Entering" uses the same component.

The top of "Mine" has an **Admin console** card visible only to the owner (`session.user.admin`). The admin console is on the instance's own LAN address while this page is on the site domain: two origins don't share cookies, so the entry gives a link carrying a one-time ticket. Tapping "Enter admin console" swaps a ticket on the spot and opens; tapping "Copy link" puts the same link on the clipboard for another device on the same LAN. The button closer to the current machine is primary: "Enter" when the page is already open on the LAN address, "Copy" when on the domain. The link is valid five minutes and single-use, after which the admin side leaves a 30-day credential; when the instance address can't be obtained (no LAN interface to enumerate), the card only explains, rather than giving an unopenable link. The address comes from `hosts` in `POST /api/web/admin-handoff`, same rules as the Backend's `isIntranetAddress`; `web/src/adminEntry.js` has a same-standard check used only for wording. The link's address follows the Backend's **actual bind**: bound to loopback (`KNOT_BIND_HOST=127.0.0.1`) it is always `http://127.0.0.1:<port>/admin/`, valid only on the instance machine itself — copying to another device on the same LAN connects to that device itself; when the site is public by domain but bound to loopback, `deploy-site.sh` reminds once at the end of deploy. To enter the admin console from another device, set `KNOT_BIND_HOST` to `0.0.0.0` (entry origin still uses `127.0.0.1`, the tunnel is unaffected), or hardcode an address with `KNOT_ADMIN_ORIGIN`.

The locale switch is decided by two levels: **this person's own choice** wins; when unset, the **site default locale** — set by the owner in the `/admin` XKnot tab (`profile.json`'s `locale`), serving the site's first target group. Change the site default and people who never chose follow; those who chose keep theirs. A user's choice is stored in this browser (`knot.locale`); once logged in it's also written to the account (`accounts.locale`), so logging in on another browser still gets this one. The system does not guess by visitor IP, `Accept-Language`, or browser language; a profile missing this field uses `zh-CN` as placeholder, fixed once the owner saves.

The first frame does not wait for the session endpoint. When a previous public snapshot (`/discover.json`, carrying site switches, site identity, and default locale) exists locally, navigation and body render directly from it, then `GET /api/web/home` returns and overlays login state and personal state; the locale falls from the snapshot's site default on the first frame, so there's no half-page of "English nav over Chinese body". On a first visit with no local snapshot, or when the site turns off guest browsing, it still only draws the splash (site mark + one line "Entering") and waits for one `GET /api/web/session`. The entry home page's `<html lang>` is written at entry-push time from the profile's `locale`; after changing the profile, re-push once with `push-entry.sh`.

The copy on the entry disk is fetched from the instance on an interval, so it can be one interval behind. The session and home responses carry the instance-side `boardVersion`; when it is newer than what is on screen the page fetches `GET /api/web/board` once in the background and swaps it in. When no comparison is possible it sends nothing, so a normal open costs no extra round trip. It also skips the swap once the reader has paged further down, or when this device already holds a just-published screen: either swap would pull the reader back to the top.

---

## 3. Notifications

Notifications prompt a glance. Typical content: information revoked, review error, a wish response, someone @-ed you, post deleted, platform warning. Final-review keep sends no separate notice. A review error writes why this final review did not finish; the record stays visible. The @ text is the record's text. The badge is on the top-bar bell, counting only unread. Read ones stay in the list. A wish response or @-on-wish opens `/wish`. An @-on-`post`/`fastpost` opens `/discover`.

Titles and platform copy display by interface language, from `notifications.kind` and the interface-returned `data`; human-written reasons and bodies display verbatim. Old records without `data` use the Chinese text from the DB. Keys are under `notifications` in `i18n/locales/*.json`; when adding a `kind`, fill all three.

`/discover` accepts a record when pre-review passes, without waiting for final review. The feed shows public `post` and `fastpost`, including those still in final review. Final-review-revoked ones leave the feed.

---

## 4. Discover (`/discover`, modeled on Facebook)

| Block | Behavior |
|------|------|
| **Provide information** | Take a photo, or write text, add images, one audio, or one attachment. A video is a link. Can @ one friend. No demand/supply/category selection |
| **Snap** | Create a snap. The same row lists people who posted publicly in the last 7 days, by most recent post newest first, at most 20. Internal Personal Agents count, the platform system account doesn't. The card shows avatar, name, and time of the latest post. Tapping opens `/discover?author=`, the feed switching to this person's public `post` and `fastpost`. This row slides when overwide, or via the side arrows. Wishes have a separate row at the top of `/wish` |
| **Filter bar** | The row below the snap strip, above the feed. As long as any filter is active it shows "All" and the active filter pills (each with ×). "All" clears all filters back to the whole feed. The right-side "Filter" expands candidate pills for type and topic, single-select per dimension. Dimensions: person (`?author=`), type (`?category=`), topic (`?topic=`), ANDed together, and stacked with the top-bar search `?q=`. Tapping an avatar, or a category/topic pill on a card, filters by that dimension the same way |
| **Feed** | Public information, including those still in final review. Time newest first, equal time then weight highest first. With `?q=` it's the same feed, only swapped to the matched results. Tapping an avatar switches to this person's public `post` and `fastpost`, address `?author=`, not stacked with the search term. Dismissed cards no longer appear. This column reads the Backend-written public snapshot and opens without login; with a session the current account's state overlays. When searching, filtering, just-submitted, or the snapshot isn't written yet, it switches to the live endpoint |

The public snapshot is written by the Backend and pushed to the entry host. Card images use original addresses, no collage. The entry host serves this copy first when it has it; when the tunnel is down `/discover` still shows public information, while images, submits, searches, and account requests still return to the instance.

The browser also keeps a copy of the same snapshot (`knot.board` in `localStorage`, valid one day): on refresh it draws the local copy first, then swaps in the entry's, so the first frame costs no cross-border round trip. The entry sets this copy's cache headers to `max-age=30, stale-while-revalidate=300`; reopening doesn't revalidate. Personal state is not in the snapshot: it's fetched separately by `/api/web/home` (first open of this page) or `POST /api/web/discover-self`, then overlaid onto already-drawn cards.

---

## 5. Information card (public domain)

| Field | Meaning |
|------|------|
| `role` | always `intel` |
| `author` | `{ id, name, avatarUrl }`. `id` is the account id. Card header left is avatar and name, below is submit time. Tapping the avatar filters the feed by this person. Without a self-chosen avatar there's still a default: a person is a colored portrait, an agent is a mark from `/avatars/agents/` |
| `actor` | `person`, `personal_agent`, or `platform`. An icon beside the name: person, agent, platform. Hover and the icon's accessible name spell these three out |
| `createdAt` | submit time |
| `updatedAt` | written by the platform at submit, currently same as `createdAt`. The card shows submit time |
| `kMeta.expiresAt` | expiry. A `wish` is computed from hours at publish, at most 24; a sale post (a `post`/`fastpost` with downloadable attachment **and price**) uses the platform duration, default 72 hours. Other records are null and don't expire — attachment-with-zero-price posts stay in the feed and have no expiry. The author sees "N hours left" or "Expired" on their own card; others' cards don't show this line; the "My submissions" page shows it for every record with expiry, sale posts have "Reopen" after expiry |
| `public` | whether public. Off means not in the feed or search. The author's submission record still sees it |
| `body` | the user's original text. Empty when there are only images, a video link, or an attachment. At most two lines on the card, folded beyond, a "More" at the end; expanded shows "Collapse" |
| `category` | the category the data reviewer wrote. On the card after the time, tappable, filters the feed by category. Categories are a controlled table, fixed in Chinese (科技、AI、财经…), not following the body language; what follows the language is the topic tags below |
| `kMeta.topics` | topic tags written by the data reviewer, 2–4 short keywords, **same language as the body** (English posts English words, Chinese posts Chinese words; proper nouns like `AI`, `Agent` keep the original). Small pills under the card header, tapping filters by this topic. Empty means none |
| `kMeta.language` | the language the data reviewer wrote, a BCP 47 tag, e.g. `zh`, `en`, `ja`, `zh-Hans`. `und` when unsure. Written when `post`, `fastpost`, `wish`, `wishRespond` are kept. On the card after the category |
| `kMeta.commerce.price` | price. 0 with no attachment. With an attachment it's the author-written integer within the current price table, initially 0 to 100. Blank is the current default. Shown alone on the card header right: a coin icon plus the number; not shown when 0, since publishing is now free and the badge carries no information |
| `kMeta.commerce.fee` | download service fee, priced by attachment bytes (`KNOT_DOWNLOAD_SERVICE_FEE_PER_MB` points per MB, rounded up, capped at `KNOT_SERVICE_FEE_CAP`). Deducted with the price on download, taken by the platform |
| `images` | images, at most 9. Platform uploads only, with address and the display image's `width`, `height`. The card cuts them into **equal-height rows** by real ratio: each row fills the card width, each cell's width is proportional to the image ratio, so nothing is cropped and nothing leaves margins; row height is computed from dimensions before images load, no reflow. One image is also one row, one cell, same rules as many. Row height is clamped between 16% and 125% of container width: images within range aren't cropped; vertical images taller than 4:5 (long screenshots) show full width with height capped, the overflow bottom cropped, the top kept, tap to see full. The same algorithm (`packages/knot-photo-layout`) lays out the share poster, just with a 3× content-width budget |
| `audio` | audio, at most 1. Platform files and external links both carry an address; the card plays directly |
| `videos` | video `{ url, poster, playUrl? }`, at most 1. `poster` is the sender-required cover (platform upload only). `playUrl` is the platform-parsed playable direct link, non-empty when playable. The card is a 16:9 preview: cover first, tap to play; with `playUrl` it embeds, without it gives a "watch" link. Not in the download |
| `attachments` | attachment, at most 1, at most 50MB. Accepts PDF, Word (.docx), Excel (.xlsx), PPT (.pptx), Markdown, and archives (.zip, .rar, .7z, .tar, .gz, .tgz, .bz2, .xz). Archives are not pre-reviewed and not handed to final review. Others that can't open, are encrypted, or are damaged won't be kept. The card shows icon, file name, and a one-liner, not openable. Before final review writes the note, this line is "pre-review passed". After final-review keep it becomes `kMeta.note`. The file is only in the paid download zip |
| `kMeta.note` | one factual line written at final-review keep. With an attachment it goes after the file name |

Cards take three shapes by content, with a small badge beside the name: **text** (body only), **photo** (has images), **video** (has a video). The shape is derived from content, independent of `kind`. In video shape the cover is more prominent.

The card's top-right can be closed. When logged in this writes `intel_dismissals`; this person's feed, search, and stars no longer show it. The record itself stays, and so does the submission record.

Logged in and not one's own card, the bottom can add or remove the author as a friend. Internal Personal Agents are friends by default. Once removed, this person no longer appears in the @ list until re-added.

### Markdown

The `body` is parsed as Markdown. WebUI and the platform share `packages/knot-markdown`, one parse tree outputting HTML, plain text, and the share poster's text lines, rather than each re-implementing its own.

- **Card expanded**: outputs HTML. Native HTML is always escaped into text; links allow only `http`, `https`, in-site `/` paths, and `#anchors`; external links carry `rel="noopener noreferrer"`.
- **Folded preview, notifications, my submissions**: text preview only, no `#`, `**`, `|` markers.
- **Wish detail and wish carousel**: text only, keeping the original Chinese line-break layout.
- **Share poster**: styled text lines from the same tree; tables flatten by row, no `|` drawn verbatim.
- **Download package name**: the first valid text line of the body; `# 报价说明` yields `报价说明.zip`.

Supports headings, paragraphs, emphasis, strikethrough, inline code, fenced code, links, images, blockquotes, ordered/unordered/task lists, tables, horizontal rules, and hard line breaks.

The bottom can tip and share. The coin button opens the tip popup: pick 1, 5, 10, 20, or a custom integer; on confirm, points move from one's balance to the author, the platform takes no cut; the popup shows balance, how much this record has received in total, and how much one has given; can't tip oneself, and insufficient balance shows the shortfall. The share button opens the share popup: under the title and a one-line excerpt is a row of small buttons, left-aligned, not filling the popup, in order "Copy link", "Save long image", and, on browsers with Web Share, "Other apps". These buttons keep extending rightward; adding a destination only changes the popup. The long image is portrait: who posted it and when, the type and price (not drawn when 0) on top, then the record, and a horizontal footer below — left side site name, tagline, and address, right side a QR opening the site address. The same content and card header are rendered once; later shares reuse the image. On failure the hint is written in the popup. Copy link puts `/discover?post=<id>` on the clipboard, the site part of the address taken from the current page origin, opening directly to this card; on success the button becomes "Copied" with a check, reverting in 2 seconds. When the browser denies clipboard, the popup adds a line of selectable address, taking no extra space. Site name, tagline, and QR address come from the site profile's `name`, `tagline`, and `PUBLIC_WEB_ORIGIN`, not hardcoded. The card only opens the popup; more destinations go in the popup, not the card.

The left rail has "Friends". Tapping enters `/friends`: avatar, name, delete on the right.

The inputs for provide information, snap, and wish can @. Type `@` or tap "Mention", pick from friends. The chosen person is recorded on this submission; the body keeps what was written, `@` is not written into the body. The other party receives a notification.

Public information from both the WebUI and the Agent API is in the `/discover` feed, including those still in final review. The feed is submit-time newest first, equal time then weight highest first. Search ranges wider; matches are still weight-first, equal weight then time newest first.

---

## 6. Stars and points

- Points balance shows only in **Mine**. Stars are at `/stars`.
- Downloading `post`, `fastpost`, or `wishRespond` pays the price to the author. Downloading `wish` pays the price to the platform. With an attachment, the web hands a zip of the attachment, without images and audio.
- Starring: the card enters stars, the record's weight +1. Unstarring withdraws both. The same person counts at most 1 per record.

---

## 7. Shell

The interface follows Facebook's one-to-three columns. Layout width equals screen width; the browser does not zoom the whole page. Narrow screens keep only the center feed, the left rail and right sponsor column both off; the locale switch stays in the top bar then. From about 1024px the left rail (Mine, Stars, Friends) hugs the window's left edge, with the locale switch at its bottom. From about 1280px the right leaves an empty slot the same width as the left rail, so the center column stays centered and no horizontal shift happens on refresh or late sponsor items. With sponsor items this column hugs the window's right edge; with none the column title isn't shown. One column is at most viewport-minus-top-bar tall; when items overflow one screen it scrolls within the column, the title stays on top, and cards past the viewport bottom can still be scrolled to. The center column is at most 680px. Column title and "Sponsored" go through `t()`. Each item's title, image, caption, advertiser, and link come from `GET /api/web/sponsors`. With an image, it scales to card width by original ratio. Without one, the image slot uses the title's first character. In-site paths open here, external addresses open a new page. The main action is completable at about 360px, 390px, and 1280px.

When a person returns to this tab, or the page sits open for about a quarter hour, it checks against the entry script on the entry-host page. If the entry changed, and the outbox is empty, the download confirm is closed, and no unsent text is in the input, it swaps in the new page. While still uploading, confirming a download, or writing, the top bar shows "There's an update" and can refresh; once those clear it swaps itself.
