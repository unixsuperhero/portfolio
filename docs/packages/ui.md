# @portfolio/ui

React components for the parts of Portfolio worth keeping: the portfolio card above all, plus the grid, the card form and editor, the rail sections and rail items the library's side columns use, the library item row, and the kind and tag badges. Class names match the server's CSS, so a page can mix server-rendered HTML and components.

```ts
import { PortfolioCard, PortfolioGrid, CardEditor, RailSection, ItemList } from "@portfolio/ui";
import "@portfolio/ui/tokens.css";
import "@portfolio/ui/cards.css";
```

Peer dependencies: `react` and `react-dom` 18 or 19. The package ships TypeScript source; `bun run --cwd packages/ui build` writes `dist/` for consumers that need JavaScript.

- [Components](../ui/components.md) — props and examples for every component and hook
- [Demo and theming](../ui/demo.md) — `bun run ui:demo`, the tokens, light and dark

Server rendering:

```ts
import { toHtml } from "@portfolio/ui/server";
toHtml(PortfolioCard, { card, items, total });   // static HTML string
```

Tests: `packages/ui/test/ui.test.tsx` (react-dom/server). Back to the [index](../index.md).
