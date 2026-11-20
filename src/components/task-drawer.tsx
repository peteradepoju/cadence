import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { X, Trash2, Copy, Bell, Plus, Paperclip, Sparkles, Loader2, Timer, ExternalLink, Download, CalendarClock, FileText, ImageOff, ImagePlus, ChevronLeft, ChevronRight } from "lucide-react";
import { NotesEditor } from "./notes";
import type { Attachment, Column, Project, Task } from "../lib/model";
import { addTask, completeTask, deleteTask, moveToProject, reopenTask, setColumn, timeSpent, updateTask } from "../lib/actions";
import { aiReady, breakDown } from "../lib/ai";
import { minutesLabel, niceDate, today } from "../lib/dates";
import { aiProblem } from "../lib/gemini";
import { type Reminder, uid } from "../lib/model";
import { all, get, put, useColl, useRec, settings } from "../lib/store";
import { fileBlob } from "../lib/sync";
import { idb } from "../lib/idb";
import { start as startFocus } from "../lib/focus";
import { PriorityChip, ProjectChip, TagChip, WhenChip, Chip } from "./pickers";
import { Tick, TaskRow } from "./task-row";
import { Button, cx, IconBtn, MenuItem, Popover, toast, useIsMobile, Modal } from "./ui";
import { InlineAdd } from "./quick-add";

export function TaskDrawer() {
  const [params] = useSearchParams();
  const id = params.get("task");
  const task = useRec("tasks", id);
  const [p, setP] = useSearchParams();
  const close = () => { const n = new URLSearchParams(p); n.delete("task"); setP(n, { replace: true }); };
  const mobile = useIsMobile();
  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("[role=dialog] [role=dialog]")) close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  if (!id) return null;
  if (!task) return null;
  return (
    <>
      {mobile && <div className="fixed inset-0 z-40 bg-black/30" onClick={close} />}
      <aside className={cx("fixed z-40 bg-surface overflow-y-auto",
        mobile ? "inset-x-0 bottom-0 top-10 rounded-t-3xl shadow-float sheet-up safe-bottom" : "top-0 right-0 bottom-0 w-[440px] border-l border-border shadow-float slide-in")}>
        <Editor key={task.id} id={task.id} onClose={close} />
      </aside>
    </>
  );
}

