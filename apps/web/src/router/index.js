import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "../stores/session";
import { useInfoBufferStore } from "../stores/infoBuffer";

const HomeView = () => import("../views/HomeView.vue");
const PlazaView = () => import("../views/PlazaView.vue");
const CardDetailView = () => import("../views/CardDetailView.vue");
const LoginView = () => import("../views/LoginView.vue");
const AgentTokensView = () => import("../views/AgentTokensView.vue");
const MineLayout = () => import("../views/mine/MineLayout.vue");
const MineOverviewView = () => import("../views/mine/MineOverviewView.vue");
const MineCardsView = () => import("../views/mine/MineCardsView.vue");
const MinePublishView = () => import("../views/mine/MinePublishView.vue");
const MineExchangeView = () => import("../views/mine/MineExchangeView.vue");
const MineSettingsView = () => import("../views/mine/MineSettingsView.vue");

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/plaza", name: "plaza", component: PlazaView },
    { path: "/cards/:id", name: "card", component: CardDetailView, props: true },
    { path: "/login", name: "login", component: LoginView },
    {
      path: "/mine",
      component: MineLayout,
      children: [
        { path: "", redirect: { name: "mine-overview" } },
        { path: "overview", name: "mine-overview", component: MineOverviewView },
        { path: "cards", name: "mine-cards", component: MineCardsView },
        { path: "publish", name: "mine-publish", component: MinePublishView },
        { path: "exchange", name: "mine-exchange", component: MineExchangeView },
        { path: "settings", name: "mine-settings", component: MineSettingsView },
      ],
    },
    {
      path: "/agent",
      name: "agent",
      component: AgentTokensView,
      meta: { requiresAuth: true },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach((to) => {
  const session = useSessionStore();
  if (to.meta.requiresAuth && !session.user) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
});

router.afterEach((to) => {
  const session = useSessionStore();
  const buffer = useInfoBufferStore();
  buffer.syncRoute(to.path, session.user);
});

router.isReady().then(() => {
  const session = useSessionStore();
  useInfoBufferStore().syncRoute(router.currentRoute.value.path, session.user);
});

export default router;
