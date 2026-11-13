import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, DragOverlay } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Plus, Trash2, Loader2, X } from "lucide-react";
import { Page } from "../components/shell";
import { Button, IconBtn, Segmented, cx, Modal, useIsMobile, toast } from "../components/ui";
import { Tick, useOpenTask } from "../components/task-row";
import { addDays, addMonths, DAY_SHORT, dayOfWeek, daysInMonth, fromMin, MONTH_LONG, niceTime, parseYmd, startOfMonth, startOfWeek, toMin, today, niceDate, longDate } from "../lib/dates";
import { all, create, put, remove, useColl, useSettings } from "../lib/store";
import { byDue, byPriority, updateTask } from "../lib/actions";
import { uid, type Block, type Task } from "../lib/model";
import { otherEvents, type OtherEvent } from "../lib/gcal";
import { hasScope, useGoogle } from "../lib/google";
import { occurrences } from "../lib/recurrence";

type View = "month" | "week" | "day";
const HOUR = 52;
const START_H = 0, END_H = 24;

function useOther(from: string, to: string) {
  const [events, setEvents] = useState<OtherEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const g = useGoogle();
  const s = useSettings();
  useEffect(() => {
    if (!s.calShowOthers || !hasScope("calendarRead")) { setEvents([]); return; }
    let live = true;
    setLoading(true);
    otherEvents(from, to).then(e => { if (live) setEvents(e); }).catch(() => {}).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [from, to, g.token?.access, s.calShowOthers]);
  return { events, loading };
}

/** Tasks on a day, including later dates of repeating tasks (marked as previews). */
function tasksOn(tasks: Task[], d: string): { task: Task; preview: boolean }[] {
  const out: { task: Task; preview: boolean }[] = [];
  for (const t of tasks) {
    if (!t.due || t.parentId) continue;
    if (t.due === d) out.push({ task: t, preview: false });
    else if (!t.done && t.recurrence && t.due < d && occurrences(t.recurrence, t.due, d, d).includes(d)) out.push({ task: t, preview: true });
  }
  return out.sort((a, b) => byDue(a.task, b.task));
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const view = (params.get("view") as View) ?? (mobile ? "day" : "week");
  const date = params.get("date") ?? today();
  const s = useSettings();
  const set = (p: Record<string, string>) => { const n = new URLSearchParams(params); for (const [k, v] of Object.entries(p)) n.set(k, v); setParams(n, { replace: true }); };
  const step = (dir: number) => set({ date: view === "month" ? addMonths(startOfMonth(date), dir) : addDays(date, dir * (view === "week" ? 7 : 1)) });
  const weekStart = startOfWeek(date, s.weekStart);
  const range = view === "month" ? [startOfWeek(startOfMonth(date), s.weekStart), addDays(startOfMonth(date), 41)] : view === "week" ? [weekStart, addDays(weekStart, 6)] : [date, date];
  const other = useOther(range[0], range[1]);
  const d = parseYmd(date);
  const title = view === "month" ? `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}` : view === "week" ? `${parseYmd(weekStart).getDate()} ${MONTH_LONG[parseYmd(weekStart).getMonth()].slice(0, 3)} – ${parseYmd(addDays(weekStart, 6)).getDate()} ${MONTH_LONG[parseYmd(addDays(weekStart, 6)).getMonth()].slice(0, 3)}` : longDate(date);
  return (
    <Page wide>
      <header className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-3xl md:text-4xl mr-auto">{title}</h1>
        {other.loading && <Loader2 size={15} className="animate-spin text-muted" />}
        <Segmented size="sm" value={view} onChange={v => set({ view: v })} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <div className="flex items-center">
          <IconBtn label="Previous" onClick={() => step(-1)}><ChevronLeft size={18} /></IconBtn>
          <Button size="sm" variant="ghost" onClick={() => set({ date: today() })}>Today</Button>
          <IconBtn label="Next" onClick={() => step(1)}><ChevronRight size={18} /></IconBtn>
        </div>
      </header>
      {view === "month" ? <Month date={date} other={other.events} onDay={dd => set({ view: "day", date: dd })} /> : <TimeGrid days={view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [date]} other={other.events} />}
    </Page>
  );
}

// ── Month ──────────────────────────────────────────────────────────────────
function DraggableChip({ task, preview }: { task: Task; preview: boolean }) {
  const open = useOpenTask();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}`, disabled: preview });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={e => { e.stopPropagation(); open(task.id); }}
      className={cx("truncate rounded-md px-1.5 py-0.5 text-[12px] cursor-pointer", task.done ? "text-faint line-through" : preview ? "text-muted border border-dashed border-border" : "bg-surface-2 hover:bg-surface-3", isDragging && "opacity-40")}
      style={!task.done && !preview && task.priority < 4 ? { boxShadow: `inset 2px 0 0 var(--p${task.priority})` } : undefined}>
      {task.time && <span className="text-muted tabular mr-1">{niceTime(task.time)}</span>}{task.title}
    </div>
  );
}

function DayCell({ d, month, tasks, other, onDay }: { d: string; month: string; tasks: { task: Task; preview: boolean }[]; other: OtherEvent[]; onDay: (d: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${d}` });
  const t = today();
  const max = 3;
  const items = [...other.map(e => ({ kind: "e" as const, e })), ...tasks.map(x => ({ kind: "t" as const, x }))];
  return (
    <div ref={setNodeRef} onClick={() => onDay(d)} className={cx("min-h-[96px] md:min-h-[116px] border-r border-b border-border p-1 cursor-pointer overflow-hidden", d.slice(0, 7) !== month.slice(0, 7) && "bg-surface-2/40", isOver && "bg-accent-soft")}>
      <div className={cx("text-xs mb-1 w-6 h-6 grid place-items-center rounded-full tabular", d === t ? "bg-primary text-on-primary" : "text-muted")}>{Number(d.slice(8))}</div>
      <div className="space-y-0.5">
        {items.slice(0, max).map(i => i.kind === "t" ? <DraggableChip key={i.x.task.id + d} task={i.x.task} preview={i.x.preview} /> : <div key={i.e.id} className="truncate rounded-md px-1.5 py-0.5 text-[12px] text-muted" style={{ boxShadow: `inset 2px 0 0 ${i.e.color}` }}>{i.e.start && <span className="tabular mr-1">{niceTime(i.e.start)}</span>}{i.e.title}</div>)}
        {items.length > max && <div className="text-[11px] text-muted px-1.5">+{items.length - max} more</div>}
      </div>
    </div>
  );
}

