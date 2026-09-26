---
version: 1
slug: "src-pages-herdr-tsx"
primary_target: "src/pages/Herdr.tsx"
related_targets: []
---

# Herdr workbench

Mode: Operate. One developer browsing live sessions and inspecting panes, starting agents and sending prompts. Preserve the session → workspace → tab → pane → agent hierarchy, URL-backed collections, all schema-defined operations, confirmation of mutations, and refresh-safe drafts and selection. Compact explorer approved; debugger workbench selected.

## Direction contract

THESIS: A debugger workbench for local agents: trace ownership on the left, inspect and act on the right. Reject a filter wall followed by a generic operation form.

OWN-WORLD: Restrained graphite surfaces in dark mode and cool paper surfaces in light mode. Workhorse app sans, monospace only for IDs, paths and payloads. Fine separators, compact disclosure rows, a quiet selection fill, text-labelled statuses.

STORY: Find a session, descend to its pane, inspect its state, then start an agent or compose a prompt without losing the selected branch.

FIRST VIEWPORT: Compact title and freshness strip; a left explorer with search, sort and folded attribute filters; a right inspector with entity breadcrumb, name and status. Pane actions sit directly below identity. Technical metadata and the full operation catalog remain available through disclosure. Results live with controls. Narrow windows stack explorer above inspector. Signature interaction: expanding a branch and selecting a pane brings its agent actions into the inspector while drafts and expansion survive refresh. Motion is limited to short control-state feedback, with reduced motion respected.

FORM: Debugger workbench, grounded candidate 7, seed 90b5a654. Other grounded candidates: source-control browser, process monitor, filesystem column browser, terminal multiplexer, database record inspector, network packet analyzer. The user selected debugger workbench. Code-led.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
