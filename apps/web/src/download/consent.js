import { reactive, ref } from "vue";

export const downloadConsent = ref(null);

export function downloadCharge({ price = 0, granted = false } = {}) {
  const amount = Number(price) || 0;
  if (granted || amount <= 0) return 0;
  return amount;
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

export function acceptDownload({ price = 0, granted = false, payee = "author", task, code } = {}) {
  if (downloadConsent.value?.phase === "confirm") settleDownload(false);
  if (downloadConsent.value) return Promise.resolve(false);

  const amount = code ? 0 : downloadCharge({ price, granted });
  const phase = code ? "error" : amount ? "confirm" : "working";
  return new Promise((resolve) => {
    const job = reactive({
      phase,
      amount,
      payee: payee === "platform" ? "platform" : "author",
      code: code || "",
      task: typeof task === "function" ? task : null,
      resolve,
    });
    downloadConsent.value = job;
    if (phase === "working") void runTask();
  });
}
