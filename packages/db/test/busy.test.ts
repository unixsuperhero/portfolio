import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getItem, openDatabase, upsertItem } from "../src/index.ts";

test("another Portfolio process can save after a concurrent writer releases the database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "portfolio-busy-"));
  const path = join(dir, "portfolio.sqlite");
  let first: Database | null = null;
  try {
    first = openDatabase(path);
    const holder = Bun.spawn([process.execPath, "-e", `
      const { Database } = require("bun:sqlite");
      const db = new Database(${JSON.stringify(path)});
      db.exec("BEGIN IMMEDIATE");
      // Fake timers cannot release an OS lock while the other process is blocked in SQLite.
      process.stdout.write("LOCKED\\n");
      await Bun.sleep(300);
      db.exec("COMMIT");
      db.close();
    `], { stdout: "pipe", stderr: "pipe" });
    try {
      const signal = await holder.stdout.getReader().read();
      expect(new TextDecoder().decode(signal.value)).toStartWith("LOCKED");
      const second = openDatabase(path);
      try {
        const id = upsertItem(second, { type: "note", title: "Saved despite another writer" });
        expect(getItem(first, id)?.title).toBe("Saved despite another writer");
      } finally { second.close(); }
      expect(await holder.exited).toBe(0);
    } finally {
      if (holder.exitCode === null) holder.kill();
      await holder.exited;
    }
  } finally {
    first?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
