# Categories everywhere

A lot of things fall into a small, finite set of categories, far smaller than the number of
items that will ever exist. Files, dirs, links, notes — concepts the app already tracks — cover
most of it. This document designs categories, slots, and sources so any category can attach
shared, optional, configurable behavior to every one of its members, no matter what item type
the members are.

The three concrete cases that motivate the design: AI harnesses and their config/skill/agent/
command dirs and prompts, programming projects and their services, and a YouTube portfolio of
files, notes, links, and slide decks. Section 4 and 5 work through all three as data.

No code in this document. It is a design to review before packages change.

## Where the current design stops

- `items.category_id` is a plain nullable FK with no type CHECK — nothing in the schema limits
  it to `file`/`dir` items. `Category.kind: ItemType` already spans all six item types
  (`document | note | link | pr | file | dir`).
- What actually limits categories to file and dir items is `Slot.kind: PathType` (`"file" |
  "dir"` only, in `packages/core/src/types.ts`), and the fact that nothing in the API or UI ever
  assigns a category to a note, link, pr, or document.
- Project discovery is its own thing: `project_parents` is a one-column table, `discoverProjects`
  in `packages/watch/src/projects.ts` is a project-shaped walk, and `PROJECT_CATEGORY` is a
  hardcoded category with one hardcoded slot.

So the gap is narrower than "categories don't work for other types" — it's "slots only know how
to be a file or a dir" and "there's no general way to say where a category's members come from."
Both are addressed below without touching how `category_id` itself is stored.

## 1. Categories for every item type

**What changes:** nothing in the `categories` or `items` tables. `Category.kind` already accepts
any `ItemType`; this design just starts using that. The only schema-relevant change is widening
`Slot.kind` (section 2), which lives inside the `slots` JSON column, not a new column.

**What "kind" means, precisely** — two different things share the word today, and this design
keeps them separate on purpose:

| Field | Answers | Example values |
|-------|---------|-----------------|
| `category.kind` | What item type can be a member of this category | `dir`, `note`, `file` |
| `slot.kind` | What a slot resolves to for each member | `file`, `dir`, `link`, `note`, `command` |

