import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Sun, Inbox as InboxIcon, Sparkles, Loader2, MoonStar, Hash, CheckCircle2, Plus, Archive as ArchiveIcon } from "lucide-react";
import { Page } from "../components/shell";
import { TaskList } from "../components/task-list";
import { TaskRow } from "../components/task-row";
import { Button, Empty, PageHeader, Section, toast, cx, Dot } from "../components/ui";
import { MiniMonth } from "../components/pickers";
import { byDue, byOrder, byPriority, carryForward, isOverdue } from "../lib/actions";
import { addDays, DAY_LONG, dayOfWeek, longDate, niceDate, today, niceTime } from "../lib/dates";
import { useColl, useSettings, put, all, create } from "../lib/store";
import { aiReady, planDay } from "../lib/ai";
import { aiProblem } from "../lib/gemini";
import { uid, type Task } from "../lib/model";
import { occurrences } from "../lib/recurrence";

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

export function Today() {
  const tasks = useColl("tasks");
  const blocks = useColl("blocks");
  const s = useSettings();
  const nav = useNavigate();
  const t = today();
  const [planning, setPlanning] = useState(false);
  const overdue = tasks.filter(x => !x.parentId && isOverdue(x)).sort(byDue);
  const todays = tasks.filter(x => !x.parentId && !x.done && ((x.due === t) || (!x.due && x.plannedFor && x.plannedFor <= t) || (x.due && x.due > t && x.plannedFor && x.plannedFor <= t))).sort(byDue);
  const doneToday = tasks.filter(x => x.done && x.doneAt && x.doneAt.slice(0, 10) === t && !x.parentId);
  const todayBlocks = blocks.filter(b => b.date === t).sort((a, b) => a.start.localeCompare(b.start));
  const suggestions = useMemo(() => tasks.filter(x => !x.done && !x.parentId && !x.due && !x.plannedFor).sort(byPriority).slice(0, 5), [tasks]);
  const room = Math.max(0, s.dailyLimit - todays.length);

  const doPlan = async () => {
    setPlanning(true);
    try {
      const list = [...overdue, ...todays];
      const r = await planDay({ date: t, tasks: list, busy: todayBlocks.map(b => ({ start: b.start, end: b.end, title: b.title })) });
      for (const b of r.blocks) {
        const task = list.find(x => x.id === b.taskId);
        create("blocks", { id: uid(), date: t, start: b.start, end: b.end, title: task?.title ?? "Focus", taskId: b.taskId, color: "", calPushed: null });
      }
      toast(r.blocks.length ? `Planned ${r.blocks.length} blocks` : "Nothing to plan", { sub: r.note });
      if (r.blocks.length) nav("/calendar?view=day");
    } catch (e) { toast(aiProblem(e), { tone: "error" }); }
    setPlanning(false);
  };

  return (
    <Page>
      <PageHeader eyebrow={longDate(t)} title={greeting(s.name)} sub={todays.length + overdue.length === 0 ? (doneToday.length ? `${doneToday.length} done today. Nicely done.` : "A clear day.") : `${todays.length + overdue.length} to do${doneToday.length ? ` · ${doneToday.length} done` : ""}`}>
        {aiReady() && (todays.length + overdue.length > 0) && <Button size="sm" variant="soft" onClick={doPlan} disabled={planning}>{planning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Plan my day</Button>}
        <Button size="sm" onClick={() => nav("/review")}><MoonStar size={14} /> End the day</Button>
      </PageHeader>

      {todayBlocks.length > 0 && (
        <Section title="Time blocks" right={<button className="text-xs text-muted hover:text-fg" onClick={() => nav("/calendar?view=day")}>Open day</button>}>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {todayBlocks.map(b => (
              <button key={b.id} onClick={() => nav("/calendar?view=day")} className="flex-none rounded-xl border border-border bg-surface px-3 py-2 text-left min-w-[150px]">
                <div className="text-xs text-muted tabular">{niceTime(b.start)}–{niceTime(b.end)}</div>
                <div className="text-sm truncate max-w-[180px]">{b.title}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {overdue.length > 0 && (
        <Section title={<span className="text-danger">Overdue</span>} right={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => { const ids = overdue.map(x => x.id); carryForward(ids, t); toast(`Moved ${ids.length} to today`, { action: { label: "Undo", run: () => overdue.forEach(o => put("tasks", o.id, { due: o.due })) } }); }}>Move to today</Button>
          </div>
        }>
          <TaskList tasks={overdue} sortable={false} />
        </Section>
      )}

      <Section title="Today">
        <TaskList tasks={todays} sortable={false} addDefaults={{ due: t }} empty={!overdue.length && <Empty icon={<Sun size={28} />} title="Nothing due today">Add something, or pick from below.</Empty>} />
      </Section>

      {room > 0 && suggestions.length > 0 && (
        <Section title="Could do today" right={<span className="text-xs text-faint">from Inbox and projects</span>}>
          {suggestions.slice(0, room + 1).map(x => (
            <div key={x.id} className="flex items-center">
              <div className="flex-1 min-w-0"><TaskRow task={x} /></div>
              <Button size="sm" variant="ghost" onClick={() => put("tasks", x.id, { plannedFor: t })} title="Plan for today"><Plus size={14} /> Today</Button>
            </div>
          ))}
        </Section>
      )}

      {doneToday.length > 0 && (
        <Section title={`Done today · ${doneToday.length}`}>
          {doneToday.map(x => <TaskRow key={x.id} task={x} />)}
        </Section>
      )}
    </Page>
  );
}

export function Inbox() {
  const tasks = useColl("tasks");
  const open = tasks.filter(t => !t.projectId && !t.parentId && !t.done).sort(byOrder);
  const done = tasks.filter(t => !t.projectId && !t.parentId && t.done);
  return (
    <Page>
      <PageHeader title="Inbox" sub="Everything lands here first. Give it a date, a project, or just do it." />
      <TaskList tasks={open} addDefaults={{}} completed={done} hideProject empty={<Empty icon={<InboxIcon size={28} />} title="Inbox zero">Press Q anywhere to capture a thought.</Empty>} />
    </Page>
  );
}

export function Upcoming() {
  const tasks = useColl("tasks");
  const s = useSettings();
  const t = today();
  const [days, setDays] = useState(14);
  const nav = useNavigate();
  const dated = tasks.filter(x => !x.done && !x.parentId && x.due);
  const marks = new Set(dated.map(x => x.due!));
  const list = Array.from({ length: days }, (_, i) => addDays(t, i));
  // Repeating tasks also show their later dates (as previews), so the week looks like it will.
  const previews = (d: string) => dated.filter(x => x.recurrence && x.due! < d && occurrences(x.recurrence, x.due!, d, d).includes(d));
  return (
    <Page>
      <PageHeader title="Upcoming" sub="The next two weeks, day by day.">
        <Button size="sm" variant="soft" onClick={() => nav("/plan")}><Sparkles size={14} /> Plan the week</Button>
      </PageHeader>
      {dated.some(x => x.due! < t) && (
        <Section title={<span className="text-danger">Overdue</span>}>
          <TaskList tasks={dated.filter(x => x.due! < t).sort(byDue)} sortable={false} />
        </Section>
      )}
      <div className="hidden md:block float-right ml-6 w-[260px] card p-1 sticky top-6">
        <MiniMonth value={null} marks={marks} onPick={d => document.getElementById(`day-${d}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) ?? nav(`/calendar?date=${d}`)} />
      </div>
      {list.map(d => {
        const items = [...dated.filter(x => x.due === d), ...tasks.filter(x => !x.done && !x.parentId && !x.due && x.plannedFor === d && d !== t)].sort(byDue);
        const pre = previews(d);
        const dow = dayOfWeek(d);
        return (
          <section key={d} id={`day-${d}`} className="mb-4 scroll-mt-4">
            <div className={cx("flex items-baseline gap-2 border-b border-border pb-1 mb-1", dow === s.weekStart && d !== t && "mt-6")}>
              <h2 className="font-display text-xl">{niceDate(d)}</h2>
              <span className="text-xs text-muted">{d === t || d === addDays(t, 1) ? DAY_LONG[dow] + " · " : ""}{longDate(d).split(", ")[1]}</span>
            </div>
            <TaskList tasks={items} sortable={false} hideDate addDefaults={{ due: d }} />
            {pre.map(x => <div key={x.id + d} className="flex items-center gap-3 px-2 py-1.5 text-sm text-faint"><span className="size-5 rounded-full border border-dashed border-faint" />{x.title} <span className="text-xs">repeats</span></div>)}
          </section>
        );
      })}
      <div className="text-center my-6"><Button size="sm" onClick={() => setDays(d => d + 14)}>Show two more weeks</Button></div>
      <Section title="No date">
        <TaskList tasks={tasks.filter(x => !x.done && !x.parentId && !x.due).sort(byPriority).slice(0, 50)} sortable={false} />
      </Section>
    </Page>
  );
}

export function TagPage() {
  const { tag = "" } = useParams();
  const tasks = useColl("tasks");
  const name = decodeURIComponent(tag);
  const list = tasks.filter(t => t.tags.includes(name) && !t.parentId);
  return (
    <Page>
      <PageHeader eyebrow="Tag" title={<span className="inline-flex items-center gap-2"><Hash size={30} className="text-muted" />{name}</span>} />
      <TaskList tasks={list.filter(t => !t.done).sort(byDue)} sortable={false} addDefaults={{ tags: [name] }} completed={list.filter(t => t.done)} />
    </Page>
  );
}

export function CompletedPage() {
  const tasks = useColl("tasks").filter(t => t.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const [limit, setLimit] = useState(60);
  const groups = new Map<string, Task[]>();
  for (const t of tasks.slice(0, limit)) { const d = (t.doneAt ?? t.createdAt).slice(0, 10); groups.set(d, [...(groups.get(d) ?? []), t]); }
  return (
    <Page>
      <PageHeader title="Completed" sub={`${tasks.length} done in all`} />
      {!tasks.length && <Empty icon={<CheckCircle2 size={28} />} title="Nothing yet">Ticked-off tasks gather here.</Empty>}
      {[...groups].map(([d, list]) => (
        <Section key={d} title={niceDate(d)}>{list.map(t => <TaskRow key={t.id} task={t} />)}</Section>
      ))}
      {tasks.length > limit && <div className="text-center"><Button size="sm" onClick={() => setLimit(l => l + 100)}>Show more</Button></div>}
    </Page>
  );
}

export function ArchivePage() {
  const projects = useColl("projects").filter(p => p.archived);
  const nav = useNavigate();
  return (
    <Page>
      <PageHeader title="Archived projects" />
      {!projects.length && <Empty icon={<ArchiveIcon size={28} />} title="No archived projects" />}
      {projects.map(p => (
        <div key={p.id} className="flex items-center gap-3 py-2.5 border-b border-border">
          <Dot color={p.color} />
          <button className="flex-1 text-left" onClick={() => nav(`/project/${p.id}`)}>{p.name}</button>
          <Button size="sm" onClick={() => put("projects", p.id, { archived: false })}>Restore</Button>
        </div>
      ))}
    </Page>
  );
}

/** Rolls tasks that were planned for an earlier day forward (they stay visible on Today). */
export function rollPlanned() {
  const t = today();
  for (const x of all("tasks")) if (!x.done && x.plannedFor && x.plannedFor < t && !x.due) put("tasks", x.id, { plannedFor: t });
}

