import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, CornerDownLeft, Loader2, X } from "lucide-react";
import { addTask, addProject } from "../lib/actions";
import { aiReady, smartCapture, type AiTask } from "../lib/ai";
import { niceDate, niceTime } from "../lib/dates";
import { aiProblem } from "../lib/gemini";
import type { Priority, Rule, Task } from "../lib/model";
import { parseCapture } from "../lib/parse";
import { describeRule } from "../lib/recurrence";
import { all, useColl } from "../lib/store";
import { closeQuickAdd, useUI } from "../lib/ui-state";
import { PriorityChip, ProjectChip, TagChip, WhenChip, type When } from "./pickers";
import { Button, cx, Modal, toast } from "./ui";
import { AddRow } from "./task-list";

function projectIdFor(name: string | null, fallback: string | null): string | null {
  if (!name) return fallback;
  const p = all("projects").find(x => x.name.toLowerCase() === name.toLowerCase());
  return p ? p.id : addProject({ name }).id;
}

function useCapture(defaults: Partial<Task>) {
  const projects = useColl("projects");
  const [text, setText] = useState("");
  const [manual, setManual] = useState<{ when?: Partial<When>; projectId?: string | null; priority?: Priority; tags?: string[] }>({});
  const parsed = useMemo(() => parseCapture(text, { projects: projects.map(p => p.name) }), [text, projects]);
  const when: When = {
    due: manual.when?.due !== undefined ? manual.when.due : parsed.due ?? defaults.due ?? null,
    time: manual.when?.time !== undefined ? manual.when.time : parsed.time ?? defaults.time ?? null,
    recurrence: manual.when?.recurrence !== undefined ? manual.when.recurrence : parsed.recurrence ?? defaults.recurrence ?? null,
    duration: manual.when?.duration !== undefined ? manual.when.duration : parsed.duration ?? defaults.duration ?? null,
  };
  const projectId = manual.projectId !== undefined ? manual.projectId : parsed.project ? (projects.find(p => p.name.toLowerCase() === parsed.project!.toLowerCase())?.id ?? null) : defaults.projectId ?? null;
  const priority = manual.priority ?? parsed.priority ?? defaults.priority ?? 4;
  const tags = [...new Set([...(defaults.tags ?? []), ...parsed.tags, ...(manual.tags ?? [])])];
  const submit = (): Task | null => {
    if (!parsed.title.trim()) return null;
    const pid = manual.projectId !== undefined ? manual.projectId : projectIdFor(parsed.project, defaults.projectId ?? null);
    const t = addTask({ ...defaults, title: parsed.title, due: when.due, time: when.time, recurrence: when.recurrence, duration: when.duration ?? null, projectId: pid, priority, tags });
    setText(""); setManual({});
    return t;
  };
  return { text, setText, parsed, when, projectId, priority, tags, setManual, manual, submit };
}

/** The add box at the bottom of a list. */
export function InlineAdd({ defaults }: { defaults: Partial<Task> }) {
  const [open, setOpen] = useState(false);
  if (!open) return <AddRow onClick={() => setOpen(true)} />;
  return <CaptureBox defaults={defaults} onClose={() => setOpen(false)} inline />;
}

