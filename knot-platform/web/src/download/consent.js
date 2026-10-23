import { reactive, ref } from "vue";

export const downloadConsent = ref(null);

export function downloadOffer({ price = 0, fee = 0, granted = false, mine = false, balance = 0 } = {}) {

  const amount = Math.max(0, Number(price) || 0) + Math.max(0, Number(fee) || 0);
  const points = Number(balance);
  if (mine) return { kind: "own", amount: 0, short: false };
  if (granted) return { kind: "again", amount: 0, short: false };
  if (amount > 0) {
    return { kind: "charge", amount, short: Number.isFinite(points) && points < amount };
  }
  return { kind: "free", amount: 0, short: false };
}

function finish(result) {
  const job = downloadConsent.value;
  if (!job) return;
  downloadConsent.value = null;
  job.resolve(Boolean(result));
}

export function settleDownload(accepted) {
  const job = downloadConsent.value;
  if (!job || job.phase !== "confirm") return;
  if (!accepted) {
    finish(false);
    return;
  }
  // 余额不够时确认键本来是禁用的；万一被程序调进来，也要给一个看得见的结果，
  // 不能静默 return 把界面留在 confirm。
  if (job.short) {
    job.code = "insufficient_points";
    job.phase = "error";
    return;
  }
  void runTask();
}

export function dismissDownload() {
  const job = downloadConsent.value;
  if (!job || job.phase === "confirm" || job.phase === "working") return;
  finish(job.phase === "done");
}

async function runTask() {
  const job = downloadConsent.value;
  if (!job?.task) return;
  job.phase = "working";
  try {
    await job.task();
    if (downloadConsent.value !== job) return;
    job.phase = "done";
  } catch (error) {
    if (downloadConsent.value !== job) return;
    job.code = error?.code || "request_failed";
    job.phase = "error";
  }
}

export function acceptDownload({ price = 0, fee = 0, granted = false, mine = false, balance = 0, task, code } = {}) {
  if (downloadConsent.value?.phase === "confirm") settleDownload(false);
  if (downloadConsent.value) return Promise.resolve(false);

  const offer = code ? { kind: "charge", amount: 0, short: false } : downloadOffer({ price, fee, granted, mine, balance });
  return new Promise((resolve) => {
    downloadConsent.value = reactive({
      phase: code ? "error" : "confirm",
      kind: offer.kind,
      amount: offer.amount,
      short: offer.short,
      balance: Number(balance) || 0,
      price: Math.max(0, Number(price) || 0),
      fee: Math.max(0, Number(fee) || 0),
      code: code || "",
      task: typeof task === "function" ? task : null,
      resolve,
    });
  });
}
