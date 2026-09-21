# Portfolio setup

Portfolio is a local document server for macOS. It uses Bun, SQLite, Pandoc, and a per-user LaunchAgent.

## Install on another Mac

1. Install the runtime tools:

   ```bash
   brew install bun pandoc
   ```

2. Copy this project to `~/proj/portfolio`.

3. If you want the existing library, copy these files and directories too:

   ```text
   ~/proj/portfolio/portfolio.sqlite
   ~/claude/docs/
   ```

   The database stores document content and metadata. The paths in `source_path` point to the Markdown or HTML source files. Keep the source files at the same paths, or import them again on the new machine.

4. Run the installer:

   ```bash
   ~/proj/portfolio/bin/install
   ```

   After the first installation, you can use:

   ```bash
   h-docs setup
   ```

The installer performs these actions:

- Installs `h-docs` and `mdoc` in `~/bin`.
- Creates `~/Library/LaunchAgents/com.$USER.portfolio.plist`.
- Starts the service on `127.0.0.1:4387`.
- Imports `~/claude/index.json` when no Portfolio database exists.
- Verifies the `/health` endpoint.

If `~/bin` is not on your `PATH`, add it to your shell configuration:

```bash
export PATH="$HOME/bin:$PATH"
```

## Manage the service

Use `h-docs` for normal service operations:

```bash
h-docs status
h-docs restart
h-docs stop
h-docs start
```

Open the library:

```bash
h-docs open
```

The service logs are:

```text
~/proj/portfolio/logs/stdout.log
~/proj/portfolio/logs/stderr.log
```

## Add Markdown with `mdoc`

Use `mdoc` to add one or more Markdown files to Portfolio:

```bash
mdoc guide.md notes.md --no-open
```

Use `-r` to include local `.md` and `.markdown` files linked by those roots. Portfolio stores the original Markdown and rewrites rendered Pandoc links to the matching Portfolio item. It keeps query strings and fragments on those links.

```bash
mdoc -r docs/overview.md --title "Overview"
```

The title and description apply to the first root. `mdoc` returns and opens root items only. It ignores external links, anchor links, images, links written in code, and raw HTML anchors. It reports a missing linked Markdown file before it uploads any document. Paths use their lexical absolute spelling, so two symlink spellings identify different tracked sources.

Pipe one nonrecursive document with `-`:

```bash
printf '# Hello\n' | mdoc - --title 'Piped input'
```

## Recover without `h-docs`

Restart the loaded service:

```bash
launchctl kickstart -k "gui/$(id -u)/com.$USER.portfolio"
```

Unload the service:

```bash
launchctl bootout "gui/$(id -u)/com.$USER.portfolio"
```

Load it again:

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.$USER.portfolio.plist"
```

Inspect its state:

```bash
launchctl print "gui/$(id -u)/com.$USER.portfolio"
```

Re-run `h-docs setup` if the project moves, Bun moves, or the LaunchAgent file is missing. The installer regenerates absolute paths in the LaunchAgent.

## Use `docs.h`

Add this record to `/etc/hosts`:

```text
127.0.0.1 docs.h
```

Run this command to append it:

```bash
echo '127.0.0.1 docs.h' | sudo tee -a /etc/hosts
```

Then open:

```text
http://docs.h:4387
```

To make `h-docs` use that URL, add this setting to your shell configuration:

```bash
export HDOCS_SERVER=http://docs.h:4387
```

## Settings

Open `http://127.0.0.1:4387/settings` to configure watched directories and Pastry uploads.

### Pull documents from watched directories

1. Enter an absolute directory path.
2. Select **Include subdirectories** if Portfolio must also import files below that directory.
3. Click **Add directory**.

Portfolio imports `.md`, `.markdown`, and `.html` files. It uses one watcher in the server process for each configured directory. Recursive mode uses the same watcher for the whole directory tree. It does not start a process for each subdirectory.

File additions, edits, and deletions update the library. Turning off **Include subdirectories** removes nested documents that no other watched directory covers. Removing a watched directory also removes its uncovered documents, but it does not delete source files.

Click **Sync now** to run an immediate scan. The server also scans each watched directory when it starts.

The **Enable Pastry uploads** setting is stored in the `settings` table. Watched directories are stored in `watched_directories`.

## Upload documents to Pastry

1. Turn on **Enable Pastry uploads** on the settings page.
2. Open any document, then click **Upload to Pastry** in the document header.
3. In the dialog, choose the file type (Markdown or HTML) and the visibility (public or private), then click **Upload**.

The server writes the document to a temporary file and runs:

```bash
pastry create <file> --title "<document title>" --public|--private --json
```

Uploads are also available over HTTP:

