import { expect, test } from "bun:test";
import { listItems, openDatabase, setTags, updateItem, upsertItem } from "../src/index.ts";

test("search matches case-insensitive fragments across title, description, and body", () => {
  const db = openDatabase(":memory:");
  try {
    const title = upsertItem(db, { type: "document", title: "/impeccable Subcommands" });
    const description = upsertItem(db, { type: "note", title: "Overview", description: "IMPECCABLE details" });
    const body = upsertItem(db, { type: "note", title: "Reference", content: "Try /Impeccable for layouts" });
    upsertItem(db, { type: "note", title: "Unrelated", content: "Other text" });
    const ids = (q: string) => listItems(db, { q, contents: true }).map(item => item.id).sort((a, b) => a - b);
    for (const q of ["i", "im", "PECC", "impeccable"]) expect(ids(q)).toEqual([title, description, body]);
    expect(ids("/impeccable")).toEqual([title, body]);
    expect(ids("reference out")).toEqual([body]);
    expect(ids("  reference\n\tout  ")).toEqual([body]);
    expect(ids("reference missing")).toEqual([]);
    expect(listItems(db, { q: "pecc" }).map(item => item.id).sort((a, b) => a - b)).toEqual([title, description]);
    setTags(db, body, ["guide"]);
    updateItem(db, body, { pinned: true, starred: true });
    expect(listItems(db, { q: "pecc", contents: true, type: "note", tagName: "guide", pinned: true, starred: true }).map(item => item.id)).toEqual([body]);
    updateItem(db, body, { content: "Replacement text" });
    expect(ids("pecc")).toEqual([title, description]);
  } finally { db.close(); }
});

test("search treats punctuation and SQL wildcard characters literally", () => {
  const db = openDatabase(":memory:");
  try {
    const literal = upsertItem(db, { type: "note", title: "100% task_name C:\\tmp \"quoted\" i* O'Reilly" });
    upsertItem(db, { type: "note", title: "1000 taskXname tmp quoted inside" });
    for (const q of ["%", "_", "\\", "\"", "i*", "O'Reilly"]) {
      expect(listItems(db, { q, contents: true }).map(item => item.id)).toEqual([literal]);
    }
    expect(listItems(db, { q: "' OR 1=1 --", contents: true })).toEqual([]);
    expect(listItems(db, { q: " \n\t ", contents: true })).toHaveLength(2);
  } finally { db.close(); }
});
