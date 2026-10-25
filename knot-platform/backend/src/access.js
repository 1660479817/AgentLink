// 外网访问：把「填档案 → 交申请 → 中枢配置 → 本机隧道 → 验收 → 写接入件」
// 压成一份可判定的视图，管理页只照着它画状态、按钮与过程。
//
// 这里只判断，不读写文件、不发请求：调用方把已经拿到的数据交进来。这样
// 「什么时候该给申请按钮、什么时候该给重试、什么时候只能重交一张」都能被
// 单元测试固定住，不必起服务器、不必连中枢。
//
// 状态只有六个，另外带一个原因码：
//   not_joined      还没申请（原因可能是档案不全，或还没有站点目录）
//   submitted       申请已交，中枢还没建接通任务
//   provisioning    中枢在入口主机上配置
//   awaiting_tunnel 入口侧已完成，球在本机这一侧（起隧道）
//   active          已上线（接入件已写入）或已验收、正等重启生效
//   failed          失败；原因是「再点一次会好」还是「只能重交一张」由 reason 区分
//
// 按钮只有五个：apply / reapply / retry / connect / none。前两个都展开申请表单，
// 区别只在文案：一个是首次申请，一个是上一张已经作废。

import { applicationPayload, missingFields } from "./xknotJoin.js";

// 中枢那边的终态：这三种都不会再自动接通，只能重新交一张。
const CLOSED_STATUSES = new Set(["withdrawn", "rejected", "expired"]);

// 中枢自动接通的八个步骤，顺序就是 provision worker 的推进顺序。
// 中枢还没建 run 时按这个列出计划，让人看见「点完之后会发生什么」。
const HUB_STEPS = ["allocate", "publish", "account", "sshd", "static", "dns", "vhost", "tls"];

function hubStep(step) {
  const raw = String(step?.state || "");
  let state = "todo";
  if (raw === "done" || raw === "skipped") state = "done";
  else if (raw === "failed") state = "failed";
  // 中枢失败之后会按退避自动重试，这时仍然是「进行中」，但错误码照写：
  // 人能看到卡在哪一步，也不会以为整条链路已经停了。
  else if (step?.error) state = "retrying";
  return {
    id: String(step.id),
    kind: "hub",
    state,
    error: String(step.error || ""),
    note: String(step.note || ""),
  };
}

/**
 * 过程列表：本地两步 + 中枢八步 + 本地三步。
 *
 * 顺序就是事实发生的顺序。中枢的步骤来自它自己的 run；还没建 run 时按计划
 * 展开成待办，这样「提交之后还剩几件事」一开始就看得见。
 */
export function accessSteps({ site = null, application = null, progress = null, local = null } = {}) {
  const missing = missingFields(applicationPayload(site || {}, { email: "" }));
  const run = progress?.run || null;
  const steps = [
    { id: "profile", kind: "local", state: missing.length ? "todo" : "done", error: "", note: missing.join(",") },
    { id: "apply", kind: "local", state: application ? "done" : "todo", error: "", note: String(application?.id || "") },
  ];

  const reported = Array.isArray(run?.steps) ? run.steps.filter((step) => step && typeof step.id === "string") : [];
  if (reported.length) steps.push(...reported.map(hubStep));
  else steps.push(...HUB_STEPS.map((id) => ({ id, kind: "hub", state: "todo", error: "", note: "" })));

  // 隧道配置写进 tunnel.env 只是一半，通不通要看中枢的探测：那就是下面的 probe。
  steps.push({
    id: "tunnel",
    kind: "local",
    state: local?.tunnelConfigured ? "done" : progress?.handoff ? "running" : "todo",
    error: String(local?.error || ""),
    note: "",
  });
  steps.push({
    id: "probe",
    kind: "local",
    state: run?.state === "active" ? "done" : run?.state === "awaiting_tunnel" ? "running" : "todo",
    error: run?.state === "active" ? "" : String(run?.lastError || ""),
    note: "",
  });
  steps.push({
    id: "join",
    kind: "local",
    state: local?.joined || local?.joinWritten ? "done" : "todo",
    error: String(local?.joinError || ""),
    note: "",
  });

  return { steps, missing };
}

