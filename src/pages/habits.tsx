import { useState } from "react";
import { Plus, Flame, Check, MoreHorizontal, Archive, Trash2, Pencil, Bell, Repeat2 } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Empty, IconBtn, MenuItem, Modal, PageHeader, Popover, cx, useConfirm, Segmented } from "../components/ui";
import { addDays, DAY_SHORT, dayOfWeek, niceTime, today } from "../lib/dates";
import { countOn, dueOn, logMap, rate, setCount, streak, tick, weekCount } from "../lib/habits";
import { PALETTE, uid, type Habit } from "../lib/model";
import { create, put, remove, useColl, useSettings } from "../lib/store";

/** Today's habits as a row of tappable rings (on Today). */
export function HabitStrip() {
  const habits = useColl("habits").filter(h => !h.archived).sort((a, b) => a.order - b.order);
  const logs = logMap(useColl("habitLogs"));
  const t = today();
  const due = habits.filter(h => dueOn(h, t));
  if (!due.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6 -mx-1 px-1 pb-1">
      {due.map(h => {
        const n = countOn(logs, h, t), target = Math.max(1, h.target), done = n >= target;
        const st = streak(h, logs).current;
        return (
          <button key={h.id} onClick={() => tick(h, t, done && target === 1 ? -1 : done ? -n : 1)}
            className={cx("flex-none flex items-center gap-2 rounded-full border pl-1.5 pr-3.5 h-11 transition-colors", done ? "border-transparent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2")}>
            <Ring value={n / target} color={h.color} done={done}>{h.emoji || <Repeat2 size={14} />}</Ring>
            <span className={cx("text-sm", done && "text-accent-strong")}>{h.name}</span>
            {target > 1 && <span className="text-xs text-muted tabular">{n}/{target}</span>}
            {st > 1 && <span className="text-xs text-muted inline-flex items-center gap-0.5"><Flame size={12} className="text-p1" />{st}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Ring({ value, color, done, children, size = 32 }: { value: number; color: string; done: boolean; children: React.ReactNode; size?: number }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  return (
    <span className="relative grid place-items-center flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} stroke={color} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value))} style={{ transition: "stroke-dashoffset .3s" }} />
      </svg>
      <span className="text-[13px]">{done ? <Check size={14} style={{ color }} strokeWidth={3} /> : children}</span>
    </span>
  );
}

export function HabitsPage() {
  const habits = useColl("habits");
  const logs = logMap(useColl("habitLogs"));
  const s = useSettings();
  const [edit, setEdit] = useState<Habit | null>(null);
  const [show, setShow] = useState<"active" | "archived">("active");
  const confirm = useConfirm();
  const t = today();
  const list = habits.filter(h => (show === "active") === !h.archived).sort((a, b) => a.order - b.order);
  // the last 7 days, oldest first
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const blank = (): Habit => ({ id: uid(), name: "", emoji: "", color: PALETTE[habits.length % PALETTE.length], kind: "daily", days: [1, 2, 3, 4, 5], perWeek: 3, target: 1, reminder: null, archived: false, order: habits.length, createdAt: new Date().toISOString(), calPushed: null });
  return (
    <Page>
      <PageHeader title="Habits" sub="Small things, done often.">
        {habits.some(h => h.archived) && <Segmented size="sm" value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />}
        <Button size="sm" variant="primary" onClick={() => setEdit(blank())}><Plus size={15} /> New habit</Button>
      </PageHeader>
      {!list.length && <Empty icon={<Repeat2 size={28} />} title={show === "active" ? "No habits yet" : "Nothing archived"}>{show === "active" && "Try one small daily habit: read 10 pages, walk after lunch, drink water."}</Empty>}
      <div className="space-y-3">
        {list.map(h => {
          const st = streak(h, logs);
          const r = Math.round(rate(h, logs) * 100);
          return (
            <div key={h.id} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="size-10 rounded-full grid place-items-center text-lg flex-none" style={{ background: `color-mix(in srgb, ${h.color} 15%, transparent)` }}>{h.emoji || <Repeat2 size={18} style={{ color: h.color }} />}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{h.name}</div>
                  <div className="text-xs text-muted flex flex-wrap gap-x-2">
                    <span>{h.kind === "daily" ? "Every day" : h.kind === "days" ? h.days.map(d => DAY_SHORT[d]).join(" ") : `${h.perWeek}× a week`}{h.target > 1 ? ` · ${h.target}× a day` : ""}</span>
                    {h.reminder && <span className="inline-flex items-center gap-0.5"><Bell size={11} />{niceTime(h.reminder)}</span>}
                    {h.kind === "weekly" && <span>{weekCount(h, logs)}/{h.perWeek} this week</span>}
                  </div>
                </div>
                <div className="text-right mr-1">
                  <div className="inline-flex items-center gap-1 text-sm tabular"><Flame size={15} className={st.current ? "text-p1" : "text-faint"} />{st.current}</div>
                  <div className="text-[11px] text-faint">best {st.best} · {r}%</div>
                </div>
                <Popover align="end" trigger={({ toggle }) => <IconBtn label="Habit menu" onClick={toggle}><MoreHorizontal size={17} /></IconBtn>}>
                  {close => <>
                    <MenuItem icon={<Pencil size={15} />} onClick={() => { setEdit(h); close(); }}>Edit</MenuItem>
                    <MenuItem icon={<Archive size={15} />} onClick={() => { put("habits", h.id, { archived: !h.archived }); close(); }}>{h.archived ? "Bring back" : "Archive"}</MenuItem>
                    <MenuItem icon={<Trash2 size={15} />} danger onClick={async () => { close(); if (await confirm({ title: `Delete “${h.name}”?`, body: "Its history goes too. Archive it to keep the history.", ok: "Delete", danger: true })) remove("habits", h.id); }}>Delete</MenuItem>
                  </>}
                </Popover>
              </div>
              <div className="grid grid-cols-7 gap-1.5 mt-3">
                {week.map(d => {
                  const n = countOn(logs, h, d), target = Math.max(1, h.target), done = n >= target, expected = h.kind === "weekly" || dueOn(h, d);
                  return (
                    <button key={d} onClick={() => setCount(h, d, done ? 0 : target === 1 ? 1 : n + 1)} onContextMenu={e => { e.preventDefault(); setCount(h, d, 0); }}
                      className={cx("flex flex-col items-center gap-1 rounded-xl py-1.5 transition-colors", d === t ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                      <span className="text-[10px] text-muted">{DAY_SHORT[dayOfWeek(d)].slice(0, 2)}</span>
                      <span className={cx("size-7 rounded-full grid place-items-center text-[11px] tabular", done ? "text-white" : expected ? "border border-border-strong" : "border border-dashed border-border text-faint")}
                        style={done ? { background: h.color } : n > 0 ? { background: `color-mix(in srgb, ${h.color} ${Math.round((n / target) * 60)}%, transparent)` } : undefined}>
                        {done ? <Check size={13} strokeWidth={3} /> : n > 0 ? n : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Heatmap habit={h} logs={logs} weekStart={s.weekStart} />
            </div>
          );
        })}
      </div>
      <HabitEditor habit={edit} onClose={() => setEdit(null)} />
    </Page>
  );
}

function Heatmap({ habit, logs, weekStart }: { habit: Habit; logs: Map<string, number>; weekStart: 0 | 1 }) {
  const t = today();
  const weeks = 18;
  const end = addDays(t, (6 - ((dayOfWeek(t) - weekStart + 7) % 7)));
  const start = addDays(end, -weeks * 7 + 1);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  return (
    <div className="mt-3 overflow-x-auto no-scrollbar">
      <div className="grid grid-flow-col grid-rows-7 gap-[3px] w-max">
        {cells.map(d => {
          const n = countOn(logs, habit, d), done = n >= Math.max(1, habit.target);
          return <span key={d} title={d} className="size-[11px] rounded-[3px]" style={{ background: d > t ? "transparent" : done ? habit.color : n ? `color-mix(in srgb, ${habit.color} 40%, var(--surface-2))` : "var(--surface-2)" }} />;
        })}
      </div>
    </div>
  );
}

const EMOJI = ["", "📖", "🏃", "💧", "🧘", "🥗", "😴", "✍️", "🎸", "🙏", "💊", "🚶", "🧹", "📵", "🌞", "💪"];

function HabitEditor({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const [h, setH] = useState<Habit | null>(habit);
  const [last, setLast] = useState(habit);
  if (habit !== last) { setLast(habit); setH(habit); }
  if (!h) return null;
  const set = (p: Partial<Habit>) => setH({ ...h, ...p });
  const save = () => {
    if (!h.name.trim()) return;
    create("habits", { ...h, name: h.name.trim() });
    onClose();
  };
  return (
    <Modal open={!!habit} onClose={onClose} title={habit?.name ? "Edit habit" : "New habit"}>
      <div className="space-y-4">
        <input autoFocus className="field text-lg" placeholder="Read 10 pages" value={h.name} onChange={e => set({ name: e.target.value })} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <div className="flex flex-wrap gap-1">{EMOJI.map(e => <button key={e || "none"} onClick={() => set({ emoji: e })} className={cx("size-9 rounded-lg text-lg hover:bg-surface-2", h.emoji === e && "bg-surface-2 ring-1 ring-border-strong")}>{e || "–"}</button>)}</div>
        <div className="flex flex-wrap gap-1.5">{PALETTE.map(c => <button key={c} aria-label={c} onClick={() => set({ color: c })} className={cx("size-7 rounded-full", h.color === c && "ring-2 ring-offset-2 ring-offset-surface ring-fg")} style={{ background: c }} />)}</div>
        <div>
          <div className="eyebrow mb-1.5">How often</div>
          <Segmented value={h.kind} onChange={k => set({ kind: k })} options={[{ value: "daily", label: "Every day" }, { value: "days", label: "Some days" }, { value: "weekly", label: "× a week" }]} />
          {h.kind === "days" && (
            <div className="flex gap-1 mt-2">{[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} onClick={() => set({ days: h.days.includes(d) ? h.days.filter(x => x !== d) : [...h.days, d].sort() })} className={cx("size-9 rounded-full text-xs", h.days.includes(d) ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>{DAY_SHORT[d].slice(0, 2)}</button>)}</div>
          )}
          {h.kind === "weekly" && <div className="flex items-center gap-2 mt-2 text-sm"><input type="number" min={1} max={7} className="field w-20" value={h.perWeek} onChange={e => set({ perWeek: Math.max(1, Math.min(7, Number(e.target.value) || 1)) })} /> times a week</div>}
        </div>
        <div className="flex items-center gap-2 text-sm"><span className="w-28 text-muted">Times a day</span><input type="number" min={1} max={20} className="field w-20" value={h.target} onChange={e => set({ target: Math.max(1, Number(e.target.value) || 1) })} /></div>
        <div className="flex items-center gap-2 text-sm"><span className="w-28 text-muted">Remind me at</span><input type="time" className="field w-32" value={h.reminder ?? ""} onChange={e => set({ reminder: e.target.value || null })} /></div>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!h.name.trim()}>Save</Button></div>
      </div>
    </Modal>
  );
}