function CaptureBox({ defaults, onClose, inline }: { defaults: Partial<Task>; onClose: () => void; inline?: boolean }) {
  const c = useCapture(defaults);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [ai, setAi] = useState<{ busy: boolean; items: AiTask[] | null }>({ busy: false, items: null });
  const lines = c.text.split(/\n/).map(l => l.trim()).filter(Boolean);
  useEffect(() => { ref.current?.focus(); }, []);

  const add = () => {
    if (lines.length > 1) {
      for (const l of lines) { const p = parseCapture(l, { projects: all("projects").map(x => x.name) }); addTask({ ...defaults, title: p.title, due: p.due ?? defaults.due ?? null, time: p.time, recurrence: p.recurrence, priority: p.priority ?? 4, tags: p.tags, projectId: projectIdFor(p.project, defaults.projectId ?? null), duration: p.duration }); }
      toast(`Added ${lines.length} tasks`); c.setText(""); return;
    }
    const t = c.submit();
    if (t) toast("Added", { sub: t.title + (t.due ? ` · ${niceDate(t.due)}` : "") });
    if (!inline && t) onClose();
  };

  const runAi = async () => {
    if (!c.text.trim()) return;
    setAi({ busy: true, items: null });
    try { setAi({ busy: false, items: await smartCapture(c.text) }); }
    catch (e) { setAi({ busy: false, items: null }); toast(aiProblem(e), { tone: "error" }); }
  };
  const addAi = () => {
    for (const x of ai.items ?? []) addTask({ ...defaults, title: x.title, due: x.due ?? null, time: x.time ?? null, priority: (x.priority ?? 4) as Priority, tags: (x.tags ?? []).map(s => s.toLowerCase()), projectId: projectIdFor(x.project ?? null, defaults.projectId ?? null), duration: x.duration ?? null, recurrence: (x.recurrence as Rule) ?? null, notes: x.notes ?? "" });
    toast(`Added ${ai.items?.length ?? 0} tasks`);
    setAi({ busy: false, items: null }); c.setText("");
    if (!inline) onClose();
  };

  return (
    <div className={cx(inline ? "my-2 rounded-2xl border border-border-strong bg-surface p-3 shadow-soft fade-up" : "")}>
      <textarea ref={ref} rows={1} value={c.text} placeholder="Call mum fri 6pm #family !2"
        onChange={e => { c.setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (ai.items) addAi(); else add(); }
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        }}
        className="w-full resize-none bg-transparent text-[17px] outline-none placeholder:text-faint" />
      {c.parsed.found.length > 0 && lines.length <= 1 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {c.parsed.found.map((f, i) => <span key={i} className="rounded-md bg-accent-soft text-accent-strong px-1.5 py-0.5 text-xs">{f.text}</span>)}
          {c.when.due && <span className="text-xs text-muted py-0.5">→ {niceDate(c.when.due)}{c.when.time ? " " + niceTime(c.when.time) : ""}{c.when.recurrence ? " · " + describeRule(c.when.recurrence) : ""}</span>}
        </div>
      )}
      {lines.length > 1 && <p className="text-xs text-muted mt-1">{lines.length} lines: each becomes its own task.</p>}
      {ai.items && (
        <div className="mt-2 rounded-xl bg-surface-2 p-2 space-y-1">
          <div className="flex items-center justify-between"><span className="eyebrow">AI read it as</span><button aria-label="Discard" onClick={() => setAi({ busy: false, items: null })}><X size={14} /></button></div>
          {ai.items.map((x, i) => (
            <div key={i} className="text-sm flex flex-wrap gap-x-2">
              <span className="font-medium">{x.title}</span>
              <span className="text-muted text-xs self-center">{[x.due && niceDate(x.due), x.time && niceTime(x.time), x.project, ...(x.tags ?? []).map(t => "#" + t), x.recurrence && describeRule(x.recurrence as Rule)].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
          {!ai.items.length && <p className="text-sm text-muted">Nothing to add.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <WhenChip value={c.when} onChange={w => c.setManual(m => ({ ...m, when: { ...m.when, ...w } }))} />
        <ProjectChip value={c.projectId} onChange={id => c.setManual(m => ({ ...m, projectId: id }))} />
        <PriorityChip value={c.priority} onChange={p => c.setManual(m => ({ ...m, priority: p }))} />
        <TagChip value={c.tags} onChange={t => c.setManual(m => ({ ...m, tags: t }))} />
        <div className="flex-1" />
        {aiReady() && (
          <Button size="sm" variant="soft" onClick={runAi} disabled={ai.busy || !c.text.trim()} title="Let AI read it">
            {ai.busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Smart
          </Button>
        )}
        {inline && <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}
        <Button size="sm" variant="primary" onClick={ai.items ? addAi : add} disabled={!c.text.trim()}><CornerDownLeft size={14} /> Add</Button>
      </div>
    </div>
  );
}

/** The quick-add dialog (Q, or the + button). */
export function QuickAddModal() {
  const { quickAdd } = useUI();
  return (
    <Modal open={!!quickAdd} onClose={closeQuickAdd} bare>
      <div className="p-4">
        {quickAdd && <CaptureBox defaults={quickAdd} onClose={closeQuickAdd} />}
        <p className="mt-3 text-[11px] text-faint hidden md:block">Type dates and times naturally · #tag · /Project · !1 urgent … !4 · “every monday” · “for 30m” · paste several lines for several tasks</p>
      </div>
    </Modal>
  );
}
