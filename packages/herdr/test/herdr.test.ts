import { expect, test } from "bun:test";
import { entities, targetParams } from "../src/index.ts";
import type { HerdrOperation, HerdrOverview } from "../src/index.ts";

const overview: HerdrOverview = { updated_at: "2026-09-24T00:00:00Z", sessions: ["alpha", "beta"].map(name => ({
  name, default: false, running: true, session_dir: `/sessions/${name}`, socket_path: `/sessions/${name}/herdr.sock`, error: null,
  snapshot: { protocol: 20, panes: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", cwd: "/project", agent: "codex", agent_status: "blocked", tokens: { task: "release" } }] },
})) };
const operation = (method: string, fields: string[]): HerdrOperation => ({ method, group: method.split(".")[0]!, readOnly: false, schema: {}, fields: fields.map(name => ({ name, required: false, kind: "string", choices: [], description: "", schema: {} })) });

test("entities retain session-qualified identity and unrecognized metadata", () => {
  const panes = entities(overview).filter(entity => entity.kind === "pane");
  expect(panes.map(entity => ({ key: entity.key, session: entity.session, status: entity.status, metadata: entity.details.tokens }))).toEqual([
    { key: '["alpha","pane","w1:p1"]', session: "alpha", status: "blocked", metadata: { task: "release" } },
    { key: '["beta","pane","w1:p1"]', session: "beta", status: "blocked", metadata: { task: "release" } },
  ]);
});

test("selected pane targets split and agent controls without targeting integrations or conflicting layouts", () => {
  const pane = entities(overview).find(entity => entity.kind === "pane");
  expect(targetParams(operation("pane.split", ["workspace_id", "target_pane_id"]), pane)).toEqual({ target_pane_id: "w1:p1" });
  expect(targetParams(operation("layout.export", ["pane_id", "tab_id"]), pane)).toEqual({ pane_id: "w1:p1" });
  expect(targetParams(operation("agent.get", ["target"]), pane)).toEqual({ target: "w1:p1" });
  expect(targetParams(operation("integration.install", ["target"]), pane)).toEqual({});
});
