// 页面在 <head> 里对外声明的两件事：标题与规范地址。
//
// 抽成纯函数是因为它是「爬虫读到什么」的一部分，而这个仓库的单测跑在 node 里，
// 挂不了 DOM。组件只负责把结果写进去，规则留在这里可以逐条断言。
//
// SPA 内跳转不会重新取 HTML。从首页点进 /discover 之后，若 head 不动，页面仍然
// 声明自己就是首页——canonical 指回 /，爬虫会把两页并成一页，服务端那份独立的
// canonical 等于白写。

/** 有自己标题的页面。没列进来的（登录页、兜底跳转）就用站点名。 */
export const PAGE_TITLE_KEYS = {
  discover: "discover.pageTitle",
  store: "store.title",
  economy: "economy.title",
  mine: "mine.title",
  submissions: "submissions.title",
  notifications: "notifications.title",
  friends: "friends.title",
  stars: "stars.title",
};

/** 「站点名 · 页面名」；页面没有名字时只留站点名。 */
export function pageTitle({ routeName, siteName, t }) {
  const key = PAGE_TITLE_KEYS[routeName];
  return key ? `${siteName} · ${t(key)}` : siteName;
}

/** 规范地址只留路径：查询串与尾斜杠都不进 canonical，根地址仍写成一个 /。 */
export function canonicalPath(routePath) {
  const value = String(routePath || "/");
  const trimmed = value.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** 绝对地址：入口生成的 canonical 带域名，客户端更新时必须用同一个域名。 */
export function canonicalUrl(origin, routePath) {
  return `${String(origin || "").replace(/\/+$/, "")}${canonicalPath(routePath)}`;
}
