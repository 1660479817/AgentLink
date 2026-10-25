// 外网访问的状态判定。
//
// 这份测试盯的是「什么时候给哪个按钮」：错一个，人就会在只能重交一张的时候
// 反复点重试，或者在中枢只是慢一点的时候被劝去换一个子域。

import assert from "node:assert/strict";
import test from "node:test";

import { accessState, accessSteps, needsPublicKey } from "./access.js";

const SITE = {
  name: "北港",
  tagline: "北海沿岸的慢阅读。",
  owner: "Lin",
  contact: "lin@example.com",
};

const APPLICATION = {
  id: "XK-1",
  caseUrl: "https://hub.example/case/abcdef12",
  status: "approved",
  submittedAt: "2026-10-20T08:00:00.000Z",
};

const handoff = { account: "knot-tunnel-nordhavn", host: "entry.example", port: 18090 };

function run(state, steps = [], lastError = null) {
  return { state, steps, lastError, updatedAt: "2026-10-20T08:05:00.000Z" };
}

function progress({ appStatus = "approved", state = "provisioning", steps = [], lastError = null, handoffValue = null } = {}) {
  return {
    application: { id: "XK-1", status: appStatus, subdomain: "nordhavn" },
    issued: { id: "nordhavn", url: "https://nordhavn.xknot.si", tier: "free", since: "2026-10-20", status: "pending" },
    run: run(state, steps, lastError),
    handoff: handoffValue,
  };
}

test("没申请过、档案完整：给「申请加入」", () => {
  const view = accessState({ site: SITE });
  assert.equal(view.state, "not_joined");
  assert.equal(view.action, "apply");
  assert.equal(view.reason, "");
  assert.deepEqual(view.missing, []);
});

test("没申请过、档案缺项：仍然是「申请加入」，但指出缺什么", () => {
  const view = accessState({ site: { name: "北港" } });
  assert.equal(view.state, "not_joined");
  assert.equal(view.action, "apply");
  assert.equal(view.reason, "profile_incomplete");
  assert.deepEqual(view.missing.sort(), ["email", "intro", "operator"]);
});

test("没有站点目录：什么都不给，因为连底账都写不了", () => {
  const view = accessState({ site: SITE, hasSiteDir: false });
  assert.equal(view.state, "failed");
  assert.equal(view.reason, "profile_unconfigured");
  assert.equal(view.action, "none");
});

test("申请已交、中枢还没建接通任务：等待，可以重试", () => {
  const view = accessState({ site: SITE, application: APPLICATION, progress: { application: null, run: null } });
  assert.equal(view.state, "submitted");
  assert.equal(view.action, "retry");
  assert.equal(view.attempt.id, "XK-1");
  assert.equal(view.caseUrl, APPLICATION.caseUrl);
});

test("中枢正在配置：算进行中，不催人动手", () => {
  const view = accessState({ site: SITE, application: APPLICATION, progress: progress() });
  assert.equal(view.state, "provisioning");
  assert.equal(view.action, "retry");
});

test("入口侧就绪、交接参数已给：按钮变成「接通并启动隧道」", () => {
  const view = accessState({
    site: SITE,
    application: APPLICATION,
    progress: progress({ state: "awaiting_tunnel", handoffValue: handoff }),
  });
  assert.equal(view.state, "awaiting_tunnel");
  assert.equal(view.action, "connect");
});

test("入口侧就绪但还没给交接参数：只能重试，别让人去点一个拿不到参数的按钮", () => {
  const view = accessState({
    site: SITE,
    application: APPLICATION,
    progress: progress({ state: "awaiting_tunnel", handoffValue: null }),
  });
  assert.equal(view.state, "awaiting_tunnel");
  assert.equal(view.action, "retry");
});

test("中枢的接通停了：给重试，并把停在哪一步带到步骤里", () => {
  const view = accessState({
    site: SITE,
    application: APPLICATION,
    progress: progress({
      state: "failed",
      lastError: "tls_failed",
      steps: [
        { id: "allocate", state: "done" },
        { id: "publish", state: "done" },
        { id: "account", state: "done" },
        { id: "sshd", state: "done" },
        { id: "static", state: "done" },
        { id: "dns", state: "done" },
        { id: "vhost", state: "done" },
        { id: "tls", state: "failed", error: "tls_failed" },
      ],
    }),
  });
  assert.equal(view.state, "failed");
  assert.equal(view.reason, "run_failed");
  assert.equal(view.action, "retry");
  assert.equal(view.steps.find((step) => step.id === "tls").state, "failed");
});