function Month({ date, other, onDay }: { date: string; other: OtherEvent[]; onDay: (d: string) => void }) {
  const s = useSettings();
  const tasks = useColl("tasks");
  const month = startOfMonth(date);
  const first = startOfWeek(month, s.weekStart);
  const weeks = Math.ceil(((dayOfWeek(month) - s.weekStart + 7) % 7 + daysInMonth(month)) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
  const [drag, setDrag] = useState<Task | null>(null);
  const onEnd = (e: DragEndEvent) => {
    setDrag(null);
    const id = String(e.active.id).replace("task:", ""), over = e.over ? String(e.over.id) : "";
    if (over.startsWith("day:")) updateTask(id, { due: over.slice(4), calOff: false });
  };
  return (
    <DndContext sensors={sensors} onDragStart={e => setDrag(all("tasks").find(t => `task:${t.id}` === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setDrag(null)}>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {Array.from({ length: 7 }, (_, i) => <div key={i} className="px-2 py-1.5 text-xs text-muted border-r border-border last:border-r-0">{DAY_SHORT[(i + s.weekStart) % 7]}</div>)}
        </div>
        <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          {days.map(d => <DayCell key={d} d={d} month={month} tasks={tasksOn(tasks, d)} other={other.filter(e => e.date === d)} onDay={onDay} />)}
        </div>
      </div>
      <DragOverlay>{drag && <div className="rounded-md bg-surface px-2 py-1 text-xs shadow-float">{drag.title}</div>}</DragOverlay>
    </DndContext>
  );
}

// ── Week and day: time blocking ────────────────────────────────────────────
interface Placed { id: string; kind: "block" | "task" | "event"; date: string; start: number; end: number; title: string; color: string; task?: Task; block?: Block; done?: boolean }

function layout(items: Placed[]): (Placed & { col: number; cols: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: (Placed & { col: number; cols: number })[] = [];
  let group: (Placed & { col: number; cols: number })[] = [], groupEnd = -1;
  const flush = () => { const n = Math.max(...group.map(g => g.col)) + 1; group.forEach(g => (g.cols = n)); out.push(...group); group = []; };
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) { flush(); groupEnd = -1; }
    const used = new Set(group.filter(g => g.end > it.start).map(g => g.col));
    let col = 0; while (used.has(col)) col++;
    group.push({ ...it, col, cols: 1 });
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) flush();
  return out;
}

function Slot({ date, minute }: { date: string; minute: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${date}:${minute}` });
  return <div ref={setNodeRef} className={cx("h-[26px] border-b border-border/40", minute % 60 === 30 && "border-border/80", isOver && "bg-accent-soft")} />;
}

function SideTask({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` });
  const open = useOpenTask();
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={() => open(task.id)} className={cx("flex items-start gap-2 rounded-xl border border-border bg-surface px-2.5 py-2 text-sm cursor-grab touch-manipulation", isDragging && "opacity-40")}>
      <Tick task={task} size={16} />
      <div className="min-w-0"><div className="leading-snug">{task.title}</div>{(task.duration || task.due) && <div className="text-[11px] text-muted">{task.due ? niceDate(task.due) : ""}{task.duration ? ` · ${task.duration} min` : ""}</div>}</div>
    </div>
  );
}

