// 实例侧的接入底账：中枢返回的申请编号与案例链接只出现一次。
//
// 邮件只是通知，刷新页面之后还得找得到进度；这份文件记在站点目录里，
// 与 profile.json、xknot.env 同级。案例链接本身就是能力凭据，所以权限 600，
// 不进版本库、不进发布包。
//
// 写入是整份替换：先写临时文件再 rename，半截文件不会盖掉上一次的记录。

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ID_RE = /^[A-Za-z0-9-]{3,64}$/;

export function joinStatePath(profileFile) {
  const file = String(profileFile || "").trim();
  return file ? path.join(path.dirname(file), "join.json") : null;
}

function cleanApplication(value) {
  if (!value || typeof value !== "object") return null;

  const id = String(value.id || "").trim();
  if (!ID_RE.test(id)) return null;

  let caseUrl = "";
  try {
    const url = new URL(String(value.caseUrl || ""));
    // 只收 http(s)：案例页可能在中枢的本机联调地址上。
    if (url.protocol === "https:" || url.protocol === "http:") caseUrl = url.toString();
  } catch {
    // 不是绝对地址就不记。
  }
  if (!caseUrl) return null;

  const status = String(value.status || "").trim().slice(0, 24) || "pending";
  const submittedAt = String(value.submittedAt || value.createdAt || "").trim() || new Date().toISOString();
  return { id, caseUrl, status, submittedAt };
}

export async function readJoinState(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const application = cleanApplication(parsed?.application);
    if (!application) return null;
    return {
      formatVersion: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      application,
    };
  } catch {
    return null;
  }
}

export async function saveJoinState(file, application) {
  if (!file) return null;
  const cleaned = cleanApplication(application);
  if (!cleaned) return null;

  const payload = { formatVersion: 1, updatedAt: new Date().toISOString(), application: cleaned };
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
  return payload;
}