```bash
curl -X POST http://127.0.0.1:4387/api/items/1/pastry \
  -H 'content-type: application/json' \
  -d '{"format":"md","visibility":"private"}'
```

`format` is `md` or `html`. `visibility` is `public` or `private`. The response contains the Pastry `slug` and `url`.

Portfolio calls `pastry` on `PATH`. Set `PASTRY_BIN` to an absolute path in the LaunchAgent environment if the service cannot find it.

## Back up the library

Stop the service before copying the live SQLite database:

```bash
h-docs stop
cp ~/proj/portfolio/portfolio.sqlite /path/to/backup/
h-docs start
```

Back up tracked source files separately. Most current sources are under `~/claude/docs/`, but `mdoc` can track Markdown from any absolute path.

## Add HTML files with `mdoc`

`mdoc` also accepts `.html` files. They are stored as-is and served verbatim:

```bash
mdoc report.html --no-open
```

The title defaults to the file's `<title>` tag. Recursive link-following applies to Markdown only.

## Track open ports

Open `http://127.0.0.1:4387/ports` for a live table of TCP listeners: owning process, uptime, working directory, Herdr pane, and AI session. Hover an uptime value for the estimated start time. The same data is available as JSON:

```bash
curl http://127.0.0.1:4387/api/ports
h-docs ports
h-docs ports --json
```

Attribution comes from `bin/ports-scan` (`lsof` + `ps` + `herdr`). A listener counts as a **process match** when it descends from a pane's shell; a trailing `~` means same working directory only. This server runs under `launchd`, so its own row shows `~`. When Herdr is unreachable the process and directory columns still work. Set `PORTS_SCAN_BIN` to override the scanner (used by tests).

## Build portfolios from cards

Open `http://127.0.0.1:4387/portfolios` to create a portfolio. A portfolio is a page of cards, three per row. Each card is a saved query over the library and lists every item that matches it. A long list scrolls inside its card.

A card has these settings:

- **Tags**: an item matches when it has any one of them. Leave it empty to match every item. A card can name a tag that no item carries yet.
- **Types**: `document`, `note`, `link`, or `pr`. Checked types narrow the tag matches. Leave all unchecked to allow every type.
- **Sort by** and **Direction**: created date, updated date, title, or type.
- **Max items**: the most rows the card shows, from 1 to 1000. The header shows `20 of 340` when the card is capped.

Open **Edit card** on a card to change it, move it earlier or later, or delete it. Deleting a card or a portfolio never deletes items.

The same data is available as JSON, with each card's matching items:

```bash
curl http://127.0.0.1:4387/api/portfolios/1
```

## Track files and directories

Items can be of type `file` or `dir`. They point at a path on disk, which does not have to exist. Every file and dir item, and every slot below, shares the same actions:

- **Copy path** copies the path to the clipboard.
- **Reveal in Finder** and **Open** create the file or directory first when it is missing, then run `open`.

Add one from `http://127.0.0.1:4387/new`, or over HTTP. The title defaults to the last path segment:

```bash
curl -X POST http://127.0.0.1:4387/api/items -F type=dir -F path=~/.claude -F category=harness -F tags=ai
```

## Define categories

Open `http://127.0.0.1:4387/categories`. A category names a kind of item and the **slots** every item of that category has. A slot is a file or dir with a name and a path, written one per line:

```text
tasks | file | TASKS.md
logs | dir | ~/Library/Logs/thing
```

A relative slot path is inside the member's own path. An absolute or `~/` path stands alone. Slots are computed when a page renders, so changing a category changes every member at once, and a member's page shows each slot with the file and dir actions whether or not it exists yet. Open **Change path** under a slot to give one member a different path.

`GET /api/items/<id>` returns the member's `slots` with their resolved paths and whether each exists, which is the payload to hand an agent for context.

Deleting a category keeps its items. A category cannot change kind while it has members.

## Discover projects

Add a **project parent directory** on the settings page. A scan runs at startup, when a parent is added, and on **Scan now**. It adds each of these as a `dir` item in the `project` category with the `project` tag:

- every direct child of a parent directory
- any deeper directory, up to four levels down, with `.git` at its top level

The walk stops at a repository, so nested repositories inside one are not added. Hidden directories and `node_modules` are skipped. A scan never removes a project; delete the item to drop one. The `project` category starts with one slot, `tasks | file | TASKS.md`, and you can edit it like any other category.

## Upgrading an older database

The first start after this version rebuilds the `items` table to accept the `file` and `dir` types. It writes a copy of the database to `portfolio.sqlite.before-kinds` first and keeps every id, tag, and search index entry. Delete the copy once you are happy with the upgrade.
