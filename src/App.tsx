import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { Shell } from "./components/shell";
import { ConfirmProvider, Toaster, toast } from "./components/ui";
import { TaskDrawer } from "./components/task-drawer";
import { QuickAddModal } from "./components/quick-add";
import { Palette } from "./components/palette";
import { Today, Inbox, Upcoming, TagPage, CompletedPage, ArchivePage, rollPlanned } from "./pages/lists";
import { ProjectPage } from "./pages/project";
import { CalendarPage } from "./pages/calendar";
import { HabitsPage } from "./pages/habits";
import { GoalsPage } from "./pages/goals";
import { FocusPage } from "./pages/focus";
import { ReviewPage } from "./pages/review";
import { PlanPage } from "./pages/plan";
import { SettingsPage } from "./pages/settings";
import { CapturePage } from "./pages/capture";
import { openPalette, openQuickAdd, showShortcuts } from "./lib/ui-state";
import { setToaster } from "./lib/notify";
import { setFocusFinishHandler } from "./lib/focus";

function TaskRedirect() {
  const { id } = useParams();
  return <Navigate to={`/today?task=${id}`} replace />;
}

function Keys() {
  const nav = useNavigate();
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (Date.now() - g < 1200) {
        g = 0;
        const to = { t: "/today", i: "/inbox", u: "/upcoming", c: "/calendar", f: "/focus", h: "/habits", g: "/goals", r: "/review", s: "/settings", p: "/plan" }[k];
        if (to) { e.preventDefault(); nav(to); }
        return;
      }
      if (k === "g") { g = Date.now(); return; }
      if (k === "q" || k === "n") { e.preventDefault(); openQuickAdd(); }
      else if (k === "/") { e.preventDefault(); openPalette(); }
      else if (e.key === "?") showShortcuts(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);
  return null;
}

function Wiring() {
  const nav = useNavigate();
  useEffect(() => {
    setToaster((title, body, url) => toast(title, { sub: body, action: url ? { label: "Open", run: () => nav(url) } : undefined, ms: 8000 }));
    setFocusFinishHandler(mode => {
      toast(mode === "focus" ? "Focus round done. Take a break." : "Break's over. Ready?");
      try { if (Notification.permission === "granted" && document.visibilityState !== "visible") new Notification(mode === "focus" ? "Focus round done" : "Break's over", { body: mode === "focus" ? "Take a short break." : "Time to focus." }); } catch {}
    });
    rollPlanned();
    // The installed app's "Add task" shortcut opens /today?add=1.
    if (new URLSearchParams(location.search).get("add") === "1") { openQuickAdd(); history.replaceState(null, "", location.pathname); }
    // From the service worker: a notification was tapped.
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "open" && typeof e.data.url === "string") nav(e.data.url.replace(import.meta.env.BASE_URL, "/")); };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [nav]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <ConfirmProvider>
        <Keys />
        <Wiring />
        <Shell>
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/upcoming" element={<Upcoming />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/project/:id" element={<ProjectPage />} />
            <Route path="/tag/:tag" element={<TagPage />} />
            <Route path="/habits" element={<HabitsPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/focus" element={<FocusPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/completed" element={<CompletedPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/add" element={<CapturePage />} />
            <Route path="/task/:id" element={<TaskRedirect />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </Shell>
        <TaskDrawer />
        <QuickAddModal />
        <Palette />
        <Toaster />
      </ConfirmProvider>
    </BrowserRouter>
  );
}