A category's `kind` is a constraint on membership, enforced the same way it is today: `assign`
refuses an item whose `type` doesn't match. A slot's `kind` says what shape that one slot takes
for every member, independent of what the member's own item type is. A `note` category (member
type `note`) can still have a `link` slot (e.g. a prompt's "source thread" URL) or a `command`
slot. The two kinds are orthogonal.

Category examples across types, as data:

```js
const project = { id: 9, name: "project", kind: "dir",
  slots: [{ name: "tasks", kind: "file", path: "TASKS.md" }] };

const prompt = { id: 24, name: "prompt", kind: "note", slots: [] };

const pullRequest = { id: 30, name: "pr-review", kind: "pr",
  slots: [{ name: "checklist", kind: "note", path: "Review: {title}" }] };

const document = { id: 31, name: "runbook", kind: "document",
  slots: [{ name: "owner_note", kind: "note", path: "Owner notes: {title}" }] };
```

**Migration:** none for `categories` or `items` — both columns already fit. `createCategory` and
`updateCategory` in `packages/db/src/categories.ts` keep validating `isItemType(kind)` unchanged.
The only code change is that `isPathType` stops being the gate for a valid slot kind — see
section 2. Existing rows (all `kind: "file"` or `kind: "dir"` today) need no backfill.

## 2. Slot kinds beyond file and dir

`Slot` keeps its three-field shape — `{ name, kind, path }` — and the `name | kind | path` text
form in `parseSlots`/`formatSlots` is untouched. `path` is reinterpreted per kind: a filesystem
path for `file`/`dir`, a URL template for `link`, a title template for `note`, a shell command
template for `command`. Every slot still resolves at read time via `resolveSlots`, never stored
per member; a member's `slot_paths` JSON still holds overrides, keyed by slot name, same as today.

```js
const slots = [
  { name: "tasks",   kind: "file",    path: "TASKS.md" },
  { name: "logs",    kind: "dir",     path: "~/Library/Logs/{name}" },
  { name: "repo",    kind: "link",    path: "https://github.com/me/{name}" },
  { name: "context", kind: "note",    path: "{title} — context" },
  { name: "restart", kind: "command", path: "docker compose restart {name}" },
];
```

Template placeholders (`{name}`, `{title}`, `{path}`) are substituted from the member's own
fields before the kind-specific resolution runs — `{name}` is the member's slug/basename,
`{title}` its title, `{path}` its own filesystem path when it has one.

Resolution per kind, still through `resolveSlots(slots, { memberPath, overrides, home })`:

```js
// file / dir — unchanged
{ name: "tasks", kind: "file", path: "/Users/me/proj/app/TASKS.md", overridden: false, exists: true }

// link — path is the expanded URL; "exists" means the template resolved to a real URL
{ name: "repo", kind: "link", path: "https://github.com/me/app", overridden: false, exists: true }

// note — no override yet: nothing to open, but the slot is still listed
{ name: "context", kind: "note", path: null, overridden: false, exists: false }
// after "create": the override holds a reference to the note item that was made
{ name: "context", kind: "note", path: "note:118", overridden: true, exists: true }

// command — always resolvable; "exists" is not meaningful, so it reads true
{ name: "restart", kind: "command", path: "docker compose restart app", overridden: false, exists: true }
```

A `note` slot's override is not a filesystem path — it's `note:<item id>`, written the same way
`setSlotOverride` writes any override today, once the note item is created. Reading a `note` slot
whose override is `note:<id>` loads that note's title/href instead of treating it as a path.

**Actions per kind.** These are the same actions the desktop context menu and
`POST /api/items/:id/path-action` already expose for file and dir (`copy`, `reveal`, `open`,
`create`), extended per kind:

| Slot kind | Actions |
|-----------|---------|
| `file` | copy path, reveal in Finder, open, open in editor, create |
| `dir` | copy path, reveal in Finder, open, open in editor, create, open terminal here, scan |
| `link` | open in-app, open in system browser, copy |
| `note` | open, edit |
| `command` | run, run with args, copy |

`dir` gets the full `file` list plus its own two, same as today's row where `dir` items already
share `file`'s path actions.

**"Create, or act as if it already exists"** — the rule the user asked for, generalized from the
pattern `CONTRACT.md` already documents for file/dir (`reveal`/`open` create first when missing):

- `file`/`dir`: `create` makes the file (empty) or dir (`mkdir -p`); `reveal`/`open`/`open in
  editor` create it first if it's missing, then act. This is unchanged.
- `note`: any action (`open`, `edit`) creates the note item first if the slot has no override,
  using the resolved `path` template as the new note's title, then acts on it. The member's
  `slot_paths` gets the `note:<id>` override as a side effect, so the next read shows it exists.
- `link`, `command`: nothing to create — a URL or a shell line is always "there." Actions just
  run against the resolved template. There is no missing state for these two kinds.

So every slot kind either has a `create`, or has no missing state to begin with. The member page
never shows a slot as a dead end.

## 3. Sources: generalizing `project_parents`

`project_parents` becomes one row shape used by every category, not just `project`. A source is a
directory plus a rule for what counts as a member.

```sql
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  rule TEXT NOT NULL CHECK (rule IN ('child-dir', 'child-or-git', 'glob')),
  pattern TEXT NOT NULL DEFAULT '',  -- glob rule only, e.g. "*.md"
  depth INTEGER NOT NULL DEFAULT 4,  -- child-or-git only
  UNIQUE(category_id, path)
);
CREATE INDEX IF NOT EXISTS sources_category ON sources(category_id);
```

As data:

```js
const sources = [
  { id: 1, category_id: 9,  path: "/Users/me/proj",              rule: "child-or-git", depth: 4, pattern: "" },
  { id: 2, category_id: 21, path: "/Users/me/.claude/skills",     rule: "child-dir",    depth: 4, pattern: "" },
  { id: 3, category_id: 21, path: "/Users/me/proj/claude/skills", rule: "child-dir",    depth: 4, pattern: "" },
  { id: 4, category_id: 22, path: "/Users/me/.claude/agents",     rule: "glob",         depth: 4, pattern: "*.md" },
  { id: 5, category_id: 23, path: "/Users/me/.claude/commands",   rule: "glob",         depth: 4, pattern: "*.md" },
];
```

| Rule | Matches | Used by |
|------|---------|---------|
| `child-dir` | every direct child directory of `path` | `skill` (dirs, each with a `SKILL.md`) |
| `child-or-git` | every direct child, plus any deeper dir (to `depth`) whose top level has `.git`; stops descending at a repo — today's `discoverProjects` behavior, unchanged | `project` |
| `glob` | files or dirs under `path` matching `pattern` (relative, one level unless the pattern itself has `/`) | `agent`, `command` (flat dirs of `.md` files) |

Scan algorithm, one function replacing `discoverProjects` + `scanProjects`:

```js
async function scanSource(source) {
  switch (source.rule) {
    case "child-dir":
      return (await readdir(source.path, { withFileTypes: true }))
        .filter(e => e.isDirectory() && !e.name.startsWith("."))
        .map(e => join(source.path, e.name));
    case "child-or-git":
      return discoverProjects(source.path, source.depth);   // unchanged walk from packages/watch/src/projects.ts
    case "glob":
      return glob(join(source.path, source.pattern || "*"));
  }
}

async function scanSources(db, home) {
  const added = [];
  for (const category of listCategories(db)) {
    for (const source of listSources(db, category.id)) {
      for (const path of await scanSource(source)) {
        if (findItemByPath(db, path)) continue;
        const id = insertItem(category.kind, basename(path), abbreviatePath(path, home), path, category.id);
        setTags(db, id, [category.name]);
        added.push(path);
      }
    }
  }
  return added;   // never removes, same guarantee as scanProjects
}
```

**Replacing `project_parents` without breaking `pf-projects`.** `project_parents` rows migrate
1:1 into `sources` with `category_id` set to the `project` category's id and `rule:
"child-or-git"`. `packages/db/src/projects.ts`'s `listProjectParents`, `addProjectParent`,
`removeProjectParent` become thin wrappers:

```js
const listProjectParents = db => listSources(db, projectCategoryId(db)).map(s => ({ id: s.id, path: s.path }));
const addProjectParent = (db, path) => createSource(db, { category_id: projectCategoryId(db), path, rule: "child-or-git" });
const removeProjectParent = (db, id) => deleteSource(db, id);
```

`pf-projects parents add/rm/ls` and `POST /api/project-parents` call these same names, so nothing
above the repo layer changes. `scanProjects(db, home)` becomes `scanSources(db, home)` filtered to
the `project` category internally; `pf-projects scan` and `POST /api/projects/scan` keep their
current signatures. The `project_parents` table itself is dropped once the migration copies its
rows (see section 7).

## 4. The AI and programming category set

### Harnesses

```js
const harnessCategory = { id: 20, name: "harness", kind: "dir",
  slots: [
    { name: "config_dir",   kind: "dir",  path: "." },
    { name: "skills_dir",   kind: "dir",  path: "skills" },
    { name: "agents_dir",   kind: "dir",  path: "agents" },
    { name: "commands_dir", kind: "dir",  path: "commands" },
    { name: "log_dir",      kind: "dir",  path: "~/Library/Logs/{name}" },
    { name: "config_file",  kind: "file", path: "settings.json" },
  ] };
```

Three members, same category, different layouts — every layout difference lives in
`slot_paths`, not in the category:

```js
const claudeCode = { id: 101, type: "dir", title: "Claude Code",
  path: "/Users/me/.claude", category_id: 20,
  slot_paths: JSON.stringify({
    skills_dir: "skills", agents_dir: "agents", commands_dir: "commands",
    config_file: "settings.json", log_dir: "~/Library/Logs/Claude",
  }) };

const codex = { id: 102, type: "dir", title: "Codex",
  path: "/Users/me/.codex", category_id: 20,
  slot_paths: JSON.stringify({
    config_file: "config.toml", log_dir: "~/Library/Logs/codex", skills_dir: "",
  }) };   // empty override string on a slot the harness doesn't have — resolves to "not applicable", exists: false

const aider = { id: 103, type: "dir", title: "Aider",
  path: "/Users/me/.aider", category_id: 20, slot_paths: "{}" };   // pure category defaults, generic harness
```

`aider` needs no override at all — the category's own slot paths already fit a harness with a
`config_dir`, `skills_dir`, etc. laid out the default way. That's the "generic one": any harness
that follows the default layout gets full slot coverage for free by joining the category.

### Skills, agents, commands

```js
const skillCategory   = { id: 21, name: "skill",   kind: "dir",  slots: [{ name: "definition", kind: "file", path: "SKILL.md" }] };
const agentCategory   = { id: 22, name: "agent",   kind: "file", slots: [] };
const commandCategory = { id: 23, name: "command", kind: "file", slots: [] };
```

Skills are dirs (each with a `SKILL.md`); agents and commands are flat `.md` files, so their
categories are `kind: "file"` with no slots of their own — they get their actions from being a
`file`-kind category member (copy path, reveal, open, open in editor, create), which is the whole
point: no special-casing needed once "agent definition" is just a file-category member.

### Prompts

```js
const promptCategory = { id: 24, name: "prompt", kind: "note", slots: [] };

const promptPast    = { id: 500, type: "note", category_id: 24, title: "Refactor db categories",  content: "…" };
const promptPresent = { id: 501, type: "note", category_id: 24, title: "Widen slot kinds",         content: "…" };
const promptFuture   = { id: 502, type: "note", category_id: 24, title: "Try a harness comparison", content: "…" };
// tags: promptPast → ["prompt", "past"], promptPresent → ["prompt", "present"], promptFuture → ["prompt", "future"]
```

Status is a tag, not a column — `past`/`present`/`future` are just tag names, consistent with how
everything else in the app already carries state through `taggings`. A `prompt` slot list stays
empty by design; nothing about a prompt needs a resolved path today, and the category exists so
prompts are query-able (`pf-items ls -g prompt`) and so a slot can be added later without a
migration.

### Programming: projects

`project` is unchanged in shape from today — it's the proof this design doesn't regress the one
category that already works:

```js
const projectCategory = { id: 9, name: "project", kind: "dir",
  slots: [{ name: "tasks", kind: "file", path: "TASKS.md" }] };
```

Ports get their second home here through the existing `services` machinery
(`packages/watch/src/services.ts`, already shipped for the desktop app per `CONTRACT.md`):
`projectServices(path)` reads `package.json` scripts (and a `Makefile`) deterministically, and
`serviceCommand(services, name, args)` builds the exact shell line. That's not a new concept —
it's the deterministic "how to start/stop services" piece the user asked for, and it already
exists; this design just means every `project`-category member gets it automatically, the same
way every member gets its `tasks` slot.

### Giving agents context

The use case: hand an agent a Markdown dump of what's known about a harness (or any category
member) so it can be pasted into a session or piped straight in.

```
GET /api/items/101/context → text/markdown
```

```md
# Claude Code

- config_dir: /Users/me/.claude (exists)
- skills_dir: /Users/me/.claude/skills (exists)
- agents_dir: /Users/me/.claude/agents (exists)
- commands_dir: /Users/me/.claude/commands (exists)
- log_dir: /Users/me/Library/Logs/Claude (missing)
- config_file: /Users/me/.claude/settings.json (exists)
```

The CLI counterpart, `pf-categories context <ITEM_ID>`, prints the same Markdown to stdout — no
new formatting logic, it's `memberSlots(db, item)` rendered as a bullet list, one line per
resolved slot, kind-aware (`link` slots print the URL, `note` slots print the attached note's
title, `command` slots print the resolved command line).

## 5. yt: no new concept needed

The channel is a portfolio, videos are tagged, and a `video` category (kind `dir`) supplies the
one shared file every video has, `slides.md`, through the exact same slot mechanism as `project`'s
`tasks` file:

```js
const youtube = { id: 4, name: "YouTube", description: "everything for the channel" };

const videoCategory = { id: 25, name: "video", kind: "dir",
  slots: [{ name: "slides", kind: "file", path: "slides.md" }] };

const video = { id: 600, type: "dir", title: "Procedural thinking ep.4",
  path: "/Users/me/yt/proc-4", category_id: 25 };
// tags: ["yt", "procedural-thinking"]

const script = { id: 601, type: "document", title: "Ep.4 script", path: null, category_id: null };
const referenceLink = { id: 602, type: "link", title: "source paper", url: "https://…", category_id: null };
// tags on both: ["yt", "procedural-thinking"]

const card = { title: "Procedural thinking", tags: ["procedural-thinking"], types: [],
  sort_key: "created_at", sort_dir: "asc" };
// runs against the portfolio and returns the video dir, its script document, and its
// reference link together, ordered — the grouping is the tag, not a new relationship
```

Nothing here needs a new item type, a new table, or a new relationship. The video dir is a
`video`-category member with a `slides` slot that behaves exactly like `project`'s `tasks` slot
(copy path, reveal, open, open in editor, create). The loose files, notes, and links around it are
untyped and uncategorized — they're just tagged into the same portfolio card. This is the point of
the design: a portfolio + tags already covers "an arbitrary group of things," and categories only
need to step in where members share concrete, path-shaped (or link-shaped, note-shaped,
command-shaped) structure.

## 6. Desktop UI

### Category member page

Slot rows render the same way for every kind, with the action list narrowed by `data-kind` (the
existing context-menu convention in `CONTRACT.md`'s frontend section):

```text
┌─ Claude Code ──────────────────────────────────── category: harness ─┐
│ /Users/me/.claude                                                    │
│                                                                       │
│  Slots                                                                │
│  ┌───────────────┬──────┬──────────────────────────────┬──────────┐ │
│  │ config_dir     │ dir  │ /Users/me/.claude             │ ●exists  │ │
│  │ skills_dir     │ dir  │ /Users/me/.claude/skills      │ ●exists  │ │
│  │ agents_dir     │ dir  │ /Users/me/.claude/agents      │ ●exists  │ │
│  │ commands_dir   │ dir  │ /Users/me/.claude/commands    │ ●exists  │ │
│  │ log_dir        │ dir  │ ~/Library/Logs/Claude         │ ○missing │ │
│  │ config_file    │ file │ /Users/me/.claude/settings.json│ ●exists │ │
│  └───────────────┴──────┴──────────────────────────────┴──────────┘ │
│  right-click a row → [Copy path] [Reveal] [Open] [Open terminal here]│
│                        [Create] [Scan]  (dir rows only get the last 2)│
│                                                                       │
│  [ Copy context as Markdown ]     ← calls GET /api/items/101/context │
└────────────────────────────────────────────────────────────────────┘
```

A `link`/`note`/`command` slot row looks the same, with a kind-appropriate menu:

```text
│  repo          │ link │ https://github.com/me/app     │ ●exists   │
│    right-click → [Open in-app] [Open in system browser] [Copy]      │
│  context       │ note │ (no note yet)                  │ ○missing  │
│    right-click → [Open]  ← creates the note, then opens it          │
│  restart       │ cmd  │ docker compose restart app     │ ●exists   │
│    right-click → [Run] [Run with args] [Copy]                       │
```

"Create, or act as if it already exists" is visible here as: a missing row still has a full,
clickable action list. Nothing is greyed out because it doesn't exist yet — the row behaves
identically whether or not the target is there, and the first action that needs it brings it into
existence.

### Categories page editor

```text
┌─ Categories ───────────────────────────────────────────────────────┐
│  name       kind   members  slots                                  │
│  project    dir    14       tasks:file                        [Edit]│
│  harness    dir    3         config_dir:dir, skills_dir:dir, …[Edit]│
│  skill      dir    22        definition:file                  [Edit]│
│  agent      file   9         (none)                            [Edit]│
│  prompt     note   31        (none)                            [Edit]│
│  video      dir    18        slides:file                      [Edit]│
│                                                       [+ New category]│
└──────────────────────────────────────────────────────────────────────┘

Editing "harness":
┌─ Edit category ──────────────────────────────────────────────────┐
│ name  [harness       ]   kind [dir ▾]                              │
│                                                                     │
│ Slots                                                              │
│  name          kind ▾      path / template                        │
│  config_dir    [dir    ▾]  .                                  [x] │
│  skills_dir    [dir    ▾]  skills                              [x] │
│  agents_dir    [dir    ▾]  agents                              [x] │
│  commands_dir  [dir    ▾]  commands                            [x] │
│  log_dir       [dir    ▾]  ~/Library/Logs/{name}                [x] │
│  config_file   [file   ▾]  settings.json                       [x] │
│                                                          [+ Slot]   │
│  kind ▾ options: file, dir, link, note, command                    │
│                                                                     │
│ Sources                                                             │
│  path                           rule            pattern     depth  │
│  ~/.claude/skills               child-dir        —            —  [x]│
│  ~/proj/claude/skills           child-dir        —            —  [x]│
│                                              [+ Source]  [Scan now] │
│                                                                     │
│                                         [ Cancel ]  [ Save ]        │
└──────────────────────────────────────────────────────────────────┘
```

The slot editor is the same textarea-backed form `pf-categories edit --slots` already drives —
just with the kind column widened from a 2-way to a 5-way choice, and a new "Sources" panel below
it that lists/adds/removes rows in the `sources` table for this category, plus a "Scan now" button
that calls the same scan the nightly/on-demand job runs.

## 7. Migration and rollout order

| Order | Package | Change | Tests to add | Est. |
|-------|---------|--------|---------------|------|
| 1 | `@portfolio/core` | Widen `Slot.kind`/`PathType` → add `SlotKind = "file" \| "dir" \| "link" \| "note" \| "command"`; update `resolveSlots` for the three new kinds and template substitution (`{name}`, `{title}`, `{path}`) | `resolveSlots` per new kind, template substitution, note-override round trip | 4–6h |
| 2 | `@portfolio/db` | `sources` table in `schema.sql`; `sources.ts` repo (`listSources`, `createSource`, `deleteSource`); migrate `project_parents` rows into `sources` in `openDatabase`'s migration step, then drop the old table; `categoryMembers`/`memberSlots` unchanged | migration test: seed `project_parents`, open db, assert `sources` has equivalent rows and old table is gone | 4–5h |
| 3 | `@portfolio/watch` | Replace `discoverProjects`/`scanProjects` special case with `scanSource(source)` (three rules) + `scanSources(db, home)`; keep `discoverProjects` itself as the `child-or-git` implementation (no behavior change) | one test per rule (`child-dir`, `child-or-git`, `glob`) against real temp dirs; a "never removes" test like the existing project one | 5–6h |
| 4 | `@portfolio/db` (projects.ts) | `listProjectParents`/`addProjectParent`/`removeProjectParent` become wrappers over `sources` filtered to the `project` category, same return shapes | existing `pf-projects` tests keep passing unmodified — that's the pass/fail bar | 2h |
| 5 | `@portfolio/api` | `path-action` gains kind-aware handling (`link`, `note`, `command`); new `GET /api/items/:id/context`; categories routes accept the wider slot kind; sources CRUD routes under `/api/categories/:id/sources` | route tests per kind's actions; context endpoint snapshot test | 5–6h |
| 6 | `@portfolio/cli` / `bin/pf-categories`, `bin/pf-projects` | `pf-categories` gains `sources add/rm/ls` and `context <ITEM_ID>`; `pf-projects parents` keeps its exact CLI surface, now backed by `sources` | CLI smoke tests already run against `pf-projects`; add one for `pf-categories context` | 3h |
| 7 | `@portfolio/ui` + desktop frontend | Slot row rendering per kind, kind-aware context menu entries, categories/sources editor panel | component tests for slot row per kind; manual pass through the wireframe in section 6 | 6–8h |

Rollout order matters because each layer only needs the layer below it done: `core` first since
everything imports its types, `db` next since it's the only place `project_parents` physically
lives, `watch` third since it's the only caller of the old discovery function, then `api` → `cli`
→ `ui` outward to the edges. Total: roughly 30–36 hours, one package at a time, each shippable on
its own (a `db`-only release with no UI change is safe, since nothing reads `sources` until
`watch` does).

**CLI gains, concretely:**

- `pf-categories` — `sources add <CATEGORY> <PATH> [-r RULE] [-p PATTERN] [-d DEPTH]`, `sources
  rm <ID>`, `sources ls <CATEGORY>`, `context <ITEM_ID>` (prints the Markdown dump).
- `pf-projects` — no new subcommands; `parents add/rm/ls` and `scan` keep working unchanged,
  now backed by `sources` under the hood.

Back to the [index](../index.md).
