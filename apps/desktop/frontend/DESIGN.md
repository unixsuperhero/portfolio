---
name: "Portfolio desktop: Herdr"
description: Scoped Herdr debugger workbench within the existing Portfolio shell
colors:
  portfolio-dark-bg: "#0b1020"
  portfolio-dark-surface: "#11192a"
  portfolio-dark-surface2: "#172239"
  portfolio-dark-border: "#2a3550"
  portfolio-dark-border2: "#3a4969"
  portfolio-dark-text: "#edf2f9"
  portfolio-dark-text2: "#bcc7da"
  portfolio-dark-text3: "#7f8eab"
  portfolio-dark-accent: "#7db1ff"
  portfolio-dark-accent2: "#b8d0ff"
  portfolio-dark-gold: "#f3bd62"
  portfolio-dark-danger: "#ff9d9d"
  portfolio-light-bg: "#f6f0e6"
  portfolio-light-surface: "#fffaf2"
  portfolio-light-surface2: "#efe6d8"
  portfolio-light-border: "#d7cab7"
  portfolio-light-border2: "#c5b79f"
  portfolio-light-text: "#201b16"
  portfolio-light-text2: "#5c5248"
  portfolio-light-text3: "#8a7b6a"
  portfolio-light-accent: "#1851b4"
  portfolio-light-accent2: "#2f66ca"
  portfolio-light-gold: "#a76a00"
  portfolio-light-danger: "#b42318"
  herdr-dark-bg: "#181c22"
  herdr-dark-surface: "#20252d"
  herdr-dark-surface2: "#2a323d"
  herdr-dark-border: "#343d49"
  herdr-dark-border2: "#515e6f"
  herdr-dark-text: "#e7edf5"
  herdr-dark-text2: "#b6c1d0"
  herdr-dark-accent: "#9ec5ff"
  herdr-dark-accent2: "#c7ddff"
  herdr-dark-danger: "#ffb1ab"
  herdr-dark-gold: "#e8c785"
  herdr-light-bg: "#f7f9fc"
  herdr-light-surface: "#edf1f6"
  herdr-light-surface2: "#dde6f1"
  herdr-light-border: "#cbd4df"
  herdr-light-border2: "#8595aa"
  herdr-light-text: "#202a38"
  herdr-light-text2: "#526176"
  herdr-light-accent: "#245ca9"
  herdr-light-accent2: "#174580"
  herdr-light-danger: "#a72d29"
  herdr-light-gold: "#805716"
typography:
  body:
    fontFamily: "Avenir Next, Segoe UI, sans-serif"
    lineHeight: 1.5
  page-title:
    fontFamily: "Avenir Next, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    letterSpacing: "-.025em"
  code:
    fontFamily: "SF Mono, JetBrains Mono, monospace"
    fontSize: ".75rem"
rounded:
  portfolio: "12px"
  herdr-field: "4px"
  herdr-panel: "7px"
  herdr-row-link: "2px"
spacing:
  herdr-button-block: ".5rem"
  herdr-button-inline: ".75rem"
  herdr-panel: "1rem"
  herdr-inspector: "1.5rem"
components:
  herdr-button-primary:
    backgroundColor: "{colors.herdr-dark-accent}"
    textColor: "{colors.herdr-dark-bg}"
    rounded: "{rounded.herdr-field}"
    padding: ".5rem 1rem"
  herdr-button-secondary:
    backgroundColor: "{colors.herdr-dark-surface}"
    textColor: "{colors.herdr-dark-text}"
    rounded: "{rounded.herdr-field}"
    padding: ".5rem .75rem"
  herdr-field:
    backgroundColor: "{colors.herdr-dark-bg}"
    textColor: "{colors.herdr-dark-text}"
    rounded: "{rounded.herdr-field}"
    padding: ".55rem .65rem"
---

# Design System: Portfolio desktop, Herdr

## Overview

**Creative North Star: "Debugger workbench"**

The Herdr page is a compact explorer and inspector for local sessions within Portfolio's existing app shell. Its graphite and cool-paper palettes may also be used on other routes and in the shell. Browsing and inspection lead; pane actions remain available beside the selected entity.

A restrained graphite palette in dark mode and cool paper in light mode distinguish Herdr from Portfolio's global dark navy and warm light tokens. Fine separators, compact disclosure rows, selection fill, and text statuses make hierarchy and state legible without large cards.

**Key Characteristics:**
- Compact session tree and adjacent inspector.
- Dark graphite and light cool-paper colors, available across Portfolio.
- Text statuses, visible focus, and direct pane controls.

## Colors

`packages/ui/src/tokens.css` defines Portfolio's global `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--text`, `--text2`, `--text3`, `--accent`, `--accent2`, `--gold`, and `--danger` in both themes. `packages/ui/src/herdr.css` currently overrides those names except `--text3` on `.herdr-page` and its light-theme rule. The frontmatter records the current global and Herdr palettes separately; this does not restrict either palette to a particular route.

