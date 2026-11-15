import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { MoonStar, CalendarCheck, Sparkles, Loader2, ArrowRight, Check } from "lucide-react";
import { Page } from "../components/shell";
import { Button, PageHeader, Section, Segmented, cx, toast } from "../components/ui";
import { TaskRow } from "../components/task-row";
import { addDays, longDate, minutesLabel, niceDate, today, weekKey, weekStartOf, DAY_SHORT, dayOfWeek } from "../lib/dates";
import { carryForward, isOverdue, byDue } from "../lib/actions";
import { aiReady, dayReflection, weeklyReview } from "../lib/ai";
import { aiProblem } from "../lib/gemini";
import { goalProgress } from "../lib/goals";
import { get, put, useColl } from "../lib/store";

export function ReviewPage() {
  const [kind, setKind] = useState<"day" | "week">(new Date().getDay() === 0 || new Date().getDay() === 5 ? "week" : "day");
  return (
    <Page>
      <PageHeader title="Review" sub={kind === "day" ? "Close the day: what got done, what moves to tomorrow." : "Look back at the week, then set up the next one."}>
        <Segmented value={kind} onChange={setKind} options={[{ value: "day", label: "Today" }, { value: "week", label: "This week" }]} />
      </PageHeader>
      {kind === "day" ? <DayReview /> : <WeekReview />}
    </Page>
  );
}

function Answers({ id, questions }: { id: string; questions: [string, string][] }) {
  const r = get("reviews", id);
  const [a, setA] = useState<Record<string, string>>(r?.answers ?? {});
  return (
    <div className="space-y-3">
      {questions.map(([k, q]) => (
        <label key={k} className="block">
          <span className="text-sm text-muted">{q}</span>
          <textarea className="field mt-1 min-h-16" value={a[k] ?? ""} onChange={e => setA(x => ({ ...x, [k]: e.target.value }))} onBlur={() => put("reviews", id, { answers: a, kind: id.startsWith("day") ? "day" : "week", period: id.split(":")[1] })} />
        </label>
      ))}
    </div>
  );
}

function DayReview() {
  const tasks = useColl("tasks");
  const sessions = useColl("sessions");
  const reviews = useColl("reviews");
  const nav = useNavigate();
  const t = today(), tomorrow = addDays(t, 1);
  const id = `day:${t}`;
  const review = reviews.find(r => r.id === id);
  const done = tasks.filter(x => x.done && x.doneAt?.slice(0, 10) === t && !x.parentId);
  const left = tasks.filter(x => !x.done && !x.parentId && (isOverdue(x, tomorrow) || (x.plannedFor && x.plannedFor <= t))).sort(byDue);
  const [keep, setKeep] = useState<Set<string>>(() => new Set(left.map(x => x.id)));
  const focus = sessions.filter(x => x.kind === "focus" && x.start.slice(0, 10) === t).reduce((a, x) => a + x.minutes, 0);
  const [energy, setEnergy] = useState<number | null>(review?.energy ?? null);
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    const ids = left.filter(x => keep.has(x.id)).map(x => x.id);
    carryForward(ids, tomorrow);
    // the rest lose their date: they were never really for today
    left.filter(x => !keep.has(x.id)).forEach(x => put("tasks", x.id, x.due ? { due: null, plannedFor: null } : { plannedFor: null }));
    put("reviews", id, { kind: "day", period: t, energy, doneAt: new Date().toISOString() });
    if (aiReady()) {
      setBusy(true);
      try {
        const ai = await dayReflection({ done: done.map(x => x.title), movedToTomorrow: left.filter(x => keep.has(x.id)).map(x => x.title), focusMinutes: focus, energy, notes: get("reviews", id)?.answers });
        put("reviews", id, { ai });
      } catch (e) { toast(aiProblem(e), { tone: "error" }); }
      setBusy(false);
    }
    toast(ids.length ? `Moved ${ids.length} to tomorrow. Rest well.` : "Day closed. Rest well.");
  };
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-6">
        <Stat label="Done" value={String(done.length)} />
        <Stat label="Focused" value={minutesLabel(focus)} />
        <Stat label="Still open" value={String(left.length)} />
      </div>
      {done.length > 0 && <Section title="Done today">{done.map(x => <TaskRow key={x.id} task={x} />)}</Section>}
      <Section title={left.length ? "Still open: tick what moves to tomorrow" : "Still open"}>
        {!left.length && <p className="text-sm text-muted px-1">Nothing left over. 🌿</p>}
        {left.map(x => (
          <label key={x.id} className="flex items-center gap-3 py-2 px-2 border-b border-border/70 cursor-pointer">
            <input type="checkbox" checked={keep.has(x.id)} onChange={() => setKeep(s => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} className="size-4 accent-[var(--accent)]" />
            <span className="flex-1 text-[15px]">{x.title}</span>
            <span className="text-xs text-muted">{keep.has(x.id) ? <span className="inline-flex items-center gap-1">tomorrow <ArrowRight size={12} /></span> : "drop the date"}</span>
          </label>
        ))}
      </Section>
      <Section title="How was your energy?">
        <div className="flex gap-2">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setEnergy(n)} className={cx("size-11 rounded-full text-lg", energy === n ? "bg-primary text-on-primary" : "bg-surface-2")}>{["😴", "😕", "🙂", "😊", "⚡"][n - 1]}</button>)}</div>
      </Section>
      <Section title="A few words (only you see these)">
        <Answers id={id} questions={[["win", "What went well?"], ["learn", "What got in the way?"], ["first", "First thing tomorrow?"]]} />
      </Section>
      {review?.ai && <div className="card p-4 mb-5 text-[15px] leading-relaxed"><div className="eyebrow mb-1.5 inline-flex items-center gap-1"><Sparkles size={12} /> Reflection</div>{review.ai}</div>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={finish} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : review?.doneAt ? <Check size={15} /> : <MoonStar size={15} />} {review?.doneAt ? "Close the day again" : "Close the day"}</Button>
        <Button onClick={() => nav("/upcoming")}>See tomorrow</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="card p-3 text-center"><div className="font-display text-3xl tabular">{value}</div><div className="text-xs text-muted">{label}</div>{sub && <div className="text-[11px] text-faint">{sub}</div>}</div>;
}

