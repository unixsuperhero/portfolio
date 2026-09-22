# Demo and theming

## The demo page

```bash
bun run ui:demo            # serves http://localhost:4390 and opens it
PORT=4391 OPEN=0 bun run --cwd packages/ui demo
```

`packages/ui/demo/serve.ts` is a twelve-line `Bun.serve` that bundles `demo.tsx` on every request, so editing a component and reloading shows the change. `demo/sample.ts` holds nine sample items and four cards; the page runs each card's query in the browser with `runCard`, and the edit panels, move arrows, delete, and the add-card form all work against that in-memory list. There is a theme toggle in the header.

Sections on the page: `PortfolioGrid` with editors, a single capped `PortfolioCard`, a `RailSection` like the library's side rail, an `ItemList`, and a bare `CardForm` that alerts the normalized spec it would submit.

## CSS

Two files, both plain CSS with no build step:

- `tokens.css` sets the variables on `:root`: `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--text`, `--text2`, `--text3`, `--accent`, `--accent2`, `--gold`, `--danger`, `--radius`, `--sans`, `--mono`. `:root[data-theme="light"]` overrides them with the paper palette from the document template. `.pf-body` is the page background the app uses.
- `cards.css` styles `.rail-section`, `.rail-item`, `.kind`, `.tag`, `.portfolio-grid`, `.portfolio-card`, `.card-query`, `.card-edit`, `.card-form`, `.card-actions`, `.items`, `.item`, `.icon-button`, `.empty`, with the same breakpoints as the app.

To theme, set the variables; nothing in the components carries a color. To go light, put `data-theme="light"` on `<html>`.

## Using the package elsewhere

```bash
bun run --cwd packages/ui build     # dist/index.js + dist/*.css, react left external
```

Then `import { PortfolioCard } from "<path>/packages/ui/dist/index.js"` or publish the package. The only runtime dependency besides React is `@portfolio/core`, which is bundled in.

Back to the [index](../index.md).
