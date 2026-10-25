import { defineStore } from "pinia";
import { createIntel, uploadAttachment, uploadAudio, uploadImage } from "../api.js";
import { errorText } from "../composers/packet.js";

export function packetDraft({ body, images = [], files = [], audio = null, video = null, extra, policy }) {
  const parts = [
    ...images.map((file) => ({ file, kind: "image" })),
    ...files.map((file) => ({ file, kind: "file" })),
    ...(audio ? [{ file: audio, kind: "audio" }] : []),
    ...(video?.posterFile ? [{ file: video.posterFile, kind: "poster" }] : []),
  ];
  return {
    name: files[0]?.name || audio?.name || images[0]?.name || video?.posterFile?.name || "",
    body,
    parts,
    video,
    extra,
    policy,
  };
}

const uploadOf = {
  image: uploadImage,
  file: uploadAttachment,
  audio: uploadAudio,
  poster: uploadImage,
};

let nextId = 0;
// 已经点了「关闭」的任务。id 只增不减，所以这份集合不会误伤后来的任务。
const cancelled = new Set();

export const useOutboxStore = defineStore("outbox", {
  state: () => ({
    jobs: [],
    revision: 0,
  }),
  actions: {
    enqueue(draft) {
      const id = ++nextId;
      this.jobs.push({
        id,
        name: draft.name || "",
        progress: draft.parts.length ? 0 : 100,
        status: "sending",
        error: "",
      });
      this.run(id, draft);
    },
    dismiss(id) {
      // 只从列表里删掉不等于停下：run() 里每过完一次 await 都要看这个标记，
      // 否则上传继续、最后照样 createIntel，用户点了取消内容还是发出去了。
      cancelled.add(id);
      this.jobs = this.jobs.filter((job) => job.id !== id);
    },
    async run(id, draft) {
      const current = () => this.jobs.find((job) => job.id === id);
      const stopped = () => cancelled.has(id) || !current();
      try {
        const imageIds = [];
        const fileIds = [];
        const audioIds = [];
        let posterId = "";
        const total = draft.parts.reduce((sum, part) => sum + (part.file.size || 0), 0) || 1;
        let sent = 0;
        for (const part of draft.parts) {
          if (stopped()) return;
          const data = await uploadOf[part.kind](part.file, (ratio) => {
            const job = current();
            if (!job || job.status !== "sending") return;
            job.progress = Math.min(99, Math.round(((sent + (part.file.size || 0) * ratio) / total) * 100));
          });
          if (stopped()) return;
          sent += part.file.size || 0;
          if (part.kind === "image") imageIds.push(data.id);
          else if (part.kind === "file") fileIds.push(data.id);
          else if (part.kind === "poster") posterId = data.id;
          else audioIds.push(data.id);
        }
        if (stopped()) return;
        const extra = { ...draft.extra };
        if (audioIds.length) extra.audioIds = audioIds;
        if (draft.video) {
          extra.videos = [{ url: draft.video.url, poster: { id: posterId } }];
        }
        if (stopped()) return;
        // 默认发内容；上架商品时草稿自带 send，指向 /store。两条路只差最后这一次调用。
        const send = typeof draft.send === "function" ? draft.send : createIntel;
        await send(draft.body, imageIds, fileIds, extra);
        this.jobs = this.jobs.filter((job) => job.id !== id);
        this.revision += 1;
      } catch (err) {
        const job = current();
        if (!job) return;
        job.status = "failed";
        job.error = errorText(err.code, draft.policy);
      }
    },
  },
});
