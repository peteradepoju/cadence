import { useState } from "react";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { Page } from "../components/shell";
import { Button, PageHeader, Section, cx, toast } from "../components/ui";
import { TaskRow } from "../components/task-row";
import { addDays, DAY_SHORT, dayOfWeek, fromMin, niceDate, niceTime, startOfWeek, today, toMin } from "../lib/dates";
import { aiReady, planWeek, type PlanItem } from "../lib/ai";
import { aiProblem } from "../lib/gemini";
import { otherEvents } from "../lib/gcal";
import { byPriority } from "../lib/actions";
import { all, create, get, put, useColl, useSettings } from "../lib/store";
import { uid } from "../lib/model";

export function PlanPage() {
  const s = useSettings();
  const tasks = useColl("tasks");
  const t = today();
  // From today if it's early in the week, else next week.
  const ws = startOfWeek(t, s.weekStart);
  const start = (dayOfWeek(t) === 5 || dayOfWeek(t) === 6 || dayOfWeek(t) === 0) ? addDays(ws, 7) : t;
  const days = Array.from({ length: Math.max(1, 7 - (start === t ? (dayOfWeek(t) - s.weekStart + 7) % 7 : 0)) }, (_, i) => addDays(start, i));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ items: PlanItem[]; summary: string } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const planned = (d: string) => tasks.filter(x => !x.done && !x.parentId && ((x.due === d) || (x.plannedFor === d && !x.due)));
  const waiting = tasks.filter(x => !x.done && !x.parentId && !x.plannedFor && (!x.due || x.due > days[days.length - 1])).sort(byPriority);

  const run = async () => {
    setBusy(true);
    try {
      const busyEvents = [
        ...all("blocks").filter(b => days.includes(b.date)).map(b => ({ date: b.date, start: b.start, end: b.end, title: b.title })),
        ...(await otherEvents(days[0], days[days.length - 1]).catch(() => [])).map(e => ({ date: e.date, start: e.start, end: e.end, title: e.title })),
      ];
      const r = await planWeek({ start: days[0], days: days.length, busy: busyEvents, note });
      setPlan({ items: r.plan, summary: r.summary }); setSkip(new Set());
    } catch (e) { toast(aiProblem(e), { tone: "error" }); }
    setBusy(false);
  };
  const accept = () => {
    let n = 0;
    for (const p of plan?.items ?? []) {
      if (skip.has(p.taskId)) continue;
      const task = get("tasks", p.taskId);
      if (!task) continue;
      if (!task.due || task.due !== p.date) put("tasks", p.taskId, { plannedFor: p.date });
      if (p.time && !task.time) {
        const len = p.minutes ?? task.duration ?? 30;
        create("blocks", { id: uid(), date: p.date, start: p.time, end: fromMin(Math.min(1439, toMin(p.time) + len)), title: task.title, taskId: task.id, color: "", calPushed: null });
      }
      n++;
    }
    toast(`Planned ${n} tasks`); setPlan(null);
  };

  return (
    <Page wide>
      <PageHeader title="Plan the week" sub={`${niceDate(days[0])} – ${niceDate(days[days.length - 1])}. Put each task on a day; leave room to breathe.`} />
      {aiReady() && (
        <div className="card p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-2">
            <input className="field flex-1" placeholder="Anything to know? “Tuesday is full of meetings, I'm tired on Fridays”" value={note} onChange={e => setNote(e.target.value)} />
            <Button variant="primary" onClick={run} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Suggest a plan</Button>
          </div>
          <p className="text-xs text-faint mt-2">Uses your energy times (Settings), deadlines, priorities, time blocks{s.calShowOthers ? " and calendar" : ""}. Nothing changes until you accept.</p>
        </div>
      )}
      {plan && (
        <Section title="Suggested plan">
          {plan.summary && <p className="text-sm text-muted mb-2 px-1">{plan.summary}</p>}
          <div className="card divide-y divide-border">
            {plan.items.map(p => { const task = get("tasks", p.taskId); if (!task) return null; const off = skip.has(p.taskId); return (
              <div key={p.taskId} className={cx("flex items-center gap-3 px-3 py-2", off && "opacity-40")}>
                <span className="w-24 text-sm">{niceDate(p.date)}</span>
                <span className="w-16 text-xs text-muted tabular">{p.time ? niceTime(p.time) : ""}</span>
                <span className="flex-1 text-sm">{task.title}<span className="block text-xs text-faint">{p.why}</span></span>
                <button aria-label={off ? "Keep" : "Leave out"} onClick={() => setSkip(sk => { const n = new Set(sk); if (n.has(p.taskId)) n.delete(p.taskId); else n.add(p.taskId); return n; })}>{off ? <Check size={16} /> : <X size={16} className="text-muted" />}</button>
              </div>
            ); })}
          </div>
          <div className="flex gap-2 mt-3"><Button variant="primary" onClick={accept}>Accept plan</Button><Button onClick={() => setPlan(null)}>Discard</Button></div>
        </Section>
      )}
      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {days.map(d => {
            const list = planned(d);
            const mins = list.reduce((a, x) => a + (x.duration ?? 30), 0);
            return (
              <div key={d} className="card p-3 min-h-32">
                <div className="flex items-baseline justify-between mb-1"><span className="font-medium">{DAY_SHORT[dayOfWeek(d)]} {Number(d.slice(8))}</span><span className={cx("text-xs tabular", list.length > s.dailyLimit ? "text-danger" : "text-muted")}>{list.length} · ~{Math.round(mins / 6) / 10}h</span></div>
                {list.map(x => <div key={x.id} className="flex items-center gap-1"><div className="flex-1 min-w-0"><TaskRow task={x} hideDate /></div>{x.plannedFor && !x.due && <button aria-label="Unplan" className="text-faint hover:text-fg" onClick={() => put("tasks", x.id, { plannedFor: null })}><X size={14} /></button>}</div>)}
              </div>
            );
          })}
        </div>
        <aside>
          <div className="eyebrow mb-2">Not planned yet · {waiting.length}</div>
          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
            {waiting.slice(0, 60).map(x => (
              <div key={x.id} className="rounded-xl border border-border bg-surface p-2">
                <div className="text-sm">{x.title}</div>
                <div className="flex flex-wrap gap-1 mt-1.5">{days.map(d => <button key={d} onClick={() => put("tasks", x.id, { plannedFor: d })} className="rounded-full bg-surface-2 hover:bg-surface-3 px-2 py-0.5 text-[11px]">{DAY_SHORT[dayOfWeek(d)]}</button>)}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </Page>
  );
}
