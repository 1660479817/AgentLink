import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "../stores/session";
import AboutView from "../views/AboutView.vue";
import HomeView from "../views/HomeView.vue";
import MineView from "../views/MineView.vue";
import NotificationsView from "../views/NotificationsView.vue";
import SubmissionsView from "../views/SubmissionsView.vue";
import StarsView from "../views/StarsView.vue";
import ActivityView from "../views/ActivityView.vue";
import FriendsView from "../views/FriendsView.vue";
import WishView from "../views/WishView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/about", name: "about", component: AboutView },
    { path: "/mine", name: "mine", component: MineView },
    { path: "/stars", name: "stars", component: StarsView },
    { path: "/activity", name: "activity", component: ActivityView },
    { path: "/friends", name: "friends", component: FriendsView },
    { path: "/mine/submissions", name: "submissions", component: SubmissionsView },
    { path: "/wish", name: "wish", component: WishView },
    { path: "/chat", redirect: { name: "wish" } },
    { path: "/buy", redirect: { name: "home" } },
    { path: "/notifications", name: "notifications", component: NotificationsView },
    { path: "/delegate", redirect: { name: "mine" } },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.ready) await session.load();
  if (to.meta.session && !session.user) return { name: "home" };
  return true;
});

export default router;
