import { useState, type ReactNode } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock, Flag, Hash, Inbox, Repeat, Sun, Sofa, CalendarX, ArrowRight, Check, Plus } from "lucide-react";
import { addDays, addMonths, DAY_SHORT, dayOfWeek, daysInMonth, MONTH_LONG, niceDate, niceTime, parseYmd, startOfMonth, today } from "../lib/dates";
import { type Priority, PRIORITY_LABEL, type Rule } from "../lib/model";
import { describeRule } from "../lib/recurrence";
import { useColl, useSettings } from "../lib/store";
import { addProject, ensureTag } from "../lib/actions";
import { cx, MenuItem, Popover, Dot } from "./ui";
import { parseCapture } from "../lib/parse";

export function MiniMonth({ value, onPick, marks }: { value: string | null; onPick: (d: string) => void; marks?: Set<string> }) {
  const s = useSettings();
  const [month, setMonth] = useState(startOfMonth(value ?? today()));
  const first = dayOfWeek(month);
  const lead = (first - s.weekStart + 7) % 7;
  const n = daysInMonth(month);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => month.slice(0, 8) + String(i + 1).padStart(2, "0"))];
  const d = parseYmd(month);
  const t = today();
  return (
    <div className="p-2 select-none">
      <div className="flex items-center justify-between mb-1">
        <button className="p-1 rounded-full hover:bg-surface-2" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <div className="text-sm font-medium">{MONTH_LONG[d.getMonth()]} {d.getFullYear()}</div>
        <button className="p-1 rounded-full hover:bg-surface-2" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-faint mb-1">
        {Array.from({ length: 7 }, (_, i) => <div key={i}>{DAY_SHORT[(i + s.weekStart) % 7].slice(0, 2)}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => c ? (
          <button key={i} onClick={() => onPick(c)}
            className={cx("relative h-8 rounded-full text-[13px] tabular hover:bg-surface-2", c === value && "bg-primary text-on-primary hover:bg-primary", c === t && c !== value && "text-accent font-semibold", c < t && c !== value && "text-faint")}>
            {Number(c.slice(8))}
            {marks?.has(c) && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 size-1 rounded-full bg-accent" />}
          </button>
        ) : <div key={i} />)}
      </div>
    </div>
  );
}

export interface When { due: string | null; time: string | null; recurrence: Rule | null; duration?: number | null }

