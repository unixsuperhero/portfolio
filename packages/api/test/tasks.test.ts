import { expect, test } from "bun:test";
import { openStore } from "@portfolio/db";
import { createApi } from "../src/index.ts";

test("task hierarchy rejects cycles, preserves children on deletion, and shares library edits", async () => {
  const store = openStore(":memory:");
  const api = createApi(store);
  const request = (path: string, method = "GET", body?: unknown) => api(new Request(`http://local${path}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  try {
    const reference = await (await request("/api/items", "POST", { type: "link", title: "Reference", url: "https://example.com" })).json();
    const root = await (await request("/api/tasks", "POST", { title: "Release", item_id: reference.id })).json();
    const child = await (await request("/api/tasks", "POST", { title: "Checks", parent_id: root.id })).json();
    const leaf = await (await request("/api/tasks", "POST", { title: "Review", parent_id: child.id })).json();
    expect((await request(`/api/tasks/${root.id}`, "PATCH", { parent_id: leaf.id })).status).toBe(422);
    expect((await request(`/api/tasks/${child.id}`, "PATCH", { parent_id: child.id })).status).toBe(422);
    expect((await request("/api/tasks", "POST", { title: "Invalid", parent_id: 999 })).status).toBe(422);
    expect((await request("/api/tasks", "POST", { title: "Invalid reminder", reminders: ["08:30"] })).status).toBe(422);
    const library = await (await request("/api/items?type=task")).json();
    expect(library.items.map((item: { title: string }) => item.title).sort()).toEqual(["Checks", "Release", "Review"]);
    const entry = library.items.find((item: { title: string }) => item.title === "Checks");
    expect(entry.task_id).toBe(child.id);
    expect(entry.id).not.toBe(child.id);
    expect((await request(`/api/items/${entry.id}`, "PATCH", { title: "Run checks", content: "Run the build", tags: ["release"] })).status).toBe(200);
    expect(await (await request(`/api/tasks/${child.id}`)).json()).toMatchObject({ title: "Run checks", notes: "Run the build", parent_id: root.id });
    await request(`/api/tasks/${child.id}`, "PATCH", { title: "Build checks" });
    const search = await (await request("/api/items?type=task&q=Build&tagName=release")).json();
    expect(search.items.map((item: { title: string }) => item.title)).toEqual(["Build checks"]);
    await request(`/api/tasks/${child.id}/complete`, "POST", { on: "2020-01-01" });
    expect(await (await request(`/api/tasks/${root.id}`)).json()).toMatchObject({ completed_today: false });
    expect(await (await request(`/api/tasks/${child.id}`)).json()).toMatchObject({ completed_today: true });
    expect(await (await request(`/api/tasks/${child.id}/uncomplete`, "POST", {})).json()).toMatchObject({ completed_today: false });
    await request(`/api/items/${entry.id}`, "DELETE");
    expect((await request(`/api/tasks/${child.id}`)).status).toBe(404);
    expect(await (await request(`/api/tasks/${leaf.id}`)).json()).toMatchObject({ title: "Review", parent_id: null });
    await request(`/api/tasks/${root.id}`, "DELETE");
    const remaining = await (await request("/api/items?type=task")).json();
    expect(remaining.items.map((item: { title: string }) => item.title)).toEqual(["Review"]);
  } finally { store.close(); }
});

test("creating a task through items and quick add produces completable tasks", async () => {
  const store = openStore(":memory:");
  const api = createApi(store);
  try {
    for (const [path, body] of [
      ["/api/items", { type: "task", title: "Plan", content: "Release plan" }],
      ["/api/quick", { type: "task", content: "Review" }],
    ] as const) {
      const response = await api(new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(response.status).toBe(201);
      const { id } = await response.json();
      const detail = await (await api(new Request(`http://local/api/items/${id}`))).json();
      const completed = await api(new Request(`http://local/api/tasks/${detail.task_id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      expect(completed.status).toBe(200);
      expect(await completed.json()).toMatchObject({ completed_today: true, recurrence: "once", parent_id: null });
    }
  } finally { store.close(); }
});
