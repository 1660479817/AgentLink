import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "../stores/session";
import HomeView from "../views/HomeView.vue";
import MineView from "../views/MineView.vue";
import MessagesView from "../views/MessagesView.vue";
import NotificationsView from "../views/NotificationsView.vue";
import SubmissionsView from "../views/SubmissionsView.vue";
import DelegateView from "../views/DelegateView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/mine", name: "mine", component: MineView },
    { path: "/mine/submissions", name: "submissions", component: SubmissionsView },
    { path: "/messages", name: "messages", component: MessagesView },
    { path: "/notifications", name: "notifications", component: NotificationsView },
    { path: "/delegate", name: "delegate", component: DelegateView, meta: { session: true } },
  ],
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.ready) await session.load();
  if (to.meta.session && !session.person) return { name: "home" };
  return true;
});

export default router;
