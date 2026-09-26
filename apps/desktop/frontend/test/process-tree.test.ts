import { expect, test } from "bun:test";
import type { PortEntry, TreeNode } from "@portfolio/ports";
import { processTree } from "../src/lib/process-tree";

const node = (pid: number, ppid: number): TreeNode => ({ pid, ppid, command: `process-${pid}`, cwd: "/work" });
const entries: PortEntry[] = [
  { ...node(10, 1), host: "*", port: 3000, tree: [node(10, 1), node(1, 0)], children: [node(20, 10), node(30, 10)] },
  { ...node(20, 10), host: "::", port: 4000, tree: [node(20, 10), node(10, 1), node(1, 0)], children: [node(25, 20)] },
  { ...node(10, 1), host: "*", port: 3001 },
];

test("tree orders ancestors before the process and keeps descendants under their parents", () => {
  const before = structuredClone(entries);
  expect(processTree(entries, 10).map(({ pid, depth, relation }) => ({ pid, depth, relation }))).toEqual([
    { pid: 1, depth: 0, relation: "Ancestor" },
    { pid: 10, depth: 1, relation: "Selected" },
    { pid: 20, depth: 2, relation: "Descendant" },
    { pid: 25, depth: 3, relation: "Descendant" },
    { pid: 30, depth: 2, relation: "Descendant" },
  ]);
  expect(processTree(entries, 10).find(row => row.pid === 10)?.ports).toEqual([{ host: "*", port: 3000 }, { host: "*", port: 3001 }]);
  expect(entries).toEqual(before);
});

test("non-listening children have detail trees and unknown processes have no rows", () => {
  expect(processTree(entries, 25).map(row => row.pid)).toEqual([1, 10, 20, 25]);
  expect(processTree(entries, 999)).toEqual([]);
});

test("cyclic ancestry cannot loop or repeat rows", () => {
  expect(processTree([{ ...node(10, 20), host: "*", port: 3000, tree: [node(20, 10)], children: [node(20, 10)] }], 10).map(row => row.pid)).toEqual([20, 10]);
});
