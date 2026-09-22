# Portfolio Desktop

Wails v3 desktop shell for Portfolio: library/dashboard UI, an in-app browser, and a
terminal, backed by the `@portfolio/api` sidecar. See [CONTRACT.md](CONTRACT.md) for the
full cross-part contract this app implements.

## Running

From `apps/desktop`:

```sh
wails3 dev                # dev mode: vite on :9245, hot reload for Go + frontend
wails3 task build          # production build (runs `bun install` + `bun run build`
                            # in frontend/, then builds the Go binary)
```

`wails3 dev` and the built app both start the `@portfolio/api` sidecar automatically
(see "Sidecar behaviour" below). If port 4388 is already answering `/health` (e.g. you
started `bun run packages/api/src/server.ts` yourself), the app adopts it instead of
spawning a second copy.

## Services and events

Four Go services are registered in `main.go` and bound to the frontend at
`frontend/bindings/portfolio-desktop/`:

- **SidecarService** (`sidecarservice.ts`) — `Status()` reports `{ Url, Running, Pid,
  Error }` for the `@portfolio/api` process.
- **PtyService** (`ptyservice.ts`) — `Create`, `Write`, `Resize`, `Close`, `List` for
  pty-backed shell sessions used by the in-app terminal dock.
- **BrowserService** (`browserservice.ts`) — `Open`, `List`, `Close` for the in-app
  browser windows opened from the context menu.
- **NativeService** (`nativeservice.ts`) — `Reveal`, `OpenPath`, `OpenWith`, `OpenUrl`,
  `CopyText`, `Notify`, `Home`, `PickDirectory`, `PickFile` for native macOS integrations.

Two typed custom events are emitted and available from `frontend/bindings/.../models.ts`:

- `pty:data` — `{ Id, Data }`, `Data` is base64 of the raw bytes read from a pty session
  (binary safe; chunked at 32KB reads).
- `pty:exit` — `{ Id, Code }`, emitted once a session's shell process exits.

## Sidecar behaviour

On startup, `SidecarService`:

1. Checks `GET http://127.0.0.1:4388/health` (500ms timeout). If it answers, the sidecar
   is adopted and nothing is spawned.
2. Otherwise locates the monorepo root (`PORTFOLIO_HOME` env var if set, else walks up
   from the executable's directory and the current working directory looking for a
   `package.json` with `"name": "portfolio"`).
3. Spawns `bun run packages/api/src/server.ts` with `cwd` set to the repo root and
   `PORTFOLIO_API_PORT=4388`, appending stdout/stderr to `REPO/logs/desktop-api.log`.
   `bun` is resolved from `PATH`, falling back to `/opt/homebrew/bin/bun`.
4. Polls `/health` for up to 10s before giving up.

On shutdown, a spawned sidecar (not an adopted one) receives `SIGTERM`, then `SIGKILL`
after 2s if it hasn't exited.

## Notes / gaps

- `frontend/dist/index.html` is a gitignored placeholder so `go build` (which embeds
  `frontend/dist` via `//go:embed`) works before the frontend has been built at least
  once; run `wails3 task build` or `bun run build` in `frontend/` to produce the real
  assets.
