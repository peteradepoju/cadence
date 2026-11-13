import { addDays, DAY_LONG, dayOfWeek, today, weekKey } from "./dates";
import { generate, generateJson } from "./gemini";
import type { Energy, Priority, Rule, Task } from "./model";
import { all, settings } from "./store";

// AI with your own Gemini key. Every call goes from this device straight to Google.

export const aiReady = () => { const s = settings(); return s.aiOn && !!s.aiKey; };
const key = () => settings().aiKey;
const model = () => settings().aiModel || undefined;

export interface AiTask { title: string; due?: string | null; time?: string | null; priority?: Priority; tags?: string[]; project?: string | null; duration?: number | null; recurrence?: Rule | null; notes?: string }

/** Reads a loose sentence ("remind me to pay rent on the last friday of every month and call the landlord tomorrow") into tasks. */
export async function smartCapture(text: string): Promise<AiTask[]> {
  const projects = all("projects").filter(p => !p.archived).map(p => p.name);
  const t = today();
  const prompt = `You turn a person's quick note into to-do tasks. Today is ${DAY_LONG[dayOfWeek(t)]} ${t}.
Their projects: ${JSON.stringify(projects)}. Existing tags: ${JSON.stringify(all("tags").map(x => x.name).slice(0, 40))}.
Note: """${text.slice(0, 2000)}"""
Return JSON only: {"tasks":[{"title":"short imperative title, no date words","due":"YYYY-MM-DD or null","time":"HH:MM 24h or null","priority":1-4 (1 urgent, 4 none),"tags":["lowercase"],"project":"one of their projects or null","duration":minutes or null,"recurrence":null or {"freq":"daily|weekly|monthly|yearly","interval":1,"days":[0-6 Sunday=0],"monthDay":n},"notes":""}]}
Split into several tasks only if the note clearly lists several things. Keep the person's wording.`;
  const r = await generateJson<{ tasks?: AiTask[] }>(key(), prompt, { model: model() });
  return (r.tasks ?? []).filter(x => x?.title).slice(0, 12);
}

/** Splits a big task into small, concrete steps. */
export async function breakDown(task: Task): Promise<{ title: string; minutes?: number }[]> {
  const prompt = `Break this task into 3 to 8 small, concrete next steps a person can tick off, in order. Each step should take 5 to 90 minutes.
Task: "${task.title}"${task.notes ? `\nNotes: ${task.notes.slice(0, 1500)}` : ""}
Return JSON only: {"steps":[{"title":"verb-first step","minutes":number}]}`;
  const r = await generateJson<{ steps?: { title: string; minutes?: number }[] }>(key(), prompt, { model: model() });
  return (r.steps ?? []).filter(s => s?.title).slice(0, 10);
}

export interface PlanItem { taskId: string; date: string; time?: string | null; minutes?: number | null; why?: string }

function taskLine(t: Task) {
  return { id: t.id, title: t.title, due: t.due, time: t.time, priority: t.priority, minutes: t.duration, energy: t.energy, project: t.projectId ? all("projects").find(p => p.id === t.projectId)?.name : "Inbox", planned: t.plannedFor };
}

/** Spreads open tasks over the coming days, matching hard work to the person's high-energy times. */
export async function planWeek(opts: { start: string; days: number; busy: { date: string; start: string | null; end: string | null; title: string }[]; note?: string }): Promise<{ plan: PlanItem[]; summary: string }> {
  const s = settings();
  const end = addDays(opts.start, opts.days - 1);
  const open = all("tasks").filter(t => !t.done && !t.parentId && (!t.due || t.due <= addDays(end, 14))).slice(0, 120);
  const prompt = `You are a calm, realistic planner. Plan ${opts.start} to ${end} for one person.
Working hours ${s.dayStart}–${s.dayEnd}. Energy: morning ${s.energy.morning}, afternoon ${s.energy.afternoon}, evening ${s.energy.evening}.
At most ${s.dailyLimit} tasks a day. Keep fixed deadlines (a task with a due date must be planned on or before it). Put demanding, high-priority work in high-energy times and small chores in low-energy times. Leave space; don't fill every hour. Avoid their calendar events.
${opts.note ? `What they said about this week: "${opts.note.slice(0, 600)}"` : ""}
Calendar events: ${JSON.stringify(opts.busy.slice(0, 80))}
Open tasks: ${JSON.stringify(open.map(taskLine))}
Return JSON only: {"plan":[{"taskId":"id","date":"YYYY-MM-DD","time":"HH:MM or null","minutes":number,"why":"few words"}],"summary":"two short sentences about the shape of the week"}`;
  const r = await generateJson<{ plan?: PlanItem[]; summary?: string }>(key(), prompt, { model: model() });
  const ids = new Set(open.map(t => t.id));
  return { plan: (r.plan ?? []).filter(p => ids.has(p.taskId) && /^\d{4}-\d{2}-\d{2}$/.test(p.date)), summary: r.summary ?? "" };
}

