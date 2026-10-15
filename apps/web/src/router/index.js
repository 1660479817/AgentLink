import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "../stores/session";
import DiscoverView from "../views/DiscoverView.vue";
import FriendsView from "../views/FriendsView.vue";
import LandingView from "../views/LandingView.vue";
import MineView from "../views/MineView.vue";
import NotificationsView from "../views/NotificationsView.vue";
import StarsView from "../views/StarsView.vue";
import SubmissionsView from "../views/SubmissionsView.vue";
import WishView from "../views/WishView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "gate", component: LandingView },
    { path: "/discover", name: "discover", component: DiscoverView },
    { path: "/mine", name: "mine", component: MineView },
    { path: "/stars", name: "stars", component: StarsView },
    { path: "/friends", name: "friends", component: FriendsView },
    { path: "/mine/submissions", name: "submissions", component: SubmissionsView },
    { path: "/wish", name: "wish", component: WishView },
    { path: "/notifications", name: "notifications", component: NotificationsView },
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
  if ((to.name === "mine" || to.name === "submissions") && !session.user) return { name: "gate" };
  return true;
});

export default router;
