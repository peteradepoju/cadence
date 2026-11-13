import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { X, Trash2, Copy, Bell, Plus, Paperclip, Sparkles, Loader2, Timer, Target, Zap, Columns3, ExternalLink, Download, CalendarClock } from "lucide-react";
import { addTask, deleteTask, moveToProject, setColumn, timeSpent, updateTask } from "../lib/actions";
import { aiReady, breakDown } from "../lib/ai";
import { minutesLabel, niceDate, today } from "../lib/dates";
import { aiProblem } from "../lib/gemini";
import { type Energy, type Reminder, uid } from "../lib/model";
import { all, get, put, useColl, useRec, settings } from "../lib/store";
import { fileBlob } from "../lib/sync";
import { idb } from "../lib/idb";
import { start as startFocus } from "../lib/focus";
import { PriorityChip, ProjectChip, TagChip, WhenChip, Chip } from "./pickers";
import { Tick, TaskRow } from "./task-row";
import { Button, cx, IconBtn, MenuItem, Popover, toast, useIsMobile } from "./ui";
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
  const goals = useColl("goals").filter(g => g.status === "active");
  const sessions = useColl("sessions");
  const nav = useNavigate();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [busy, setBusy] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTitle(task.title); }, [task.title]);
  useEffect(() => { if (document.activeElement !== notesRef.current) setNotes(task.notes); }, [task.notes]);
  useEffect(() => { const el = notesRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.max(96, el.scrollHeight) + "px"; } }, [notes]);
  const subs = allTasks.filter(t => t.parentId === id).sort((a, b) => a.order - b.order);
  const project = projects.find(p => p.id === task.projectId);
  const parent = task.parentId ? get("tasks", task.parentId) : undefined;
  const spent = timeSpent(id);
  void sessions;
  const goal = goals.find(g => g.id === task.goalId) ?? (task.goalId ? get("goals", task.goalId) : undefined);

  const saveTitle = () => { const t = title.trim(); if (t && t !== task.title) updateTask(id, { title: t }); else setTitle(task.title); };
  const saveNotes = () => { if (notes !== task.notes) updateTask(id, { notes }); };

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
    for (const f of Array.from(files)) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is over 25 MB`, { tone: "error" }); continue; }
      const fid = uid();
      await idb.setBlob(`file:${fid}`, f);
      put("files", fid, { name: f.name, mime: f.type, size: f.size, driveId: null });
      updateTask(id, { attachments: [...(get("tasks", id)?.attachments ?? []), { id: fid, name: f.name, mime: f.type, size: f.size }] });
    }
  };
  const openFile = async (fid: string, name: string) => {
    try {
      const b = await fileBlob(fid);
      if (!b) { toast("This file is on another device and hasn't reached Drive yet, or Google isn't connected.", { tone: "error" }); return; }
      const url = URL.createObjectURL(b);
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; if (!/^(image|application\/pdf|text)/.test(b.type)) a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toast("Couldn't open the file.", { tone: "error" }); }
  };

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center gap-1 px-4 pt-3 pb-1 sticky top-0 bg-surface z-[1]">
        {parent ? <button className="text-xs text-muted hover:text-fg truncate max-w-[60%]" onClick={() => nav(`?task=${parent.id}`)}>↑ {parent.title}</button> : <span className="text-xs text-muted">{project ? `${project.emoji} ${project.name}` : "Inbox"}</span>}
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

        <div className="flex flex-wrap gap-1.5">
          <WhenChip value={{ due: task.due, time: task.time, recurrence: task.recurrence, duration: task.duration }} onChange={w => updateTask(id, { ...w, ...(w.due === null ? { recurrence: null, time: null } : {}), calOff: false })} />
          <ProjectChip value={task.projectId} onChange={pid => moveToProject(id, pid)} />
          <PriorityChip value={task.priority} onChange={pr => updateTask(id, { priority: pr })} />
          <TagChip value={task.tags} onChange={t => updateTask(id, { tags: t })} />
          {project && (
            <Popover trigger={({ toggle }) => <Chip icon={<Columns3 size={14} />} onClick={toggle}>{project.columns.find(c => c.id === task.column)?.name ?? "Status"}</Chip>}>
              {close => <>{project.columns.map(c => <MenuItem key={c.id} active={c.id === task.column} onClick={() => { setColumn(id, c.id); close(); }}>{c.name}</MenuItem>)}</>}
            </Popover>
          )}
          <Popover trigger={({ toggle }) => <Chip icon={<Target size={14} />} active={!!goal} onClick={toggle}>{goal?.title ?? "Goal"}</Chip>}>
            {close => <>
              <MenuItem active={!task.goalId} onClick={() => { updateTask(id, { goalId: null }); close(); }}>No goal</MenuItem>
              {goals.map(g => <MenuItem key={g.id} active={g.id === task.goalId} onClick={() => { updateTask(id, { goalId: g.id }); close(); }}>{g.title}</MenuItem>)}
              {!goals.length && <p className="px-3 py-2 text-sm text-muted">Make goals on the Goals page.</p>}
            </>}
          </Popover>
          <Popover trigger={({ toggle }) => <Chip icon={<Zap size={14} />} active={!!task.energy} onClick={toggle}>{task.energy ? `${task.energy[0].toUpperCase()}${task.energy.slice(1)} energy` : "Energy"}</Chip>}>
            {close => <>{([null, "low", "medium", "high"] as (Energy | null)[]).map(e => <MenuItem key={String(e)} active={task.energy === e} onClick={() => { updateTask(id, { energy: e }); close(); }}>{e ? `${e[0].toUpperCase()}${e.slice(1)} energy` : "Any energy"}</MenuItem>)}</>}
          </Popover>
          {!task.due && (
            <Chip icon={<CalendarClock size={14} />} active={task.plannedFor === today()} onClick={() => updateTask(id, { plannedFor: task.plannedFor === today() ? null : today() })}>{task.plannedFor === today() ? "On today's plan" : "Plan for today"}</Chip>
          )}
        </div>

        <textarea ref={notesRef} value={notes} onChange={e => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Notes, links, details…"
          className="w-full min-h-24 resize-none rounded-xl bg-surface-2/60 p-3 text-[15px] outline-none focus:bg-surface-2" />
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
            <h3 className="eyebrow">Files</h3>
            <label className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg cursor-pointer px-2 py-1 rounded-full hover:bg-surface-2">
              <Paperclip size={14} /> Attach
              <input type="file" multiple className="hidden" onChange={e => { void addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {task.attachments.map(a => (
            <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
              <Paperclip size={14} className="text-muted" />
              <button className="flex-1 text-left truncate hover:underline" onClick={() => openFile(a.id, a.name)}>{a.name}</button>
              <span className="text-xs text-faint">{Math.max(1, Math.round(a.size / 1024))} KB</span>
              {!all("files").find(f => f.id === a.id)?.driveId && <span className="text-[11px] text-faint" title="Goes to your Drive at the next sync">on device</span>}
              <IconBtn label="Download" className="size-7" onClick={() => openFile(a.id, a.name)}><Download size={14} /></IconBtn>
              <IconBtn label="Remove" className="size-7" onClick={() => updateTask(id, { attachments: task.attachments.filter(x => x.id !== a.id) })}><X size={14} /></IconBtn>
            </div>
          ))}
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
