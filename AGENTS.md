## Agent skills

Always check if you are running in Sidecar: run sidecar --agents for capabilities.

## MANDATORY: Use td for Task Management

You must run td usage --new-session at conversation start (or after /clear) to see current work.
Use td usage -q for subsequent reads.

### Issue tracker

Issues live in GitHub Issues for unixsuperhero/portfolio, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## UI rules

### Every listing is filterable, sortable, and searchable

Any page, card, or panel that lists items (library items, tasks, reminders, PRs, projects, ports, cards, categories, settings rows, anything) ships with the shared collection tools: a search box, a sort select, and filter selects for each meaningful attribute, all reflected in the URL query so the state survives navigation. Use `CollectionToolbar` and `SelectionBar` from `@portfolio/ui/collections` (`packages/ui/src/components/collections.tsx`). A new attribute on a listed record (for example a PR's `source_dir`) gets a filter, a sort option, and search coverage in the same change that adds it. See `docs/desktop.md`.

### Links must remain keyboard reachable

All navigable `<a href>`, React Router `Link`, and `NavLink` elements must participate in normal Tab/Shift+Tab order. Never give them a negative `tabindex`/`tabIndex`, remove their `href`, or suppress keyboard focus. Use native link semantics; do not patch individual pages with positive tabindex values. Keep macOS Wails `Mac.WebviewPreferences.TabFocusesLinks` enabled in `apps/desktop/main.go`. Verify actual keyboard traversal across navigation, page actions, and collection-item links, not just DOM tabindex values.

### Listing rows take part in pseudo focus

Every listing row must be reachable with `j`/`k` and respond to `Enter`, `Space`, and `.` (see "List keys and pseudo focus" in `docs/desktop.md`). Rows that match `NAV_ROW_SELECTOR` in `apps/desktop/frontend/src/lib/list-nav.ts` work automatically; give any other row `data-nav-item`. Do not move browser focus to rows or add per-page key handlers for these keys. `Cmd+K` must open the command palette from any focused element, text fields included.
