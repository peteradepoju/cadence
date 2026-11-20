import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Blocks, Check, ExternalLink, Flame, Loader2, Lock, Plus, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Empty, PageHeader, Section, Toggle, cx, toast } from "../components/ui";
import { accept, configFor, dailyBudget, dismiss, propose, pull, setConfig, waiting, type Placement } from "../lib/hub/hub";
import { SOURCES, sourceById } from "../lib/hub/sources";
import { aiPlan, type AiPlan } from "../lib/hub/plan-ai";
import { aiReady } from "../lib/ai";
import { aiProblem } from "../lib/gemini";
import { plans } from "../lib/hub/bible";
import type { HubConfig, HubField, HubSource } from "../lib/hub/types";
import { DAY_LONG, minutesLabel, niceDate, today } from "../lib/dates";
import { setSettings, useColl, useSettings } from "../lib/store";

/** Pull once when the hub is opened, and no more than once an hour. */
let lastPull = 0;

export function HubPage() {
  const shelf = useColl("shelf");
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Placement[] | null>(null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [ai, setAi] = useState<{ note: string; dropped: AiPlan["dropped"] } | null>(null);
  const [thinking, setThinking] = useState(false);

  const on = SOURCES.filter(x => configFor(x.id).on);
  const ready = on.filter(x => !x.problem(configFor(x.id)));

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await pull();
      setPlan(propose());
      setDropped(new Set());
      setAi(null);
      if (r.added) toast(`${r.added} new ${r.added === 1 ? "item" : "items"} from your apps`);
    } catch { toast("Couldn't reach one of your apps.", { tone: "error" }); }
    setBusy(false);
  };

  useEffect(() => {
    if (!ready.length) return;
    if (Date.now() - lastPull < 3600_000 && plan) return;
    lastPull = Date.now();
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.length]);

  const open = useMemo(() => waiting(), [shelf]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (plan ?? []).filter(p => open.some(o => o.id === p.shelfId) && !dropped.has(p.shelfId));
  const byDate = useMemo(() => {
    const m = new Map<string, Placement[]>();
    for (const p of shown) m.set(p.date, [...(m.get(p.date) ?? []), p]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const planWithAi = async () => {
    setThinking(true);
    try {
      const r = await aiPlan();
      setPlan(r.placements);
      setDropped(new Set());
      setAi(r.fellBack ? null : { note: r.note, dropped: r.dropped });
      toast(r.fellBack ? "Planned without the AI this time" : `Planned ${r.placements.length}`, r.fellBack ? { tone: "error" } : {});
    } catch (e) { toast(aiProblem(e), { tone: "error" }); }
    setThinking(false);
  };

  const acceptAll = () => {
    let n = 0;
    for (const p of shown) if (accept(p)) n++;
    toast(n ? `${n} added to your plan` : "Nothing to add");
    setPlan(propose());
  };

  if (!on.length) {
    return (
      <Page>
        <PageHeader title="Hub" sub="Your other apps, in one plan." />
        <Empty icon={<Blocks size={28} />} title="No apps connected yet">
          Cadence can work out what your courses and reading plan ask of you each day, and offer it here.
          <div className="mt-4"><Button variant="primary" onClick={() => nav("/settings#hub")}><Settings2 size={15} /> Connect your apps</Button></div>
        </Empty>
      </Page>
    );
  }

  return (
    <Page wide>
      <PageHeader title="Hub" eyebrow={`${ready.length} app${ready.length === 1 ? "" : "s"} connected`}
        sub={shown.length
          ? `${shown.length} of ${open.length} fit the next fortnight at ${minutesLabel(dailyBudget())} a day · nothing is added until you say so`
          : open.length ? `${open.length} waiting, but none of it fits the fortnight ahead. Give the hub more time a day, or turn a course off for now.`
          : "Nothing waiting. Your apps are up to date."}>
        <Button size="sm" onClick={() => void refresh()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check apps</Button>
        {aiReady() && open.length > 0 && (
          <Button size="sm" variant="soft" onClick={() => void planWithAi()} disabled={thinking}>
            {thinking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Plan it for me
          </Button>
        )}
        <Button size="sm" onClick={() => nav("/settings#hub")}><Settings2 size={14} /> Apps</Button>
        {shown.length > 0 && <Button size="sm" variant="primary" onClick={acceptAll}><Check size={14} /> Accept {shown.length}</Button>}
      </PageHeader>

      {ready.length < on.length && (
        <p className="mb-4 text-sm text-warning">
          {on.length - ready.length} app{on.length - ready.length === 1 ? " still needs" : "s still need"} setting up in Settings before {on.length - ready.length === 1 ? "it" : "they"} can offer anything.
        </p>
      )}

      {ai?.note && (
        <p className="mb-4 rounded-xl bg-accent-soft/60 px-4 py-3 text-sm">{ai.note}</p>
      )}

      {!shown.length && !busy && (
        <Empty icon={<Check size={28} />} title="All caught up">Nothing from your apps is waiting on a decision.</Empty>
      )}

      {byDate.map(([date, items]) => {
        const mins = items.reduce((n, p) => n + p.minutes, 0);
        return (
          <Section key={date}
            title={<span>{niceDate(date)}{/^(Today|Tomorrow)$/.test(niceDate(date)) && <span className="text-faint font-normal"> · {DAY_LONG[new Date(date + "T00:00").getDay()]}</span>}</span>}
            right={<span className="text-xs text-faint tabular">{minutesLabel(mins)} of {minutesLabel(dailyBudget())} set aside</span>}>
            {items.map(p => <Proposal key={p.shelfId} p={p} onDrop={() => setDropped(d => new Set(d).add(p.shelfId))} onAccept={() => { accept(p); setPlan(propose()); }} />)}
          </Section>
        );
      })}

      {ai && ai.dropped.length > 0 && (
        <Section title="Not this fortnight" right={<span className="text-xs text-faint">{ai.dropped.length}</span>}>
          <p className="mb-2 text-xs text-muted">Said plainly rather than quietly dropped. These stay on the shelf and can be offered again.</p>
          {ai.dropped.slice(0, 40).map(d => (
            <div key={d.shelfId} className="flex items-baseline gap-3 py-1.5 border-b border-border/50 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-sm text-muted">{d.title}</span>
              <span className="flex-none text-xs text-faint">{d.why}</span>
            </div>
          ))}
        </Section>
      )}
    </Page>
  );
}

function Proposal({ p, onAccept, onDrop }: { p: Placement; onAccept: () => void; onDrop: () => void }) {
  const item = waiting().find(w => w.id === p.shelfId);
  if (!item) return null;
  const source = sourceById(item.sourceId);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/70 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px]">{item.title}</span>
          {item.streak && <span title="Breaks if missed" className="inline-flex items-center gap-1 text-[11px] text-warning"><Flame size={11} />streak</span>}
          {item.dayLock != null && <span title={`Belongs on a ${DAY_LONG[item.dayLock]}`} className="inline-flex items-center gap-1 text-[11px] text-faint"><Lock size={11} />{DAY_LONG[item.dayLock]}s</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted mt-0.5">
          <span>{source?.name ?? item.sourceId}</span>
          <span className="tabular">{minutesLabel(p.minutes)}{item.duration && p.minutes < item.duration ? ` (of ${minutesLabel(item.duration)})` : ""}</span>
          <span className={cx(p.moved && "text-warning")}>{p.why}</span>
          {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-strong hover:underline"><ExternalLink size={11} />open</a>}
        </div>
      </div>
      <div className="flex flex-none gap-1">
        <Button size="sm" variant="ghost" onClick={() => { dismiss(p.shelfId); onDrop(); }} title="Not this time"><X size={14} /></Button>
        <Button size="sm" onClick={onAccept}><Check size={14} /> Add</Button>
      </div>
    </div>
  );
}

// ── Settings: the apps Cadence pulls from ──────────────────────────────────

export function ConnectedApps() {
  const s = useSettings();
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[15px]">Time a day for imported work</div>
            <div className="text-xs text-muted">Your courses alone ask for about fourteen hours a day. The hub claims no more than this and moves the rest to another day, so your own work still has room.</div>
          </div>
          <div className="flex-none flex items-center gap-1.5">
            <input type="number" min={30} max={720} step={30} className="field h-9 py-0 w-20 text-sm"
              value={s.hubDaily ?? 240} onChange={e => setSettings({ hubDaily: Math.max(30, Math.min(720, Number(e.target.value) || 240)) })} />
            <span className="text-xs text-muted">min</span>
          </div>
        </div>
      </div>
      {SOURCES.map(source => <SourceCard key={source.id} source={source} />)}
      <FeedFormat />
    </div>
  );
}

/** What any other app has to serve to join the hub. */
function FeedFormat() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(v => !v)}>
        <span className="min-w-0">
          <span className="block text-[15px]">Add another app</span>
          <span className="block text-xs text-muted">Any app that serves this small JSON document can join the hub.</span>
        </span>
        <Plus size={16} className={cx("flex-none text-muted transition-transform", open && "rotate-45")} />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">Serve it at any address, allow other sites to read it (an <code>access-control-allow-origin</code> header), then paste the address into Selah, Life OS or a new card. Only <code>id</code> and <code>title</code> are required.</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed">{`[
  {
    "id": "loan-7",            // stable: this is what stops duplicates
    "title": "Repay the tailor",
    "due": "2026-11-28",       // optional
    "minutes": 20,             // optional, but the planner needs it to weigh the day
    "url": "https://…",        // optional: opens it back in your app
    "dayLock": 6,              // optional, 0-6: defers a week, not a day
    "streak": false,           // optional: shrink rather than push
    "gate": false,             // optional: blocks the rest of that app
    "priority": 2,             // optional, 1-4
    "project": "Selah",        // optional
    "tags": ["money"],         // optional
    "kind": "payment",         // lesson | review | reading | project | deadline | payment | application
    "done": false              // optional: already finished over there
  }
]`}</pre>
        </div>
      )}
    </div>
  );
}

