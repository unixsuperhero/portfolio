# UI components

All components take plain data (see the [data model](../data-model.md)) and call back with plain data. None of them fetch, and none of them own global state, so a heartbeat or a reload elsewhere on a page never resets them.

## PortfolioCard

The card. Header with title and count, a query line with tag pills, type badges and the sort, a scrolling list of rail items showing the date the card sorts by, and an optional footer.

```tsx
<PortfolioCard
  card={card}                       // CardSpec (+ id): title, tags, types, sort_key, sort_dir, max_items
  items={result.items}              // ItemView[] already sorted and capped
  total={result.total}              // header shows "2 of 37" when capped
  hrefFor={item => item.href}       // optional
  tagHrefFor={tag => `/tags/${tag}`}
  onOpen={item => …}                // optional: intercept clicks instead of navigating
  emptyText="Nothing matches this card yet."
  footer={<CardEditor … />}         // anything under the list
/>
```

Rendered shape (what the tests assert):

```html
<section class="rail-section portfolio-card">
  <header><h2>Scripts</h2><div class="rail-heading-actions"><span>2 of 37</span></div></header>
  <div class="card-query"><a class="tag" href="/tags/yt">yt</a><span class="kind">DOC</span><span class="card-sort">Title ↑</span></div>
  <div class="rail-items">
    <article class="rail-item is-pinned" data-item="42"><a href="/items/42">…</a><p>…</p><div><span class="kind">DOC</span><time>2026-09-01</time><span>Pinned</span></div></article>
  </div>
  <!-- footer -->
</section>
```

Where the items come from is the caller's business: `cardItems(db, card)` on a server, `runCard(card, views)` in a browser that already holds the items, or `client.portfolio(id)` for the whole page.

## PortfolioGrid

Three cards per row (two below 1100px, one below 700px).

```tsx
<PortfolioGrid
  cards={view.cards}                              // (Card & { items, total })[]
  footerFor={card => <CardEditor value={card} onSubmit={spec => save(card.id, spec)} onMove={d => move(card.id, d)} onDelete={() => remove(card.id)} />}
  trailing={<RailSection className="portfolio-card" title="+ Add card"><CardEditor open summary="New card" onSubmit={add} submitLabel="Add card" /></RailSection>}
/>
```

## CardForm and CardEditor

`CardForm` is the controlled editor for a card's query. It emits a normalized `CardSpec` through `onSubmit`, so a caller never sees a bad sort key or a max of 5000.

```tsx
<CardForm value={card} onSubmit={spec => …} submitLabel="Save card" actions={<…/>} />
```

`CardEditor` wraps it in the collapsed `<details class="card-edit">` panel a card shows under its list, with move and delete buttons when `onMove` / `onDelete` are given.

```tsx
<CardEditor value={card} open={false} summary="Edit card" onSubmit={…} onMove={direction => …} onDelete={() => …} />
```

## CardQuery

The query line on its own: `<CardQuery card={card} tagHrefFor={…} />`. Shows `everything` when the card has neither tags nor types.

## RailSection and RailItem

The bordered panel the library uses for Notes, PRs, and Links, and every portfolio card is one.

```tsx
<RailSection title="Links" count={12} items={links} onAdd={() => openQuickAdd("link")} emptyText="No links yet." />
<RailSection title="Custom" subheader={<p>…</p>} footer={<p>…</p>}>{/* arbitrary children instead of items */}</RailSection>
<RailItem item={view} dateKey="updated_at" showKind hrefFor={…} onOpen={…} />
```

External types (link, pr) open in a new tab automatically.

## ItemRow and ItemList

The library's full-width rows: date column, kind badge and title, description, tags, then pin, star, and edit actions.

```tsx
<ItemList items={views} tagHrefFor={tag => `/tags/${tag}`} onToggle={(item, field) => api.toggle(item.id, field)} editHref={item => `/items/${item.id}/manage`} />
```

`ItemRow` takes `leading` (a checkbox for bulk selection) and `actions` (extra buttons).

## Badges

- `<KindBadge type="pr" />` → `<span class="kind">PR</span>`
- `<Tag name="yt" href="/tags/1" />`, `<Tag name="yt" onClick={…} />`, `<Tag name="yt" />` → link, button, or span
- `<TagList tags={["a", "b"]} hrefFor={…} onClick={…} />` → nothing when empty
- `<EmptyState title="Nothing here." hint="Change the filters." />`

## Hooks

```ts
const { data, error, loading, reload } = usePortfolio(client, 1);   // client.portfolio(1)
const items = useItems(client, { q: "yt", limit: 50 });              // client.items(filter)
const anything = useLoader(() => fetchSomething(), [dep]);
```

`useLoader` keeps its own slice of state, ignores late responses after a dependency changes, and exposes `reload()` so a heartbeat can refresh data without touching anything else on the page. The hooks only need an object with `portfolio(id)` and `items(filter)`, which is what [@portfolio/client](../packages/client.md) provides.

## Server rendering

```ts
import { toHtml } from "@portfolio/ui/server";
const html = toHtml(PortfolioGrid, { cards });
```

Back to the [index](../index.md).
