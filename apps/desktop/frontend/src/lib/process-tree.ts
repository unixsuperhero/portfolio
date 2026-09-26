import type { PortEntry, TreeNode } from "@portfolio/ports";

export type ProcessRow = TreeNode & { relation: "Ancestor" | "Selected" | "Descendant"; depth: number };

export function processTree(entries: PortEntry[], pid: number): ProcessRow[] {
  const nodes = new Map<number, TreeNode>();
  for (const entry of entries) {
    for (const node of [...(entry.children ?? []), ...(entry.tree ?? [])]) {
      nodes.set(node.pid, { ...nodes.get(node.pid), ...node });
    }
  }
  for (const entry of entries) {
    const existing = nodes.get(entry.pid);
    const ports = [...(existing?.ports ?? [])];
    if (entry.port !== null && !ports.some(port => port.host === entry.host && port.port === entry.port)) ports.push({ host: entry.host, port: entry.port });
    nodes.set(entry.pid, { ...existing, ...entry, command: entry.command_line || entry.command, ports });
  }
  const selected = nodes.get(pid);
  if (!selected) return [];
  const ancestors: TreeNode[] = [];
  const seen = new Set([pid]);
  let parent = selected.ppid === undefined ? undefined : nodes.get(selected.ppid);
  while (parent && !seen.has(parent.pid)) {
    seen.add(parent.pid);
    ancestors.push(parent);
    parent = parent.ppid === undefined ? undefined : nodes.get(parent.ppid);
  }
  const rows: ProcessRow[] = ancestors.reverse().map((node, depth) => ({ ...node, relation: "Ancestor", depth }));
  rows.push({ ...selected, relation: "Selected", depth: rows.length });
  const children = new Map<number, TreeNode[]>();
  for (const node of nodes.values()) {
    if (node.ppid === undefined) continue;
    const siblings = children.get(node.ppid) ?? [];
    siblings.push(node);
    children.set(node.ppid, siblings);
  }
  const pending = [{ node: selected, depth: rows.length - 1 }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    if (current.node.pid !== pid) {
      if (seen.has(current.node.pid)) continue;
      seen.add(current.node.pid);
      rows.push({ ...current.node, relation: "Descendant", depth: current.depth });
    }
    const descendants = (children.get(current.node.pid) ?? []).sort((a, b) => b.pid - a.pid);
    for (const child of descendants) {
      if (!seen.has(child.pid)) pending.push({ node: child, depth: current.depth + 1 });
    }
  }
  return rows;
}
