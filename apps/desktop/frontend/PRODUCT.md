# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The React frontend renders inside a Wails v3 WebKit window on macOS. The design language is web, not native AppKit; native affordances arrive through Go services (browser windows, terminal PTY, reveal/open/clipboard/notification).

## Users

One person: the developer who owns this repository, working on their own Mac. There is no second audience. Every design decision may assume the user already knows the data model, the CLI tools, and the repo layout, and never needs onboarding, marketing, or explanation.

## Product Purpose

Portfolio is a local, private workspace for one developer's working life across many projects. The desktop app is the shell around a library of documents, notes, links, files, directories, and pull requests, plus dashboards (portfolios of cards), tasks, reminders, project discovery, running services, and local ports. It has a built-in terminal and opens links in real browser windows.

The user confirmed the app has three equal jobs, none dominant:

- **Daily cockpit**: the home portfolio is where the day starts and gets checked. Tasks, reminders, PRs, and running services are visible at a glance.
- **Project switchboard**: find a project, see its services and ports, open a terminal or browser into it, and move on to the next one.
- **Reference library**: find documents, notes, and links again, with tags, categories, and slots.

Success is the user reaching for the app first, staying in it instead of scattering across browser tabs and terminals, and never losing track of a task, PR, or service.

## Positioning

Everything is local and belongs to the user: one SQLite file, source files at real paths on disk, no accounts, no sync, no cloud. The app is a thin React shell over the same `@portfolio/api` routes the `pf-*` CLI tools use, so the app and the terminal always agree. It embeds a real terminal (vendored libghostty) and real WKWebView browser windows, so GitHub PRs and local dev servers open inside the app rather than in iframes or hand-offs.

## Operating Context

- Runs as `Portfolio.app` on macOS, built with Wails v3 beta. Started from the `.app` bundle, not the bare binary.
- The frontend never touches SQLite. Every read and write goes through `@portfolio/api`, a Bun sidecar on port 4388, proxied by Go because the page is a secure `wails://` origin.
- The older HTML server (`app.js` on 4387) still exists and is untouched.
- The user also drives the same data from the terminal with `pf` and fifteen `pf-*` tools, and from the `h-pf` entry in the hiiro toolset.
- Pull requests come from the `gh` CLI, polled on a schedule; checks can be watched or ignored per PR.
- Watched directories discover projects; each project carries its services (runner, scripts) and the TCP listeners in its directory.
- Contract for all four parts of the desktop app (Go, terminal, React shell, backend) lives at `apps/desktop/CONTRACT.md`. Change it there first.

## Capabilities and Constraints

Confirmed capabilities (see `docs/desktop.md` and `docs/data-model.md` for shapes):

- Library: items of many types with tags, pinned/starred flags, categories with slots and per-item overrides, path actions (copy, reveal, open, create).
- Portfolios: boards of cards. Card kinds: `query`, `tasks`, `reminders`, `ports`, `clock`, `note`, `services`, `prs`, tiles, dashboard. One portfolio is the home page.
- Tasks with nesting, daily or one-off recurrence, streaks, and completion history.
- Reminders as independent records with their own schedule; optional link to a task; deletion confirmed by an in-app dialog because the webview has no `window.confirm`.
- Projects, services, ports (with safe kills), pull requests with check summaries.
- Command palette, toast notifications, Markdown rendering (GitHub-flavored) and a plain-text Markdown editor for notes.
- Built-in terminal (canvas-rendered) and browser windows without a toolbar.

Binding constraints the user confirmed:

- **macOS only.** No Windows or Linux target. macOS expectations apply.
- **Keyboard-first.** The command palette and shortcuts are the primary way to navigate; the mouse is secondary. Every action must remain reachable without a pointer.
- **Dark default, light optional.** The app opens dark; a light theme toggle stays. Both must remain complete.
- **CLI parity.** Anything the app can do, a `pf-*` command must also be able to do. The app never gets exclusive features; new capability lands as an API route first.

Technical constraints future work must respect:

- WebKit inside Wails: no `window.confirm`, POST bodies and `Content-Length` are handled by the Go proxy, `ExecJS` is gated on runtime load. See `docs/desktop.md` for the full list.
- Periodic work (polling, heartbeats) must never reset or disturb the page the user is on.
- Frontend stack is fixed: React 19, react-router 7, Vite, `@portfolio/ui` components and tokens. No new UI framework.

Terminology: **item** (any library record), **portfolio** (a board of cards), **card** (one widget on a board), **category** and **slot** (typed path assignments on an item), **project** (a discovered repo), **service** (a runnable script in a project), **port** (a TCP listener), **PR** (a GitHub pull request).

Undecided: nothing recorded as open. The user has not asked for multi-user, sync, or non-macOS support.

## Brand Commitments

The name is **Portfolio**. There is no logo, tagline, or marketing voice; none is wanted. Copy is terse and literal, written for the owner. No binding visual constraint was volunteered beyond the dark-default and light-theme requirement recorded above.

## Evidence on Hand

- Real data: the user's own `portfolio.sqlite`, documents under `~/claude/docs/`, and live repos under watched directories. Any screenshot or demo can use real content; nothing needs to be invented.
- Existing UI: `apps/desktop/frontend/src/**` (pages, cards, components) and `packages/ui` (shared components, `tokens.css`, `cards.css`), plus a demo page for the UI package.
- Docs: `docs/index.md`, `docs/desktop.md`, `docs/data-model.md`, `docs/ui/components.md`, `docs/ui/demo.md`, and the design note `docs/design/categories-everywhere.md`.
- Scripted testing of the running app through the Wails MCP tools (`WAILS_MCP_PORT`), described in `docs/desktop.md`.
- Absent: no testimonials, customers, benchmarks, pricing, or press. Never fabricate any.

## Product Principles

1. **The owner is the only user.** Optimize for someone who already knows everything; never spend space on explanation or persuasion.
2. **Three jobs, one shell.** Cockpit, switchboard, and library are equal. No job's UI may crowd out another's, and a card on the home board is the unit that ties them together.
3. **Local truth, shared with the terminal.** The app shows what the CLI shows. If a feature cannot be an API route, it does not belong in the app.
4. **Hands stay on the keyboard.** Every screen is navigable and actionable from the command palette and shortcuts.
5. **Nothing moves under the user.** Background polling and refreshes never reset scroll, selection, focus, or an edit in progress.

## Accessibility & Inclusion

No external standard was set. The binding product need is full keyboard operability of every screen and action, and two complete color themes (dark and light) with readable contrast in each.
