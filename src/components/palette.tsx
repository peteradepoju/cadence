import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Sun, Inbox, CalendarDays, Timer, Target, NotebookPen, Settings, Plus, Hash, CheckCircle2, CalendarRange, Moon } from "lucide-react";
import { useColl } from "../lib/store";
import { closePalette, openQuickAdd, showShortcuts, useUI } from "../lib/ui-state";
import { Modal, cx, Dot } from "./ui";
import { niceDate } from "../lib/dates";
import { getTheme, setTheme } from "../lib/theme";

interface Item { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; done?: boolean }

export function Palette() {
  const { palette, shortcuts } = useUI();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const tasks = useColl("tasks");
  const projects = useColl("projects");
  const tags = useColl("tags");
  useEffect(() => { if (palette) { setQ(""); setI(0); } }, [palette]);
  const go = (to: string) => () => { nav(to); closePalette(); };
  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { id: "add", label: "Add task", hint: "Q", icon: <Plus size={16} />, run: () => { closePalette(); openQuickAdd(); } },
      { id: "today", label: "Today", hint: "G T", icon: <Sun size={16} />, run: go("/today") },
      { id: "inbox", label: "Unsorted", hint: "G I", icon: <Inbox size={16} />, run: go("/inbox") },
      { id: "up", label: "Upcoming", hint: "G U", icon: <CalendarRange size={16} />, run: go("/upcoming") },
      { id: "cal", label: "Calendar", hint: "G C", icon: <CalendarDays size={16} />, run: go("/calendar") },
      { id: "focus", label: "Focus", hint: "G F", icon: <Timer size={16} />, run: go("/focus") },
      { id: "goals", label: "Goals", hint: "G G", icon: <Target size={16} />, run: go("/goals") },
      { id: "review", label: "Review", hint: "G R", icon: <NotebookPen size={16} />, run: go("/review") },
      { id: "plan", label: "Plan the week", icon: <CalendarRange size={16} />, run: go("/plan") },
      { id: "done", label: "Completed", icon: <CheckCircle2 size={16} />, run: go("/completed") },
      { id: "settings", label: "Settings", hint: "G S", icon: <Settings size={16} />, run: go("/settings") },
      { id: "theme", label: "Switch light / dark", icon: <Moon size={16} />, run: () => { const dark = document.documentElement.dataset.theme === "dark" || (getTheme() === "system" && matchMedia("(prefers-color-scheme: dark)").matches); setTheme(dark ? "light" : "dark"); closePalette(); } },
      { id: "keys", label: "Keyboard shortcuts", hint: "?", icon: <Search size={16} />, run: () => { closePalette(); showShortcuts(true); } },
      ...projects.filter(p => !p.archived).map(p => ({ id: "p" + p.id, label: p.name, hint: "Project", icon: p.emoji ? <span>{p.emoji}</span> : <Dot color={p.color} />, run: go(`/project/${p.id}`) })),
      ...tags.map(t => ({ id: "t" + t.id, label: "#" + t.name, hint: "Tag", icon: <Hash size={16} />, run: go(`/tag/${encodeURIComponent(t.name)}`) })),
    ];
    const s = q.trim().toLowerCase();
    if (!s) return base.slice(0, 12);
    const words = s.split(/\s+/);
    const match = (text: string) => words.every(w => text.toLowerCase().includes(w));
    const found = tasks.filter(t => match(t.title + " " + t.notes + " " + t.tags.join(" "))).sort((a, b) => Number(a.done) - Number(b.done)).slice(0, 30)
      .map(t => ({ id: "x" + t.id, label: t.title, hint: t.done ? "done" : t.due ? niceDate(t.due) : projects.find(p => p.id === t.projectId)?.name ?? "No project", icon: <CheckCircle2 size={16} className={t.done ? "text-accent" : "text-faint"} />, done: t.done, run: () => { closePalette(); nav(`?task=${t.id}`); } }));
    return [...base.filter(b => match(b.label)), ...found];
  }, [q, tasks, projects, tags]);

  return (
    <>
      <Modal open={palette} onClose={closePalette} bare>
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search size={18} className="text-muted" />
          <input autoFocus value={q} onChange={e => { setQ(e.target.value); setI(0); }} placeholder="Search tasks, or jump to…"
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI(x => Math.min(items.length - 1, x + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
              if (e.key === "Enter") items[i]?.run();
            }}
            className="h-14 flex-1 bg-transparent outline-none text-[16px]" />
        </div>
        <div className="max-h-[56vh] overflow-y-auto p-1.5">
          {items.map((it, k) => (
            <button key={it.id} onMouseEnter={() => setI(k)} onClick={it.run} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm", k === i && "bg-surface-2")}>
              <span className="text-muted">{it.icon}</span>
              <span className={cx("flex-1 truncate", it.done && "striked")}>{it.label}</span>
              {it.hint && <span className="text-xs text-faint">{it.hint}</span>}
            </button>
          ))}
          {!items.length && <p className="p-4 text-sm text-muted">Nothing found.</p>}
        </div>
      </Modal>
      <Modal open={shortcuts} onClose={() => showShortcuts(false)} title="Keyboard shortcuts">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {[["Q or N", "Add a task"], ["⌘K or /", "Search and jump"], ["G then T", "Today"], ["G then I", "Unsorted"], ["G then U", "Upcoming"], ["G then C", "Calendar"], ["G then F", "Focus"], ["G then G", "Goals"], ["G then R", "Review"], ["G then S", "Settings"], ["Esc", "Close"], ["?", "This list"]].map(([k, v]) => (
            <div key={k} className="contents"><kbd className="font-mono text-xs text-muted">{k}</kbd><span>{v}</span></div>
          ))}
        </div>
      </Modal>
    </>
  );
}