### Primary

- Herdr dark `herdr-dark-accent` and light `herdr-light-accent` color the primary action, focused indicators, and selected action border. `herdr-dark-accent2` and `herdr-light-accent2` color primary-button hover.
- Herdr dark `herdr-dark-danger` and light `herdr-light-danger` color blocked or unavailable statuses and errors. `herdr-dark-gold` and `herdr-light-gold` color working status.

### Neutral

- Herdr `*-bg` is the workbench and field background; `*-surface` is the explorer, buttons, and output; `*-surface2` is the hovered or selected row fill.
- Herdr `*-border` separates panels and tree levels; `*-border2` frames controls and selected rows. `*-text` is main text; `*-text2` is supporting text and idle status.
- Portfolio `portfolio-dark-*` and `portfolio-light-*` record the global theme. Its light background is warm; Herdr's page-level light background is cool. Herdr has no local `--text3` override.

## Typography

The page uses the existing system-app sans stack, `Avenir Next`, `Segoe UI`, then `sans-serif`. IDs, breadcrumbs, paths, code, and payloads use `SF Mono`, `JetBrains Mono`, then `monospace`.

- The Herdr heading is 1.5rem at weight 650, with `-.025em` tracking. Inspector titles are 1.25rem; panel headings are 1rem at weight 600.
- Tree rows and labels use .8rem. Status text uses .7rem; code uses .75rem. Output uses `.75rem/1.65` monospace with wrapping and scrolling.
- Numeric summaries and the status line use tabular numerals.

## Layout

The workbench has an explorer and inspector column, `minmax(20rem, 1fr) minmax(23rem, 1.15fr)`. The inspector contains context, controls, and the last result. At `max-width: 1150px`, it stacks into one column and the explorer scroll region caps at 24rem. At `max-width: 600px`, the heading wraps, supporting entity-kind labels hide, nested indentation tightens from .8rem to .55rem, and inspector, controls, and output padding becomes 1rem.

The explorer's rows have a 2.5rem minimum height and .8rem nested indentation outside tight mode. The inspector uses 1.5rem padding at wider widths. The app shell is unchanged.

## Elevation & Depth

Herdr uses borders and surface colors, not raised cards. A selected tree row adds a one-pixel inset border with `box-shadow: inset 0 0 0 1px var(--border2)` on the filled row. Panel edges, nested tree rails, and the divider between explorer and detail use the local `--border`.

## Shapes

Herdr fields, buttons, and output blocks have 4px corners. The status line and workbench exterior use 7px corners where they meet. Entity links use 2px corners; the focused indicator is a small circle. Portfolio's global `--radius` remains 12px for the rest of the app and is not reset on the Herdr page.

## Components

### Buttons

The secondary button uses a local surface fill, text color, 1px `--border2` edge, .5rem by .75rem padding, and 4px corners. Hover changes the fill to `--surface2` and border to `--accent`; active changes the fill to `--border`. The primary button uses `--accent` fill, `--bg` text, and 1rem inline padding; its hover fill is `--accent2`. Buttons transition their background and border for 150ms ease-out, and disable that transition under `prefers-reduced-motion: reduce`. Disabled controls use .55 opacity. Keyboard focus has a 2px `--accent` outline offset by 3px.

### Inputs / Fields

Inputs, selects, and textareas use `--bg` fill, `--text` content, a 1px `--border2` edge, 4px corners, and `.55rem .65rem` padding. Placeholders use `--text2`; the caret uses `--accent`. Textareas resize vertically and start at 8rem minimum height. Required parameters appear in the form; optional parameters are behind a disclosure. Structured values and explicit nulls use the JSON editor.

### Navigation

The explorer is a nested session, workspace, tab, pane, and agent tree, with layouts under tabs. Disclosure buttons open or close branches. Rows have a `--surface2` hover fill, and the selected row keeps that fill plus the inset border. Status is a word beside the entity, colored by state. Filtering keeps ancestors of matching rows for context.

### Inspector and result

The inspector shows the selected entity's breadcrumb, properties, and expandable raw details. A pane or agent selection exposes Start agent, Send prompt, and Read output directly. A folded catalog retains the full operation list. The last result sits below the controls in the detail column, with terminal output in a scrolling monospace block.

## Do's and Don'ts

### Do:

- **Do** reuse the graphite and cool-paper palettes on other routes and in the shell where appropriate.
- **Do** use compact disclosure rows, selection fill, fine borders, and text statuses to distinguish entities.
- **Do** keep pane actions and their result near the inspector.

### Don't:

- **Don't** use color alone to convey an agent's status.
- **Don't** animate button color changes when reduced motion is requested.