/** Date, time, repeat and length in one menu. */
export function WhenMenu({ value, onChange, close, allowPlanned }: { value: When; onChange: (w: Partial<When>) => void; close: () => void; allowPlanned?: boolean }) {
  const t = today();
  const [typed, setTyped] = useState("");
  const parsed = typed ? parseCapture("x " + typed) : null;
  const quick: { icon: ReactNode; label: string; date: string | null; hint: string }[] = [
    { icon: <Sun size={16} />, label: "Today", date: t, hint: DAY_SHORT[dayOfWeek(t)] },
    { icon: <ArrowRight size={16} />, label: "Tomorrow", date: addDays(t, 1), hint: DAY_SHORT[dayOfWeek(addDays(t, 1))] },
    { icon: <Sofa size={16} />, label: "This weekend", date: addDays(t, (6 - dayOfWeek(t) + 7) % 7 || 7), hint: "Sat" },
    { icon: <Calendar size={16} />, label: "Next week", date: addDays(t, ((1 - dayOfWeek(t) + 7) % 7) || 7), hint: "Mon" },
    { icon: <CalendarX size={16} />, label: "No date", date: null, hint: "" },
  ];
  void allowPlanned;
  return (
    <div className="w-[280px] max-w-full mx-auto">
      <input autoFocus className="field mb-1" placeholder="Type a date: fri 6pm, every mon…" value={typed} onChange={e => setTyped(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && parsed && (parsed.due || parsed.recurrence)) { onChange({ due: parsed.due, time: parsed.time ?? value.time, recurrence: parsed.recurrence ?? value.recurrence }); close(); } }} />
      {parsed && (parsed.due || parsed.recurrence) && (
        <MenuItem icon={<Check size={16} />} onClick={() => { onChange({ due: parsed.due, time: parsed.time ?? value.time, recurrence: parsed.recurrence ?? value.recurrence }); close(); }}>
          {parsed.due ? niceDate(parsed.due) : ""}{parsed.time ? " " + niceTime(parsed.time) : ""}{parsed.recurrence ? " · " + describeRule(parsed.recurrence) : ""}
        </MenuItem>
      )}
      {!typed && quick.map(q => (
        <MenuItem key={q.label} icon={q.icon} hint={q.hint} active={value.due === q.date} onClick={() => { onChange({ due: q.date, ...(q.date ? {} : { time: null, recurrence: null }) }); close(); }}>{q.label}</MenuItem>
      ))}
      <div className="border-t border-border my-1" />
      <MiniMonth value={value.due} onPick={d => { onChange({ due: d }); }} />
      <div className="border-t border-border my-1" />
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Clock size={16} className="text-muted" />
        <input type="time" className="field h-8 py-0 flex-1" value={value.time ?? ""} onChange={e => onChange({ time: e.target.value || null, due: value.due ?? t })} />
        {value.time && <button className="text-xs text-muted hover:text-fg" onClick={() => onChange({ time: null })}>Clear</button>}
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="text-xs text-muted w-[84px]">Takes</span>
        <select className="field h-8 py-0 flex-1" value={value.duration ?? ""} onChange={e => onChange({ duration: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>
          {[5, 10, 15, 25, 30, 45, 60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
        </select>
      </div>
      <RepeatEditor value={value.recurrence} due={value.due ?? t} onChange={r => onChange({ recurrence: r, due: value.due ?? t })} />
    </div>
  );
}

export function RepeatEditor({ value, onChange, due }: { value: Rule | null; onChange: (r: Rule | null) => void; due: string }) {
  const [open, setOpen] = useState(!!value);
  const r: Rule = value ?? { freq: "weekly", interval: 1, days: [dayOfWeek(due)] };
  const set = (p: Partial<Rule>) => onChange({ ...r, ...p });
  if (!open) return <MenuItem icon={<Repeat size={16} />} onClick={() => { setOpen(true); onChange(r); }}>Repeat…</MenuItem>;
  return (
    <div className="px-2 py-1.5 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Repeat size={16} className="text-muted" />
        <span>Every</span>
        <input type="number" min={1} max={99} className="field h-8 py-0 w-14" value={r.interval} onChange={e => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />
        <select className="field h-8 py-0 flex-1" value={r.freq} onChange={e => set({ freq: e.target.value as Rule["freq"], days: e.target.value === "weekly" ? [dayOfWeek(due)] : undefined, monthDay: e.target.value === "monthly" ? Number(due.slice(8)) : undefined, nth: undefined })}>
          <option value="daily">{r.interval > 1 ? "days" : "day"}</option>
          <option value="weekly">{r.interval > 1 ? "weeks" : "week"}</option>
          <option value="monthly">{r.interval > 1 ? "months" : "month"}</option>
          <option value="yearly">{r.interval > 1 ? "years" : "year"}</option>
        </select>
      </div>
      {r.freq === "weekly" && (
        <div className="flex gap-1 justify-between">
          {[1, 2, 3, 4, 5, 6, 0].map(d => {
            const on = r.days?.includes(d);
            return <button key={d} onClick={() => { const days = on ? (r.days ?? []).filter(x => x !== d) : [...(r.days ?? []), d]; set({ days: days.length ? days.sort() : [d] }); }}
              className={cx("size-8 rounded-full text-xs", on ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>{DAY_SHORT[d].slice(0, 2)}</button>;
          })}
        </div>
      )}
      {r.freq === "monthly" && (
        <select className="field h-8 py-0 text-sm" value={r.nth ? "nth" : "day"} onChange={e => {
          const d = parseYmd(due);
          set(e.target.value === "nth" ? { nth: { week: Math.ceil(d.getDate() / 7) > 4 ? -1 : Math.ceil(d.getDate() / 7), day: d.getDay() }, monthDay: undefined } : { nth: undefined, monthDay: d.getDate() });
        }}>
          <option value="day">On day {Number(due.slice(8))}</option>
          <option value="nth">On the {Math.ceil(parseYmd(due).getDate() / 7) > 4 ? "last" : ["", "1st", "2nd", "3rd", "4th"][Math.ceil(parseYmd(due).getDate() / 7)]} {DAY_SHORT[parseYmd(due).getDay()]}</option>
        </select>
      )}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={!!r.fromDone} onChange={e => set({ fromDone: e.target.checked || undefined })} /> Count from when it's done
      </label>
      <div className="flex items-center gap-2 text-sm text-muted">
        <span>Until</span>
        <input type="date" className="field h-8 py-0 flex-1" value={r.until ?? ""} onChange={e => set({ until: e.target.value || undefined })} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{describeRule(r)}</span>
        <button className="text-danger" onClick={() => { onChange(null); setOpen(false); }}>Don't repeat</button>
      </div>
    </div>
  );
}

export function PriorityMenu({ value, onChange, close }: { value: Priority; onChange: (p: Priority) => void; close: () => void }) {
  return (
    <div>
      {([1, 2, 3, 4] as Priority[]).map(p => (
        <MenuItem key={p} icon={<Flag size={16} style={{ color: p < 4 ? `var(--p${p})` : undefined }} fill={p < 4 ? `var(--p${p})` : "none"} />} active={value === p} hint={`P${p}`} onClick={() => { onChange(p); close(); }}>{PRIORITY_LABEL[p]}</MenuItem>
      ))}
    </div>
  );
}

export function ProjectMenu({ value, onChange, close }: { value: string | null; onChange: (id: string | null) => void; close: () => void }) {
  const projects = useColl("projects").filter(p => !p.archived).sort((a, b) => a.order - b.order);
  const [q, setQ] = useState("");
  const shown = projects.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="w-[260px] max-w-full mx-auto">
      <input autoFocus className="field mb-1" placeholder="Find or make a project" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { if (shown[0]) onChange(shown[0].id); else if (q.trim()) onChange(addProject({ name: q.trim() }).id); close(); } }} />
      {!q && <MenuItem icon={<Inbox size={16} />} active={value === null} onClick={() => { onChange(null); close(); }} hint="Unsorted">No project</MenuItem>}
      {shown.map(p => <MenuItem key={p.id} icon={p.emoji ? <span>{p.emoji}</span> : <Dot color={p.color} />} active={value === p.id} onClick={() => { onChange(p.id); close(); }}>{p.name}</MenuItem>)}
      {q.trim() && !projects.some(p => p.name.toLowerCase() === q.trim().toLowerCase()) && (
        <MenuItem icon={<Plus size={16} />} onClick={() => { onChange(addProject({ name: q.trim() }).id); close(); }}>New project “{q.trim()}”</MenuItem>
      )}
    </div>
  );
}

export function TagMenu({ value, onChange }: { value: string[]; onChange: (t: string[]) => void }) {
  const tags = useColl("tags");
  const [q, setQ] = useState("");
  const name = q.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
  const shown = tags.filter(t => t.name.includes(name)).sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (n: string) => { ensureTag(n); onChange(value.includes(n) ? value.filter(x => x !== n) : [...value, n]); };
  return (
    <div className="w-[240px] max-w-full mx-auto">
      <input autoFocus className="field mb-1" placeholder="Tag" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && name) { toggle(name); setQ(""); } }} />
      {shown.map(t => <MenuItem key={t.id} icon={<Hash size={15} style={{ color: t.color }} />} active={value.includes(t.name)} hint={value.includes(t.name) ? <Check size={14} /> : null} onClick={() => toggle(t.name)}>{t.name}</MenuItem>)}
      {name && !tags.some(t => t.name === name) && <MenuItem icon={<Plus size={15} />} onClick={() => { toggle(name); setQ(""); }}>Make “{name}”</MenuItem>}
    </div>
  );
}

/** A small chip button that opens a menu. */
export function Chip({ icon, children, active, onClick, color, title }: { icon?: ReactNode; children?: ReactNode; active?: boolean; onClick?: () => void; color?: string; title?: string }) {
  return (
    <button onClick={onClick} title={title} style={color ? { color } : undefined}
      className={cx("inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-[13px] transition-colors", active ? "border-border-strong bg-surface-2" : "border-border text-muted hover:text-fg hover:bg-surface-2")}>
      {icon}{children}
    </button>
  );
}

export function WhenChip({ value, onChange }: { value: When; onChange: (w: Partial<When>) => void }) {
  const label = value.due ? `${niceDate(value.due)}${value.time ? " " + niceTime(value.time) : ""}` : "Date";
  const overdue = value.due && value.due < today();
  return (
    <Popover trigger={({ toggle }) => <Chip icon={value.recurrence ? <Repeat size={14} /> : <Calendar size={14} />} active={!!value.due} onClick={toggle} color={overdue ? "var(--danger)" : value.due === today() ? "var(--accent)" : undefined}>{label}</Chip>}>
      {close => <WhenMenu value={value} onChange={onChange} close={close} />}
    </Popover>
  );
}

export function ProjectChip({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const projects = useColl("projects");
  const p = projects.find(x => x.id === value);
  return (
    <Popover trigger={({ toggle }) => <Chip icon={p ? (p.emoji ? <span>{p.emoji}</span> : <Dot color={p.color} />) : <Inbox size={14} />} onClick={toggle}>{p?.name ?? "No project"}</Chip>}>
      {close => <ProjectMenu value={value} onChange={onChange} close={close} />}
    </Popover>
  );
}

export function PriorityChip({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <Popover trigger={({ toggle }) => <Chip icon={<Flag size={14} fill={value < 4 ? `var(--p${value})` : "none"} style={{ color: value < 4 ? `var(--p${value})` : undefined }} />} active={value < 4} onClick={toggle}>{value < 4 ? PRIORITY_LABEL[value] : "Priority"}</Chip>}>
      {close => <PriorityMenu value={value} onChange={onChange} close={close} />}
    </Popover>
  );
}

export function TagChip({ value, onChange }: { value: string[]; onChange: (t: string[]) => void }) {
  return (
    <Popover trigger={({ toggle }) => <Chip icon={<Hash size={14} />} active={value.length > 0} onClick={toggle}>{value.length ? value.join(", ") : "Tags"}</Chip>}>
      {() => <TagMenu value={value} onChange={onChange} />}
    </Popover>
  );
}

