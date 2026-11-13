import { type ButtonHTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" | "soft"; size?: "sm" | "md" };
export function Button({ variant = "outline", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:opacity-50 whitespace-nowrap select-none",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-primary text-on-primary hover:opacity-90",
        variant === "outline" && "border border-border bg-surface hover:bg-surface-2",
        variant === "ghost" && "hover:bg-surface-2 text-fg",
        variant === "soft" && "bg-accent-soft text-accent-strong hover:brightness-95",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function IconBtn({ label, className, children, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button aria-label={label} title={label} {...p} className={cx("inline-grid place-items-center size-9 rounded-full text-muted hover:text-fg hover:bg-surface-2 transition-colors", active && "bg-surface-2 text-fg", className)}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cx("relative h-6 w-10 rounded-full transition-colors flex-none disabled:opacity-50", on ? "bg-accent" : "bg-surface-3")}>
      <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-full bg-surface-2 p-0.5">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-full px-3 transition-colors", size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]", value === o.value ? "bg-surface shadow-soft text-fg font-medium" : "text-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useIsMobile() {
  const q = "(max-width: 767px)";
  return useSyncExternalStore(cb => { const m = matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => matchMedia(q).matches);
}

/** A dialog: centred on desktop, a sheet from the bottom on phones. */
export function Modal({ open, onClose, children, title, wide, bare }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean; bare?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k, true); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-[10vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] pointer-events-none" />
      <div role="dialog" aria-modal="true" className={cx("relative w-full bg-surface shadow-float sheet-up max-h-[88vh] overflow-auto safe-bottom", "rounded-t-3xl md:rounded-2xl", wide ? "md:max-w-3xl" : "md:max-w-lg", "md:mx-4")}>
        {!bare && (
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h2 className="text-2xl">{title}</h2>
            <IconBtn label="Close" onClick={onClose}><X size={18} /></IconBtn>
          </div>
        )}
        <div className={bare ? "" : "px-5 pb-5"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A small floating menu next to its trigger. */
export function Popover({ trigger, children, align = "start", className }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const mobile = useIsMobile();
  useLayoutEffect(() => {
    if (!open || mobile) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const w = panel.current?.offsetWidth ?? 240, h = panel.current?.offsetHeight ?? 200;
      let left = align === "end" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      setPos({ top, left, maxH: innerHeight - top - 12 });
    };
    place();
    const ro = new ResizeObserver(place); if (panel.current) ro.observe(panel.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { ro.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, align, mobile]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", down); window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <span ref={anchor} className="inline-flex">{trigger({ open, toggle: () => setOpen(o => !o) })}</span>
      {open && createPortal(
        mobile ? (
          <div className="fixed inset-0 z-[60] flex items-end" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
            <div className="absolute inset-0 bg-black/30 pointer-events-none" />
            <div ref={panel} className={cx("relative w-full rounded-t-3xl bg-surface p-2 pb-4 shadow-float sheet-up max-h-[80vh] overflow-auto safe-bottom", className)}>{children(close)}</div>
          </div>
        ) : (
          <div ref={panel} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxH }} className={cx("fixed z-[60] min-w-[220px] overflow-auto rounded-2xl border border-border bg-surface p-1.5 shadow-float fade-up", className)}>
            {children(close)}
          </div>
        ),
        document.body,
      )}
    </>
  );
}

export function MenuItem({ icon, children, onClick, active, danger, hint }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; active?: boolean; danger?: boolean; hint?: ReactNode }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2", active && "bg-surface-2 font-medium", danger && "text-danger")}>
      {icon && <span className="text-muted flex-none">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </button>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6 text-muted">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="font-display text-2xl text-fg">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, children, eyebrow }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-4xl md:text-[44px] leading-none truncate">{title}</h1>
        {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-1.5">{children}</div>}
    </header>
  );
}

export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-6", className)}>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <h2 className="eyebrow">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────────
export interface ToastItem { id: number; text: string; action?: { label: string; run: () => void }; sub?: string; tone?: "error" }
let toasts: ToastItem[] = [];
const tsubs = new Set<() => void>();
let tid = 0;
export function toast(text: string, opts: { action?: ToastItem["action"]; sub?: string; tone?: "error"; ms?: number } = {}) {
  const t: ToastItem = { id: ++tid, text, ...opts };
  toasts = [...toasts.slice(-2), t];
  tsubs.forEach(f => f());
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); tsubs.forEach(f => f()); }, opts.ms ?? (opts.action ? 6000 : 3500));
}
export function Toaster() {
  const list = useSyncExternalStore(cb => { tsubs.add(cb); return () => tsubs.delete(cb); }, () => toasts);
  return createPortal(
    <div className="fixed z-[70] left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 flex flex-col items-center gap-2 w-[min(92vw,420px)] pointer-events-none">
      {list.map(t => (
        <div key={t.id} className={cx("pointer-events-auto w-full flex items-center gap-3 rounded-2xl px-4 py-3 shadow-float fade-up", t.tone === "error" ? "bg-danger text-white" : "bg-primary text-on-primary")}>
          <div className="flex-1 min-w-0">
            <div className="text-sm">{t.text}</div>
            {t.sub && <div className="text-xs opacity-70 truncate">{t.sub}</div>}
          </div>
          {t.action && <button className="text-sm font-semibold underline-offset-2 hover:underline" onClick={() => { t.action!.run(); toasts = toasts.filter(x => x.id !== t.id); tsubs.forEach(f => f()); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ── Confirm ────────────────────────────────────────────────────────────────
const ConfirmCtx = createContext<(q: { title: string; body?: string; ok?: string; danger?: boolean }) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState<{ title: string; body?: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (x: { title: string; body?: string; ok?: string; danger?: boolean }) => new Promise<boolean>(resolve => setQ({ ...x, resolve }));
  const done = (v: boolean) => { q?.resolve(v); setQ(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!q} onClose={() => done(false)} title={q?.title}>
        {q?.body && <p className="text-sm text-muted mb-4">{q.body}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => done(false)}>Cancel</Button>
          <Button variant={q?.danger ? "danger" : "primary"} onClick={() => done(true)} autoFocus>{q?.ok ?? "OK"}</Button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-1.5 rounded-full bg-surface-2 overflow-hidden", className)}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full flex-none" style={{ width: size, height: size, background: color }} />;
}
