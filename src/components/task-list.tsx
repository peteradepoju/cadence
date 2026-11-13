import { useMemo, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent, TouchSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Task } from "../lib/model";
import { put, useColl } from "../lib/store";
import { SortableTaskRow, TaskRow } from "./task-row";
import { InlineAdd } from "./quick-add";
import { cx } from "./ui";

/** Places `moved` between its new neighbours by giving it an order number between theirs. */
export function reorder(list: Task[], activeId: string, overId: string) {
  const from = list.findIndex(t => t.id === activeId), to = list.findIndex(t => t.id === overId);
  if (from < 0 || to < 0 || from === to) return;
  const next = arrayMove(list, from, to);
  const i = next.findIndex(t => t.id === activeId);
  const before = next[i - 1]?.order, after = next[i + 1]?.order;
  let order: number;
  if (before == null) order = (after ?? 0) - 1;
  else if (after == null) order = before + 1;
  else order = (before + after) / 2;
  // Orders that sorted by something else (dates) may collide: renumber the list then.
  if (before != null && after != null && !(before < order && order < after)) next.forEach((t, k) => put("tasks", t.id, { order: k }));
  else put("tasks", activeId, { order });
}

export function TaskList({ tasks, sortable = true, hideProject, hideDate, showSubtasks = true, addDefaults, empty, completed, groupHeader }: {
  tasks: Task[]; sortable?: boolean; hideProject?: boolean; hideDate?: boolean; showSubtasks?: boolean;
  addDefaults?: Partial<Task> | null; empty?: ReactNode; completed?: Task[]; groupHeader?: ReactNode;
}) {
  const all = useColl("tasks");
  const kids = useMemo(() => {
    const m = new Map<string, Task[]>();
    if (showSubtasks) for (const t of all) if (t.parentId && !t.done) { const a = m.get(t.parentId) ?? []; a.push(t); m.set(t.parentId, a); }
    for (const a of m.values()) a.sort((x, y) => x.order - y.order);
    return m;
  }, [all, showSubtasks]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const onEnd = (e: DragEndEvent) => { if (e.over) reorder(tasks, String(e.active.id), String(e.over.id)); };

  const renderTree = (t: Task, depth: number): ReactNode => {
    const children = kids.get(t.id) ?? [];
    const isCollapsed = collapsed.has(t.id);
    return (
      <div key={t.id}>
        <div className="relative">
          {children.length > 0 && (
            <button aria-label={isCollapsed ? "Show subtasks" : "Hide subtasks"} onClick={() => setCollapsed(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
              className="absolute top-3 text-faint hover:text-fg z-[1]" style={{ left: -14 + depth * 24 }}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {depth === 0 && sortable ? <SortableTaskRow task={t} hideProject={hideProject} hideDate={hideDate} /> : <TaskRow task={t} depth={depth} hideProject={hideProject || depth > 0} hideDate={hideDate} />}
        </div>
        {!isCollapsed && children.map(c => renderTree(c, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      {groupHeader}
      {tasks.length === 0 && empty}
      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map(t => renderTree(t, 0))}
          </SortableContext>
        </DndContext>
      ) : tasks.map(t => renderTree(t, 0))}
      {addDefaults !== null && addDefaults !== undefined && <InlineAdd defaults={addDefaults} />}
      {completed && completed.length > 0 && <Completed tasks={completed} hideProject={hideProject} />}
    </div>
  );
}

export function Completed({ tasks, hideProject }: { tasks: Task[]; hideProject?: boolean }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(30);
  const sorted = [...tasks].sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  return (
    <div className="mt-4">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-sm text-muted hover:text-fg px-2 py-1">
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Completed <span className="text-faint tabular">{tasks.length}</span>
      </button>
      {open && <div className="fade-up">{sorted.slice(0, limit).map(t => <TaskRow key={t.id} task={t} hideProject={hideProject} />)}
        {sorted.length > limit && <button className="text-sm text-muted px-3 py-2 hover:text-fg" onClick={() => setLimit(l => l + 50)}>Show more</button>}
      </div>}
    </div>
  );
}

export function AddRow({ onClick, label = "Add task" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className={cx("group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-sm text-muted hover:text-fg")}>
      <span className="grid size-5 place-items-center rounded-full text-accent group-hover:bg-accent group-hover:text-on-primary transition-colors"><Plus size={16} /></span>
      {label}
    </button>
  );
}
