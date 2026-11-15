import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { Sun, Inbox, CalendarDays, CalendarRange, Timer, Target, NotebookPen, Settings, Plus, Hash, Search, Menu, ChevronDown, ChevronRight, Cloud, CloudOff, RefreshCw, AlertCircle, Star, Archive, CheckCircle2 } from "lucide-react";
import { useColl, useSettings } from "../lib/store";
import { isToday, isOverdue, addProject } from "../lib/actions";
import { openPalette, openQuickAdd } from "../lib/ui-state";
import { useSync, syncNow } from "../lib/sync";
import { connect, useGoogle } from "../lib/google";
import { useFocus, remaining } from "../lib/focus";
import { cx, Dot, IconBtn, Modal } from "./ui";
import { pad } from "../lib/dates";

const NAV = [
  { to: "/today", label: "Today", icon: Sun, key: "today" },
  { to: "/inbox", label: "Inbox", icon: Inbox, key: "inbox" },
  { to: "/upcoming", label: "Upcoming", icon: CalendarRange, key: "upcoming" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, key: "calendar" },
  { to: "/focus", label: "Focus", icon: Timer, key: "focus" },
  { to: "/goals", label: "Goals", icon: Target, key: "goals" },
  { to: "/review", label: "Review", icon: NotebookPen, key: "review" },
];

function useCounts() {
  const tasks = useColl("tasks");
  return {
    today: tasks.filter(t => !t.parentId && isToday(t)).length,
    overdue: tasks.filter(t => !t.parentId && isOverdue(t)).length,
    inbox: tasks.filter(t => !t.done && !t.projectId && !t.parentId).length,
  };
}

export function SyncBadge({ compact }: { compact?: boolean }) {
  const s = useSync();
  const g = useGoogle();
  const nav = useNavigate();
  if (!g.account) return compact ? null : (
    <button onClick={() => nav("/settings")} className="flex items-center gap-2 text-xs text-muted hover:text-fg px-2 py-1.5 rounded-lg hover:bg-surface-2 w-full">
      <CloudOff size={14} /> On this device only
    </button>
  );
  const map = {
    off: { icon: <CloudOff size={14} />, text: "Sync off" },
    syncing: { icon: <RefreshCw size={14} className="animate-spin" />, text: `Syncing${s.detail ? " " + s.detail : ""}…` },
    synced: { icon: <Cloud size={14} />, text: "Synced" },
    paused: { icon: <AlertCircle size={14} className="text-warning" />, text: "Tap to resume sync" },
    offline: { icon: <CloudOff size={14} />, text: "Offline · saved on device" },
    error: { icon: <AlertCircle size={14} className="text-danger" />, text: "Sync problem" },
  }[s.status];
  return (
    <button title={s.error ?? undefined}
      onClick={() => { if (s.status === "paused") void connect().then(ok => { if (ok) void syncNow(); }); else if (s.status === "error") nav("/settings"); else void syncNow(); }}
      className={cx("flex items-center gap-2 text-xs text-muted hover:text-fg rounded-lg hover:bg-surface-2", compact ? "p-2" : "px-2 py-1.5 w-full")}>
      {map.icon}{!compact && <span className="truncate">{map.text}</span>}
    </button>
  );
}

function FocusPill() {
  const f = useFocus();
  const nav = useNavigate();
  const loc = useLocation();
  if (!f.running || loc.pathname === "/focus") return null;
  const left = remaining();
  return (
    <button onClick={() => nav("/focus")} className="fixed z-30 right-4 bottom-24 md:bottom-6 md:right-6 flex items-center gap-2 rounded-full bg-primary text-on-primary pl-3 pr-4 h-10 shadow-float tabular text-sm">
      <Timer size={16} /> {f.mode === "focus" ? "Focus" : "Break"} {Math.floor(left / 60)}:{pad(left % 60)}
    </button>
  );
}

