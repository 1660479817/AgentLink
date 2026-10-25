import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGES, usePacketMedia } from "./packet.js";

function jpeg(bytes, name = "photo.jpg") {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

// 解码换成一个可控的延迟。浏览器里压缩一张要几百毫秒，而这正是草稿可能被清空的
// 时间窗；这里只需要把这段等待拉长到测试能插进去。
// 环境里没有 document，编码那一步必然失败，shrinkImage 于是原样返回——这一组测的是
// 状态机（追加/丢弃/回收），编解码本身在 imageScale.test.js 里测。
function holdDecode(ms = 10) {
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () =>
    new Promise((resolve) => {
      setTimeout(() => resolve({ width: 3000, height: 2000, close() {} }), ms);
    });
  return () => {
    if (saved === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = saved;
  };
}

// 组件之外调用 usePacketMedia 会撞上 onUnmounted 的告警。这组测试不挂 DOM，
// 只把这条预期内的告警静音，其余告警照旧。
function media(policy = {}, options = {}) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return usePacketMedia(() => policy, options);
  } finally {
    console.warn = warn;
  }
}

test("a picture picked right before the draft is cleared does not come back", async () => {
  const release = holdDecode(20);
  try {
    const form = media();
    const picked = form.addImages([jpeg(3 * 1024 * 1024)]);
    // 压缩期间表单按「忙」处理，提交与关闭按钮都点不动；这里模拟另一个入口：
    // 分享条收起、wish 面板切到另一条、快拍组件卸载，都会走到 reset。
    assert.equal(form.preparing.value, true);
    form.reset();
    await picked;
    assert.equal(form.images.value.length, 0);
    assert.equal(form.previewUrls.value.length, 0);
    assert.equal(form.preparing.value, false);
    assert.equal(form.error.value, "");
  } finally {
    release();
  }
});

test("a poster picked while the draft is cleared does not reappear", async () => {
  const release = holdDecode(20);
  try {
    const form = media();
    const picked = form.setPosterFile(jpeg(3 * 1024 * 1024));
    form.reset();
    await picked;
    assert.equal(form.posterFile.value, null);
    assert.equal(form.posterPreview.value, "");
  } finally {
    release();
  }
});

test("a batch picked after the draft was cleared still lands", async () => {
  const release = holdDecode(5);
  try {
    const form = media();
    // 代数只在 reset/卸载时前进，不能把它钉在模块上，否则清空过一次就再也传不了图。
    form.reset();
    await form.addImages([jpeg(3 * 1024 * 1024)]);
    assert.equal(form.images.value.length, 1);
    assert.equal(form.previewUrls.value.length, 1);
  } finally {
    release();
  }
});

test("two batches picked back to back both land", async () => {
  const release = holdDecode(5);
  try {
    const form = media();
    // 第二批评完第一张之前就进来了：两边都在压缩，谁先回来都不该覆盖对方。
    const first = form.addImages([jpeg(3 * 1024 * 1024, "a.jpg"), jpeg(3 * 1024 * 1024, "b.jpg")]);
    const second = form.addImages([jpeg(3 * 1024 * 1024, "c.jpg")]);
    await Promise.all([first, second]);
    assert.deepEqual(
      form.images.value.map((file) => file.name).sort(),
      ["a.jpg", "b.jpg", "c.jpg"]
    );
    assert.equal(form.previewUrls.value.length, 3);
  } finally {
    release();
  }
});

test("removing a picture while another is still compressing keeps the previews in step", async () => {
  const release = holdDecode(5);
  try {
    const form = media();
    await form.addImages([jpeg(3 * 1024 * 1024, "a.jpg")]);
    const pending = form.addImages([jpeg(3 * 1024 * 1024, "b.jpg")]);
    form.removeImage(0);
    await pending;
    assert.deepEqual(
      form.images.value.map((file) => file.name),
      ["b.jpg"]
    );
    // 预览与文件一一对应：删掉一张不该把后来那张的地址一起撤掉或留成孤儿。
    assert.equal(form.previewUrls.value.length, 1);
  } finally {
    release();
  }
});

test("the count cap holds even when the pictures arrive late", async () => {
  const release = holdDecode(1);
  try {
    const form = media();
    const picks = Array.from({ length: MAX_IMAGES + 2 }, (_, i) => jpeg(3 * 1024 * 1024, `p${i}.jpg`));
    await form.addImages(picks);
    assert.equal(form.images.value.length, MAX_IMAGES);
    assert.equal(form.previewUrls.value.length, MAX_IMAGES);
  } finally {
    release();
  }
});

test("a file that is not a picture never enters the picture list", async () => {
  const form = media();
  await form.addImages([new File([new Uint8Array(10)], "notes.pdf", { type: "application/pdf" })]);
  assert.equal(form.images.value.length, 0);
  // 选了不能传的文件要说一句，而不是让「点了没反应」。
  assert.notEqual(form.error.value, "");
  assert.notEqual(form.error.value, "error.bad_mime");
});

test("a picture that cannot be brought under the limit is refused with a message", async () => {
  const release = holdDecode(5);
  try {
    const form = media({ imageMaxBytes: 1000 });
    await form.addImages([jpeg(5000)]);
    assert.equal(form.images.value.length, 0);
    // 有文案，而不是把 error 的键名直接甩给用户。
    assert.notEqual(form.error.value, "");
    assert.notEqual(form.error.value, "error.image_too_large");
  } finally {
    release();
  }
});

test("picking a poster replaces the previous one instead of stacking", async () => {
  const release = holdDecode(5);
  try {
    const form = media();
    await form.setPosterFile(jpeg(3 * 1024 * 1024, "a.jpg"));
    await form.setPosterFile(jpeg(3 * 1024 * 1024, "b.jpg"));
    assert.equal(form.posterFile.value.name, "b.jpg");
    assert.match(form.posterPreview.value, /^blob:/);
  } finally {
    release();
  }
});

test("a poster removed while it is still compressing does not come back", async () => {
  const release = holdDecode(20);
  try {
    const form = media();
    const picked = form.setPosterFile(jpeg(3 * 1024 * 1024, "poster.jpg"));
    // 用户等不及，点掉了这张海报（或换了一张又删掉）。
    form.removePoster();
    await picked;
    assert.equal(form.posterFile.value, null);
    assert.equal(form.posterPreview.value, "");
    assert.equal(form.preparing.value, false);
  } finally {
    release();
  }
});

test("a decode that never settles gives up instead of locking the form", async () => {
  // 卡住的解码比压不动更糟：preparing 永不归零，提交口子就一直关着，只能刷新页面。
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () => new Promise(() => {});
  try {
    const form = media({}, { prepareTimeoutMs: 20 });
    // 超过 2MB 才会真的去解码，这里才有机会卡住。
    await form.addImages([jpeg(3 * 1024 * 1024)]);
    // 没压成，但也没卡住：按「压不动」退回原文件，交给后端。
    assert.equal(form.images.value.length, 1);
    assert.equal(form.images.value[0].size, 3 * 1024 * 1024);
    assert.equal(form.preparing.value, false);
  } finally {
    if (saved === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = saved;
  }
});
