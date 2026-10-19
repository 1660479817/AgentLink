import assert from "node:assert/strict";
import { test } from "node:test";
import { jitteredInterval, startPolling } from "./polling.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function manualScheduler() {
  const timers = [];
  const schedule = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const cancel = () => {};
  return {
    timers,
    schedule,
    cancel,
    async fire() {
      const next = timers.shift();
      if (!next) throw new Error("no timer scheduled");
      await next();
    },
  };
}

test("jitteredInterval stays within ±20% of the interval", () => {
  assert.equal(jitteredInterval(1000, () => 0), 800);
  assert.equal(jitteredInterval(1000, () => 1), 1200);
  assert.equal(jitteredInterval(1000, () => 0.5), 1000);
});

test("immediate start runs fn once right away", async () => {
  const scheduler = manualScheduler();
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
    },
    intervalMs: 1000,
    immediate: true,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  handle.stop();
});

test("each round schedules the next with jitter", async () => {
  const scheduler = manualScheduler();
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
    },
    intervalMs: 1000,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
  });
  assert.equal(scheduler.timers.length, 1);
  await scheduler.fire();
  assert.equal(calls, 1);
  assert.equal(scheduler.timers.length, 1);
  handle.stop();
});

test("when false skips fn but keeps the cadence", async () => {
  const scheduler = manualScheduler();
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
    },
    intervalMs: 1000,
    when: () => false,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
  });
  await scheduler.fire();
  assert.equal(calls, 0);
  assert.equal(scheduler.timers.length, 1);
  handle.stop();
});

test("a hidden tab pauses and refreshes immediately when visible again", async () => {
  const scheduler = manualScheduler();
  const listeners = {};
  let state = "hidden";
  const doc = {
    get visibilityState() {
      return state;
    },
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    removeEventListener() {},
  };
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
    },
    intervalMs: 1000,
    immediate: true,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
    document: doc,
  });
  await Promise.resolve();
  // hidden from the start, so nothing runs and no timer is scheduled
  assert.equal(calls, 0);
  assert.equal(scheduler.timers.length, 0);

  state = "visible";
  listeners.visibilitychange();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(scheduler.timers.length, 1);
  handle.stop();
});

test("stop prevents further runs", async () => {
  const scheduler = manualScheduler();
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
    },
    intervalMs: 1000,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
  });
  assert.equal(scheduler.timers.length, 1);
  handle.stop();
  await scheduler.fire();
  assert.equal(calls, 0);
});

test("a slow fn is not run twice in overlap", async () => {
  const scheduler = manualScheduler();
  const gate = deferred();
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
      await gate.promise;
    },
    intervalMs: 1000,
    immediate: true,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  // the first run is still in flight; poke must not start a second run
  await handle.poke();
  assert.equal(calls, 1);
  gate.resolve();
  await Promise.resolve();
  handle.stop();
});

test("a throwing fn swallows the error and keeps polling", async () => {
  const scheduler = manualScheduler();
  let calls = 0;
  const handle = startPolling({
    fn: async () => {
      calls += 1;
      throw new Error("boom");
    },
    intervalMs: 1000,
    immediate: true,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    jitter: () => 1000,
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(scheduler.timers.length, 1);
  handle.stop();
});
