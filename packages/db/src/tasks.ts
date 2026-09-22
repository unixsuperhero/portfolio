import type { Database } from "bun:sqlite";
import type { Completion, DueReminder, Recurrence, ReminderInput, Task, TaskInput, TaskView } from "@portfolio/core";

const pad = (n: number): string => String(n).padStart(2, "0");
const isoDate = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (on: string, delta: number): string => {
  const date = new Date(`${on}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return isoDate(date);
};

const REMINDER_PATTERNS: Record<Recurrence, RegExp> = { daily: /^\d{2}:\d{2}$/, once: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ };

export const getTask = (db: Database, id: number): Task | null => db.query<Task, [number]>("SELECT * FROM tasks WHERE id = ?").get(id);

/** Active tasks unless `all`. */
export const listTasks = (db: Database, options: { all?: boolean } = {}): Task[] =>
  options.all
    ? db.query<Task, []>("SELECT * FROM tasks ORDER BY id").all()
    : db.query<Task, []>("SELECT * FROM tasks WHERE active = 1 ORDER BY id").all();

export const listCompletions = (db: Database, taskId: number): Completion[] =>
  db.query<Completion, [number]>('SELECT * FROM completions WHERE task_id = ? ORDER BY "on" DESC').all(taskId);

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("title is required");
  return trimmed;
}

function validateRecurrence(recurrence: string): Recurrence {
  if (recurrence !== "daily" && recurrence !== "once") throw new Error("recurrence must be daily or once");
  return recurrence;
}

/** Validates weekdays: integers 0 (Sunday) through 6 (Saturday), de-duplicated and sorted. */
function validateDays(days: number[]): number[] {
  const unique = new Set<number>();
  for (const day of days) {
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error(`reminder day "${day}" must be an integer 0-6`);
    unique.add(day);
  }
  return [...unique].sort((a, b) => a - b);
}

function normalizeReminder(recurrence: Recurrence, input: ReminderInput): { at: string; days: number[] } {
  if (typeof input === "string") return { at: input, days: [] };
  if (recurrence === "once" && input.days !== undefined) throw new Error("once tasks cannot have reminder days");
  return { at: input.at, days: input.days ? validateDays(input.days) : [] };
}

/** Replaces a task's reminders. Format depends on the task's recurrence: "HH:MM" for daily, "YYYY-MM-DDTHH:MM" for once.
 * Daily reminders may include weekdays ([] or omitted = every day); once reminders may not. */
export function setReminders(db: Database, taskId: number, reminders: ReminderInput[]): void {
  const task = getTask(db, taskId);
  if (!task) throw new Error("task not found");
  const pattern = REMINDER_PATTERNS[task.recurrence];
  const normalized = reminders.map(reminder => normalizeReminder(task.recurrence, reminder));
  for (const { at } of normalized) if (!pattern.test(at)) throw new Error(`reminder "${at}" must match ${task.recurrence === "daily" ? "HH:MM" : "YYYY-MM-DDTHH:MM"}`);
  db.transaction(() => {
    db.query("DELETE FROM reminders WHERE task_id = ?").run(taskId);
    const insert = db.query("INSERT INTO reminders(task_id, at, days) VALUES (?, ?, ?)");
    for (const { at, days } of normalized) insert.run(taskId, at, JSON.stringify(days));
  })();
}

export function createTask(db: Database, input: TaskInput): number {
  const title = validateTitle(input.title);
  const recurrence = validateRecurrence(input.recurrence);
  const id = db.query<{ id: number }, [string, string, string, number | null]>(
    "INSERT INTO tasks(title, notes, recurrence, item_id) VALUES (?, ?, ?, ?) RETURNING id",
  ).get(title, input.notes ?? "", recurrence, input.item_id ?? null)!.id;
  if (input.reminders) setReminders(db, id, input.reminders);
  return id;
}

export function updateTask(db: Database, id: number, patch: Partial<TaskInput> & { active?: boolean }): boolean {
  const current = getTask(db, id);
  if (!current) return false;
  const title = patch.title !== undefined ? validateTitle(patch.title) : current.title;
  const recurrence = patch.recurrence !== undefined ? validateRecurrence(patch.recurrence) : current.recurrence;
  db.query("UPDATE tasks SET title = ?, notes = ?, recurrence = ?, item_id = ?, active = ? WHERE id = ?").run(
    title,
    patch.notes ?? current.notes,
    recurrence,
    patch.item_id === undefined ? current.item_id : patch.item_id,
    patch.active === undefined ? current.active : Number(patch.active),
    id,
  );
  if (patch.reminders) setReminders(db, id, patch.reminders);
  return true;
}

export const deleteTask = (db: Database, id: number): boolean => db.query("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;

export function completeTask(db: Database, id: number, on: string = isoDate(new Date())): TaskView {
  const task = getTask(db, id);
  if (!task) throw new Error("task not found");
  db.query('INSERT INTO completions(task_id, "on") VALUES (?, ?) ON CONFLICT(task_id, "on") DO NOTHING').run(id, on);
  return taskView(db, task);
}

export function uncompleteTask(db: Database, id: number, on: string = isoDate(new Date())): TaskView {
  const task = getTask(db, id);
  if (!task) throw new Error("task not found");
  db.query('DELETE FROM completions WHERE task_id = ? AND "on" = ?').run(id, on);
  return taskView(db, task);
}

/** A task row plus its reminders and computed completion state, as of `today` (default: today). */
export function taskView(db: Database, task: Task, today: string = isoDate(new Date())): TaskView {
  const reminders = db.query<{ id: number; at: string; days: string }, [number]>("SELECT id, at, days FROM reminders WHERE task_id = ? ORDER BY at").all(task.id)
    .map(reminder => ({ id: reminder.id, at: reminder.at, days: JSON.parse(reminder.days) as number[] }));
  const completions = listCompletions(db, task.id);
  const completedDates = new Set(completions.map(completion => completion.on));
  const completed_today = task.recurrence === "daily" ? completedDates.has(today) : completions.length > 0;
  const last_completed = completions[0]?.on ?? null;
  let streak = 0;
  if (task.recurrence === "daily") {
    let cursor = completedDates.has(today) ? today : addDays(today, -1);
    while (completedDates.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
  }
  return { id: task.id, title: task.title, notes: task.notes, recurrence: task.recurrence, item_id: task.item_id, active: Boolean(task.active), created_at: task.created_at, reminders, completed_today, last_completed, streak };
}

export const listTaskViews = (db: Database, options: { all?: boolean } = {}): TaskView[] => listTasks(db, options).map(task => taskView(db, task));

/** Reminders due within `minutes` of `now` (default 60), excluding ones already completed. */
export function dueReminders(db: Database, options: { now?: Date; minutes?: number } = {}): DueReminder[] {
  const now = options.now ?? new Date();
  const windowMs = (options.minutes ?? 60) * 60 * 1000;
  const today = isoDate(now);
  const due: DueReminder[] = [];
  for (const task of listTasks(db, { all: false })) {
    const view = taskView(db, task, today);
    if (view.completed_today) continue;
    for (const reminder of view.reminders) {
      if (task.recurrence === "daily" && reminder.days.length > 0 && !reminder.days.includes(now.getDay())) continue;
      const due_at = task.recurrence === "daily" ? `${today}T${reminder.at}` : reminder.at;
      const at = new Date(due_at);
      if (Number.isNaN(at.getTime())) continue;
      if (Math.abs(at.getTime() - now.getTime()) <= windowMs) due.push({ task: view, reminder, due_at });
    }
  }
  return due;
}

/** Daily tasks (unless every reminder's weekdays exclude today) plus once tasks with a reminder dated today, each with its completed flag. */
export function todayTasks(db: Database, today: string = isoDate(new Date())): TaskView[] {
  const weekday = new Date(`${today}T00:00:00`).getDay();
  return listTaskViews(db, { all: false }).filter(view => {
    if (view.recurrence === "once") return view.reminders.some(reminder => reminder.at.startsWith(today));
    return view.reminders.length === 0 || view.reminders.some(reminder => reminder.days.length === 0 || reminder.days.includes(weekday));
  });
}
