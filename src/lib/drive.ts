import { gfetch, gjson } from "./google";

// A small Google Drive client. With the drive.file permission Cadence can only see files it made,
// never the rest of your Drive. Everything lives in a "Cadence" folder you can open yourself.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

export interface DFile { id: string; name: string; modifiedTime: string; size?: string; mimeType?: string; appProperties?: Record<string, string> }

export async function findFiles(q: string): Promise<DFile[]> {
  const out: DFile[] = [];
  let page = "";
  do {
    const u = new URL(`${API}/files`);
    u.searchParams.set("q", q);
    u.searchParams.set("fields", "nextPageToken,files(id,name,modifiedTime,size,mimeType,appProperties)");
    u.searchParams.set("pageSize", "200");
    u.searchParams.set("spaces", "drive");
    if (page) u.searchParams.set("pageToken", page);
    const r = await gjson<{ files: DFile[]; nextPageToken?: string }>(u.toString());
    out.push(...r.files);
    page = r.nextPageToken ?? "";
  } while (page);
  return out;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function ensureFolder(name: string, parent: string | null, tag: string): Promise<string> {
  const q = `mimeType='${FOLDER}' and trashed=false and appProperties has { key='cadence' and value='${esc(tag)}' }` + (parent ? ` and '${parent}' in parents` : "");
  const found = await findFiles(q);
  if (found.length) return found.sort((a, b) => a.id.localeCompare(b.id))[0].id;
  const r = await gjson<{ id: string }>(`${API}/files?fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}), appProperties: { cadence: tag } }),
  });
  return r.id;
}

export async function download(id: string): Promise<Response> {
  const r = await gfetch(`${API}/files/${id}?alt=media`);
  if (!r.ok) throw new Error(`Drive download ${r.status}`);
  return r;
}

export async function createFile(name: string, parent: string, body: Blob, props: Record<string, string> = {}): Promise<DFile> {
  const meta = { name, parents: [parent], mimeType: body.type || "application/octet-stream", appProperties: { cadence: "file", ...props } };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", body);
  return gjson<DFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`, { method: "POST", body: form });
}

export async function updateFile(id: string, body: Blob): Promise<DFile> {
  return gjson<DFile>(`${UPLOAD}/files/${id}?uploadType=media&fields=id,name,modifiedTime`, {
    method: "PATCH", headers: { "content-type": body.type || "application/octet-stream" }, body,
  });
}

export async function trashFile(id: string): Promise<void> {
  const r = await gfetch(`${API}/files/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) });
  if (!r.ok && r.status !== 404) throw new Error(`Drive trash ${r.status}`);
}

export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
