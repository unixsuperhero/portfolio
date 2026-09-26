import { expect, test } from "bun:test";
import { markdownTasks, setMarkdownTask } from "../src/lib/markdown-tasks.ts";

test("updates only parsed task markers, preserving source formatting and code samples", () => {
  const source = "# Tasks\r\n\r\n- [ ] First **task**\r\n  - [X] Nested\r\n\r\n> - [ ] Quoted\r\n\r\n1. [ ] Ordered\r\n\r\n```md\r\n- [ ] Code sample\r\n```\r\n\r\n    - [ ] Indented code\r\n\r\n<input type=\"checkbox\">\r\n";
  const tasks = markdownTasks(source);
  expect(tasks.map(({ checked, label }) => ({ checked, label }))).toEqual([
    { checked: false, label: "First task" },
    { checked: true, label: "Nested" },
    { checked: false, label: "Quoted" },
    { checked: false, label: "Ordered" },
  ]);
  const nested = tasks[1]!;
  const updated = setMarkdownTask(source, nested.offset, false);
  expect(updated).toBe("# Tasks\r\n\r\n- [ ] First **task**\r\n  - [ ] Nested\r\n\r\n> - [ ] Quoted\r\n\r\n1. [ ] Ordered\r\n\r\n```md\r\n- [ ] Code sample\r\n```\r\n\r\n    - [ ] Indented code\r\n\r\n<input type=\"checkbox\">\r\n");
  expect(setMarkdownTask("- [ ] Ready\n", 3, true)).toBe("- [x] Ready\n");
  expect(() => setMarkdownTask(source, source.indexOf("[ ] Code sample") + 1, true)).toThrow("no longer matches");
});
