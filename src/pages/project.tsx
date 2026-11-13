import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable, type DragEndEvent, closestCorners, DragOverlay, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { List, Columns3, MoreHorizontal, Star, Archive, Trash2, Pencil, Plus, GripVertical, X, ArrowDownUp } from "lucide-react";
import { Page } from "../components/shell";
import { TaskList } from "../components/task-list";
import { TaskMeta, Tick, useOpenTask } from "../components/task-row";
import { Button, Empty, IconBtn, MenuItem, Modal, PageHeader, Popover, Segmented, cx, useConfirm, toast, Dot } from "../components/ui";
import { InlineAdd } from "../components/quick-add";
import { byDue, byOrder, byPriority, deleteProject, setColumn } from "../lib/actions";
import { PALETTE, uid, type Column, type Project, type Task } from "../lib/model";
import { put, useColl, useRec } from "../lib/store";

type Sort = "manual" | "due" | "priority";

export function ProjectPage() {
  const { id = "" } = useParams();
  const project = useRec("projects", id);
  const tasks = useColl("tasks");
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState<Sort>("manual");
  const confirm = useConfirm();
  const nav = useNavigate();
  if (!project) return <Page><Empty title="Project not found">It may have been deleted on another device.</Empty></Page>;
  const mine = tasks.filter(t => t.projectId === id && !t.parentId);
  const open = mine.filter(t => !t.done).sort(sort === "due" ? byDue : sort === "priority" ? byPriority : byOrder);
  const done = mine.filter(t => t.done);
  return (
    <Page wide={project.view === "board"}>
      <PageHeader eyebrow="Project" title={<span className="inline-flex items-center gap-2.5">{project.emoji ? <span>{project.emoji}</span> : <Dot color={project.color} size={14} />}{project.name}</span>}
        sub={project.notes ? project.notes.split("\n")[0] : `${open.length} open${done.length ? ` · ${done.length} done` : ""}`}>
        <Segmented size="sm" value={project.view} onChange={v => put("projects", id, { view: v })} options={[{ value: "list", label: <span className="inline-flex items-center gap-1"><List size={14} />List</span> }, { value: "board", label: <span className="inline-flex items-center gap-1"><Columns3 size={14} />Board</span> }]} />
        {project.view === "list" && (
          <Popover align="end" trigger={({ toggle }) => <IconBtn label="Sort" onClick={toggle}><ArrowDownUp size={17} /></IconBtn>}>
            {close => <>{(["manual", "due", "priority"] as Sort[]).map(s => <MenuItem key={s} active={sort === s} onClick={() => { setSort(s); close(); }}>{s === "manual" ? "Your order" : s === "due" ? "Due date" : "Priority"}</MenuItem>)}</>}
          </Popover>
        )}
        <Popover align="end" trigger={({ toggle }) => <IconBtn label="Project menu" onClick={toggle}><MoreHorizontal size={18} /></IconBtn>}>
          {close => <>
            <MenuItem icon={<Pencil size={15} />} onClick={() => { setEditing(true); close(); }}>Edit project</MenuItem>
            <MenuItem icon={<Star size={15} />} onClick={() => { put("projects", id, { favorite: !project.favorite }); close(); }}>{project.favorite ? "Unpin from top" : "Pin to top"}</MenuItem>
            <MenuItem icon={<Archive size={15} />} onClick={() => { put("projects", id, { archived: !project.archived }); close(); toast(project.archived ? "Restored" : "Archived"); }}>{project.archived ? "Restore" : "Archive"}</MenuItem>
            <MenuItem icon={<Trash2 size={15} />} danger onClick={async () => {
              close();
              if (!(await confirm({ title: `Delete “${project.name}”?`, body: mine.length ? `Its ${mine.length} tasks will be deleted too. (To keep them, move them first, or archive the project.)` : undefined, ok: "Delete", danger: true }))) return;
              deleteProject(id, false); nav("/today");
            }}>Delete project</MenuItem>
          </>}
        </Popover>
      </PageHeader>
      {project.view === "list"
        ? <TaskList tasks={open} sortable={sort === "manual"} hideProject addDefaults={{ projectId: id }} completed={done} empty={<Empty title="No tasks yet">Add the first one below.</Empty>} />
        : <Board project={project} tasks={mine} />}
      <ProjectEditor open={editing} onClose={() => setEditing(false)} project={project} />
    </Page>
  );
}