function Sidebar() {
  const counts = useCounts();
  const projects = useColl("projects").filter(p => !p.archived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
  const archived = useColl("projects").filter(p => p.archived);
  const tags = useColl("tags");
  const tasks = useColl("tasks");
  const usedTags = tags.filter(t => tasks.some(x => !x.done && x.tags.includes(t.name)));
  const [showProjects, setShowProjects] = useState(true);
  const [showTags, setShowTags] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const nav = useNavigate();
  const s = useSettings();
  const link = (active: boolean) => cx("flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[14px] transition-colors", active ? "bg-surface-2 text-fg font-medium" : "text-muted hover:text-fg hover:bg-surface-2/70");
  return (
    <nav className="hidden md:flex flex-col w-[248px] flex-none h-screen sticky top-0 border-r border-border bg-bg px-3 py-4 overflow-y-auto no-scrollbar">
      <div className="flex items-center justify-between px-2 mb-4">
        <NavLink to="/today" className="font-display text-[28px] leading-none tracking-tight">Cadence</NavLink>
        <div className="flex">
          <IconBtn label="Search (⌘K)" onClick={openPalette}><Search size={17} /></IconBtn>
        </div>
      </div>
      <button onClick={() => openQuickAdd()} className="mb-3 flex items-center gap-2 rounded-full bg-primary text-on-primary h-10 px-4 text-sm font-medium hover:opacity-90">
        <Plus size={17} /> Add task <span className="ml-auto text-[11px] opacity-60">Q</span>
      </button>
      <div className="space-y-0.5">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => link(isActive)}>
            <n.icon size={17} strokeWidth={1.8} /> <span className="flex-1">{n.label}</span>
            {n.key === "today" && counts.today > 0 && <span className={cx("text-xs tabular", counts.overdue ? "text-danger" : "text-faint")}>{counts.today}</span>}
            {n.key === "inbox" && counts.inbox > 0 && <span className="text-xs tabular text-faint">{counts.inbox}</span>}
          </NavLink>
        ))}
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between px-2.5 mb-1">
          <button className="eyebrow flex items-center gap-1 hover:text-fg" onClick={() => setShowProjects(v => !v)}>{showProjects ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Projects</button>
          <IconBtn label="New project" className="size-7" onClick={() => setNaming("")}><Plus size={15} /></IconBtn>
        </div>
        {showProjects && (
          <div className="space-y-0.5">
            {naming !== null && (
              <input autoFocus className="field h-8 py-0 text-sm" placeholder="Project name" value={naming} onChange={e => setNaming(e.target.value)}
                onBlur={() => setNaming(null)}
                onKeyDown={e => { if (e.key === "Enter" && naming.trim()) { const p = addProject({ name: naming.trim() }); setNaming(null); nav(`/project/${p.id}`); } if (e.key === "Escape") setNaming(null); }} />
            )}
            {projects.map(p => {
              const n = tasks.filter(t => t.projectId === p.id && !t.done && !t.parentId).length;
              return (
                <NavLink key={p.id} to={`/project/${p.id}`} className={({ isActive }) => link(isActive)}>
                  <span className="w-[17px] grid place-items-center">{p.emoji || <Dot color={p.color} size={9} />}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.favorite && <Star size={11} className="text-faint" />}
                  {n > 0 && <span className="text-xs tabular text-faint">{n}</span>}
                </NavLink>
              );
            })}
            {!projects.length && naming === null && <p className="px-2.5 text-xs text-faint">Group tasks into projects with the +.</p>}
            {archived.length > 0 && <NavLink to="/archive" className={({ isActive }) => link(isActive)}><Archive size={15} /> <span className="flex-1">Archived</span><span className="text-xs text-faint">{archived.length}</span></NavLink>}
          </div>
        )}
      </div>
      {usedTags.length > 0 && (
        <div className="mt-4">
          <button className="eyebrow flex items-center gap-1 px-2.5 mb-1 hover:text-fg" onClick={() => setShowTags(v => !v)}>{showTags ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Tags</button>
          {showTags && usedTags.sort((a, b) => a.name.localeCompare(b.name)).map(t => (
            <NavLink key={t.id} to={`/tag/${encodeURIComponent(t.name)}`} className={({ isActive }) => link(isActive)}><Hash size={15} style={{ color: t.color }} /> {t.name}</NavLink>
          ))}
        </div>
      )}
      <div className="flex-1" />
      <div className="mt-4 space-y-0.5 border-t border-border pt-3">
        <NavLink to="/completed" className={({ isActive }) => link(isActive)}><CheckCircle2 size={17} strokeWidth={1.8} /> Completed</NavLink>
        <NavLink to="/settings" className={({ isActive }) => link(isActive)}><Settings size={17} strokeWidth={1.8} /> Settings</NavLink>
        <SyncBadge />
        {s.name && <p className="px-2 pt-1 text-[11px] text-faint truncate">{s.name}</p>}
      </div>
    </nav>
  );
}

