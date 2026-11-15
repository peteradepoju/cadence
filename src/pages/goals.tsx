import { useState } from "react";
import { Plus, Target, ChevronDown, ChevronRight, MoreHorizontal, Check, Trash2, Pencil, Sparkles, Loader2, X } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Empty, IconBtn, MenuItem, Modal, PageHeader, Popover, Progress, Segmented, cx, toast, useConfirm } from "../components/ui";
import { TaskRow } from "../components/task-row";
import { InlineAdd } from "../components/quick-add";
import {  addMonths, isoWeek, monthKey, pad, quarterKey } from "../lib/dates";
import { currentPeriod, goalProgress, periodLabel } from "../lib/goals";
import { PALETTE, uid, type Goal, type Horizon } from "../lib/model";
import { create, put, remove, useColl } from "../lib/store";
import { aiReady, suggestGoalSteps } from "../lib/ai";
import { aiProblem } from "../lib/gemini";
import { addTask } from "../lib/actions";

const HORIZONS: { value: Horizon; label: string }[] = [{ value: "year", label: "Year" }, { value: "quarter", label: "Quarter" }, { value: "month", label: "Month" }, { value: "week", label: "Week" }];
const PARENT: Record<Horizon, Horizon | null> = { year: null, quarter: "year", month: "quarter", week: "month" };

function shift(h: Horizon, p: string, dir: number): string {
  if (h === "year") return String(Number(p) + dir);
  if (h === "quarter") { const [y, q] = p.split("-Q").map(Number); const n = (y * 4 + q - 1) + dir; return `${Math.floor(n / 4)}-Q${(n % 4) + 1}`; }
  if (h === "month") return monthKey(addMonths(p + "-01", dir));
  const [y, w] = p.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4); const mon = new Date(jan4); mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1 + dir) * 7);
  const iso = isoWeek(`${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`);
  return `${iso.year}-W${pad(iso.week)}`;
}
/** Which period of the parent horizon a period falls in ("2026-11" → quarter "2026-Q4"). */
function parentPeriod(h: Horizon, p: string): string | null {
  if (h === "quarter") return p.slice(0, 4);
  if (h === "month") return quarterKey(p + "-01");
  if (h === "week") { const [y, w] = p.split("-W").map(Number); const jan4 = new Date(y, 0, 4); const mon = new Date(jan4); mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7 + 3); return monthKey(`${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-01`); }
  return null;
}

