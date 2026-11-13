import { memo, useState, type ReactNode } from "react";
import { Check, Repeat, AlignLeft, Paperclip, Bell, GripVertical, ListTree, Target, Clock } from "lucide-react";
import { useSearchParams } from "react-router";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { niceDate, niceTime, today, minutesLabel } from "../lib/dates";
import type { Task } from "../lib/model";
import { toggleTask } from "../lib/actions";
import { useColl } from "../lib/store";
import { cx, Dot, toast } from "./ui";

export function useOpenTask() {
  const [params, setParams] = useSearchParams();
  return (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("task", id); else p.delete("task");
    setParams(p, { replace: !id });
  };
}

export function Tick({ task, size = 20 }: { task: Task; size?: number }) {
  const [just, setJust] = useState(false);
  const color = task.priority < 4 ? `var(--p${task.priority})` : "var(--faint)";
  return (
    <button
      aria-label={task.done ? "Mark not done" : "Mark done"}
      onClick={e => {
        e.stopPropagation();
        setJust(true); setTimeout(() => setJust(false), 300);
        const wasRepeat = !!task.recurrence && !task.done;
        const undo = toggleTask(task.id);
        if (!task.done && undo) toast(wasRepeat ? "Done. See you next time." : "Done", { sub: task.title, action: { label: "Undo", run: undo } });
      }}
      className={cx("check", task.done && "done", just && "just")}
      style={{ color: task.done ? "var(--accent)" : color, width: size, height: size }}
    >
      {task.done && <Check size={size * 0.65} strokeWidth={3} />}
    </button>
  );
}

export function TaskMeta({ task, hideProject, hideDate }: { task: Task; hideProject?: boolean; hideDate?: boolean }) {
  const projects = useColl("projects");
  const tasks = useColl("tasks");
  const goals = useColl("goals");
  const subs = tasks.filter(t => t.parentId === task.id);
  const p = projects.find(x => x.id === task.projectId);
  const g = task.goalId ? goals.find(x => x.id === task.goalId) : undefined;
  const t = today();
  const items: ReactNode[] = [];
  if (task.due && !hideDate) {
    const over = !task.done && task.due < t;
    items.push(<span key="d" className={cx("inline-flex items-center gap-1", over ? "text-danger" : task.due === t ? "text-accent" : "")}>{niceDate(task.due)}{task.time ? ` ${niceTime(task.time)}` : ""}</span>);
  } else if (task.time && hideDate) items.push(<span key="tm" className="inline-flex items-center gap-1"><Clock size={12} />{niceTime(task.time)}</span>);
  if (task.recurrence) items.push(<Repeat key="r" size={12} />);
  if (task.duration) items.push(<span key="du">{minutesLabel(task.duration)}</span>);
  if (subs.length) items.push(<span key="s" className="inline-flex items-center gap-1"><ListTree size={12} />{subs.filter(s => s.done).length}/{subs.length}</span>);
  if (task.notes?.trim()) items.push(<AlignLeft key="n" size={12} />);
  if (task.attachments?.length) items.push(<Paperclip key="a" size={12} />);
  if (task.reminders?.length) items.push(<Bell key="b" size={12} />);
  if (g) items.push(<span key="g" className="inline-flex items-center gap-1"><Target size={12} />{g.title}</span>);
  for (const tag of task.tags) items.push(<span key={"#" + tag} className="text-muted">#{tag}</span>);
  if (p && !hideProject) items.push(<span key="p" className="inline-flex items-center gap-1">{p.emoji || <Dot color={p.color} size={7} />}{p.name}</span>);
  if (!items.length) return null;
  return <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted mt-0.5">{items}</div>;
}

export const TaskRow = memo(function TaskRow({ task, hideProject, hideDate, depth = 0, dragHandle, selected, onSelect }: { task: Task; hideProject?: boolean; hideDate?: boolean; depth?: number; dragHandle?: ReactNode; selected?: boolean; onSelect?: () => void }) {
  const open = useOpenTask();
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => (onSelect ? onSelect() : open(task.id))}
      onKeyDown={e => { if (e.key === "Enter") open(task.id); }}
      className={cx("group flex items-start gap-3 py-2.5 pr-2 rounded-xl hover:bg-surface-2/60 cursor-pointer border-b border-border/70 last:border-b-0", selected && "bg-surface-2")}
      style={{ paddingLeft: 8 + depth * 24 }}
    >
      {dragHandle}
      <div className="pt-0.5"><Tick task={task} /></div>
      <div className="min-w-0 flex-1">
        <div className={cx("text-[15px] leading-snug break-words", task.done && "striked")}>{task.title}</div>
        <TaskMeta task={task} hideProject={hideProject} hideDate={hideDate} />
      </div>
    </div>
  );
});

export function SortableTaskRow(props: Parameters<typeof TaskRow>[0]) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, position: "relative", zIndex: isDragging ? 5 : undefined }}>
      <TaskRow {...props} dragHandle={
        <button {...attributes} {...listeners} onClick={e => e.stopPropagation()} aria-label="Drag to reorder" className="hidden md:block -ml-1 pt-0.5 text-faint opacity-0 group-hover:opacity-100 cursor-grab touch-none">
          <GripVertical size={16} />
        </button>
      } />
    </div>
  );
}
