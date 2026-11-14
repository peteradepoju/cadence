import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bold, Italic, Strikethrough, Heading, List, ListOrdered, ListChecks, Quote, Link2, Code, Pencil, Eye } from "lucide-react";
import { cx } from "./ui";

// Task notes: plain Markdown underneath (so they stay readable in Google Tasks and in exports),
// shown formatted, with a small toolbar for bullets, numbering, checklists and so on.

// ── Rendering ──────────────────────────────────────────────────────────────
const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code first, then links, then emphasis
  const re = /(`[^`]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(~~([^~]+)~~)|(\*([^*\s][^*]*)\*)|(\b_([^_\s][^_]*)_\b)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(SAFE_URL.test(m[4]) ? <a key={k} href={m[4]} target="_blank" rel="noreferrer" className="text-accent-strong underline underline-offset-2">{inline(m[3], k)}</a> : m[0]);
    else if (m[5]) out.push(<strong key={k}>{inline(m[6], k)}</strong>);
    else if (m[7]) out.push(<strong key={k}>{inline(m[8], k)}</strong>);
    else if (m[9]) out.push(<s key={k}>{inline(m[10], k)}</s>);
    else if (m[11]) out.push(<em key={k}>{inline(m[12], k)}</em>);
    else if (m[13]) out.push(<em key={k}>{inline(m[14], k)}</em>);
    else if (m[15]) out.push(<a key={k} href={m[15]} target="_blank" rel="noreferrer" className="text-accent-strong underline underline-offset-2 break-all">{m[15]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/;

/** Renders Markdown notes. `onToggle(line)` makes checklist boxes tickable. */
export function Markdown({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={i} className="rounded-lg bg-surface-2 p-3 font-mono text-[13px] overflow-x-auto whitespace-pre">{body.join("\n")}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const cls = h[1].length === 1 ? "font-display text-[22px]" : h[1].length === 2 ? "font-display text-[19px]" : "font-semibold";
      blocks.push(<div key={i} className={cx(cls, "mt-1")}>{inline(h[2], `h${i}`)}</div>);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(<hr key={i} className="border-border my-1" />); i++; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={i} className="border-l-2 border-border-strong pl-3 text-muted">{body.map((b, k) => <div key={k}>{inline(b, `q${i}-${k}`)}</div>)}</blockquote>);
      continue;
    }
    if (LIST.test(line)) {
      const items: { indent: number; ordered: boolean; check: null | boolean; text: string; line: number }[] = [];
      while (i < lines.length && LIST.test(lines[i])) {
        const m = lines[i].match(LIST)!;
        items.push({ indent: Math.floor(m[1].replace(/\t/g, "  ").length / 2), ordered: /\d/.test(m[2]), check: m[3] ? m[4].toLowerCase() === "x" : null, text: m[5], line: i });
        i++;
      }
      let num = 0;
      blocks.push(
        <div key={i} className="space-y-0.5">
          {items.map(it => {
            if (it.ordered && it.indent === 0) num++;
            return (
              <div key={it.line} className="flex items-start gap-2" style={{ paddingLeft: it.indent * 20 }}>
                {it.check !== null ? (
                  <input type="checkbox" checked={it.check} disabled={!onToggle} onChange={() => onToggle?.(it.line)} onClick={e => e.stopPropagation()}
                    className="mt-[5px] size-4 flex-none accent-[var(--accent)] cursor-pointer" />
                ) : it.ordered ? <span className="min-w-[1.2em] text-muted tabular">{it.indent === 0 ? num : "•"}.</span>
                  : <span className="mt-[9px] size-1.5 flex-none rounded-full bg-fg/60" />}
                <span className={cx("min-w-0", it.check && "line-through text-muted")}>{inline(it.text, `l${it.line}`)}</span>
              </div>
            );
          })}
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^(#{1,3}\s|>|```|-{3,}\s*$)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={i} className="whitespace-pre-wrap break-words">{para.map((p, k) => <span key={k}>{k > 0 && "\n"}{inline(p, `p${i}-${k}`)}</span>)}</p>);
  }
  return <div className="space-y-2 text-[15px] leading-relaxed">{blocks}</div>;
}

/** Ticks or unticks the checklist item on a given line. */
export function toggleCheck(text: string, line: number): string {
  const lines = text.split("\n");
  lines[line] = lines[line].replace(/\[( |x|X)\]/, m => (m === "[ ]" ? "[x]" : "[ ]"));
  return lines.join("\n");
}

// ── Editing ────────────────────────────────────────────────────────────────
type Act = "bold" | "italic" | "strike" | "code" | "h" | "ul" | "ol" | "check" | "quote" | "link";

export function applyFormat(value: string, start: number, end: number, act: Act): { value: string; start: number; end: number } {
  const wrap = (l: string, r = l, placeholder = "text") => {
    const sel = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + l + sel + r + value.slice(end);
    return { value: next, start: start + l.length, end: start + l.length + sel.length };
  };
  if (act === "bold") return wrap("**");
  if (act === "italic") return wrap("*");
  if (act === "strike") return wrap("~~");
  if (act === "code") return wrap("`");
  if (act === "link") {
    const sel = value.slice(start, end) || "link";
    const next = value.slice(0, start) + `[${sel}](https://)` + value.slice(end);
    const urlAt = start + sel.length + 3;
    return { value: next, start: urlAt, end: urlAt + 8 };
  }
  // line formats apply to every selected line
  const ls = value.lastIndexOf("\n", start - 1) + 1;
  let le = value.indexOf("\n", end); if (le < 0) le = value.length;
  const block = value.slice(ls, le).split("\n");
  const strip = (l: string) => l.replace(/^(\s*)([-*+]\s+\[( |x|X)\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?|#{1,3}\s+)/, "$1");
  const has = (l: string) => act === "ul" ? /^\s*[-*+]\s+(?!\[)/.test(l) : act === "ol" ? /^\s*\d+[.)]\s+/.test(l) : act === "check" ? /^\s*[-*+]\s+\[( |x|X)\]/.test(l) : act === "quote" ? /^>\s?/.test(l) : /^#{1,3}\s/.test(l);
  const allHave = block.every(l => !l.trim() || has(l));
  const out = block.map((l, k) => {
    if (!l.trim() && block.length > 1) return l;
    const base = strip(l);
    if (allHave) return base;
    const ind = base.match(/^\s*/)![0], rest = base.slice(ind.length);
    return ind + (act === "ul" ? "- " : act === "ol" ? `${k + 1}. ` : act === "check" ? "- [ ] " : act === "quote" ? "> " : "## ") + rest;
  }).join("\n");
  const next = value.slice(0, ls) + out + value.slice(le);
  return { value: next, start: ls + out.length, end: ls + out.length };
}

/** On Enter inside a list, start the next item (or end the list on an empty item). */
export function continueList(value: string, pos: number): { value: string; pos: number } | null {
  const ls = value.lastIndexOf("\n", pos - 1) + 1;
  const line = value.slice(ls, pos);
  const m = line.match(/^(\s*)([-*+]\s+\[( |x|X)\]\s+|[-*+]\s+|(\d+)([.)])\s+|>\s?)(.*)$/);
  if (!m) return null;
  if (!m[6].trim()) { // empty item: end the list
    const next = value.slice(0, ls) + value.slice(pos);
    return { value: next, pos: ls };
  }
  const marker = m[4] ? `${Number(m[4]) + 1}${m[5]} ` : /\[/.test(m[2]) ? "- [ ] " : m[2].startsWith(">") ? "> " : m[2];
  const ins = "\n" + m[1] + marker;
  return { value: value.slice(0, pos) + ins + value.slice(pos), pos: pos + ins.length };
}

const TOOLS: { act: Act; icon: ReactNode; label: string; key?: string }[] = [
  { act: "bold", icon: <Bold size={15} />, label: "Bold (Ctrl+B)", key: "b" },
  { act: "italic", icon: <Italic size={15} />, label: "Italic (Ctrl+I)", key: "i" },
  { act: "strike", icon: <Strikethrough size={15} />, label: "Strike through" },
  { act: "h", icon: <Heading size={15} />, label: "Heading" },
  { act: "ul", icon: <List size={15} />, label: "Bullet list" },
  { act: "ol", icon: <ListOrdered size={15} />, label: "Numbered list" },
  { act: "check", icon: <ListChecks size={15} />, label: "Checklist" },
  { act: "quote", icon: <Quote size={15} />, label: "Quote" },
  { act: "code", icon: <Code size={15} />, label: "Code" },
  { act: "link", icon: <Link2 size={15} />, label: "Link (Ctrl+K)", key: "k" },
];

/** The notes box: formatted when you're reading it, a Markdown editor with a toolbar when you're writing. */
export function NotesEditor({ value, onSave, placeholder = "Notes, links, details…" }: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(!value.trim());
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => { if (document.activeElement !== ref.current) setText(value); }, [value]);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto"; el.style.height = Math.max(110, el.scrollHeight + 2) + "px";
    if (pending.current) { el.setSelectionRange(pending.current.start, pending.current.end); pending.current = null; }
  }, [text, editing]);
  const save = (v = text) => { if (v !== value) onSave(v); };

  const run = (act: Act) => {
    const el = ref.current; if (!el) return;
    const r = applyFormat(text, el.selectionStart, el.selectionEnd, act);
    pending.current = { start: r.start, end: r.end };
    setText(r.value);
    el.focus();
  };

  if (!editing) {
    return (
      <div className="group relative rounded-xl bg-surface-2/60 p-3 min-h-16 cursor-text" onClick={e => { if (!(e.target as HTMLElement).closest("a,input")) { setEditing(true); setTimeout(() => ref.current?.focus(), 0); } }}>
        {text.trim() ? <Markdown text={text} onToggle={line => { const v = toggleCheck(text, line); setText(v); save(v); }} /> : <span className="text-faint">{placeholder}</span>}
        <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-faint"><Pencil size={14} /></span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface focus-within:border-border-strong">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        {TOOLS.map(t => (
          <button key={t.act} type="button" title={t.label} aria-label={t.label} onMouseDown={e => e.preventDefault()} onClick={() => run(t.act)}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">{t.icon}</button>
        ))}
        <div className="flex-1" />
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { save(); setEditing(false); }}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[13px] text-muted hover:bg-surface-2 hover:text-fg"><Eye size={14} /> Done</button>
      </div>
      <textarea ref={ref} value={text} placeholder={placeholder}
        onChange={e => setText(e.target.value)}
        onBlur={() => { save(); if (text.trim()) setEditing(false); }}
        onKeyDown={e => {
          const el = e.currentTarget;
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            const t = TOOLS.find(x => x.key === e.key.toLowerCase());
            if (t) { e.preventDefault(); run(t.act); return; }
          }
          if (e.key === "Enter" && !e.shiftKey && el.selectionStart === el.selectionEnd) {
            const r = continueList(text, el.selectionStart);
            if (r) { e.preventDefault(); pending.current = { start: r.pos, end: r.pos }; setText(r.value); }
          }
          if (e.key === "Tab" && /^\s*([-*+]|\d+[.)])\s/.test(text.slice(text.lastIndexOf("\n", el.selectionStart - 1) + 1))) {
            e.preventDefault();
            const ls = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
            const pos = el.selectionStart;
            if (e.shiftKey) { if (text.startsWith("  ", ls)) { pending.current = { start: pos - 2, end: pos - 2 }; setText(text.slice(0, ls) + text.slice(ls + 2)); } }
            else { pending.current = { start: pos + 2, end: pos + 2 }; setText(text.slice(0, ls) + "  " + text.slice(ls)); }
          }
          if (e.key === "Escape") { e.stopPropagation(); save(); setEditing(false); }
        }}
        className="block w-full resize-none bg-transparent p-3 text-[15px] leading-relaxed outline-none placeholder:text-faint" />
      <p className="px-3 pb-2 text-[11px] text-faint">Lists keep going when you press Enter · Tab indents · Ctrl+B bold, Ctrl+I italic, Ctrl+K link</p>
    </div>
  );
}
