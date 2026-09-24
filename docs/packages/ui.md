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

## Herdr console

The same interactive console runs in Wails or a normal React web app. It has no
desktop imports and uses the existing Portfolio HTTP transport:

```tsx
import { useSearchParams } from "react-router";
import { PortfolioClient } from "@portfolio/client";
import { createHerdrClient } from "@portfolio/herdr";
import { HerdrPage } from "@portfolio/ui/herdr";
import "@portfolio/ui/tokens.css";
import "@portfolio/ui/herdr.css";

const transport = new PortfolioClient("http://127.0.0.1:4388");
const herdr = createHerdrClient((path, init) => transport.request(path, init));

function HerdrRoute() {
  const [params, setParams] = useSearchParams();
  return <HerdrPage client={herdr} params={params}
    onParamsChange={next => setParams(next, { replace: true })} />;
}
```

The host owns routing; any router that can supply these props works. The client is
created outside render so background refresh is not restarted on every keystroke.
Include React Router's `useSearchParams` for the example above, or pass your router's
equivalent. Run the Portfolio API on the same machine as Herdr; browsers cannot open
Unix sockets. API access is restricted to local origins.

`@portfolio/herdr/server` contains the Bun-only `HerdrService`. The package's default
entry point contains only shared models, entity targeting, and the HTTP client factory;
browser bundles never import `node:net`, process launching, or schema validation.

`CollectionToolbar`, `SelectionBar`, and `useSelection` are exported from
`@portfolio/ui/collections`. The selection hook supports both numeric record IDs and
session-qualified string IDs.

Tests: `packages/ui/test/ui.test.tsx` (react-dom/server). Back to the [index](../index.md).
