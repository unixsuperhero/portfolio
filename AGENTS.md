## Agent skills

### Issue tracker

Issues live in GitHub Issues for unixsuperhero/portfolio, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## UI rules

### Every listing is filterable, sortable, and searchable

Any page, card, or panel that lists items (library items, tasks, reminders, PRs, projects, ports, cards, categories, settings rows, anything) ships with the shared collection tools: a search box, a sort select, and filter selects for each meaningful attribute, all reflected in the URL query so the state survives navigation. Use `CollectionToolbar` and `SelectionBar` from `@portfolio/ui/collections` (`packages/ui/src/components/collections.tsx`). A new attribute on a listed record (for example a PR's `source_dir`) gets a filter, a sort option, and search coverage in the same change that adds it. See `docs/desktop.md`.