/**
 * @param {object} input
 * @param {object|null} input.site 自述区（决定「档案是否够交申请」）
 * @param {object|null} input.issued 接入件里的签发区（空 id 表示还没接入）
 * @param {object|null} input.application 本地底账里的那张申请
 * @param {object|null} input.progress 中枢进度原文
 * @param {string} input.progressError 读进度的失败码：bad_case_url / hub_error / unreachable
 * @param {number} input.progressStatus 读进度的 HTTP 状态（hub_error 时才有）
 * @param {object|null} input.local 本地写入结果
 * @param {boolean} input.hasSiteDir 有没有站点目录（没有就什么都写不了）
 */
export function accessState({
  site = null,
  issued = null,
  application = null,
  progress = null,
  progressError = "",
  progressStatus = 0,
  local = null,
  hasSiteDir = true,
} = {}) {
  const { steps, missing } = accessSteps({ site, application, progress, local });
  const issuedView = {
    id: String(issued?.id || ""),
    url: String(issued?.url || ""),
    since: String(issued?.since || ""),
    tier: String(issued?.tier || ""),
    status: String(issued?.status || ""),
  };
  const hubApp = progress?.application || null;
  const run = progress?.run || null;
  const attempt = application
    ? {
        id: application.id,
        status: String(application.status || ""),
        submittedAt: String(application.submittedAt || ""),
        caseUrl: String(application.caseUrl || ""),
      }
    : null;

  const base = {
    attempt,
    issued: issuedView,
    missing,
    steps,
    caseUrl: attempt?.caseUrl || "",
    hubStatus: String(hubApp?.status || attempt?.status || ""),
    hubError: String(progressError || ""),
    // 只有「中枢说公钥没交上」值得补交一次；其余失败补交没有意义。
    keyNeeded: needsPublicKey(progress),
  };

  // 案例链接与当前中枢对不上（换过中枢），或中枢那边已经没有这张单：
  // 这两种重试多少次都不会变好，只能重新交一张。
  const gone = progressError === "bad_case_url" || (progressError === "hub_error" && progressStatus === 404);

  // 没有站点目录时连 join.json 都写不了，别让人白点。
  if (!hasSiteDir) return { ...base, state: "failed", reason: "profile_unconfigured", action: "none" };

  if (hubApp && CLOSED_STATUSES.has(String(hubApp.status || ""))) {
    return { ...base, state: "failed", reason: "application_closed", action: "reapply" };
  }
  if (issuedView.id) return { ...base, state: "active", reason: "", action: "none" };

  if (gone) {
    return {
      ...base,
      state: "failed",
      reason: progressError === "bad_case_url" ? "case_url_invalid" : "application_closed",
      action: attempt ? "reapply" : "apply",
    };
  }
  if (!attempt) {
    return {
      ...base,
      state: "not_joined",
      reason: missing.length ? "profile_incomplete" : "",
      action: "apply",
    };
  }
  if (progressError) return { ...base, state: "failed", reason: "hub_unreachable", action: "retry" };
  if (!run) return { ...base, state: "submitted", reason: "", action: "retry" };

  switch (String(run.state || "")) {
    case "active":
      // 验收通过但接入件还没生效（写完要重启 Backend）：再同步一次就能落地。
      return { ...base, state: "active", reason: "join_pending", action: "retry" };
    case "awaiting_tunnel":
      return { ...base, state: "awaiting_tunnel", reason: "", action: progress?.handoff ? "connect" : "retry" };
    case "failed":
      return { ...base, state: "failed", reason: "run_failed", action: "retry", hubError: String(run.lastError || "") };
    case "provisioning":
      return { ...base, state: "provisioning", reason: "", action: "retry" };
    default:
      return { ...base, state: "submitted", reason: "", action: "retry" };
  }
}

/** 失败的那一步是不是「这一侧还没把公钥交上去」——只有它值得补交一次。 */
export function needsPublicKey(progress = null) {
  const steps = Array.isArray(progress?.run?.steps) ? progress.run.steps : [];
  return steps.some((step) => step && step.error === "public_key_missing");
}
