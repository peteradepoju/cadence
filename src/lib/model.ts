// What Cadence stores. Every collection syncs field by field (see crdt.ts).

export type Priority = 1 | 2 | 3 | 4; // 1 is the most urgent, 4 is none
export type Energy = "low" | "medium" | "high";

export interface Rule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;          // every N days/weeks/months/years
  days?: number[];           // weekly: 0 = Sunday … 6 = Saturday
  monthDay?: number;         // monthly: day of month (31 means the last day in shorter months)
  nth?: { week: number; day: number }; // monthly: "2nd Tuesday" (week -1 = last)
  fromDone?: boolean;        // the next date counts from when it was done, not from the due date
  until?: string;            // YYYY-MM-DD
  count?: number;            // stop after this many
}

export interface Reminder {
  id: string;
  /** Minutes before the due time (or before 09:00 on the due day when the task has no time). */
  before?: number;
  /** An exact moment, ISO. */
  at?: string;
}

export interface Attachment { id: string; name: string; mime: string; size: number; driveId?: string; url?: string }

export interface Task {
  id: string;
  title: string;
  notes: string;
  projectId: string | null;  // null = Inbox
  column: string | null;     // board column within the project
  parentId: string | null;   // subtasks
  order: number;
  priority: Priority;
  tags: string[];
  due: string | null;        // YYYY-MM-DD
  time: string | null;       // HH:MM
  duration: number | null;   // minutes, used for time blocking and calendar events
  plannedFor: string | null; // YYYY-MM-DD: picked for that day in planning, without a deadline
  recurrence: Rule | null;
  doneCount: number;         // completions of a recurring task
  reminders: Reminder[];
  attachments: Attachment[];
  goalId: string | null;
  energy: Energy | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  origin: string;            // device that created it
  source: string | null;     // "selah", "lumen", "gtasks", "todoist", a link…
  link: string | null;
  // Google Tasks
  gId: string | null;
  gList: string | null;
  gSeen: string | null;      // Google's "updated" we last read or wrote
  gPushed: string | null;    // our stamp last sent to Google
  // Google Calendar
  calPushed: string | null;
  calOff?: boolean;          // removed from Google Calendar by hand: don't put it back
  deleted?: boolean;
}

export interface Column { id: string; name: string; kind: "todo" | "doing" | "done" }

export interface Project {
  id: string;
  name: string;
  color: string;
  emoji: string;
  order: number;
  view: "list" | "board";
  columns: Column[];
  archived: boolean;
  favorite: boolean;
  notes: string;
  gList: string | null;      // linked Google Tasks list
  createdAt: string;
  deleted?: boolean;
}

export interface Tag { id: string; name: string; color: string; deleted?: boolean }

/** Old data only: Habits were removed from Cadence. Kept so earlier data still syncs and its calendar events can be cleared. */
export interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;
  kind: "daily" | "days" | "weekly";
  days: number[];            // for "days": which weekdays
  perWeek: number;           // for "weekly": times a week
  target: number;            // times a day it counts as done
  reminder: string | null;   // HH:MM
  archived: boolean;
  order: number;
  createdAt: string;
  calPushed: string | null;
  deleted?: boolean;
}

export interface HabitLog { id: string; habitId: string; date: string; count: number; deleted?: boolean }

export type Horizon = "year" | "quarter" | "month" | "week";
export interface Goal {
  id: string;
  title: string;
  why: string;
  horizon: Horizon;
  period: string;            // "2026", "2026-Q4", "2026-11", "2026-W46"
  parentId: string | null;
  status: "active" | "done" | "dropped";
  progress: number | null;   // 0–100 set by hand; null = from linked tasks and sub-goals
  color: string;
  order: number;
  createdAt: string;
  deleted?: boolean;
}

export interface Block {
  id: string;
  date: string;
  start: string;             // HH:MM
  end: string;
  title: string;
  taskId: string | null;
  color: string;
  calPushed: string | null;
  deleted?: boolean;
}

export interface Session {
  id: string;
  taskId: string | null;
  start: string;             // ISO
  minutes: number;
  kind: "focus" | "manual";
  note: string;
  deleted?: boolean;
}