function TimeGrid({ days, other }: { days: string[]; other: OtherEvent[] }) {
  const tasks = useColl("tasks");
  const blocks = useColl("blocks");
  const s = useSettings();
  const open = useOpenTask();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const scroller = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const [drag, setDrag] = useState<Task | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(i); }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: Math.max(0, (toMin(s.dayStart) / 60 - START_H - 0.5) * HOUR) }); }, [s.dayStart]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));

  const placed = (d: string): Placed[] => {
    const out: Placed[] = [];
    for (const b of blocks) if (b.date === d) out.push({ id: "b" + b.id, kind: "block", date: d, start: toMin(b.start), end: Math.max(toMin(b.end), toMin(b.start) + 15), title: b.title, color: b.taskId ? (tasks.find(t => t.id === b.taskId)?.projectId ? all("projects").find(p => p.id === tasks.find(t => t.id === b.taskId)!.projectId)?.color ?? "var(--accent)" : "var(--accent)") : "var(--accent)", block: b, task: tasks.find(t => t.id === b.taskId), done: tasks.find(t => t.id === b.taskId)?.done });
    for (const { task, preview } of tasksOn(tasks, d)) {
      if (!task.time || preview) continue;
      if (blocks.some(b => b.date === d && b.taskId === task.id)) continue;
      const st = toMin(task.time);
      out.push({ id: "t" + task.id, kind: "task", date: d, start: st, end: st + (task.duration ?? 30), title: task.title, color: task.priority < 4 ? `var(--p${task.priority})` : "var(--muted)", task, done: task.done });
    }
    for (const e of other) if (e.date === d && e.start) out.push({ id: "e" + e.id, kind: "event", date: d, start: toMin(e.start), end: e.end ? Math.max(toMin(e.end), toMin(e.start) + 15) : toMin(e.start) + 30, title: e.title, color: e.color });
    return out;
  };

  const untimed = (d: string) => tasksOn(tasks, d).filter(x => !x.task.time);
  const allDayEvents = (d: string) => other.filter(e => e.date === d && !e.start);
  const unscheduled = useMemo(() => tasks.filter(t => !t.done && !t.parentId && !t.time && (!t.due || days.includes(t.due) || t.due < days[0]) && !blocks.some(b => b.taskId === t.id && days.includes(b.date))).sort(byPriority).slice(0, 40), [tasks, blocks, days]);

  const onEnd = (e: DragEndEvent) => {
    setDrag(null);
    if (!e.over) return;
    const id = String(e.active.id).replace("task:", "");
    const [, date, minute] = String(e.over.id).split(":");
    const task = all("tasks").find(t => t.id === id);
    if (!task || !date) return;
    const start = Number(minute), len = task.duration ?? 30;
    create("blocks", { id: uid(), date, start: fromMin(start), end: fromMin(Math.min(start + len, 1439)), title: task.title, taskId: id, color: "", calPushed: null });
    if (!task.due && !task.plannedFor) put("tasks", id, { plannedFor: date });
    toast("Blocked out", { sub: `${task.title} · ${niceTime(fromMin(start))}` });
  };

  const addBlockAt = (date: string, minute: number) => {
    const b: Block = { id: uid(), date, start: fromMin(minute), end: fromMin(minute + 60), title: "", taskId: null, color: "", calPushed: null };
    setEditing(b);
  };

  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  return (
    <DndContext sensors={sensors} onDragStart={e => setDrag(all("tasks").find(t => `task:${t.id}` === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setDrag(null)}>
      <div className="flex gap-4">
        <div className="flex-1 min-w-0 card overflow-hidden">
          {/* day headers and untimed tasks */}
          <div className="flex border-b border-border">
            <div className="w-12 flex-none" />
            {days.map(d => (
              <div key={d} className="flex-1 min-w-0 border-l border-border px-1.5 py-1.5">
                <button onClick={() => nav(`/calendar?view=day&date=${d}`)} className={cx("text-xs", d === today() ? "text-accent font-semibold" : "text-muted")}>{DAY_SHORT[dayOfWeek(d)]} <span className="tabular">{Number(d.slice(8))}</span></button>
                <div className="space-y-0.5 mt-1 max-h-[96px] overflow-y-auto">
                  {allDayEvents(d).map(e => <div key={e.id} className="truncate rounded px-1.5 py-0.5 text-[11px] text-muted" style={{ boxShadow: `inset 2px 0 0 ${e.color}` }}>{e.title}</div>)}
                  {untimed(d).map(({ task, preview }) => <button key={task.id} onClick={() => open(task.id)} className={cx("block w-full text-left truncate rounded px-1.5 py-0.5 text-[11px]", task.done ? "line-through text-faint" : preview ? "border border-dashed border-border text-muted" : "bg-surface-2")}>{task.title}</button>)}
                </div>
              </div>
            ))}
          </div>
          <div ref={scroller} className="relative overflow-y-auto" style={{ height: mobile ? "calc(100vh - 290px)" : "calc(100vh - 260px)" }}>
            <div className="flex relative" style={{ height: hours.length * HOUR }}>
              <div className="w-12 flex-none relative">
                {hours.map(h => <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-faint tabular" style={{ top: (h - START_H) * HOUR }}>{h === 0 ? "" : niceTime(`${String(h).padStart(2, "0")}:00`)}</div>)}
              </div>
              {days.map(d => (
                <div key={d} className="flex-1 min-w-0 border-l border-border relative">
                  {/* working hours tint */}
                  <div className="absolute inset-x-0 bg-surface-2/40 pointer-events-none" style={{ top: 0, height: (toMin(s.dayStart) / 60 - START_H) * HOUR }} />
                  <div className="absolute inset-x-0 bg-surface-2/40 pointer-events-none" style={{ top: (toMin(s.dayEnd) / 60 - START_H) * HOUR, bottom: 0 }} />
                  <div onDoubleClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); addBlockAt(d, Math.floor(((e.clientY - r.top) / HOUR) * 4) * 15 + START_H * 60); }}>
                    {hours.flatMap(h => [0, 30].map(m => <Slot key={`${h}:${m}`} date={d} minute={h * 60 + m} />))}
                  </div>
                  {layout(placed(d)).map(p => <PlacedItem key={p.id} p={p} onEdit={b => setEditing(b)} />)}
                  {d === today() && <div className="absolute inset-x-0 h-px bg-danger pointer-events-none z-[2]" style={{ top: (nowMin / 60 - START_H) * HOUR }}><span className="absolute -left-1 -top-1 size-2 rounded-full bg-danger" /></div>}
                  <button aria-label="Add block" onClick={() => addBlockAt(d, Math.max(toMin(s.dayStart), Math.ceil(nowMin / 30) * 30))} className="md:hidden absolute right-1 top-1 z-[3] size-7 grid place-items-center rounded-full bg-surface border border-border"><Plus size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className={cx("w-[250px] flex-none", mobile && "hidden")}>
          <div className="eyebrow mb-2">Drag onto the calendar</div>
          <p className="text-xs text-muted mb-2">Drop a task on a time to block it out. Double-click an empty time for a free block.</p>
          <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {unscheduled.map(t => <SideTask key={t.id} task={t} />)}
            {!unscheduled.length && <p className="text-sm text-faint">Nothing waiting.</p>}
          </div>
        </aside>
      </div>
      {mobile && (
        <div className="mt-4">
          <div className="eyebrow mb-2">Hold and drag onto a time</div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">{unscheduled.slice(0, 12).map(t => <div key={t.id} className="w-[200px] flex-none"><SideTask task={t} /></div>)}</div>
        </div>
      )}
      <DragOverlay>{drag && <div className="rounded-xl bg-surface px-3 py-2 text-sm shadow-float border border-border w-[200px]">{drag.title}</div>}</DragOverlay>
      <BlockEditor block={editing} onClose={() => setEditing(null)} />
    </DndContext>
  );
}

/** A block or timed task on the grid: drag to move, pull the bottom edge to resize. */
function PlacedItem({ p, onEdit }: { p: Placed & { col: number; cols: number }; onEdit: (b: Block) => void }) {
  const open = useOpenTask();
  const [delta, setDelta] = useState<{ move: number; size: number } | null>(null);
  const start = useRef<{ y: number; mode: "move" | "size"; moved: boolean } | null>(null);
  const editable = p.kind !== "event";
  const down = (e: RPointerEvent, mode: "move" | "size") => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, mode, moved: false };
  };
  const move = (e: RPointerEvent) => {
    if (!start.current) return;
    const mins = Math.round(((e.clientY - start.current.y) / HOUR) * 4) * 15;
    if (Math.abs(e.clientY - start.current.y) > 4) start.current.moved = true;
    setDelta(start.current.mode === "move" ? { move: mins, size: 0 } : { move: 0, size: mins });
  };
  const up = () => {
    const st = start.current; start.current = null;
    if (!st) return;
    if (!st.moved) { setDelta(null); if (p.block) onEdit(p.block); else if (p.task) open(p.task.id); return; }
    const d = delta ?? { move: 0, size: 0 };
    setDelta(null);
    const ns = Math.max(0, Math.min(1425, p.start + d.move)), ne = Math.max(ns + 15, Math.min(1439, p.end + d.move + d.size));
    if (p.block) put("blocks", p.block.id, { start: fromMin(ns), end: fromMin(ne) });
    else if (p.task) updateTask(p.task.id, { time: fromMin(ns), duration: ne - ns });
  };
  const top = ((p.start + (delta?.move ?? 0)) / 60 - START_H) * HOUR;
  const height = Math.max(18, ((p.end - p.start + (delta?.size ?? 0)) / 60) * HOUR - 2);
  const w = 100 / p.cols;
  return (
    <div onPointerDown={e => down(e, "move")} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDelta(null); }}
      className={cx("absolute rounded-lg px-1.5 py-1 text-[11px] leading-tight overflow-hidden select-none z-[1]", editable ? "cursor-pointer touch-none" : "opacity-80", p.kind === "event" ? "bg-surface-2 text-muted" : p.kind === "task" ? "bg-surface border border-border" : "text-fg", delta && "shadow-float z-[4]")}
      style={{ top, height, left: `calc(${p.col * w}% + 2px)`, width: `calc(${w}% - 4px)`, ...(p.kind === "block" ? { background: `color-mix(in srgb, ${p.color} 16%, var(--surface))`, boxShadow: `inset 3px 0 0 ${p.color}` } : { boxShadow: `inset 3px 0 0 ${p.color}` }) }}>
      <div className={cx("font-medium truncate", p.done && "line-through text-faint")}>{p.title || "Focus time"}</div>
      {height > 30 && <div className="text-muted tabular">{niceTime(fromMin(p.start + (delta?.move ?? 0)))}–{niceTime(fromMin(p.end + (delta?.move ?? 0) + (delta?.size ?? 0)))}</div>}
      {editable && <div onPointerDown={e => down(e, "size")} className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" />}
    </div>
  );
}