function WeekReview() {
  const tasks = useColl("tasks");
  const sessions = useColl("sessions");
  const goals = useColl("goals");
  const reviews = useColl("reviews");
  const nav = useNavigate();
  const t = today();
  const wk = weekKey(t);
  const start = weekStartOf(wk), end = addDays(start, 6);
  const id = `week:${wk}`;
  const review = reviews.find(r => r.id === id);
  const [busy, setBusy] = useState(false);
  const inWeek = (iso: string | null | undefined) => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;
  const done = tasks.filter(x => x.done && inWeek(x.doneAt) && !x.parentId);
  const slipped = tasks.filter(x => !x.done && !x.parentId && x.due && x.due >= start && x.due < t);
  const focus = sessions.filter(x => x.kind === "focus" && inWeek(x.start)).reduce((a, x) => a + x.minutes, 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const perDay = days.map(d => done.filter(x => x.doneAt!.slice(0, 10) === d).length);
  const maxDay = Math.max(1, ...perDay);
  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of done) { const n = x.projectId ? get("projects", x.projectId)?.name ?? "Other" : "Inbox"; m.set(n, (m.get(n) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [done]);
  const weekGoals = goals.filter(g => g.status === "active" && (g.period === wk || g.horizon === "month" || g.horizon === "quarter"));

  const write = async () => {
    setBusy(true);
    try {
      const ai = await weeklyReview({
        week: wk, done: done.map(x => x.title).slice(0, 60), slipped: slipped.map(x => x.title), focusMinutes: focus, perDay: Object.fromEntries(days.map((d, i) => [DAY_SHORT[dayOfWeek(d)], perDay[i]])),
        byProject: Object.fromEntries(byProject), goals: weekGoals.map(g => `${g.title}: ${goalProgress(g, goals, tasks)}%`),
        energy: reviews.filter(r => r.kind === "day" && r.period >= start && r.period <= end && r.energy).map(r => r.energy),
      }, review?.answers ?? {});
      put("reviews", id, { kind: "week", period: wk, ai });
    } catch (e) { toast(aiProblem(e), { tone: "error" }); }
    setBusy(false);
  };

  return (
    <div>
      <p className="text-sm text-muted mb-4">{longDate(start)} – {longDate(end)}</p>
      <div className="grid grid-cols-3 gap-2 mb-6">
        <Stat label="Done" value={String(done.length)} />
        <Stat label="Focused" value={minutesLabel(focus)} />
        <Stat label="Slipped" value={String(slipped.length)} />
      </div>
      <Section title="Done each day">
        <div className="flex items-end gap-2 h-28 card p-3">
          {days.map((d, i) => (
            <div key={d} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <span className="text-[10px] text-muted tabular">{perDay[i] || ""}</span>
              <div className="w-full max-w-8 rounded-md bg-accent/80" style={{ height: `${(perDay[i] / maxDay) * 80}%`, minHeight: perDay[i] ? 4 : 0 }} />
              <span className={cx("text-[10px]", d === t ? "text-fg" : "text-muted")}>{DAY_SHORT[dayOfWeek(d)].slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </Section>
      {byProject.length > 0 && <Section title="Where the work went">{byProject.map(([n, c]) => <div key={n} className="flex items-center gap-3 py-1 text-sm"><span className="flex-1">{n}</span><div className="w-32 h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${(c / done.length) * 100}%` }} /></div><span className="w-6 text-right tabular text-muted">{c}</span></div>)}</Section>}
      {slipped.length > 0 && <Section title="Slipped">{slipped.map(x => <TaskRow key={x.id} task={x} />)}
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => { carryForward(slipped.map(x => x.id), addDays(t, 1)); toast(`Moved ${slipped.length} to tomorrow`); }}>Move all to tomorrow</Button>
      </Section>}
      <Section title="Your notes">
        <Answers id={id} questions={[["proud", "What are you glad you did?"], ["drain", "What drained you?"], ["next", "What matters most next week?"]]} />
      </Section>
      {review?.ai && <div className="card p-4 mb-5 text-[15px] leading-relaxed whitespace-pre-line"><div className="eyebrow mb-1.5 inline-flex items-center gap-1"><Sparkles size={12} /> Your week</div>{review.ai}</div>}
      <div className="flex flex-wrap gap-2">
        {aiReady() && <Button variant="soft" onClick={write} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {review?.ai ? "Write it again" : "Write my weekly review"}</Button>}
        <Button variant="primary" onClick={() => { put("reviews", id, { kind: "week", period: wk, doneAt: new Date().toISOString() }); nav("/plan"); }}><CalendarCheck size={15} /> Plan next week</Button>
      </div>
      <p className="text-xs text-faint mt-6">Earlier reviews: {reviews.filter(r => r.kind === "week" && r.id !== id).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6).map(r => r.period).join(", ") || "none yet"} {niceDate(t) && ""}</p>
    </div>
  );
}
