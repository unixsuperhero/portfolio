# @portfolio/client

A `fetch`-based client for the server's HTTP API. Works in Bun, Node 18+, and browsers, so the React components and the CLI share it. This replaces the `PortfolioApi` class inside the Ruby `h-docs` and the curl calls inside `mdoc`.

```ts
import { PortfolioClient } from "@portfolio/client";
const api = new PortfolioClient();                          // PORTFOLIO_SERVER, HDOCS_SERVER, or http://127.0.0.1:4387
const api2 = new PortfolioClient("http://docs.h:4387", { fetch: myFetch, headers: {} });
```

| Method | Calls |
|--------|-------|
| `health()` | `GET /health` |
| `items(filter)` | `GET /api/items?q&contents&pinned&starred&type&tag&limit` |
| `item(id)` | `GET /api/items/:id` (with tags and slots) |
| `deleteItem(id, deleteFiles?)` | `DELETE /api/items/:id` |
| `detect(content)` | `GET /api/detect` |
| `quickAdd(content, { type, tags })` | `POST /items/quick` |
| `createItem(fields)` | `POST /api/items` |
| `createDocuments(docs, { roots, title, description, toc })` | `POST /api/documents` (multipart, like mdoc) |
| `toggle(id, field)`, `addTags(id, tags)` | `POST /items/:id/toggle`, `POST /items/:id/tags` |
| `portfolio(id)`, `createPortfolio`, `createCard` | portfolios and cards |
| `ports()`, `killPort(pid, signal)` | ports |
| `settings()`, `directories(path, files?)`, `pastry(id, format, visibility)` | settings, the directory browser, Pastry uploads |
| `url(path, query)`, `absolute(href)` | URL helpers |

Errors are `PortfolioApiError` with `status` (0 when the server is unreachable) and the parsed body.

```js
const view = await api.portfolio(1);
// { id: 1, name: "YouTube", cards: [{ id: 3, title: "Scripts", tags: ["yt"], types: [], total: 12, items: [ItemView…] }] }
```

Tests: `packages/client/test/client.test.ts` (fake fetch). Back to the [index](../index.md).