function SourceCard({ source }: { source: HubSource }) {
  const cfg = configFor(source.id);
  const problem = source.problem(cfg);
  const set = (patch: Partial<HubConfig>) => setConfig(source.id, patch);
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px]">{source.name}</div>
          <div className="text-xs text-muted">{source.blurb}</div>
        </div>
        <Toggle on={!!cfg.on} onChange={v => set({ on: v, ...(v && !cfg.anchorDate && source.needs === "position" ? { anchorDate: today(), week: 1, day: 1 } : {}), ...(v && !cfg.startedAt && source.needs === "plan" ? { startedAt: today() } : {}) })} label={source.name} />
      </div>
      {cfg.on && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {source.fields.map(f => <Field key={String(f.key)} f={f} cfg={cfg} onChange={set} />)}
          </div>
          {problem
            ? <p className="mt-2 text-xs text-warning">{problem}</p>
            : <p className="mt-2 text-xs text-faint">Ready. Its work shows on the Hub.</p>}
        </>
      )}
    </div>
  );
}

function Field({ f, cfg, onChange }: { f: HubField; cfg: HubConfig; onChange: (p: Partial<HubConfig>) => void }) {
  const v = cfg[f.key];
  if (f.type === "plan") {
    return (
      <label className="text-xs text-muted">
        <span className="block mb-1">{f.label}</span>
        <select className="field h-9 py-0 text-sm" value={String(v ?? "")} onChange={e => onChange({ planId: e.target.value })}>
          <option value="">Choose…</option>
          {plans().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="text-xs text-muted">
      <span className="block mb-1">{f.label}</span>
      <input
        className={cx("field h-9 py-0 text-sm", f.type === "number" ? "w-20" : "w-[160px]")}
        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
        min={f.type === "number" ? 1 : undefined}
        value={String(v ?? "")}
        placeholder={f.hint}
        onChange={e => onChange({ [f.key]: f.type === "number" ? Number(e.target.value) || undefined : e.target.value } as Partial<HubConfig>)}
      />
      {f.hint && <span className="block mt-0.5 text-[11px] text-faint max-w-[160px]">{f.hint}</span>}
    </label>
  );
}
