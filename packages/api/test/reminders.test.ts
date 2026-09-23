import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dueReminders, openStore } from "@portfolio/db";
import type { Store } from "@portfolio/db";
import { createApi } from "../src/index.ts";

const requestFor = (store: Store) => {
  const api = createApi(store);
  return (path: string, method = "GET", body?: unknown) => api(new Request(`http://local/api${path}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
};

test("standalone reminders persist and complete without creating or completing tasks", async () => {
  const store = openStore(":memory:");
  const request = requestFor(store);
  const now = new Date("2026-09-23T08:30:00");
  try {
    const created = await request("/reminders", "POST", { title: "Take the bins out", notes: "**Before** collection", at: "2026-09-23T08:30" });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await (await request("/tasks?all=true")).json()).tasks).toEqual([]);
    expect((await (await request("/items?type=task")).json()).items).toEqual([]);
    expect(dueReminders(store.db, { now, minutes: 1 }).map(({ reminder, due_at }) => ({ title: reminder.title, task_id: reminder.task_id, due_at })))
      .toEqual([{ title: "Take the bins out", task_id: null, due_at: "2026-09-23T08:30" }]);
    await request(`/reminders/${id}/complete`, "POST", { on: "2026-09-23" });
    expect(dueReminders(store.db, { now, minutes: 1 })).toEqual([]);
    await request(`/reminders/${id}/uncomplete`, "POST", {});
    expect(dueReminders(store.db, { now, minutes: 1 }).map(({ reminder }) => reminder.title)).toEqual(["Take the bins out"]);

    const task = await (await request("/tasks", "POST", { title: "Household chores" })).json();
    expect((await request(`/reminders/${id}`, "PATCH", { title: "Put recycling out", task_id: task.id })).status).toBe(200);
    await request(`/reminders/${id}/complete`, "POST", { on: "2026-09-23" });
    expect(await (await request(`/tasks/${task.id}`)).json()).toMatchObject({ title: "Household chores", completed_today: false });
    await request(`/tasks/${task.id}`, "DELETE");
    expect(await (await request(`/reminders/${id}`)).json()).toMatchObject({ title: "Put recycling out", task_id: null, completed_today: true });
    expect((await request(`/reminders/${id}`, "DELETE")).status).toBe(200);
    expect((await (await request("/reminders?all=true")).json()).reminders).toEqual([]);
  } finally { store.close(); }
});

test("standalone daily reminders honor weekdays and independent completion dates", async () => {
  const store = openStore(":memory:");
  const request = requestFor(store);
  const dueOn = (date: string) => dueReminders(store.db, { now: new Date(`${date}T08:30:00`), minutes: 1 }).map(({ reminder }) => reminder.title);
  try {
    const { id } = await (await request("/reminders", "POST", { title: "Water plants", recurrence: "daily", at: "08:30", days: [1] })).json();
    expect(dueOn("2026-09-21")).toEqual(["Water plants"]);
    expect(dueOn("2026-09-22")).toEqual([]);
    await request(`/reminders/${id}/complete`, "POST", { on: "2026-09-21" });
    expect(dueOn("2026-09-21")).toEqual([]);
    expect(dueOn("2026-09-28")).toEqual(["Water plants"]);
    expect((await request("/reminders", "POST", { title: "Invalid", recurrence: "daily", at: "25:99" })).status).toBe(422);
    expect((await request("/reminders", "POST", { title: "Invalid", at: "2026-02-30T08:30" })).status).toBe(422);
    expect((await request("/reminders", "POST", { title: "Invalid", at: "2026-09-23T08:30", task_id: 99999 })).status).toBe(422);
  } finally { store.close(); }
});

test("legacy reminder migration preserves schedules and completions across reopening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portfolio-reminder-migration-"));
  const path = join(directory, "legacy.sqlite");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', recurrence TEXT NOT NULL DEFAULT 'once',
      item_id INTEGER, parent_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE reminders (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      at TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE completions (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(task_id, "on"));
    INSERT INTO tasks(id, title, notes, recurrence) VALUES (4, 'Legacy reminder', 'Keep this note', 'daily');
    INSERT INTO reminders(id, task_id, at, days) VALUES (9, 4, '08:30', '[1,3,5]');
    INSERT INTO completions(task_id, "on") VALUES (4, '2026-09-23');
  `);
  legacy.close();
  try {
    for (let reopen = 0; reopen < 2; reopen++) {
      const store = openStore(path);
      try {
        const request = requestFor(store);
        const reminders = (await (await request("/reminders?all=true")).json()).reminders;
        expect(reminders.map(({ id, title, notes, at, days, task_id, last_completed }: Record<string, unknown>) => ({ id, title, notes, at, days, task_id, last_completed })))
          .toEqual([{ id: 9, title: "Legacy reminder", notes: "Keep this note", at: "08:30", days: [1, 3, 5], task_id: 4, last_completed: "2026-09-23" }]);
        expect(dueReminders(store.db, { now: new Date("2026-09-23T08:30:00"), minutes: 1 })).toEqual([]);
        expect(store.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { store.close(); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
