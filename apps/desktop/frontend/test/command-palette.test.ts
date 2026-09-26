import { describe, expect, test } from "bun:test";
import { rankCommands, type Command } from "../src/components/CommandPalette";

const run = () => {};
const commands: Command[] = [
  { id: "go-library", label: "Go to Library", hint: "/library", run },
  { id: "search-library", label: "Search Library", hint: "Use the palette text as a library query", always: true, run },
  { id: "add-note", label: "Add note", hint: "Detected · lib", always: true, run },
];

describe("command palette ranking", () => {
  test("ranks matching navigation before hint matches and fallbacks", () => {
    expect(rankCommands(commands, "lib").map(command => command.id)).toEqual([
      "go-library",
      "search-library",
      "add-note",
    ]);
  });

  test("keeps configured order for an empty query", () => {
    expect(rankCommands(commands, " ")).toBe(commands);
  });
});