function Editor({ id, onClose }: { id: string; onClose: () => void }) {
  const task = useRec("tasks", id)!;
  const allTasks = useColl("tasks");
  const projects = useColl("projects");
  const sessions = useColl("sessions");
  const nav = useNavigate();
  const [title, setTitle] = useState(task.title);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(task.title); }, [task.title]);
  const subs = allTasks.filter(t => t.parentId === id).sort((a, b) => a.order - b.order);
  const project = projects.find(p => p.id === task.projectId);
  const parent = task.parentId ? get("tasks", task.parentId) : undefined;
  const spent = timeSpent(id);
  void sessions;

  const saveTitle = () => { const t = title.trim(); if (t && t !== task.title) updateTask(id, { title: t }); else setTitle(task.title); };

  const doBreakDown = async () => {
    setBusy(true);
    try {
      const steps = await breakDown(task);
      steps.forEach((s, i) => addTask({ title: s.title, parentId: id, projectId: task.projectId, duration: s.minutes ?? null, order: Date.now() + i }));
      toast(`Added ${steps.length} steps`);
    } catch (e) { toast(aiProblem(e), { tone: "error" }); }
    setBusy(false);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const original of Array.from(files)) {
      const f = await shrinkPhoto(original);
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is over 25 MB`, { tone: "error" }); continue; }
      const fid = uid();
      await idb.setBlob(`file:${fid}`, new Blob([f], { type: f.type }));
      put("files", fid, { name: f.name, mime: f.type, size: f.size, driveId: null });
      updateTask(id, { attachments: [...(get("tasks", id)?.attachments ?? []), { id: fid, name: f.name, mime: f.type, size: f.size }] });
    }
  };
  const openFile = async (fid: string, name: string) => {
    try {
      const b = await fileBlob(fid);
      if (!b) { toast("This file is on another device and hasn't reached Drive yet, or Google isn't connected.", { tone: "error" }); return; }
      const url = URL.createObjectURL(b);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toast("Couldn't open the file.", { tone: "error" }); }
  };

  return (
    <div className="flex flex-col min-h-full" onPaste={e => { const f = e.clipboardData?.files; if (f && f.length) { e.preventDefault(); void addFiles(f); toast(f.length > 1 ? `Attached ${f.length} files` : "Attached"); } }}>
      <div className="flex items-center gap-1 px-4 pt-3 pb-1 sticky top-0 bg-surface z-[1]">
        {parent ? <button className="text-xs text-muted hover:text-fg truncate max-w-[60%]" onClick={() => nav(`?task=${parent.id}`)}>↑ {parent.title}</button> : <span className="text-xs text-muted">{project ? `${project.emoji} ${project.name}` : "No project"}</span>}
        <div className="flex-1" />
        <IconBtn label="Start focus on this" onClick={() => { startFocus(id); nav("/focus"); }}><Timer size={17} /></IconBtn>
        <IconBtn label="Duplicate" onClick={() => { const { id: _o, ...rest } = task; void _o; addTask({ ...rest, title: task.title + " (copy)", gId: null, gList: null, gSeen: null, gPushed: null, calPushed: null, done: false, doneAt: null }); toast("Duplicated"); }}><Copy size={17} /></IconBtn>
        <IconBtn label="Delete" onClick={() => { const undo = deleteTask(id); onClose(); toast("Deleted", { sub: task.title, action: { label: "Undo", run: undo } }); }}><Trash2 size={17} /></IconBtn>
        <IconBtn label="Close" onClick={onClose}><X size={18} /></IconBtn>
      </div>

      <div className="px-5 pb-6 space-y-4">
        <div className="flex items-start gap-3 pt-1">
          <div className="pt-1.5"><Tick task={task} size={22} /></div>
          <textarea value={title} rows={1} onChange={e => { setTitle(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
            onBlur={saveTitle} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
            ref={el => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
            className={cx("flex-1 resize-none bg-transparent font-display text-[26px] leading-tight outline-none", task.done && "striked")} />
        </div>

        <StatusPicker task={task} project={project} />

        <div className="flex flex-wrap gap-1.5">
          <WhenChip value={{ due: task.due, time: task.time, recurrence: task.recurrence, duration: task.duration }} onChange={w => updateTask(id, { ...w, ...(w.due === null ? { recurrence: null, time: null } : {}), calOff: false })} />
          <ProjectChip value={task.projectId} onChange={pid => moveToProject(id, pid)} />
          <PriorityChip value={task.priority} onChange={pr => updateTask(id, { priority: pr })} />
          <TagChip value={task.tags} onChange={t => updateTask(id, { tags: t })} />
          {!task.due && (
            <Chip icon={<CalendarClock size={14} />} active={task.plannedFor === today()} onClick={() => updateTask(id, { plannedFor: task.plannedFor === today() ? null : today() })}>{task.plannedFor === today() ? "On today's plan" : "Plan for today"}</Chip>
          )}
        </div>

        <NotesEditor key={task.id} value={task.notes} onSave={v => updateTask(id, { notes: v })} />
        {task.link && <a href={task.link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-accent-strong hover:underline truncate"><ExternalLink size={14} />{task.link}</a>}

        <Reminders task={task} />

        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="eyebrow">Subtasks {subs.length > 0 && <span className="tabular">· {subs.filter(s => s.done).length}/{subs.length}</span>}</h3>
            {aiReady() && <Button size="sm" variant="ghost" onClick={doBreakDown} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Break it down</Button>}
          </div>
          {subs.map(s => <TaskRow key={s.id} task={s} hideProject />)}
          <InlineAdd defaults={{ parentId: id, projectId: task.projectId }} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="eyebrow">Pictures and files</h3>
            <div className="flex">
              <label className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg cursor-pointer px-2 py-1 rounded-full hover:bg-surface-2">
                <ImagePlus size={14} /> Picture
                <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void addFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg cursor-pointer px-2 py-1 rounded-full hover:bg-surface-2">
                <Paperclip size={14} /> File
                <input type="file" multiple className="hidden" onChange={e => { void addFiles(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          </div>
          <Attachments task={task} onOpen={openFile} />
        </div>

        <div className="text-xs text-faint space-y-0.5 pt-2 border-t border-border">
          {spent > 0 && <div>Time spent: {minutesLabel(spent)}</div>}
          {task.recurrence && task.doneCount > 0 && <div>Done {task.doneCount} time{task.doneCount === 1 ? "" : "s"}</div>}
          <div>Added {niceDate(task.createdAt.slice(0, 10))}{task.source ? ` from ${task.source === "gtasks" ? "Google Tasks" : task.source[0].toUpperCase() + task.source.slice(1)}` : ""}</div>
          {task.done && task.doneAt && <div>Done {niceDate(task.doneAt.slice(0, 10))}</div>}
          {task.gId && <div>Synced with Google Tasks</div>}
        </div>
      </div>
    </div>
  );
}

/** Tasks with no project still have the two statuses every task has. */
const PLAIN_COLUMNS: Column[] = [{ id: "todo", name: "To do", kind: "todo" }, { id: "done", name: "Done", kind: "done" }];

const dotFor = (kind: Column["kind"]) => kind === "done" ? "bg-success" : kind === "doing" ? "bg-warning" : "bg-faint";

/**
 * Move a task through its project's columns without opening the board.
 * Tasks outside a project get a plain To do / Done pair.
 */
function StatusPicker({ task, project }: { task: Task; project?: Project }) {
  const cols = project?.columns ?? PLAIN_COLUMNS;
  const fallback = (task.done ? cols.find(c => c.kind === "done") : cols.find(c => c.kind === "todo")) ?? cols[0];
  const current = project && task.column && cols.some(c => c.id === task.column) ? task.column : fallback?.id;
  const set = (c: Column) => {
    if (project) { setColumn(task.id, c.id); return; }
    if (c.kind === "done") { if (!task.done) completeTask(task.id); }
    else if (task.done) reopenTask(task.id);
  };
  return (
    <div>
      <h3 className="eyebrow mb-1.5">Status</h3>
      <div className="flex flex-wrap gap-1.5">
        {cols.map(c => (
          <button key={c.id} onClick={() => set(c)} aria-pressed={c.id === current}
            className={cx("inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] transition-colors",
              c.id === current ? "border-border-strong bg-surface-2 text-fg font-medium" : "border-border text-muted hover:text-fg hover:bg-surface-2")}>
            <span className={cx("size-2 rounded-full", dotFor(c.kind))} />{c.name}
          </button>
        ))}
      </div>
      {!project && <p className="mt-1.5 text-xs text-faint">Put this task in a project to use that project's own statuses.</p>}
    </div>
  );
}

const PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const presetLabel = (m: number, timed: boolean) => m === 0 ? (timed ? "At the time" : "At 9am that day") : m < 60 ? `${m} min before` : m < 1440 ? `${m / 60} h before` : m === 1440 ? "1 day before" : m === 10080 ? "1 week before" : `${m / 1440} days before`;

function Reminders({ task }: { task: ReturnType<typeof get<"tasks">> & object }) {
  const [custom, setCustom] = useState("");
  const set = (r: Reminder[]) => updateTask(task.id, { reminders: r, calOff: false });
  const s = settings();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="eyebrow">Reminders</h3>
        <Popover align="end" trigger={({ toggle }) => <button onClick={toggle} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg px-2 py-1 rounded-full hover:bg-surface-2"><Plus size={14} /> Add</button>}>
          {close => (
            <div className="w-[240px]">
              {task.due ? PRESETS.map(m => <MenuItem key={m} icon={<Bell size={15} />} onClick={() => { set([...task.reminders, { id: uid(), before: m }]); close(); }}>{presetLabel(m, !!task.time)}</MenuItem>)
                : <p className="px-3 py-2 text-xs text-muted">Give the task a date for reminders that move with it, or pick an exact time:</p>}
              <div className="flex gap-1 p-1.5">
                <input type="datetime-local" className="field h-8 py-0 text-sm" value={custom} onChange={e => setCustom(e.target.value)} />
                <Button size="sm" variant="primary" disabled={!custom} onClick={() => { set([...task.reminders, { id: uid(), at: new Date(custom).toISOString() }]); if (!task.due) updateTask(task.id, { due: custom.slice(0, 10) }); setCustom(""); close(); }}>Add</Button>
              </div>
            </div>
          )}
        </Popover>
      </div>
      {task.reminders.length === 0 && <p className="text-xs text-faint px-1">{s.calOn ? "Reminders reach your phone through Google Calendar." : "Turn on Google Calendar in Settings to get reminders while Cadence is closed."}</p>}
      {task.reminders.map(r => (
        <div key={r.id} className="flex items-center gap-2 py-1 text-sm">
          <Bell size={14} className="text-muted" />
          <span className="flex-1">{r.at ? new Date(r.at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : presetLabel(r.before ?? 0, !!task.time)}</span>
          <IconBtn label="Remove reminder" className="size-7" onClick={() => set(task.reminders.filter(x => x.id !== r.id))}><X size={14} /></IconBtn>
        </div>
      ))}
    </div>
  );
}

const isImage = (a: Pick<Attachment, "mime" | "name">) => a.mime?.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|heic|bmp|svg)$/i.test(a.name);

/** The picture behind an attachment, from this device or from Drive. */
function useFileUrl(a: Attachment | null): { url: string | null; state: "loading" | "ready" | "missing" } {
  const [r, setR] = useState<{ url: string | null; state: "loading" | "ready" | "missing" }>({ url: null, state: "loading" });
  useEffect(() => {
    if (!a) return;
    let url: string | null = null, live = true;
    setR({ url: null, state: "loading" });
    fileBlob(a.id).then(b => {
      if (!live) return;
      if (!b) { setR({ url: null, state: "missing" }); return; }
      // Drive sometimes hands back a file with no type; images need one to display.
      const typed = b.type && b.type !== "application/octet-stream" ? b : new Blob([b], { type: a.mime || "image/jpeg" });
      url = URL.createObjectURL(typed);
      setR({ url, state: "ready" });
    }).catch(() => live && setR({ url: null, state: "missing" }));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return r;
}

function Thumb({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const { url, state } = useFileUrl(a);
  return (
    <button onClick={onOpen} title={a.name} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2 grid place-items-center">
      {url ? <img src={url} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
        : state === "loading" ? <Loader2 size={18} className="animate-spin text-faint" />
        : <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] text-faint"><ImageOff size={18} />Not on this device yet</span>}
    </button>
  );
}

function Viewer({ list, index, onIndex, onClose, onDownload }: { list: Attachment[]; index: number; onIndex: (i: number) => void; onClose: () => void; onDownload: (a: Attachment) => void }) {
  const a = list[index] ?? null;
  const { url, state } = useFileUrl(a);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowRight") onIndex((index + 1) % list.length); if (e.key === "ArrowLeft") onIndex((index - 1 + list.length) % list.length); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [index, list.length, onIndex]);
  if (!a) return null;
  return (
    <Modal open onClose={onClose} bare wide>
      <div className="relative bg-black/90 md:rounded-2xl overflow-hidden">
        <div className="grid place-items-center min-h-[50vh] max-h-[80vh]">
          {url ? <img src={url} alt={a.name} className="max-h-[80vh] w-auto max-w-full object-contain" />
            : state === "loading" ? <Loader2 className="animate-spin text-white/70" /> : <p className="text-white/70 text-sm p-6 text-center">This picture hasn't reached your Drive yet. Open Cadence on the device it was added on, or connect Google.</p>}
        </div>
        {list.length > 1 && <>
          <button aria-label="Previous" onClick={() => onIndex((index - 1 + list.length) % list.length)} className="absolute left-2 top-1/2 -translate-y-1/2 size-10 grid place-items-center rounded-full bg-black/50 text-white"><ChevronLeft /></button>
          <button aria-label="Next" onClick={() => onIndex((index + 1) % list.length)} className="absolute right-2 top-1/2 -translate-y-1/2 size-10 grid place-items-center rounded-full bg-black/50 text-white"><ChevronRight /></button>
        </>}
        <div className="flex items-center gap-2 bg-black/70 px-3 py-2 text-white text-sm">
          <span className="flex-1 truncate">{a.name}</span>
          <button onClick={() => onDownload(a)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-white/10"><Download size={14} /> Save</button>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-white/10"><X size={16} /></button>
        </div>
      </div>
    </Modal>
  );
}

function Attachments({ task, onOpen }: { task: Task; onOpen: (id: string, name: string) => void }) {
  const [view, setView] = useState<number | null>(null);
  const images = task.attachments.filter(isImage);
  const others = task.attachments.filter(a => !isImage(a));
  const remove = (aid: string) => updateTask(task.id, { attachments: task.attachments.filter(x => x.id !== aid) });
  return (
    <>
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          {images.map((a, i) => (
            <div key={a.id} className="group relative">
              <Thumb a={a} onOpen={() => setView(i)} />
              <button aria-label="Remove picture" onClick={() => remove(a.id)} className="absolute top-1 right-1 size-6 grid place-items-center rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 md:opacity-0 max-md:opacity-100"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {others.map(a => (
        <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
          <FileText size={14} className="text-muted" />
          <button className="flex-1 text-left truncate hover:underline" onClick={() => onOpen(a.id, a.name)}>{a.name}</button>
          <span className="text-xs text-faint">{Math.max(1, Math.round(a.size / 1024))} KB</span>
          {!all("files").find(f => f.id === a.id)?.driveId && <span className="text-[11px] text-faint" title="Goes to your Drive at the next sync">on device</span>}
          <IconBtn label="Download" className="size-7" onClick={() => onOpen(a.id, a.name)}><Download size={14} /></IconBtn>
          <IconBtn label="Remove" className="size-7" onClick={() => remove(a.id)}><X size={14} /></IconBtn>
        </div>
      ))}
      {!task.attachments.length && <p className="text-xs text-faint px-1">Attach pictures and files, or paste a screenshot here.</p>}
      {view !== null && <Viewer list={images} index={view} onIndex={setView} onClose={() => setView(null)} onDownload={a => onOpen(a.id, a.name)} />}
    </>
  );
}

/** Big phone photos are scaled down (longest side 2400px) so they sync quickly; other files are kept as they are. */
async function shrinkPhoto(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || f.size < 1.5 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return f; }
}
