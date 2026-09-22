import type { Database } from "bun:sqlite";
import type { Completion, DueReminder, Recurrence, Task, TaskInput, TaskView } from "@portfolio/core";

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

/** Replaces a task's reminders. Format depends on the task's recurrence: "HH:MM" for daily, "YYYY-MM-DDTHH:MM" for once. */
export function setReminders(db: Database, taskId: number, ats: string[]): void {
  const task = getTask(db, taskId);
  if (!task) throw new Error("task not found");
  const pattern = REMINDER_PATTERNS[task.recurrence];
  for (const at of ats) if (!pattern.test(at)) throw new Error(`reminder "${at}" must match ${task.recurrence === "daily" ? "HH:MM" : "YYYY-MM-DDTHH:MM"}`);
  db.transaction(() => {
    db.query("DELETE FROM reminders WHERE task_id = ?").run(taskId);
    const insert = db.query("INSERT INTO reminders(task_id, at) VALUES (?, ?)");
    for (const at of ats) insert.run(taskId, at);
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
  const reminders = db.query<{ id: number; at: string }, [number]>("SELECT id, at FROM reminders WHERE task_id = ? ORDER BY at").all(task.id);
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
      const due_at = task.recurrence === "daily" ? `${today}T${reminder.at}` : reminder.at;
      const at = new Date(due_at);
      if (Number.isNaN(at.getTime())) continue;
      if (Math.abs(at.getTime() - now.getTime()) <= windowMs) due.push({ task: view, reminder, due_at });
    }
  }
  return due;
}

/** Daily tasks plus once tasks with a reminder dated today, each with its completed flag. */
export function todayTasks(db: Database, today: string = isoDate(new Date())): TaskView[] {
  return listTaskViews(db, { all: false }).filter(view => view.recurrence === "daily" || view.reminders.some(reminder => reminder.at.startsWith(today)));
}
