import type { Database } from "bun:sqlite";
import type { DueReminder, Recurrence, Reminder, ReminderCreateInput, ReminderView } from "@portfolio/core";

const pad = (n: number): string => String(n).padStart(2, "0");
const isoDate = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (on: string, delta: number): string => {
  const date = new Date(`${on}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return isoDate(date);
};

const REMINDER_PATTERNS: Record<Recurrence, RegExp> = { daily: /^\d{2}:\d{2}$/, once: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ };

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("title is required");
  return trimmed;
}

export function validateRecurrence(recurrence: string): Recurrence {
  if (recurrence !== "daily" && recurrence !== "once") throw new Error("recurrence must be daily or once");
  return recurrence;
}

export function validateDays(days: number[]): number[] {
  const unique = new Set<number>();
  for (const day of days) {
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error(`reminder day "${day}" must be an integer 0-6`);
    unique.add(day);
  }
  return [...unique].sort((a, b) => a - b);
}

function validDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute;
}

function validateAt(recurrence: Recurrence, at: string): string {
  if (!REMINDER_PATTERNS[recurrence].test(at)) throw new Error(`reminder "${at}" must match ${recurrence === "daily" ? "HH:MM" : "YYYY-MM-DDTHH:MM"}`);
  const dateTime = recurrence === "daily" ? `2000-01-01T${at}` : at;
  if (!validDateTime(dateTime)) throw new Error(`reminder "${at}" is not a valid date/time`);
  return at;
}

function normalizeDays(recurrence: Recurrence, days: number[] | undefined): number[] {
  if (recurrence === "once") {
    if (days !== undefined && days.length > 0) throw new Error("once reminders cannot have days");
    return [];
  }
  return days ? validateDays(days) : [];
}

function validateTask(db: Database, taskId: number | null): number | null {
  if (taskId === null) return null;
  if (!Number.isSafeInteger(taskId) || !db.query("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) throw new Error("task not found");
  return taskId;
}

export const getReminder = (db: Database, id: number): Reminder | null => db.query<Reminder, [number]>("SELECT * FROM reminders WHERE id = ?").get(id);

export const listReminders = (db: Database, options: { all?: boolean } = {}): Reminder[] =>
  options.all
    ? db.query<Reminder, []>("SELECT * FROM reminders ORDER BY id").all()
    : db.query<Reminder, []>("SELECT * FROM reminders WHERE active = 1 ORDER BY id").all();

function completions(db: Database, reminderId: number): { on: string }[] {
  return db.query<{ on: string }, [number]>('SELECT "on" FROM reminder_completions WHERE reminder_id = ? ORDER BY "on" DESC').all(reminderId);
}

export function reminderView(db: Database, reminder: Reminder, today: string = isoDate(new Date())): ReminderView {
  const rows = completions(db, reminder.id);
  const completedDates = new Set(rows.map(row => row.on));
  const completed_today = reminder.recurrence === "daily" ? completedDates.has(today) : rows.length > 0;
  const last_completed = rows[0]?.on ?? null;
  let streak = 0;
  if (reminder.recurrence === "daily") {
    let cursor = completedDates.has(today) ? today : addDays(today, -1);
    while (completedDates.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
  }
  return {
    id: reminder.id,
    title: reminder.title,
    notes: reminder.notes,
    recurrence: reminder.recurrence,
    at: reminder.at,
    days: JSON.parse(reminder.days) as number[],
    task_id: reminder.task_id,
    active: Boolean(reminder.active),
    created_at: reminder.created_at,
    completed_today,
    last_completed,
    streak,
  };
}

export const listReminderViews = (db: Database, options: { all?: boolean } = {}): ReminderView[] => listReminders(db, options).map(reminder => reminderView(db, reminder));

export function createReminder(db: Database, input: ReminderCreateInput): number {
  const recurrence = validateRecurrence(input.recurrence ?? "once");
  const title = validateTitle(input.title);
  const at = validateAt(recurrence, input.at);
  const days = normalizeDays(recurrence, input.days);
  const taskId = validateTask(db, input.task_id ?? null);
  return db.query<{ id: number }, [string, string, string, string, string, number | null, number]>(
    "INSERT INTO reminders(title, notes, recurrence, at, days, task_id, active) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  ).get(title, input.notes ?? "", recurrence, at, JSON.stringify(days), taskId, input.active === undefined ? 1 : Number(input.active))!.id;
}

export function updateReminder(db: Database, id: number, patch: Partial<ReminderCreateInput>): boolean {
  const current = getReminder(db, id);
  if (!current) return false;
  const recurrence = patch.recurrence !== undefined ? validateRecurrence(patch.recurrence) : current.recurrence;
  const at = validateAt(recurrence, patch.at ?? current.at);
  const days = normalizeDays(recurrence, patch.days === undefined ? JSON.parse(current.days) as number[] : patch.days);
  const taskId = validateTask(db, patch.task_id === undefined ? current.task_id : patch.task_id ?? null);
  db.query("UPDATE reminders SET title = ?, notes = ?, recurrence = ?, at = ?, days = ?, task_id = ?, active = ? WHERE id = ?").run(
    patch.title !== undefined ? validateTitle(patch.title) : current.title,
    patch.notes ?? current.notes,
    recurrence,
    at,
    JSON.stringify(days),
    taskId,
    patch.active === undefined ? current.active : Number(patch.active),
    id,
  );
  return true;
}

export const deleteReminder = (db: Database, id: number): boolean => db.query("DELETE FROM reminders WHERE id = ?").run(id).changes > 0;

export function completeReminder(db: Database, id: number, on: string = isoDate(new Date())): ReminderView | null {
  const reminder = getReminder(db, id);
  if (!reminder) return null;
  db.query('INSERT INTO reminder_completions(reminder_id, "on") VALUES (?, ?) ON CONFLICT(reminder_id, "on") DO NOTHING').run(id, on);
  return reminderView(db, reminder, on);
}

export function uncompleteReminder(db: Database, id: number, on: string = isoDate(new Date())): ReminderView | null {
  const reminder = getReminder(db, id);
  if (!reminder) return null;
  if (reminder.recurrence === "once") db.query("DELETE FROM reminder_completions WHERE reminder_id = ?").run(id);
  else db.query('DELETE FROM reminder_completions WHERE reminder_id = ? AND "on" = ?').run(id, on);
  return reminderView(db, reminder, on);
}

function taskDoneOrInactive(db: Database, reminder: Reminder, on: string): boolean {
  if (reminder.task_id === null) return false;
  const task = db.query<{ recurrence: Recurrence; active: 0 | 1 }, [number]>("SELECT recurrence, active FROM tasks WHERE id = ?").get(reminder.task_id);
  if (!task || !task.active) return true;
  const row = task.recurrence === "daily"
    ? db.query('SELECT 1 FROM completions WHERE task_id = ? AND "on" = ?').get(reminder.task_id, on)
    : db.query("SELECT 1 FROM completions WHERE task_id = ?").get(reminder.task_id);
  return Boolean(row);
}

function reminderCompleted(db: Database, reminder: Reminder, on: string): boolean {
  if (reminder.recurrence === "daily") return Boolean(db.query('SELECT 1 FROM reminder_completions WHERE reminder_id = ? AND "on" = ?').get(reminder.id, on));
  return Boolean(db.query("SELECT 1 FROM reminder_completions WHERE reminder_id = ?").get(reminder.id));
}

function occurrenceDates(now: Date, minutes: number): string[] {
  const days = new Set<string>();
  const windowMs = minutes * 60 * 1000;
  for (const offset of [-windowMs, 0, windowMs]) days.add(isoDate(new Date(now.getTime() + offset)));
  return [...days];
}

export function dueReminders(db: Database, options: { now?: Date; minutes?: number } = {}): DueReminder[] {
  const now = options.now ?? new Date();
  const minutes = options.minutes ?? 60;
  const windowMs = minutes * 60 * 1000;
  const due: DueReminder[] = [];
  for (const reminder of listReminders(db)) {
    for (const date of reminder.recurrence === "daily" ? occurrenceDates(now, minutes) : [reminder.at.slice(0, 10)]) {
      const days = JSON.parse(reminder.days) as number[];
      const dueAt = reminder.recurrence === "daily" ? `${date}T${reminder.at}` : reminder.at;
      const at = new Date(dueAt);
      if (Number.isNaN(at.getTime())) continue;
      if (Math.abs(at.getTime() - now.getTime()) > windowMs) continue;
      if (reminder.recurrence === "daily" && days.length > 0 && !days.includes(at.getDay())) continue;
      if (reminderCompleted(db, reminder, date) || taskDoneOrInactive(db, reminder, date)) continue;
      due.push({ reminder: reminderView(db, reminder, date), due_at: dueAt });
    }
  }
  return due;
}

export function todayReminders(db: Database, today: string = isoDate(new Date())): ReminderView[] {
  const weekday = new Date(`${today}T00:00:00`).getDay();
  return listReminders(db).map(reminder => reminderView(db, reminder, today)).filter(view => {
    if (view.recurrence === "once") return view.at.startsWith(today);
    return view.days.length === 0 || view.days.includes(weekday);
  });
}
