import { expect, test } from "bun:test";
import { openStore } from "@portfolio/db";
import { createApi } from "../src/index.ts";

test("Library search requests return partial matches in titles, descriptions, and bodies", async () => {
  const store = openStore(":memory:");
  try {
    const title = store.items.upsertItem({ type: "document", title: "/impeccable Subcommands" });
    const description = store.items.upsertItem({ type: "note", title: "Overview", description: "Impeccable details" });
    const body = store.items.upsertItem({ type: "note", title: "Reference", content: "Try IMPECCABLE for layouts" });
    store.items.upsertItem({ type: "note", title: "Other", content: "Other text" });
    const api = createApi(store);
    for (const q of ["i", "im", "PECC"]) {
      const response = await api(new Request(`http://test/api/items?${new URLSearchParams({ q, contents: "1" })}`));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.items.map((item: { id: number }) => item.id).sort((a: number, b: number) => a - b)).toEqual([title, description, body]);
    }
  } finally { store.close(); }
});
