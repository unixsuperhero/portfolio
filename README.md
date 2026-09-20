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

Open `http://127.0.0.1:4387/settings` to manage local preferences. They are stored in the `settings` table of the Portfolio database.

The available setting is **Enable Pastry uploads**.

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

Open `http://127.0.0.1:4387/ports` for a live table of TCP listeners: owning process, working directory, Herdr pane, and AI session. The same data is available as JSON:

```bash
curl http://127.0.0.1:4387/api/ports
h-docs ports
h-docs ports --json
```

Attribution comes from `bin/ports-scan` (`lsof` + `ps` + `herdr`). A listener counts as a **process match** when it descends from a pane's shell; a trailing `~` means same working directory only. This server runs under `launchd`, so its own row shows `~`. When Herdr is unreachable the process and directory columns still work. Set `PORTS_SCAN_BIN` to override the scanner (used by tests).
