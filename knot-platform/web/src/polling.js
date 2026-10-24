const POLL_JITTER_RATIO = 0.2;

export function jitteredInterval(intervalMs, random = Math.random) {
  const low = intervalMs * (1 - POLL_JITTER_RATIO);
  const high = intervalMs * (1 + POLL_JITTER_RATIO);
  return Math.round(low + (high - low) * random());
}

export function startPolling({
  fn,
  intervalMs,
  when = () => true,
  immediate = false,
  onVisible = true,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  jitter = jitteredInterval,
  document: doc,
} = {}) {
  let timer = null;
  let stopped = false;
  let running = false;
  let visible = !doc || doc.visibilityState !== "hidden";

  async function tick() {
    if (stopped) return;
    if (running) return;
    if (!visible) return;
    if (!when()) {
      scheduleNext();
      return;
    }
    running = true;
    try {
      await fn();
    } catch {
      /* swallow errors; the next round retries instead of looping tightly */
    } finally {
      running = false;
    }
    scheduleNext();
  }

  function scheduleNext() {
    if (stopped) return;
    timer = schedule(() => void tick(), jitter(intervalMs));
  }

  function onVisibilityChange() {
    const next = !doc || doc.visibilityState !== "hidden";
    if (next === visible) return;
    visible = next;
    if (visible) {
      cancel(timer);
      void tick();
    } else {
      cancel(timer);
      timer = null;
    }
  }

  if (doc?.addEventListener) {
    doc.addEventListener("visibilitychange", onVisibilityChange);
  }

  if (immediate) {
    void tick();
  } else {
    scheduleNext();
  }

  return {
    stop() {
      stopped = true;
      cancel(timer);
      timer = null;
      if (doc?.removeEventListener) doc.removeEventListener("visibilitychange", onVisibilityChange);
    },
    poke: tick,
  };
}
