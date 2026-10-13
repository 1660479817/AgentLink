import { ref } from "vue";

export const downloadConsent = ref(null);

export function downloadCharge({ price = 0, granted = false } = {}) {
  const amount = Number(price) || 0;
  if (granted || amount <= 0) return 0;
  return amount;
}

export function settleDownload(accepted) {
  const job = downloadConsent.value;
  if (!job) return;
  downloadConsent.value = null;
  job.resolve(Boolean(accepted));
}

export function acceptDownload({ price = 0, granted = false, payee = "author" } = {}) {
  const amount = downloadCharge({ price, granted });
  if (!amount) return Promise.resolve(true);
  settleDownload(false);
  return new Promise((resolve) => {
    downloadConsent.value = {
      amount,
      payee: payee === "platform" ? "platform" : "author",
      resolve,
    };
  });
}