/** Orders today's tasks into time blocks around calendar events. */
export async function planDay(opts: { date: string; tasks: Task[]; busy: { start: string | null; end: string | null; title: string }[]; energyNow?: Energy | null }): Promise<{ blocks: { taskId: string; start: string; end: string }[]; note: string }> {
  const s = settings();
  const prompt = `Make a realistic time-blocked plan for ${opts.date}, from ${s.dayStart} to ${s.dayEnd}.
Energy: morning ${s.energy.morning}, afternoon ${s.energy.afternoon}, evening ${s.energy.evening}${opts.energyNow ? `; right now they feel ${opts.energyNow}` : ""}.
Fixed events (don't overlap): ${JSON.stringify(opts.busy)}
Tasks: ${JSON.stringify(opts.tasks.map(taskLine))}
Tasks with a time keep it. Hardest work in high energy, short breaks between long blocks, leave a little slack. Skip tasks that don't fit.
Return JSON only: {"blocks":[{"taskId":"id","start":"HH:MM","end":"HH:MM"}],"note":"one short encouraging sentence"}`;
  const r = await generateJson<{ blocks?: { taskId: string; start: string; end: string }[]; note?: string }>(key(), prompt, { model: model() });
  const ids = new Set(opts.tasks.map(t => t.id));
  return { blocks: (r.blocks ?? []).filter(b => ids.has(b.taskId) && /^\d\d:\d\d$/.test(b.start) && /^\d\d:\d\d$/.test(b.end)), note: r.note ?? "" };
}

/** A short, honest write-up of the week from what actually happened. */
export async function weeklyReview(facts: object, answers: Record<string, string>): Promise<string> {
  const prompt = `Write a short weekly review for a person, from the facts below (week ${weekKey(today())}). Warm, plain and honest, not gushing.
Three short paragraphs: what got done and what it says; what slipped and a likely reason; two or three specific suggestions for next week (name tasks or habits). Under 180 words. No headings, no bullet symbols.
Facts: ${JSON.stringify(facts).slice(0, 6000)}
Their own notes: ${JSON.stringify(answers).slice(0, 2000)}`;
  return (await generate(key(), prompt, { model: model() })).trim();
}

export async function dayReflection(facts: object): Promise<string> {
  const prompt = `In two or three short sentences, reflect back on this person's day from the facts, and suggest the one thing to start tomorrow with. Plain and kind. Facts: ${JSON.stringify(facts).slice(0, 4000)}`;
  return (await generate(key(), prompt, { model: model() })).trim();
}

/** Suggests a few habits or goals from a sentence ("I want to get fit and read more"). */
export async function suggestGoalSteps(goal: string, horizon: string): Promise<{ tasks: string[]; habits: string[] }> {
  const prompt = `A person has this ${horizon} goal: "${goal.slice(0, 400)}". Suggest up to 5 concrete one-off tasks that move it forward and up to 3 small daily or weekly habits. Return JSON only: {"tasks":["…"],"habits":["…"]}`;
  const r = await generateJson<{ tasks?: string[]; habits?: string[] }>(key(), prompt, { model: model() });
  return { tasks: (r.tasks ?? []).slice(0, 5), habits: (r.habits ?? []).slice(0, 3) };
}
