import { useEffect, useState, type ReactNode } from "react";
import { Cloud, ExternalLink, Loader2, LogOut, RefreshCw, KeyRound, Bell, Upload, Download, Link2, Trash2, Check, Copy, Sparkles, CalendarDays, ListChecks } from "lucide-react";
import { Page } from "../components/shell";
import { Button, PageHeader, Segmented, Toggle, toast, useConfirm } from "../components/ui";
import { all, setSettings, useSettings, replaceAll, applyRemote } from "../lib/store";
import { clientId, connect, dropScope, hasScope, setClientId, signOut, useGoogle } from "../lib/google";
import { forgetSyncMeta, setAutoResume, autoResume, syncNow, useSync } from "../lib/sync";
import { folderUrl } from "../lib/drive";
import { checkKey, KEY_PROBLEM, AI_STUDIO_URL, resetModelSkips, modelsFor } from "../lib/gemini";
import { askPermission, canNotify } from "../lib/notify";
import { backupJson, dateStamp, download, icsFile, importSelah, importTodoist, plainJson, restoreBackup, tasksCsv } from "../lib/io";
import { resetCalendarMarks } from "../lib/gcal";
import { resetGTasksCursors } from "../lib/gtasks";
import { idb } from "../lib/idb";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import type { DataSet } from "../lib/crdt";
import type { Energy } from "../lib/model";

