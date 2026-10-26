// 写场景的清理判定。
//
// 发帖成功而解析不出 id、删除失败、删除抛异常，这三种都会在库里留下记录。
// 判定放这里而不是 write.js 里，是为了能用 node --test 覆盖：k6 脚本在 node 下 import 不了。

// 从 POST /api/agent/intel 的响应里取 id；取不到返回空串，调用方必须把它当失败。
// 拿到 id 之前吞掉异常的话，发帖已经进了库，却连一条错误都不记。
export function intelIdFrom(response) {
  try {
    const body = response.json();
    const intel = body && body.intel;
    if (!intel) return "";
    return intel.id || (intel.kMeta && intel.kMeta.id) || "";
  } catch (error) {
    return "";
  }
}

// 删除是否真的完成：2xx 且 body.ok，或者 404（本来就不在）。
// 429 在这里算「没删掉」——probe.js 把它记成限流，但清理链路关心的是记录还在不在。
export function deletePassed(response) {
  if (!response) return false;
  if (response.status === 404) return true;
  if (!(response.status >= 200 && response.status < 300)) return false;
  try {
    return response.json("ok") === true;
  } catch (error) {
    return false;
  }
}
