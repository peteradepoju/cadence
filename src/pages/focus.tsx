import { useEffect, useMemo, useState } from "react";
import { Play, Pause, RotateCcw, SkipForward, Timer, Check, Maximize2, X, BellOff, Volume2, Smartphone, ExternalLink } from "lucide-react";
import { Page } from "../components/shell";
import { Button, PageHeader, Section, Segmented, cx, IconBtn, Modal, Toggle, toast } from "../components/ui";
import { primeSound, testPhone, unsilencePhone } from "../lib/phone";
import { Tick } from "../components/task-row";
import { addDays, DAY_SHORT, dayOfWeek, minutesLabel, niceDate, pad, today } from "../lib/dates";
import { focusState, pause, remaining, reset, setTask, skip, start, useFocus, type Mode } from "../lib/focus";
import { byDue, isToday } from "../lib/actions";
import { useColl, useSettings, setSettings, get } from "../lib/store";

export function FocusPage() {
  const f = useFocus();
  const s = useSettings();
  const tasks = useColl("tasks");
  const sessions = useColl("sessions");
  const task = f.taskId ? get("tasks", f.taskId) : undefined;
  const left = remaining();
  const pct = f.total ? 1 - left / f.total : 0;
  const R = 120, C = 2 * Math.PI * R;
  const candidates = useMemo(() => tasks.filter(t => !t.done && !t.parentId && (isToday(t) || t.priority < 3)).sort(byDue).slice(0, 12), [tasks]);
  const t = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const minutesOn = (d: string) => sessions.filter(x => x.kind === "focus" && x.start.slice(0, 10) === d).reduce((a, x) => a + x.minutes, 0);
  const max = Math.max(25, ...week.map(minutesOn));
  const todays = sessions.filter(x => x.kind === "focus" && x.start.slice(0, 10) === t);
  const [zen, setZen] = useState(false);
  const [setup, setSetup] = useState(false);
  const go = () => { primeSound(); start(); };
  const phoneReady = !!(s.phoneOnUrl && s.phoneOffUrl);
  return (
    <Page>
      <PageHeader title="Focus" sub={f.mode === "focus" ? `Round ${f.round}` : f.mode === "long" ? "Long break" : "Short break"} />
      <div className="flex flex-col items-center">
        <Segmented value={f.mode} onChange={(m: Mode) => reset(m)} options={[{ value: "focus", label: `Focus ${s.focusMinutes}` }, { value: "break", label: `Break ${s.breakMinutes}` }, { value: "long", label: `Long ${s.longBreakMinutes}` }]} />
        <div className="relative my-8" style={{ width: 2 * R + 24, height: 2 * R + 24 }}>
          <svg width={2 * R + 24} height={2 * R + 24} className="-rotate-90">
            <circle cx={R + 12} cy={R + 12} r={R} fill="none" strokeWidth={6} className="ring-track" />
            <circle cx={R + 12} cy={R + 12} r={R} fill="none" strokeWidth={6} strokeLinecap="round" className="ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={f.mode !== "focus" ? { stroke: "var(--p3)" } : undefined} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="font-display text-[72px] leading-none tabular">{Math.floor(left / 60)}:{pad(left % 60)}</div>
              <div className="text-sm text-muted mt-2 max-w-[200px] truncate">{task ? task.title : f.mode === "focus" ? "No task picked" : "Breathe"}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconBtn label="Reset" onClick={() => reset()}><RotateCcw size={18} /></IconBtn>
          {f.running
            ? <Button variant="primary" className="h-12 px-8 text-base" onClick={pause}><Pause size={18} /> Pause</Button>
            : <Button variant="primary" className="h-12 px-8 text-base" onClick={go}><Play size={18} /> {f.startedAt ? "Resume" : "Start"}</Button>}
          <IconBtn label="Skip" onClick={skip}><SkipForward size={18} /></IconBtn>
          <IconBtn label="Full screen" onClick={() => { primeSound(); setZen(true); }}><Maximize2 size={18} /></IconBtn>
        </div>
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          {phoneReady ? (
            <button onClick={() => { setSettings({ phoneSilence: !s.phoneSilence }); if (s.phoneSilence) unsilencePhone(true); }}
              className={cx("inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[13px]", s.phoneSilence ? "border-transparent bg-accent-soft text-accent-strong" : "border-border text-muted")}>
              <BellOff size={15} /> {s.phoneSilence ? "Phone goes silent during focus" : "Silence my phone during focus"}
            </button>
          ) : (
            <button onClick={() => setSetup(true)} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-dashed border-border-strong text-[13px] text-muted hover:text-fg">
              <Smartphone size={15} /> Set up phone silencing
            </button>
          )}
          <button onClick={() => setSettings({ focusChime: !s.focusChime })}
            className={cx("inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[13px]", s.focusChime ? "border-transparent bg-accent-soft text-accent-strong" : "border-border text-muted")}>
            <Volume2 size={15} /> {s.focusChime ? "Chime and vibrate at the end" : "No chime"}
          </button>
          {phoneReady && <button onClick={() => setSetup(true)} className="text-[12px] text-faint hover:text-fg px-2">Phone setup</button>}
        </div>
      </div>

      <Section title="Working on" className="mt-10">
        <div className="space-y-1">
          <button onClick={() => setTask(null)} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-left", !f.taskId ? "bg-surface-2" : "hover:bg-surface-2/60")}><Timer size={16} className="text-muted" /> Just focus</button>
          {candidates.map(x => (
            <div key={x.id} role="button" tabIndex={0} onClick={() => setTask(x.id)} onKeyDown={e => { if (e.key === "Enter") setTask(x.id); }} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left cursor-pointer", f.taskId === x.id ? "bg-surface-2" : "hover:bg-surface-2/60")}>
              <Tick task={x} size={18} /><span className="flex-1 text-sm truncate">{x.title}</span>
              {f.taskId === x.id && <Check size={15} className="text-accent" />}
              <span className="text-xs text-faint">{x.due ? niceDate(x.due) : ""}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Focused today · ${minutesLabel(todays.reduce((a, x) => a + x.minutes, 0))}`}>
        <div className="flex items-end gap-2 h-28 card p-3">
          {week.map(d => (
            <div key={d} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <div className="w-full max-w-8 rounded-md bg-accent/80" style={{ height: `${(minutesOn(d) / max) * 100}%`, minHeight: minutesOn(d) ? 4 : 0 }} title={minutesLabel(minutesOn(d))} />
              <span className={cx("text-[10px]", d === t ? "text-fg" : "text-muted")}>{DAY_SHORT[dayOfWeek(d)].slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Timer lengths">
        <div className="card p-4 grid grid-cols-3 gap-3 text-sm">
          {([["focusMinutes", "Focus"], ["breakMinutes", "Break"], ["longBreakMinutes", "Long break"]] as const).map(([k, label]) => (
            <label key={k} className="space-y-1"><span className="text-muted text-xs">{label} (min)</span>
              <input type="number" min={1} max={180} className="field" value={s[k]} onChange={e => { setSettings({ [k]: Math.max(1, Number(e.target.value) || 1) }); if (!f.running) reset(); }} />
            </label>
          ))}
        </div>
      </Section>
      {zen && <Zen onClose={() => setZen(false)} />}
      <PhoneSetup open={setup} onClose={() => setSetup(false)} />
    </Page>
  );
}

/** Keeps the screen on while a round runs (where the browser allows it). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null, live = true;
    const get = () => navigator.wakeLock.request("screen").then(l => { if (live) lock = l; else void l.release(); }).catch(() => {});
    void get();
    const again = () => { if (document.visibilityState === "visible") void get(); };
    document.addEventListener("visibilitychange", again);
    return () => { live = false; document.removeEventListener("visibilitychange", again); void lock?.release(); };
  }, [on]);
}

/** Full screen: just the time, the task and one button. */
function Zen({ onClose }: { onClose: () => void }) {
  const f = useFocus();
  const task = f.taskId ? get("tasks", f.taskId) : undefined;
  const left = remaining();
  useWakeLock(true);
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => {});
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === " ") { e.preventDefault(); if (focusRunning()) pause(); else start(); } };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  }, [onClose]);
  const pct = f.total ? 1 - left / f.total : 0;
  return (
    <div className="fixed inset-0 z-[80] bg-bg flex flex-col items-center justify-center px-6 select-none">
      <button aria-label="Leave full screen" onClick={onClose} className="absolute top-5 right-5 size-11 grid place-items-center rounded-full text-muted hover:bg-surface-2"><X size={22} /></button>
      <div className="eyebrow mb-4">{f.mode === "focus" ? `Focus · round ${f.round}` : f.mode === "long" ? "Long break" : "Break"}</div>
      <div className="font-display tabular leading-none text-[min(34vw,220px)]">{Math.floor(left / 60)}:{pad(left % 60)}</div>
      <div className="mt-6 text-lg text-muted text-center max-w-md">{task ? task.title : f.mode === "focus" ? "One thing at a time." : "Stand up, breathe, look far away."}</div>
      <div className="w-[min(80vw,420px)] h-1 rounded-full bg-surface-2 mt-10 overflow-hidden"><div className="h-full bg-accent transition-all duration-1000" style={{ width: `${pct * 100}%`, background: f.mode !== "focus" ? "var(--p3)" : undefined }} /></div>
      <div className="mt-10 flex gap-3">
        {f.running ? <Button variant="outline" className="h-12 px-8" onClick={pause}><Pause size={18} /> Pause</Button> : <Button variant="primary" className="h-12 px-8" onClick={() => start()}><Play size={18} /> {f.startedAt ? "Resume" : "Start"}</Button>}
        <Button variant="ghost" className="h-12" onClick={skip}><SkipForward size={18} /> Skip</Button>
      </div>
    </div>
  );
}
const focusRunning = () => focusState().running;

function PhoneSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const [on, setOn] = useState(s.phoneOnUrl);
  const [off, setOff] = useState(s.phoneOffUrl);
  useEffect(() => { if (open) { setOn(s.phoneOnUrl); setOff(s.phoneOffUrl); } }, [open, s.phoneOnUrl, s.phoneOffUrl]);
  const valid = (u: string) => /^https:\/\/\S+$/.test(u.trim());
  const save = () => { setSettings({ phoneOnUrl: on.trim(), phoneOffUrl: off.trim(), phoneSilence: true }); toast("Saved. Your phone goes silent when a focus round starts."); onClose(); };
  const test = async (which: "on" | "off") => { setSettings({ phoneOnUrl: on.trim(), phoneOffUrl: off.trim() }); const ok = await testPhone(which); toast(ok ? (which === "on" ? "Sent. Your phone should be on Do Not Disturb now." : "Sent. Do Not Disturb should be off.") : "Couldn't send it. Check the link and your connection.", { tone: ok ? undefined : "error" }); };
  return (
    <Modal open={open} onClose={onClose} title="Silence your Android phone" wide>
      <div className="space-y-4 text-[14px]">
        <p className="text-muted">A website can't switch Do Not Disturb itself, so Cadence asks <b>MacroDroid</b> (free) to do it. One-time setup, about five minutes. Afterwards, starting focus on any device, your PC included, silences the phone; ending, pausing or skipping turns it back on.</p>
        <ol className="list-decimal pl-5 space-y-2.5">
          <li>Install <a className="underline" href="https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid" target="_blank" rel="noreferrer">MacroDroid <ExternalLink size={12} className="inline" /></a> from the Play Store and open it. When it asks, allow <b>Do Not Disturb access</b>.</li>
          <li><b>Add Macro</b> → Triggers <b>+</b> → <b>Connectivity → Webhook (URL)</b>. Name it <code className="font-mono text-xs bg-surface-2 px-1 rounded">cadence-focus-on</code>. MacroDroid shows a link starting <code className="font-mono text-xs bg-surface-2 px-1 rounded">https://trigger.macrodroid.com/…</code>. Copy it.</li>
          <li>Actions <b>+</b> → <b>Volume → Priority Mode / Do Not Disturb</b> → choose <b>Allow Priority Notifications</b> (calls from starred contacts still ring) or <b>Block all</b>. <span className="text-muted">Optional safety: add <b>Wait before next action</b> (your focus length, e.g. 25 min) then another Do Not Disturb action set to <b>Allow All</b>, so the phone un-silences on time even if the browser is asleep.</span> Save the macro as “Cadence focus on”.</li>
          <li>Make a second macro the same way with a webhook named <code className="font-mono text-xs bg-surface-2 px-1 rounded">cadence-focus-off</code> and the action Do Not Disturb → <b>Allow All</b>. Save it as “Cadence focus off” and copy its link.</li>
          <li>Paste both links below, then tap <b>Test</b> on each.</li>
        </ol>
        <label className="block"><span className="text-xs text-muted">Link that turns Do Not Disturb ON</span>
          <div className="flex gap-2 mt-1"><input className="field font-mono text-xs" placeholder="https://trigger.macrodroid.com/…/cadence-focus-on" value={on} onChange={e => setOn(e.target.value)} /><Button size="sm" disabled={!valid(on)} onClick={() => test("on")}>Test</Button></div>
        </label>
        <label className="block"><span className="text-xs text-muted">Link that turns it OFF</span>
          <div className="flex gap-2 mt-1"><input className="field font-mono text-xs" placeholder="https://trigger.macrodroid.com/…/cadence-focus-off" value={off} onChange={e => setOff(e.target.value)} /><Button size="sm" disabled={!valid(off)} onClick={() => test("off")}>Test</Button></div>
        </label>
        <p className="text-xs text-faint">The links are saved in your Drive folder, so every device you use Cadence on can trigger them. Each round sends <code className="font-mono">?minutes=25&amp;until=…</code>, which you can use in MacroDroid if you like. Pairs well with Android's own <b>Focus mode</b> (Settings → Digital Wellbeing) to pause distracting apps on the same schedule.</p>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><Toggle on={s.phoneSilence} onChange={v => setSettings({ phoneSilence: v })} /> Silence the phone during focus</label>
          <div className="flex gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid(on) || !valid(off)} onClick={save}>Save</Button></div>
        </div>
      </div>
    </Modal>
  );
}