function Card({ title, icon, children, sub }: { title: string; icon?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <section className="card p-5 mb-4">
      <h2 className="text-2xl flex items-center gap-2 mb-1">{icon}{title}</h2>
      {sub && <p className="text-sm text-muted mb-3">{sub}</p>}
      <div className="space-y-3 mt-3">{children}</div>
    </section>
  );
}
function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0"><div className="text-[15px]">{label}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const g = useGoogle();
  const sync = useSync();
  const confirm = useConfirm();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [cid, setCid] = useState(clientId());
  const [key, setKey] = useState(s.aiKey);
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [perm, setPerm] = useState(canNotify() ? Notification.permission : "denied");
  useEffect(() => { if (s.aiKey) modelsFor(s.aiKey).then(setModels).catch(() => {}); }, [s.aiKey]);
  const builtInClient = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const capture = `${location.origin}${import.meta.env.BASE_URL}add?title=`;

  const saveKey = async () => {
    setChecking(true);
    const r = await checkKey(key);
    setChecking(false);
    if (!r.ok) { toast(KEY_PROBLEM[r.reason], { tone: "error", ms: 7000 }); return; }
    resetModelSkips();
    setSettings({ aiKey: key.trim(), aiOn: true });
    toast("Gemini key saved");
  };

  const turnTasks = async (on: boolean) => {
    if (!on) { setSettings({ gtasksOn: false }); dropScope("tasks"); return; }
    if (!(await connect({ add: ["tasks"] })) || !hasScope("tasks")) { toast("Google Tasks wasn't allowed. Tick the Google Tasks box when Google asks.", { tone: "error" }); return; }
    resetGTasksCursors();
    setSettings({ gtasksOn: true });
    void syncNow();
    toast("Google Tasks connected", { sub: "Your Inbox syncs with “My Tasks”, each project with a list of its name." });
  };
  const turnCal = async (on: boolean) => {
    if (!on) { setSettings({ calOn: false }); dropScope("calendar"); return; }
    if (!(await connect({ add: ["calendar"] })) || !hasScope("calendar")) { toast("Google Calendar wasn't allowed.", { tone: "error" }); return; }
    resetCalendarMarks();
    setSettings({ calOn: true });
    void syncNow();
    toast("Google Calendar connected", { sub: "Reminders now reach your phone through the “Cadence” calendar." });
  };
  const turnOthers = async (on: boolean) => {
    if (!on) { setSettings({ calShowOthers: false }); dropScope("calendarRead"); return; }
    if (!(await connect({ add: ["calendarRead"] })) || !hasScope("calendarRead")) { toast("Reading your calendars wasn't allowed.", { tone: "error" }); return; }
    setSettings({ calShowOthers: true });
  };

  const pick = (accept: string, fn: (f: File) => Promise<void>) => {
    const i = document.createElement("input"); i.type = "file"; i.accept = accept;
    i.onchange = () => { const f = i.files?.[0]; if (f) fn(f).catch(e => toast((e as Error).message, { tone: "error" })); };
    i.click();
  };

  return (
    <Page>
      <PageHeader title="Settings" />

      <Card title="Google" icon={<Cloud size={20} />} sub="Cadence keeps your tasks in a “Cadence” folder in your own Google Drive and works offline on each device. Cadence has no server: nothing goes anywhere else.">
        {!builtInClient && (
          <div className="rounded-xl bg-surface-2 p-3 space-y-2">
            <div className="text-sm">Google client ID <span className="text-muted">(this copy of Cadence has none built in; see SETUP.md)</span></div>
            <div className="flex gap-2"><input className="field font-mono text-xs" placeholder="1234-abc.apps.googleusercontent.com" value={cid} onChange={e => setCid(e.target.value)} /><Button onClick={() => { setClientId(cid); toast("Saved"); }}>Save</Button></div>
          </div>
        )}
        {g.account ? (
          <>
            <Row label={g.account.name || g.account.email} hint={g.account.email}>
              <Button size="sm" onClick={async () => { if (await confirm({ title: "Disconnect Google?", body: "Your tasks stay on this device. Other devices keep syncing with Drive.", ok: "Disconnect" })) { signOut(true); forgetSyncMeta(); } }}><LogOut size={14} /> Disconnect</Button>
            </Row>
            <Row label="Drive sync" hint={sync.status === "synced" && sync.at ? `Synced ${new Date(sync.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : sync.status === "paused" ? "Paused until Google is reconnected" : sync.status === "error" ? sync.error : sync.status}>
              <div className="flex gap-1.5">
                {sync.folder && <a className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-border text-[13px] hover:bg-surface-2" href={folderUrl(sync.folder)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Folder</a>}
                <Button size="sm" onClick={() => (sync.status === "paused" ? connect().then(ok => { if (ok) void syncNow(); }) : syncNow())}>{sync.status === "syncing" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {sync.status === "paused" ? "Resume" : "Sync now"}</Button>
              </div>
            </Row>
            <Row label="Resume sync on the next tap" hint="Google's sign-in lasts about an hour. When it runs out, your next tap reconnects (a Google window may flash).">
              <Toggle on={autoResume()} onChange={v => { setAutoResume(v); toast(v ? "On" : "Off"); }} />
            </Row>
            <div className="border-t border-border pt-3" />
            <Row label={<span className="inline-flex items-center gap-1.5"><ListChecks size={16} /> Google Tasks, both ways</span>} hint="Inbox ↔ My Tasks, each project ↔ a list with its name. Lists you make in Google Tasks become projects.">
              <Toggle on={s.gtasksOn && hasScope("tasks")} onChange={turnTasks} />
            </Row>
            <Row label={<span className="inline-flex items-center gap-1.5"><CalendarDays size={16} /> Reminders through Google Calendar</span>} hint="Timed tasks, reminders and time blocks go on a “Cadence” calendar, so your phone alerts you when Cadence is closed. Moving them there moves them here.">
              <Toggle on={s.calOn && hasScope("calendar")} onChange={turnCal} />
            </Row>
            {s.calOn && <Row label="Habit reminders on the calendar" hint="A repeating event at each habit's reminder time."><Toggle on={s.habitCalendar} onChange={v => { setSettings({ habitCalendar: v }); void syncNow(); }} /></Row>}
            <Row label="Show my other calendars" hint="See your events next to your tasks (read only).">
              <Toggle on={s.calShowOthers && hasScope("calendarRead")} onChange={turnOthers} />
            </Row>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => connect({ prompt: "select_account" }).then(ok => { if (ok) void syncNow(); })} disabled={g.busy}>{g.busy ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />} Connect Google Drive</Button>
            <span className="text-sm text-muted">Until then, everything stays on this device.</span>
          </div>
        )}
        {g.error && <p className="text-sm text-danger">{g.error}</p>}
      </Card>

      <Card title="AI" icon={<Sparkles size={20} />} sub={<>Your own free Gemini key: smart capture, breaking tasks down, planning your day and week, and reviews. Calls go from this device straight to Google. <a className="underline" href={AI_STUDIO_URL} target="_blank" rel="noreferrer">Get a key</a>.</>}>
        <div className="flex gap-2">
          <input type="password" className="field font-mono text-sm" placeholder="Paste your Gemini API key" value={key} onChange={e => setKey(e.target.value)} />
          <Button variant="primary" onClick={saveKey} disabled={checking || !key.trim() || key === s.aiKey}>{checking ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Save</Button>
        </div>
        {s.aiKey && (
          <>
            <Row label="Use AI" hint="Off hides every AI button."><Toggle on={s.aiOn} onChange={v => setSettings({ aiOn: v })} /></Row>
            <Row label="Model" hint="Automatic picks the best free model your key can use.">
              <select className="field h-9 py-0 w-[200px]" value={s.aiModel} onChange={e => setSettings({ aiModel: e.target.value })}>
                <option value="">Automatic</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Row>
            <button className="text-sm text-danger" onClick={() => { setSettings({ aiKey: "", aiOn: false }); setKey(""); resetModelSkips(); }}>Remove key</button>
          </>
        )}
        <p className="text-xs text-faint">The key is stored on this device and in your Drive folder, so your other devices have it too. Google's free tier may use what you send to improve its models.</p>
      </Card>

      <Card title="Your day">
        <Row label="Your name"><input className="field h-9 py-0 w-48" value={s.name} onChange={e => setSettings({ name: e.target.value })} placeholder="Optional" /></Row>
        <Row label="Theme"><Segmented size="sm" value={theme} onChange={v => { setTheme(v); setThemeState(v); }} options={[{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></Row>
        <Row label="Week starts on"><Segmented size="sm" value={String(s.weekStart) as "0" | "1"} onChange={v => setSettings({ weekStart: Number(v) as 0 | 1 })} options={[{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }]} /></Row>
        <Row label="Working hours" hint="Shaded on the calendar; used for planning."><div className="flex items-center gap-1"><input type="time" className="field h-9 py-0 w-28" value={s.dayStart} onChange={e => setSettings({ dayStart: e.target.value || "08:00" })} />–<input type="time" className="field h-9 py-0 w-28" value={s.dayEnd} onChange={e => setSettings({ dayEnd: e.target.value || "18:00" })} /></div></Row>
        <Row label="End-of-day review" hint="A nudge to close the day."><input type="time" className="field h-9 py-0 w-28" value={s.reviewTime} onChange={e => setSettings({ reviewTime: e.target.value })} /></Row>
        <Row label="Tasks a day" hint="Today suggests more until this many; planning keeps to it."><input type="number" min={1} max={30} className="field h-9 py-0 w-20" value={s.dailyLimit} onChange={e => setSettings({ dailyLimit: Math.max(1, Number(e.target.value) || 6) })} /></Row>
        <Row label="Default reminder" hint="Added to new tasks with a time.">
          <select className="field h-9 py-0 w-40" value={s.defaultReminder ?? ""} onChange={e => setSettings({ defaultReminder: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">None</option>{[0, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m ? `${m} min before` : "At the time"}</option>)}
          </select>
        </Row>
        <div>
          <div className="text-[15px] mb-1">Your energy through the day</div>
          <div className="grid grid-cols-3 gap-2">
            {(["morning", "afternoon", "evening"] as const).map(p => (
              <label key={p} className="text-xs text-muted space-y-1"><span className="capitalize">{p}</span>
                <select className="field h-9 py-0" value={s.energy[p]} onChange={e => setSettings({ energy: { ...s.energy, [p]: e.target.value as Energy } })}>
                  <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Notifications" icon={<Bell size={20} />} sub="While Cadence is open (or installed), it reminds you itself. When it's closed, Google Calendar does (above).">
        <Row label="Notifications on this device" hint={perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked in your browser settings" : "Not asked yet"}>
          <Button size="sm" disabled={perm !== "default"} onClick={async () => setPerm(await askPermission())}>{perm === "granted" ? <><Check size={14} /> Allowed</> : "Allow"}</Button>
        </Row>
        <Row label="Calendar file" hint="For Apple or Outlook calendars: a one-off .ics of your dated tasks."><Button size="sm" onClick={() => download(icsFile(), `cadence-${dateStamp()}.ics`)}><Download size={14} /> .ics</Button></Row>
      </Card>

      <Card title="Bring tasks in" icon={<Upload size={20} />}>
        <Row label="From Selah" hint="In Selah: Settings → Export → Projects for Cadence. Importing again updates, never duplicates.">
          <Button size="sm" onClick={() => pick(".json,application/json", async f => { const r = importSelah(JSON.parse(await f.text())); toast(`Brought in ${r.projects} projects and ${r.tasks} tasks from Selah`); })}>Choose file</Button>
        </Row>
        <Row label="From Todoist" hint="In Todoist: a project's ⋯ → Export as template → CSV. One file per project.">
          <Button size="sm" onClick={() => pick(".csv,text/csv", async f => { const n = importTodoist(await f.text(), f.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim() || "Todoist"); toast(`Brought in ${n} tasks`); })}>Choose CSV</Button>
        </Row>
        <Row label="From Google Tasks" hint="Turn on Google Tasks above: your lists come in by themselves."><span className="text-xs text-faint">{s.gtasksOn ? "On" : "Off"}</span></Row>
        <Row label="Restore a Cadence backup" hint="Merges with what's here; nothing is lost.">
          <Button size="sm" onClick={() => pick(".json,application/json", async f => { const d = restoreBackup(JSON.parse(await f.text())) as DataSet; const n = applyRemote(d); toast(n ? `Restored ${n} items` : "Nothing new in that backup"); })}>Choose file</Button>
        </Row>
      </Card>

      <Card title="Take everything with you" icon={<Download size={20} />}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => download(backupJson(), `cadence-backup-${dateStamp()}.json`)}>Backup (.json)</Button>
          <Button size="sm" onClick={() => download(plainJson(), `cadence-${dateStamp()}.json`)}>Readable (.json)</Button>
          <Button size="sm" onClick={() => download(tasksCsv(), `cadence-tasks-${dateStamp()}.csv`)}>Tasks (.csv)</Button>
          <Button size="sm" onClick={() => download(icsFile(), `cadence-${dateStamp()}.ics`)}>Calendar (.ics)</Button>
        </div>
      </Card>

      <Card title="Add from other apps" icon={<Link2 size={20} />} sub="Lumen, Selah or anything else can send a task to Cadence by opening a link. It works on any device; the task waits in your Inbox.">
        <div className="rounded-xl bg-surface-2 p-3 font-mono text-[12px] break-all">{capture}<span className="text-muted">Read%2020%20pages</span>&amp;due=today&amp;notes=…&amp;link=…&amp;source=lumen</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { navigator.clipboard?.writeText(capture); toast("Copied"); }}><Copy size={14} /> Copy link</Button>
          <a className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border text-[13px] hover:bg-surface-2" href={`javascript:(()=>{open('${capture}'+encodeURIComponent(document.title)+'&link='+encodeURIComponent(location.href),'_blank')})()`} onClick={e => { e.preventDefault(); toast("Drag this button to your bookmarks bar"); }}>＋ Cadence (bookmarklet)</a>
        </div>
        <p className="text-xs text-faint">Fields: title, notes, due (today, tomorrow, fri, 2026-12-01 …), time, project, tags (comma-separated), priority (1–4), repeat (“every day”), link, source. On a phone you can also share a page to Cadence once it's installed.</p>
      </Card>

      <Card title="This device">
        <Row label="Clear Cadence from this device" hint="Removes the copy here. Your Drive copy and other devices are untouched.">
          <Button size="sm" variant="danger" onClick={async () => {
            if (!(await confirm({ title: "Clear this device?", body: g.account ? "Everything will come back from Drive next time you connect." : "You're not connected to Drive, so this deletes your tasks for good. Export a backup first.", ok: "Clear", danger: true }))) return;
            await idb.clear(); try { Object.keys(localStorage).filter(k => k.startsWith("cadence:")).forEach(k => localStorage.removeItem(k)); } catch {} replaceAll({}); location.reload();
          }}><Trash2 size={14} /> Clear</Button>
        </Row>
        <p className="text-xs text-faint">{all("tasks").length} tasks, {all("projects").length} projects, {all("habits").length} habits on this device · Cadence {__APP_VERSION__} · <a className="underline" href={`${import.meta.env.BASE_URL}privacy.html`}>Privacy</a></p>
      </Card>
    </Page>
  );
}
