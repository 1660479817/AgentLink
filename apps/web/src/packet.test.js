import assert from "node:assert/strict";
import test from "node:test";
import { lockedImages, packetAudio, packetFile, packetVideos, photoUrls, videoFrame } from "./packet.js";

test("a card keeps each part inside its capacity", () => {
  const images = [
    { id: "a", url: "/a" },
    { id: "b", url: "/b" },
    { id: "c", url: "/c" },
    { id: "d", url: "/d" },
    { id: "e", url: "/e" },
  ];
  assert.deepEqual(photoUrls([], images), ["/a", "/b", "/c", "/d"]);
  assert.deepEqual(photoUrls(["/x"], images), ["/x"]);
  assert.deepEqual(lockedImages([], [{ id: "a", name: "a.png" }]).map((file) => file.id), ["a"]);
  assert.deepEqual(lockedImages([], [{ id: "a", name: "a.png" }, { id: "b", url: "/b" }]), []);
  assert.equal(packetAudio([{ id: "1" }, { id: "2" }]).length, 1);
  assert.equal(packetVideos([{ url: "https://a" }, { url: "https://b" }]).length, 1);
  assert.deepEqual(
    packetFile([
      { id: "pic", image: true, name: "a.png" },
      { id: "doc", name: "a.pdf" },
      { id: "extra", name: "b.pdf" },
    ]).map((file) => file.id),
    ["doc"]
  );
});

test("a video link becomes one preview frame", () => {
  assert.equal(videoFrame("https://www.youtube.com/watch?v=abc123").src, "https://www.youtube.com/embed/abc123");
  assert.equal(videoFrame("https://www.youtube.com/watch?v=abc123").poster, "https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  assert.equal(videoFrame("https://example.com/watch", "https://cdn.example.com/cover.jpg").poster, "https://cdn.example.com/cover.jpg");
  assert.equal(videoFrame("https://youtu.be/abc123").kind, "iframe");
  assert.match(videoFrame("https://www.bilibili.com/video/BV1xx411c7mD").src, /bvid=BV1xx411c7mD/);
  assert.equal(videoFrame("https://cdn.example.com/a.mp4").kind, "file");
  assert.equal(videoFrame("https://example.com/watch").kind, "open");
});
