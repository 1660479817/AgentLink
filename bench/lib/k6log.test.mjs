import test from "node:test";
import assert from "node:assert/strict";
import { k6Messages } from "./k6log.mjs";

test("旧格式 WARN[0000] 收进提示，进度行和 info 不收", () => {
  const stderr = [
    "          /\\      |‾‾| /‾‾/   /‾‾/",
    "time=\"2026-10-23T14:00:00+08:00\" level=info msg=\"setup: base=https://example.xknot.si assets=3\"",
    "WARN[0001] setup: 公开信息流为空，卡片详情将跳过",
    "running (00m01.0s), 0/5 VUs, 10 complete and 0 interrupted iterations",
    "ERRO[0002] [write] 发帖失败：status=429",
    "",
  ].join("\n");

  assert.deepEqual(k6Messages(stderr), ["setup: 公开信息流为空，卡片详情将跳过", "[write] 发帖失败：status=429"]);
});

test("新格式 time=… level=warning msg=… 也收", () => {
  const stderr = 'time="2026-10-23T14:00:00+08:00" level=warning msg="Agent 只有一份授权码：20 个 VU 共享一个账号"\n';
  assert.deepEqual(k6Messages(stderr), ["Agent 只有一份授权码：20 个 VU 共享一个账号"]);
});

test("没有提示时返回空数组，不把 summary 当作提示", () => {
  assert.deepEqual(k6Messages(""), []);
  assert.deepEqual(k6Messages(undefined), []);
  assert.deepEqual(k6Messages('     data_received........: 1.2 MB   120 kB/s\n'), []);
});