test("中枢按退避自动重试的一步：仍算进行中，但错误码照写", () => {
  const view = accessState({
    site: SITE,
    application: APPLICATION,
    progress: progress({ steps: [{ id: "dns", state: "pending", error: "dns_missing" }] }),
  });
  const dns = view.steps.find((step) => step.id === "dns");
  assert.equal(dns.state, "retrying");
  assert.equal(dns.error, "dns_missing");
  assert.equal(view.state, "provisioning");
});

test("中枢已收回这张单：只能重新申请，重试没有意义", () => {
  for (const status of ["withdrawn", "rejected", "expired"]) {
    const view = accessState({ site: SITE, application: APPLICATION, progress: progress({ appStatus: status }) });
    assert.equal(view.state, "failed", status);
    assert.equal(view.reason, "application_closed", status);
    assert.equal(view.action, "reapply", status);
  }
});

test("中枢那边已经没有这张单（404）：同样只能重新申请", () => {
  const view = accessState({
    site: SITE,
    application: APPLICATION,
    progressError: "hub_error",
    progressStatus: 404,
  });
  assert.equal(view.state, "failed");
  assert.equal(view.reason, "application_closed");
  assert.equal(view.action, "reapply");
});

test("案例链接与当前中枢对不上：重新申请，不拿别人的地址去发请求", () => {
  const view = accessState({ site: SITE, application: APPLICATION, progressError: "bad_case_url" });
  assert.equal(view.state, "failed");
  assert.equal(view.reason, "case_url_invalid");
  assert.equal(view.action, "reapply");
});

test("中枢连不上：给重试，不假装成没申请过", () => {
  const view = accessState({ site: SITE, application: APPLICATION, progressError: "unreachable" });
  assert.equal(view.state, "failed");
  assert.equal(view.reason, "hub_unreachable");
  assert.equal(view.action, "retry");
  assert.equal(view.hubError, "unreachable");
});

test("接入件已生效：已上线，不给按钮", () => {
  const view = accessState({
    site: SITE,
    issued: { id: "nordhavn", url: "https://nordhavn.xknot.si", since: "2026-10-20", tier: "free", status: "active" },
    application: APPLICATION,
    progress: progress({ state: "active", handoffValue: handoff }),
  });
  assert.equal(view.state, "active");
  assert.equal(view.action, "none");
});

test("验收通过但接入件还没生效：仍显示已上线，但要再同步一次才落地", () => {
  const view = accessState({
    site: SITE,
    application: APPLICATION,
    progress: progress({ state: "active", handoffValue: handoff }),
  });
  assert.equal(view.state, "active");
  assert.equal(view.reason, "join_pending");
  assert.equal(view.action, "retry");
});

test("过程按发生顺序排：本地两步在前，中枢八步居中，本地三步收尾", () => {
  const { steps } = accessSteps({ site: SITE, application: APPLICATION, progress: progress() });
  assert.deepEqual(
    steps.map((step) => step.id),
    ["profile", "apply", "allocate", "publish", "account", "sshd", "static", "dns", "vhost", "tls", "tunnel", "probe", "join"]
  );
  assert.equal(steps[0].state, "done");
  // 中枢还没建 run 时按计划展开，别让人以为一步都还没轮上。
  assert.equal(steps[2].state, "todo");
});

test("过程里的本地步骤反映盘上的事实：隧道段与接入件", () => {
  const { steps } = accessSteps({
    site: SITE,
    application: APPLICATION,
    progress: progress({ state: "awaiting_tunnel", handoffValue: handoff }),
    local: { tunnelConfigured: true, joinWritten: false },
  });
  assert.equal(steps.find((step) => step.id === "tunnel").state, "done");
  assert.equal(steps.find((step) => step.id === "probe").state, "running");
  assert.equal(steps.find((step) => step.id === "join").state, "todo");
});

test("档案缺项时第一步是待办，且带上字段名", () => {
  const { steps, missing } = accessSteps({ site: { name: "北港" } });
  assert.equal(steps[0].id, "profile");
  assert.equal(steps[0].state, "todo");
  assert.deepEqual(steps[0].note.split(",").sort(), ["email", "intro", "operator"]);
  assert.deepEqual(missing.sort(), ["email", "intro", "operator"]);
});

test("只有「公钥没交上」值得补交一次", () => {
  assert.equal(
    needsPublicKey(progress({ steps: [{ id: "sshd", state: "pending", error: "public_key_missing" }] })),
    true
  );
  assert.equal(needsPublicKey(progress({ steps: [{ id: "dns", state: "pending", error: "dns_missing" }] })), false);
  assert.equal(needsPublicKey(null), false);
});
