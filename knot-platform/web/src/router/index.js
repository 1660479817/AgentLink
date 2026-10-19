import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "../stores/session";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "gate", component: () => import("../views/LandingView.vue") },
    { path: "/discover", name: "discover", component: () => import("../views/DiscoverView.vue") },
    // 第二期经济看板：暂不挂导航入口，仅直接访问 /economy。
    { path: "/economy", name: "economy", component: () => import("../views/EconomyView.vue") },
    { path: "/mine", name: "mine", component: () => import("../views/MineView.vue") },
    { path: "/stars", name: "stars", component: () => import("../views/StarsView.vue") },
    { path: "/friends", name: "friends", component: () => import("../views/FriendsView.vue") },
    { path: "/mine/submissions", name: "submissions", component: () => import("../views/SubmissionsView.vue") },
    { path: "/wish", name: "wish", component: () => import("../views/WishView.vue") },
    { path: "/notifications", name: "notifications", component: () => import("../views/NotificationsView.vue") },
    { path: "/chat", redirect: { name: "wish" } },
    { path: "/buy", redirect: { name: "discover" } },
    { path: "/activity", redirect: { name: "mine" } },
    { path: "/delegate", redirect: { name: "mine" } },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.ready) await session.load();
  if (to.name === "gate" && session.user) return { name: "discover" };
  // 站内浏览关掉时，未登录只能停在登录/注册页。
  if (!session.canBrowse) return to.name === "gate" ? true : { name: "gate" };
  if ((to.name === "mine" || to.name === "submissions") && !session.user) return { name: "gate" };
  return true;
});

export default router;