function BoardCard({ task, overlay }: { task: Task; overlay?: boolean }) {
  const open = useOpenTask();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { column: task.column } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging && !overlay ? 0.4 : 1 }}
      className={cx("rounded-xl border border-border bg-surface p-3 shadow-soft cursor-pointer touch-manipulation", overlay && "rotate-1 shadow-float")}
      onClick={() => open(task.id)} {...attributes} {...listeners}>
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5"><Tick task={task} size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className={cx("text-sm leading-snug", task.done && "striked")}>{task.title}</div>
          <TaskMeta task={task} hideProject />
        </div>
      </div>
    </div>
  );
}

function ColumnView({ col, tasks, projectId }: { col: Column; tasks: Task[]; projectId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  return (
    <div className="flex-none w-[280px] md:w-[290px] flex flex-col max-h-[calc(100vh-200px)]">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className={cx("size-2 rounded-full", col.kind === "done" ? "bg-success" : col.kind === "doing" ? "bg-warning" : "bg-faint")} />
        <h3 className="text-sm font-medium">{col.name}</h3>
        <span className="text-xs text-faint tabular">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className={cx("flex-1 overflow-y-auto rounded-2xl p-1.5 space-y-2 transition-colors min-h-24", isOver ? "bg-accent-soft" : "bg-surface-2/50")}>
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(t => <BoardCard key={t.id} task={t} />)}
        </SortableContext>
        {col.kind !== "done" && <InlineAdd defaults={{ projectId, column: col.id }} />}
      </div>
    </div>
  );
}

function Board({ project, tasks }: { project: Project; tasks: Task[] }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));
  const [active, setActive] = useState<Task | null>(null);
  const firstTodo = project.columns.find(c => c.kind === "todo")?.id ?? project.columns[0]?.id;
  const doneCol = project.columns.find(c => c.kind === "done")?.id;
  const colOf = (t: Task) => (t.column && project.columns.some(c => c.id === t.column) ? t.column : t.done ? doneCol ?? firstTodo : firstTodo);
  const byCol = (c: string) => tasks.filter(t => colOf(t) === c && (!t.done || c === doneCol)).sort((a, b) => (c === doneCol ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : a.order - b.order));
  const onStart = (e: DragStartEvent) => setActive(tasks.find(t => t.id === e.active.id) ?? null);
  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    if (!e.over) return;
    const id = String(e.active.id), over = String(e.over.id);
    const target = over.startsWith("col:") ? over.slice(4) : colOf(tasks.find(t => t.id === over)!);
    const t = tasks.find(x => x.id === id)!;
    if (target && target !== colOf(t)) setColumn(id, target!);
    if (!over.startsWith("col:")) {
      const list = byCol(target!).filter(x => x.id !== id);
      const i = list.findIndex(x => x.id === over);
      const before = list[i - 1]?.order, at = list[i]?.order;
      const order = at == null ? (list.length ? list[list.length - 1].order + 1 : Date.now()) : before == null ? at - 1 : (before + at) / 2;
      put("tasks", id, { order });
    }
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 snap-x">
        {project.columns.map(c => <ColumnView key={c.id} col={c} tasks={byCol(c.id)} projectId={project.id} />)}
        <AddColumn project={project} />
      </div>
      <DragOverlay>{active && <BoardCard task={active} overlay />}</DragOverlay>
    </DndContext>
  );
}

function AddColumn({ project }: { project: Project }) {
  const [name, setName] = useState<string | null>(null);
  if (name === null) return <button onClick={() => setName("")} className="flex-none w-[200px] h-10 rounded-xl border border-dashed border-border text-sm text-muted hover:text-fg flex items-center justify-center gap-1.5"><Plus size={15} /> Add column</button>;
  const add = () => {
    if (!name.trim()) { setName(null); return; }
    const cols = [...project.columns];
    const at = cols.findIndex(c => c.kind === "done");
    cols.splice(at < 0 ? cols.length : at, 0, { id: uid(), name: name.trim(), kind: "doing" });
    put("projects", project.id, { columns: cols });
    setName(null);
  };
  return <input autoFocus className="field flex-none w-[220px] h-10" placeholder="Column name" value={name} onChange={e => setName(e.target.value)} onBlur={add} onKeyDown={e => { if (e.key === "Enter") add(); if (e.key === "Escape") setName(null); }} />;
}

