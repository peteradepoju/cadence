import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Check } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Empty } from "../components/ui";
import { addTask, addProject } from "../lib/actions";
import { parseCapture } from "../lib/parse";
import { all, isReady, subscribe } from "../lib/store";
import { niceDate } from "../lib/dates";
import type { Priority } from "../lib/model";

// /add?title=…&notes=…&due=…&time=…&project=…&tags=a,b&priority=1&repeat=every%20day&link=…&source=lumen
// Also the target of "Share to Cadence" on phones (title / text / url).
// The same link opened twice within a minute only adds the task once.

export function CapturePage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [added, setAdded] = useState<{ title: string; due: string | null } | null>(null);
  const once = useRef(false);
  const [ready, setReady] = useState(isReady());
  useEffect(() => (ready ? undefined : subscribe(() => { if (isReady()) setReady(true); })), [ready]);

  useEffect(() => {
    if (!ready || once.current) return;
    once.current = true;
    const text = params.get("text") ?? "";
    const url = params.get("link") ?? params.get("url") ?? (text.match(/https?:\/\/\S+/)?.[0] ?? null);
    const rawTitle = params.get("title") || text.replace(/https?:\/\/\S+/, "").trim() || url || "";
    if (!rawTitle) return;
    const key = `cadence:capture:${rawTitle}:${url}`;
    try { const at = Number(sessionStorage.getItem(key) ?? 0); if (Date.now() - at < 60_000) { setAdded({ title: rawTitle, due: null }); return; } sessionStorage.setItem(key, String(Date.now())); } catch {}
    const when = [params.get("due"), params.get("time"), params.get("repeat")].filter(Boolean).join(" ");
    const p = parseCapture(when ? `x ${when}` : rawTitle, { projects: all("projects").map(x => x.name) });
    const titleParsed = when ? { ...parseCapture(rawTitle), title: rawTitle } : p;
    const projectName = params.get("project");
    const project = projectName ? (all("projects").find(x => x.name.toLowerCase() === projectName.toLowerCase())?.id ?? addProject({ name: projectName }).id) : null;
    const tags = (params.get("tags") ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const pr = Number(params.get("priority"));
    const notes = [params.get("notes") ?? "", text && params.get("title") ? text : ""].filter(Boolean).join("\n\n");
    const t = addTask({
      title: when ? rawTitle : titleParsed.title, notes, due: p.due, time: p.time, recurrence: p.recurrence,
      projectId: project, tags: [...tags, ...(when ? [] : p.tags)], priority: (pr >= 1 && pr <= 4 ? pr : p.priority ?? 4) as Priority,
      link: url, source: params.get("source") ?? (params.has("text") || params.has("url") ? "share" : "link"),
    });
    setAdded({ title: t.title, due: t.due });
  }, [ready, params]);

  return (
    <Page>
      {added ? (
        <Empty icon={<Check size={30} className="text-accent" />} title="Added to Cadence">
          <p>{added.title}{added.due ? ` · ${niceDate(added.due)}` : ""}</p>
          <div className="flex justify-center gap-2 mt-4"><Button variant="primary" onClick={() => nav("/inbox")}>Open Inbox</Button><Button onClick={() => window.close()}>Close</Button></div>
        </Empty>
      ) : <Empty title="Nothing to add">This link adds a task when it has a title: /add?title=Call%20mum</Empty>}
    </Page>
  );
}
