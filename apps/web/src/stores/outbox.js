import { defineStore } from "pinia";
import { createIntel, uploadAttachment, uploadAudio, uploadImage } from "../api.js";
import { errorText } from "../composers/packet.js";

export function packetDraft({ body, images = [], files = [], audio = null, extra, policy }) {
  const parts = [
    ...images.map((file) => ({ file, kind: "image" })),
    ...files.map((file) => ({ file, kind: "file" })),
    ...(audio ? [{ file: audio, kind: "audio" }] : []),
  ];
  return {
    name: files[0]?.name || audio?.name || images[0]?.name || "",
    body,
    parts,
    extra,
    policy,
  };
}

const uploadOf = {
  image: uploadImage,
  file: uploadAttachment,
  audio: uploadAudio,
};

let nextId = 0;

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
      this.jobs = this.jobs.filter((job) => job.id !== id);
    },
    async run(id, draft) {
      const current = () => this.jobs.find((job) => job.id === id);
      try {
        const imageIds = [];
        const fileIds = [];
        const audioIds = [];
        const total = draft.parts.reduce((sum, part) => sum + (part.file.size || 0), 0) || 1;
        let sent = 0;
        for (const part of draft.parts) {
          const data = await uploadOf[part.kind](part.file, (ratio) => {
            const job = current();
            if (!job || job.status !== "sending") return;
            job.progress = Math.min(99, Math.round(((sent + (part.file.size || 0) * ratio) / total) * 100));
          });
          sent += part.file.size || 0;
          if (part.kind === "image") imageIds.push(data.id);
          else if (part.kind === "file") fileIds.push(data.id);
          else audioIds.push(data.id);
        }
        const extra = { ...draft.extra };
        if (audioIds.length) extra.audioIds = audioIds;
        await createIntel(draft.body, imageIds, fileIds, extra);
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
