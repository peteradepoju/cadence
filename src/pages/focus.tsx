import { useMemo } from "react";
import { Play, Pause, RotateCcw, SkipForward, Timer, Check } from "lucide-react";
import { Page } from "../components/shell";
import { Button, PageHeader, Section, Segmented, cx, IconBtn } from "../components/ui";
import { Tick } from "../components/task-row";
import { addDays, DAY_SHORT, dayOfWeek, minutesLabel, niceDate, pad, today } from "../lib/dates";
import { pause, remaining, reset, setTask, skip, start, useFocus, type Mode } from "../lib/focus";
import { byDue, isToday } from "../lib/actions";
import { useColl, useSettings, setSettings, get } from "../lib/store";

export function FocusPage() {
  const f = useFocus();
  const s = useSettings();
  const tasks = useColl("tasks");
  const sessions = useColl("sessions");
  const task = f.taskId ? get("tasks", f.taskId) : undefined;
  const left = remaining();
  const pct = f.total ? 1 - left / f.total : 0;
  const R = 120, C = 2 * Math.PI * R;
  const candidates = useMemo(() => tasks.filter(t => !t.done && !t.parentId && (isToday(t) || t.priority < 3)).sort(byDue).slice(0, 12), [tasks]);
  const t = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const minutesOn = (d: string) => sessions.filter(x => x.kind === "focus" && x.start.slice(0, 10) === d).reduce((a, x) => a + x.minutes, 0);
  const max = Math.max(25, ...week.map(minutesOn));
  const todays = sessions.filter(x => x.kind === "focus" && x.start.slice(0, 10) === t);
  return (
    <Page>
      <PageHeader title="Focus" sub={f.mode === "focus" ? `Round ${f.round}` : f.mode === "long" ? "Long break" : "Short break"} />
      <div className="flex flex-col items-center">
        <Segmented value={f.mode} onChange={(m: Mode) => reset(m)} options={[{ value: "focus", label: `Focus ${s.focusMinutes}` }, { value: "break", label: `Break ${s.breakMinutes}` }, { value: "long", label: `Long ${s.longBreakMinutes}` }]} />
        <div className="relative my-8" style={{ width: 2 * R + 24, height: 2 * R + 24 }}>
          <svg width={2 * R + 24} height={2 * R + 24} className="-rotate-90">
            <circle cx={R + 12} cy={R + 12} r={R} fill="none" strokeWidth={6} className="ring-track" />
            <circle cx={R + 12} cy={R + 12} r={R} fill="none" strokeWidth={6} strokeLinecap="round" className="ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={f.mode !== "focus" ? { stroke: "var(--p3)" } : undefined} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-display text-[72px] leading-none tabular">{Math.floor(left / 60)}:{pad(left % 60)}</div>
              <div className="text-sm text-muted mt-2 max-w-[200px] truncate">{task ? task.title : f.mode === "focus" ? "No task picked" : "Breathe"}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconBtn label="Reset" onClick={() => reset()}><RotateCcw size={18} /></IconBtn>
          {f.running
            ? <Button variant="primary" className="h-12 px-8 text-base" onClick={pause}><Pause size={18} /> Pause</Button>
            : <Button variant="primary" className="h-12 px-8 text-base" onClick={() => start()}><Play size={18} /> {f.startedAt ? "Resume" : "Start"}</Button>}
          <IconBtn label="Skip" onClick={skip}><SkipForward size={18} /></IconBtn>
        </div>
      </div>

      <Section title="Working on" className="mt-10">
        <div className="space-y-1">
          <button onClick={() => setTask(null)} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-left", !f.taskId ? "bg-surface-2" : "hover:bg-surface-2/60")}><Timer size={16} className="text-muted" /> Just focus</button>
          {candidates.map(x => (
            <div key={x.id} role="button" tabIndex={0} onClick={() => setTask(x.id)} onKeyDown={e => { if (e.key === "Enter") setTask(x.id); }} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left cursor-pointer", f.taskId === x.id ? "bg-surface-2" : "hover:bg-surface-2/60")}>
              <Tick task={x} size={18} /><span className="flex-1 text-sm truncate">{x.title}</span>
              {f.taskId === x.id && <Check size={15} className="text-accent" />}
              <span className="text-xs text-faint">{x.due ? niceDate(x.due) : ""}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Focused today · ${minutesLabel(todays.reduce((a, x) => a + x.minutes, 0))}`}>
        <div className="flex items-end gap-2 h-28 card p-3">
          {week.map(d => (
            <div key={d} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <div className="w-full max-w-8 rounded-md bg-accent/80" style={{ height: `${(minutesOn(d) / max) * 100}%`, minHeight: minutesOn(d) ? 4 : 0 }} title={minutesLabel(minutesOn(d))} />
              <span className={cx("text-[10px]", d === t ? "text-fg" : "text-muted")}>{DAY_SHORT[dayOfWeek(d)].slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Timer lengths">
        <div className="card p-4 grid grid-cols-3 gap-3 text-sm">
          {([["focusMinutes", "Focus"], ["breakMinutes", "Break"], ["longBreakMinutes", "Long break"]] as const).map(([k, label]) => (
            <label key={k} className="space-y-1"><span className="text-muted text-xs">{label} (min)</span>
              <input type="number" min={1} max={180} className="field" value={s[k]} onChange={e => { setSettings({ [k]: Math.max(1, Number(e.target.value) || 1) }); if (!f.running) reset(); }} />
            </label>
          ))}
        </div>
      </Section>
    </Page>
  );
}