function MobileNav() {
  const counts = useCounts();
  const [more, setMore] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);
  const projects = useColl("projects").filter(p => !p.archived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
  const tab = (to: string, label: string, Icon: typeof Sun, badge?: number) => (
    <NavLink to={to} className={({ isActive }) => cx("flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1 text-[11px]", isActive ? "text-fg" : "text-muted")}>
      <span className="relative"><Icon size={21} strokeWidth={1.8} />{!!badge && <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-accent text-[10px] text-white grid place-items-center tabular">{badge}</span>}</span>{label}
    </NavLink>
  );
  return (
    <>
      <button aria-label="Add task" onClick={() => openQuickAdd()} className="md:hidden fixed z-30 right-4 bottom-[76px] size-14 rounded-full bg-primary text-on-primary shadow-float grid place-items-center" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
        <Plus size={26} />
      </button>
      <nav className="md:hidden fixed z-30 inset-x-0 bottom-0 border-t border-border bg-bg/95 backdrop-blur safe-bottom flex">
        {tab("/today", "Today", Sun, counts.today)}
        {tab("/inbox", "Inbox", Inbox, counts.inbox)}
        {tab("/calendar", "Calendar", CalendarDays)}
        {tab("/goals", "Goals", Target)}
        <button onClick={() => setMore(true)} className="flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] text-muted"><Menu size={21} strokeWidth={1.8} />More</button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="Cadence">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[...NAV.filter(n => !["today", "inbox", "calendar", "goals"].includes(n.key)), { to: "/completed", label: "Completed", icon: CheckCircle2 }, { to: "/settings", label: "Settings", icon: Settings }].map(n => (
            <button key={n.to} onClick={() => nav(n.to)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 py-3 text-sm"><n.icon size={20} strokeWidth={1.8} />{n.label}</button>
          ))}
          <button onClick={() => { setMore(false); openPalette(); }} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 py-3 text-sm"><Search size={20} strokeWidth={1.8} />Search</button>
        </div>
        <div className="eyebrow mb-1 px-1">Projects</div>
        {projects.map(p => <button key={p.id} onClick={() => nav(`/project/${p.id}`)} className="flex w-full items-center gap-2.5 px-2 py-2.5 text-[15px] border-b border-border/60"><span className="w-5 grid place-items-center">{p.emoji || <Dot color={p.color} size={9} />}</span>{p.name}</button>)}
        <button onClick={() => { const name = prompt("Project name"); if (name?.trim()) nav(`/project/${addProject({ name: name.trim() }).id}`); }} className="flex w-full items-center gap-2.5 px-2 py-2.5 text-[15px] text-muted"><Plus size={18} /> New project</button>
        <div className="mt-3"><SyncBadge /></div>
      </Modal>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 pb-28 md:pb-10">
        <div className="md:hidden flex items-center justify-between px-4 pt-3 safe-top">
          <span className="font-display text-2xl">Cadence</span>
          <div className="flex items-center"><SyncBadge compact /><IconBtn label="Search" onClick={openPalette}><Search size={19} /></IconBtn></div>
        </div>
        {children}
      </main>
      <MobileNav />
      <FocusPill />
    </div>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx("mx-auto px-4 md:px-10 pt-4 md:pt-10", wide ? "max-w-[1200px]" : "max-w-[760px]")}>{children}</div>;
}