export function GoalsPage() {
  const goals = useColl("goals");
  const tasks = useColl("tasks");
  const [horizon, setHorizon] = useState<Horizon>("quarter");
  const [period, setPeriod] = useState(currentPeriod("quarter"));
  const [edit, setEdit] = useState<Goal | null>(null);
  const changeHorizon = (h: Horizon) => { setHorizon(h); setPeriod(currentPeriod(h)); };
  const list = goals.filter(g => g.horizon === horizon && g.period === period).sort((a, b) => a.order - b.order);
  const parentH = PARENT[horizon];
  const parents = parentH ? goals.filter(g => g.horizon === parentH && g.period === parentPeriod(horizon, period) && g.status === "active") : [];
  const blank = (): Goal => ({ id: uid(), title: "", why: "", horizon, period, parentId: null, status: "active", progress: null, color: PALETTE[goals.length % PALETTE.length], order: list.length, createdAt: new Date().toISOString() });
  return (
    <Page>
      <PageHeader title="Goals" sub="From the year down to this week. Link tasks to a goal to see it move.">
        <Button size="sm" variant="primary" onClick={() => setEdit(blank())}><Plus size={15} /> New goal</Button>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Segmented value={horizon} onChange={changeHorizon} options={HORIZONS} />
        <div className="flex items-center ml-auto">
          <IconBtn label="Previous" onClick={() => setPeriod(shift(horizon, period, -1))}><ChevronDown size={17} className="rotate-90" /></IconBtn>
          <button className="text-sm font-medium px-2 min-w-[120px]" onClick={() => setPeriod(currentPeriod(horizon))}>{periodLabel(horizon, period)}</button>
          <IconBtn label="Next" onClick={() => setPeriod(shift(horizon, period, 1))}><ChevronDown size={17} className="-rotate-90" /></IconBtn>
        </div>
      </div>
      {parents.length > 0 && (
        <div className="mb-5 rounded-2xl bg-surface-2/60 p-3">
          <div className="eyebrow mb-1.5">Serving these {parentH} goals</div>
          {parents.map(p => <div key={p.id} className="flex items-center gap-2 text-sm py-0.5"><Target size={14} style={{ color: p.color }} /> <span className="flex-1">{p.title}</span><span className="text-xs text-muted tabular">{goalProgress(p, goals, tasks)}%</span></div>)}
        </div>
      )}
      {!list.length && <Empty icon={<Target size={28} />} title={`No goals for ${periodLabel(horizon, period)}`}>What would make this {horizon} a good one? Two or three goals is plenty.</Empty>}
      <div className="space-y-3">{list.map(g => <GoalCard key={g.id} goal={g} onEdit={() => setEdit(g)} />)}</div>
      <GoalEditor goal={edit} onClose={() => setEdit(null)} parents={edit ? goals.filter(g => PARENT[edit.horizon] === g.horizon && g.status === "active") : []} />
    </Page>
  );
}

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const goals = useColl("goals");
  const tasks = useColl("tasks");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<{ tasks: string[] } | null>(null);
  const confirm = useConfirm();
  const p = goalProgress(goal, goals, tasks);
  const linked = tasks.filter(t => t.goalId === goal.id && !t.parentId);
  const kids = goals.filter(g => g.parentId === goal.id);
  const parent = goals.find(g => g.id === goal.parentId);
  const suggest = async () => {
    setBusy(true);
    try { setIdeas(await suggestGoalSteps(goal.title + (goal.why ? ` (${goal.why})` : ""), goal.horizon)); setOpen(true); }
    catch (e) { toast(aiProblem(e), { tone: "error" }); }
    setBusy(false);
  };
  return (
    <div className={cx("card p-4", goal.status !== "active" && "opacity-70")}>
      <div className="flex items-start gap-3">
        <button onClick={() => setOpen(o => !o)} className="mt-1 text-muted">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Target size={16} style={{ color: goal.color }} />
            <span className={cx("font-medium", goal.status === "done" && "striked")}>{goal.title}</span>
            {goal.status === "dropped" && <span className="text-xs text-faint">dropped</span>}
          </div>
          {goal.why && <p className="text-sm text-muted mt-0.5">{goal.why}</p>}
          {parent && <p className="text-xs text-faint mt-0.5">Part of: {parent.title}</p>}
          <div className="flex items-center gap-2 mt-2.5">
            <Progress value={p} className="flex-1" />
            <span className="text-xs text-muted tabular w-9 text-right">{p}%</span>
          </div>
          <div className="text-xs text-faint mt-1">{linked.filter(t => t.done).length}/{linked.length} tasks{kids.length ? ` · ${kids.length} smaller goals` : ""}{goal.progress != null ? " · progress set by hand" : ""}</div>
        </div>
        <Popover align="end" trigger={({ toggle }) => <IconBtn label="Goal menu" onClick={toggle}><MoreHorizontal size={17} /></IconBtn>}>
          {close => <>
            <MenuItem icon={<Pencil size={15} />} onClick={() => { onEdit(); close(); }}>Edit</MenuItem>
            <MenuItem icon={<Check size={15} />} onClick={() => { put("goals", goal.id, { status: goal.status === "done" ? "active" : "done" }); close(); }}>{goal.status === "done" ? "Not done yet" : "Mark achieved"}</MenuItem>
            <MenuItem icon={<X size={15} />} onClick={() => { put("goals", goal.id, { status: goal.status === "dropped" ? "active" : "dropped" }); close(); }}>{goal.status === "dropped" ? "Pick back up" : "Let it go"}</MenuItem>
            <MenuItem icon={<Trash2 size={15} />} danger onClick={async () => { close(); if (await confirm({ title: "Delete this goal?", body: "Linked tasks stay; they just won't point at a goal.", ok: "Delete", danger: true })) { remove("goals", goal.id); tasks.filter(t => t.goalId === goal.id).forEach(t => put("tasks", t.id, { goalId: null })); } }}>Delete</MenuItem>
          </>}
        </Popover>
      </div>
      {open && (
        <div className="mt-3 pl-7 fade-up">
          {kids.map(k => <div key={k.id} className="flex items-center gap-2 text-sm py-1"><Target size={13} style={{ color: k.color }} /><span className="flex-1">{k.title}</span><span className="text-xs text-muted">{periodLabel(k.horizon, k.period)} · {goalProgress(k, goals, tasks)}%</span></div>)}
          {linked.filter(t => !t.done).map(t => <TaskRow key={t.id} task={t} />)}
          <InlineAdd defaults={{ goalId: goal.id }} />
          {aiReady() && !ideas && <Button size="sm" variant="ghost" onClick={suggest} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Suggest steps</Button>}
          {ideas && (
            <div className="rounded-xl bg-surface-2 p-3 mt-2 space-y-1">
              <div className="eyebrow">Ideas</div>
              {ideas.tasks.map(x => <div key={x} className="flex items-center gap-2 text-sm"><span className="flex-1">{x}</span><Button size="sm" variant="ghost" onClick={() => { addTask({ title: x, goalId: goal.id }); setIdeas(i => i && { ...i, tasks: i.tasks.filter(y => y !== x) }); }}><Plus size={13} /> Task</Button></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoalEditor({ goal, onClose, parents }: { goal: Goal | null; onClose: () => void; parents: Goal[] }) {
  const [g, setG] = useState<Goal | null>(goal);
  const [last, setLast] = useState(goal);
  if (goal !== last) { setLast(goal); setG(goal); }
  if (!g) return null;
  const set = (p: Partial<Goal>) => setG({ ...g, ...p });
  const save = () => { if (!g.title.trim()) return; create("goals", { ...g, title: g.title.trim() }); onClose(); };
  return (
    <Modal open={!!goal} onClose={onClose} title={goal?.title ? "Edit goal" : "New goal"}>
      <div className="space-y-3">
        <input autoFocus className="field text-lg" placeholder="Run a 10k" value={g.title} onChange={e => set({ title: e.target.value })} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <textarea className="field min-h-16" placeholder="Why it matters (optional)" value={g.why} onChange={e => set({ why: e.target.value })} />
        <div className="flex flex-wrap gap-2 items-center">
          <Segmented size="sm" value={g.horizon} onChange={h => set({ horizon: h, period: currentPeriod(h), parentId: null })} options={HORIZONS} />
          <span className="text-sm text-muted">{periodLabel(g.horizon, g.period)}</span>
        </div>
        {parents.length > 0 && (
          <select className="field" value={g.parentId ?? ""} onChange={e => set({ parentId: e.target.value || null })}>
            <option value="">Not part of a bigger goal</option>
            {parents.map(p => <option key={p.id} value={p.id}>{p.title} ({periodLabel(p.horizon, p.period)})</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={g.progress != null} onChange={e => set({ progress: e.target.checked ? 0 : null })} /> Set progress by hand</label>
        {g.progress != null && <input type="range" min={0} max={100} step={5} value={g.progress} onChange={e => set({ progress: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />}
        <div className="flex flex-wrap gap-1.5">{PALETTE.map(c => <button key={c} aria-label={c} onClick={() => set({ color: c })} className={cx("size-7 rounded-full", g.color === c && "ring-2 ring-offset-2 ring-offset-surface ring-fg")} style={{ background: c }} />)}</div>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!g.title.trim()}>Save</Button></div>
      </div>
    </Modal>
  );
}