function BlockEditor({ block, onClose }: { block: Block | null; onClose: () => void }) {
  const [b, setB] = useState<Block | null>(block);
  useEffect(() => setB(block), [block]);
  const tasks = useColl("tasks").filter(t => !t.done && !t.parentId).sort(byPriority).slice(0, 60);
  if (!b) return null;
  const exists = !!all("blocks").find(x => x.id === b.id);
  const save = () => {
    const task = tasks.find(t => t.id === b.taskId);
    const title = b.title.trim() || task?.title || "Focus time";
    if (toMin(b.end) <= toMin(b.start)) { toast("The end has to be after the start", { tone: "error" }); return; }
    if (exists) put("blocks", b.id, { ...b, title }); else create("blocks", { ...b, title });
    onClose();
  };
  return (
    <Modal open={!!block} onClose={onClose} title={exists ? "Time block" : "New time block"}>
      <div className="space-y-3">
        <input autoFocus className="field" placeholder="What's this time for?" value={b.title} onChange={e => setB({ ...b, title: e.target.value })} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <div className="flex gap-2 items-center">
          <input type="date" className="field" value={b.date} onChange={e => setB({ ...b, date: e.target.value })} />
          <input type="time" className="field" value={b.start} onChange={e => setB({ ...b, start: e.target.value })} />
          <span className="text-muted">–</span>
          <input type="time" className="field" value={b.end} onChange={e => setB({ ...b, end: e.target.value })} />
        </div>
        <select className="field" value={b.taskId ?? ""} onChange={e => setB({ ...b, taskId: e.target.value || null })}>
          <option value="">Not linked to a task</option>
          {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <div className="flex justify-between">
          {exists ? <Button variant="ghost" className="text-danger" onClick={() => { remove("blocks", b.id); onClose(); }}><Trash2 size={15} /> Delete</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose}><X size={15} /> Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
        </div>
      </div>
    </Modal>
  );
}