export interface Review {
  id: string;                // "day:2026-11-13" or "week:2026-W46"
  kind: "day" | "week";
  period: string;
  answers: Record<string, string>;
  energy: number | null;     // 1–5
  ai: string;
  doneAt: string | null;
  deleted?: boolean;
}

export interface Settings {
  id: "main";
  name: string;
  weekStart: 0 | 1;
  dayStart: string;          // HH:MM, for time blocking
  dayEnd: string;
  reviewTime: string;        // HH:MM, end-of-day review nudge
  defaultReminder: number | null; // minutes before, for new timed tasks
  energy: { morning: Energy; afternoon: Energy; evening: Energy };
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  phoneSilence: boolean;     // silence the phone during focus rounds (MacroDroid on Android)
  phoneOnUrl: string;        // webhook that turns Do Not Disturb on
  phoneOffUrl: string;       // webhook that turns it off
  focusChime: boolean;       // sound and vibration when a round or break ends
  aiKey: string;
  aiModel: string;
  aiOn: boolean;
  gtasksOn: boolean;
  gInbox: string | null;     // Google Tasks list the Inbox syncs with
  gIgnore: string[];         // Google lists not to bring back as projects
  calOn: boolean;
  calId: string | null;
  calShowOthers: boolean;
  habitCalendar: boolean;
  dailyLimit: number;        // how many tasks Today suggests
}

export const DEFAULT_SETTINGS: Settings = {
  id: "main",
  name: "",
  weekStart: 1,
  dayStart: "08:00",
  dayEnd: "18:00",
  reviewTime: "20:30",
  defaultReminder: 15,
  energy: { morning: "high", afternoon: "medium", evening: "low" },
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  phoneSilence: false,
  phoneOnUrl: "",
  phoneOffUrl: "",
  focusChime: true,
  aiKey: "",
  aiModel: "",
  aiOn: true,
  gtasksOn: false,
  gInbox: null,
  gIgnore: [],
  calOn: false,
  calId: null,
  calShowOthers: false,
  habitCalendar: false,
  dailyLimit: 6,
};

export interface FileMeta { id: string; name: string; mime: string; size: number; driveId: string | null; deleted?: boolean }

export type Collections = {
  tasks: Task;
  projects: Project;
  tags: Tag;
  habits: Habit;
  habitLogs: HabitLog;
  goals: Goal;
  blocks: Block;
  sessions: Session;
  reviews: Review;
  settings: Settings;
  files: FileMeta;
};
export type CollName = keyof Collections;
export const COLLECTIONS: CollName[] = ["tasks", "projects", "tags", "habits", "habitLogs", "goals", "blocks", "sessions", "reviews", "settings", "files"];

export const PALETTE = ["#4F6F52", "#3E6FD8", "#C8573C", "#B08D4F", "#7E57C2", "#1F8A6E", "#C0487A", "#5B6472", "#D08A2E", "#2F7F9E"];

export const DEFAULT_COLUMNS: Column[] = [
  { id: "todo", name: "To do", kind: "todo" },
  { id: "doing", name: "In progress", kind: "doing" },
  { id: "done", name: "Done", kind: "done" },
];

export const PRIORITY_LABEL: Record<Priority, string> = { 1: "Urgent", 2: "High", 3: "Medium", 4: "None" };
export const PRIORITY_COLOR: Record<Priority, string> = { 1: "var(--p1)", 2: "var(--p2)", 3: "var(--p3)", 4: "var(--muted)" };

export function newTask(p: Partial<Task> & { title: string }, device: string): Task {
  return {
    id: p.id ?? uid(),
    notes: "", projectId: null, column: null, parentId: null, order: Date.now(), priority: 4, tags: [],
    due: null, time: null, duration: null, plannedFor: null, recurrence: null, doneCount: 0, reminders: [], attachments: [],
    goalId: null, energy: null, done: false, doneAt: null, createdAt: new Date().toISOString(), origin: device,
    source: null, link: null, gId: null, gList: null, gSeen: null, gPushed: null, calPushed: null,
    ...p,
  };
}

export function uid(): string {
  const b = crypto.getRandomValues(new Uint8Array(10));
  // base32hex (0-9, a-v): also valid as a Google Calendar event id
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let s = Date.now().toString(32);
  for (const x of b) s += alphabet[x & 31];
  return s;
}