const EMOJIS = ["", "📁", "🏠", "💼", "📚", "💪", "🎯", "✈️", "💰", "🎨", "🧪", "🛒", "❤️", "🌱", "🎵", "⚙️", "📝", "🚀"];

export function ProjectEditor({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const [name, setName] = useState(project.name);
  const [notes, setNotes] = useState(project.notes);
  const [cols, setCols] = useState<Column[]>(project.columns);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const save = () => { put("projects", project.id, { name: name.trim() || project.name, notes, columns: cols.length ? cols : project.columns }); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="Edit project">
      <div className="space-y-4">
        <input className="field text-lg" value={name} onChange={e => setName(e.target.value)} />
        <div>
          <div className="eyebrow mb-1.5">Colour and icon</div>
          <div className="flex flex-wrap gap-1.5 mb-2">{PALETTE.map(c => <button key={c} aria-label={c} onClick={() => put("projects", project.id, { color: c })} className={cx("size-7 rounded-full", project.color === c && "ring-2 ring-offset-2 ring-offset-surface ring-fg")} style={{ background: c }} />)}</div>
          <div className="flex flex-wrap gap-1">{EMOJIS.map(e => <button key={e || "none"} onClick={() => put("projects", project.id, { emoji: e })} className={cx("size-8 rounded-lg text-lg hover:bg-surface-2", project.emoji === e && "bg-surface-2 ring-1 ring-border-strong")}>{e || <X size={14} className="mx-auto text-muted" />}</button>)}</div>
        </div>
        <textarea className="field min-h-20" placeholder="What is this project for?" value={notes} onChange={e => setNotes(e.target.value)} />
        <div>
          <div className="eyebrow mb-1.5">Columns (board view and status)</div>
          <DndContext sensors={sensors} onDragEnd={e => { if (!e.over) return; const a = cols.findIndex(c => c.id === e.active.id), b = cols.findIndex(c => c.id === e.over!.id); if (a < 0 || b < 0) return; const n = [...cols]; const [m] = n.splice(a, 1); n.splice(b, 0, m); setCols(n); }}>
            <SortableContext items={cols.map(c => c.id)} strategy={verticalListSortingStrategy}>
              {cols.map(c => <ColumnRow key={c.id} col={c} onChange={p => setCols(cs => cs.map(x => x.id === c.id ? { ...x, ...p } : x))} onRemove={cols.length > 1 ? () => setCols(cs => cs.filter(x => x.id !== c.id)) : undefined} />)}
            </SortableContext>
          </DndContext>
          <button className="mt-1 text-sm text-muted hover:text-fg inline-flex items-center gap-1" onClick={() => setCols(cs => [...cs, { id: uid(), name: "New column", kind: "doing" }])}><Plus size={14} /> Add column</button>
        </div>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
      </div>
    </Modal>
  );
}

function ColumnRow({ col, onChange, onRemove }: { col: Column; onChange: (p: Partial<Column>) => void; onRemove?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: col.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="flex items-center gap-2 py-1">
      <button {...attributes} {...listeners} className="text-faint cursor-grab touch-none" aria-label="Drag"><GripVertical size={15} /></button>
      <input className="field h-8 py-0 flex-1" value={col.name} onChange={e => onChange({ name: e.target.value })} />
      <select className="field h-8 py-0 w-[120px]" value={col.kind} onChange={e => onChange({ kind: e.target.value as Column["kind"] })}>
        <option value="todo">Not started</option><option value="doing">In progress</option><option value="done">Done</option>
      </select>
      {onRemove && <IconBtn label="Remove column" className="size-8" onClick={onRemove}><X size={14} /></IconBtn>}
    </div>
  );
}
