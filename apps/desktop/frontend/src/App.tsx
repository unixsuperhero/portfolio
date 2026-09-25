import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Detection, ItemType } from "@portfolio/core";
import { createHashRouter, Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { useTerminalStore } from "./terminal/store.ts";
import { ContextMenuProvider } from "./context-menu/ContextMenu.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import type { Command } from "./components/CommandPalette.tsx";
import { BrowsePicker } from "./components/BrowsePicker.tsx";
import { AddModal } from "./components/AddModal.tsx";
import { createTask, detect, quickAdd } from "./api.ts";
import { ToastStack } from "./components/ToastStack.tsx";
import { useSidecarStatus } from "./hooks/useSidecarStatus.ts";
import { useNotificationPolling } from "./hooks/useNotificationPolling.ts";
import { PrDataProvider } from "./hooks/usePrData.tsx";
import { dismissNotifications, useNotifications } from "./lib/notifications.ts";
import { home, openSystem, pickDirectory, pickFile } from "./native.ts";
import { isWails } from "./lib/wails.ts";
import "./shell.css";

const TerminalDock = lazy(() => import("./terminal/TerminalDock.tsx").then(module => ({ default: module.TerminalDock })));
const Home = lazy(() => import("./pages/Home.tsx"));
const Portfolios = lazy(() => import("./pages/Portfolios.tsx"));
const Portfolio = lazy(() => import("./pages/Portfolio.tsx"));
const Library = lazy(() => import("./pages/Library.tsx"));
const Item = lazy(() => import("./pages/Item.tsx"));
const Categories = lazy(() => import("./pages/Categories.tsx"));
const Category = lazy(() => import("./pages/Category.tsx"));
const Projects = lazy(() => import("./pages/Projects.tsx"));
const Project = lazy(() => import("./pages/Project.tsx"));
const Ports = lazy(() => import("./pages/Ports.tsx"));
const Herdr = lazy(() => import("./pages/Herdr.tsx"));
const Reminders = lazy(() => import("./pages/Reminders.tsx"));
const Tasks = lazy(() => import("./pages/Tasks.tsx"));
const PullRequests = lazy(() => import("./pages/PullRequests.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const Notifications = lazy(() => import("./pages/Notifications.tsx"));

const NAV_ITEMS = [
  { to: "/", label: "Home", end: true },
  { to: "/library", label: "Library" },
  { to: "/portfolios", label: "Portfolios" },
  { to: "/categories", label: "Categories" },
  { to: "/projects", label: "Projects" },
  { to: "/ports", label: "Ports" },
  { to: "/herdr", label: "Herdr" },
  { to: "/tasks", label: "Tasks" },
  { to: "/reminders", label: "Reminders" },
  { to: "/prs", label: "PRs" },
  { to: "/notifications", label: "Notifications" },
  { to: "/settings", label: "Settings" },
] as const;

const isNativeMac = () => isWails() && /Mac/i.test(navigator.platform);

const TYPE_LABEL: Record<ItemType, string> = { document: "document", note: "note", link: "link", pr: "PR", file: "file", dir: "directory", task: "task" };
const ALL_ADDABLE_TYPES: ItemType[] = ["task", "note", "link", "pr", "file", "dir", "document"];
type PickerKind = "file" | "dir";

const URL_SCHEME_RE = /^https?:\/\//i;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(\/\S*)?$/i;

/** True when the whole trimmed text is a link: it has an http(s) scheme, or looks like a bare
 * domain (example.com, github.com/foo/bar). A domain inside a longer sentence does not count. */
function isLinkish(text: string): boolean {
  return URL_SCHEME_RE.test(text) || DOMAIN_RE.test(text);
}

/** Prefixes a bare domain with https:// so detect()/quickAdd() see a real URL — detect() only
 * recognizes URLs that already carry a scheme (see packages/core/src/detect.ts). */
function linkContent(text: string): string {
  return URL_SCHEME_RE.test(text) ? text : `https://${text}`;
}

/** The content to actually send for a given kind: link/PR text gets the https:// treatment above. */
function contentFor(type: ItemType, text: string): string {
  return (type === "link" || type === "pr") && isLinkish(text) ? linkContent(text) : text;
}

function browserUrlForLocation(pathname: string, search: string): string {
  if (!isWails()) return window.location.href;
  return `http://127.0.0.1:4388/app/#${pathname}${search}`;
}

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("theme") === "light" ? "light" : "dark"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(current => (current === "dark" ? "light" : "dark")) };
}

function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const { items: notifications, storageError, pollingError } = useNotifications();
  const newNotifications = notifications.filter(item => item.dismissed_at === null).length;
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [browseKind, setBrowseKind] = useState<PickerKind | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalInitial, setAddModalInitial] = useState("");

  // Detect what the palette text is (URL, path, or text) the same way the Library quick-add does.
  // A bare domain (no scheme) is prefixed with https:// first, since detect() only recognizes
  // URLs that already carry a scheme.
  useEffect(() => {
    if (!paletteQuery) { setDetection(null); return; }
    const probe = isLinkish(paletteQuery) ? linkContent(paletteQuery) : paletteQuery;
    let live = true;
    const id = setTimeout(() => {
      detect(probe)
        .then(result => { if (live) setDetection(result); })
        .catch(() => { if (live) setDetection(null); });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [paletteQuery]);

  const report = (err: unknown, fallback: string) => setBrowserError(err instanceof Error ? err.message : fallback);

  const addItem = useCallback((content: string, type?: ItemType) => {
    setBrowserError("");
    return quickAdd(content, type ? { type } : {})
      .then(result => navigate(`/items/${result.id}`))
      .catch(err => report(err, "Could not add the item."));
  }, [navigate]);

  const addTask = useCallback((title: string) => {
    setBrowserError("");
    return createTask({ title })
      .then(result => navigate(`/tasks/${result.id}`))
      .catch(err => report(err, "Could not add the task."));
  }, [navigate]);

  const addPath = useCallback(async (kind: PickerKind) => {
    if (!isWails()) { setBrowseKind(kind); return; }
    const picked = kind === "dir" ? await pickDirectory("Add a directory to the library", await home()) : await pickFile("Add a file to the library", await home());
    if (picked) await addItem(picked, kind);
  }, [addItem]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV_ITEMS.map(item => ({
      id: `go-${item.to}`,
      label: `Go to ${item.label}`,
      hint: item.to,
      run: () => navigate(item.to),
    }));

    // Adding what was typed: the detected kind first, then every other addable kind.
    const add: Command[] = [];
    const text = paletteQuery;
    if (text) {
      const detectedType = detection?.type;
      const hintFor = (type: ItemType) =>
        type === "task" ? "A task titled with the palette text"
        : type === "document" ? "Import the file as a rendered document"
        : `Add the palette text as a ${TYPE_LABEL[type]}`;
      const addAs = (type: ItemType, hint: string): Command => ({
        id: `add-as-${type}`,
        label: `Add ${TYPE_LABEL[type]}`,
        hint,
        always: true,
        run: query => { const content = contentFor(type, query); void (type === "task" ? addTask(content) : addItem(content, type)); },
      });
      if (detection && detectedType) {
        add.push({ ...addAs(detectedType, `Detected · ${detection.title}`), id: "add-detected" });
      }
      for (const type of ALL_ADDABLE_TYPES) {
        if (type === detectedType) continue;
        add.push(addAs(type, hintFor(type)));
      }
    }

    const openAdd: Command = {
      id: "open-add-modal",
      label: "Add…",
      hint: "Open the add dialog to write content, pick a kind, or choose a file/directory",
      always: true,
      run: query => { setAddModalInitial(query); setAddModalOpen(true); },
    };

    const pickers: Command[] = [
      { id: "pick-file", label: "Add file…", hint: "Pick a file to add to the library", always: true, run: () => { void addPath("file"); } },
      { id: "pick-dir", label: "Add directory…", hint: "Pick a directory to add to the library", always: true, run: () => { void addPath("dir"); } },
    ];

    const search: Command = {
      id: "search-library",
      label: "Search Library",
      hint: "Use the palette text as a library query",
      always: true,
      run: query => navigate(query ? `/library?q=${encodeURIComponent(query)}` : "/library"),
    };

    // "Add…" sits near the top when the query is empty (right before Go to…), but when there's
    // a detected/addable kind for the typed text, that kind must rank first — so "Add…" moves
    // after the add commands (nav items never land in the ranked fallback bucket; only
    // `always`-flagged commands do, so nav's position here only matters for the empty-query list).
    return text ? [...add, openAdd, ...pickers, search, ...nav] : [openAdd, ...nav, ...pickers, search];
  }, [addItem, addPath, addTask, detection, navigate, paletteQuery]);

  const openPalette = (trigger: HTMLElement | null) => {
    if (trigger?.closest(".command-palette")) return;
    returnFocusRef.current = trigger;
    setPaletteOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette(document.activeElement instanceof HTMLElement ? document.activeElement : commandButtonRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openCurrentPage = async () => {
    setBrowserBusy(true);
    setBrowserError("");
    try {
      await openSystem(browserUrlForLocation(location.pathname, location.search));
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : "Could not open this page in a browser.");
    } finally {
      setBrowserBusy(false);
    }
  };

  return (
    <div className="topbar">
      <button ref={commandButtonRef} type="button" className="topbar-command" onClick={() => openPalette(commandButtonRef.current)}>
        Commands <span aria-hidden="true">⌘K</span>
      </button>
      <button type="button" className="topbar-browser" onClick={() => void openCurrentPage()} disabled={browserBusy}>
        {browserBusy ? "Opening…" : "Open in system browser"}
      </button>
      {browserError ? <span className="topbar-error" role="alert">{browserError}</span> : null}
      <Link className="topbar-notifications" to="/notifications">Notifications ({newNotifications}){storageError || pollingError ? " · Error" : ""}</Link>
      <button type="button" className="topbar-dismiss" disabled={!newNotifications} onClick={() => dismissNotifications()}>Dismiss all</button>
      <button type="button" className="topbar-theme" onClick={toggle}>{theme === "dark" ? "Light" : "Dark"} theme</button>
      <CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} returnFocusRef={returnFocusRef} onQueryChange={setPaletteQuery} />
      {browseKind ? (
        <BrowsePicker kind={browseKind} onClose={() => setBrowseKind(null)} onPick={path => { setBrowseKind(null); void addItem(path, browseKind); }} />
      ) : null}
      <AddModal
        open={addModalOpen}
        initialContent={addModalInitial}
        onClose={() => { setAddModalOpen(false); requestAnimationFrame(() => commandButtonRef.current?.focus()); }}
      />
    </div>
  );
}

function Sidebar() {
  const status = useSidecarStatus();
  const terminal = useTerminalStore();
  return (
    <div className="sidebar">
      <div className="sidebar-brand">Portfolio</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} end={"end" in item ? item.end : undefined} className={({ isActive }) => (isActive ? "active" : "")}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="sidecar-terminal-toggle" onClick={() => terminal.setOpen(!terminal.open)}>
          Terminal <span style={{ marginLeft: "auto", color: "var(--text3)" }}>⌃`</span>
        </button>
        <div className="sidecar-status">
          <span className={`sidecar-dot ${status === "ok" ? "ok" : status === "down" ? "down" : ""}`} />
          <span>{status === "ok" ? "API connected" : status === "down" ? "API offline" : "Checking…"}</span>
        </div>
      </div>
    </div>
  );
}

function Layout() {
  const terminal = useTerminalStore();
  useNotificationPolling();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        terminal.setOpen(!terminal.open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [terminal]);

  return (
    <PrDataProvider>
      <div className={`app-shell${isNativeMac() ? " native-macos" : ""}`}>
        <Sidebar />
        <div className="main-area">
          <TopBar />
          <div className="content">
            <Suspense fallback={<p role="status">Loading…</p>}><Outlet /></Suspense>
          </div>
        </div>
        <div className="terminal-dock-shell">
          {terminal.open ? <Suspense fallback={null}><TerminalDock /></Suspense> : null}
        </div>
        <ContextMenuProvider />
        <ToastStack />
      </div>
    </PrDataProvider>
  );
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/portfolios", element: <Portfolios /> },
      { path: "/portfolios/:id", element: <Portfolio /> },
      { path: "/library", element: <Library /> },
      { path: "/items/:id", element: <Item /> },
      { path: "/categories", element: <Categories /> },
      { path: "/categories/:id", element: <Category /> },
      { path: "/projects", element: <Projects /> },
      { path: "/projects/:id", element: <Project /> },
      { path: "/ports", element: <Ports /> },
      { path: "/herdr", element: <Herdr /> },
      { path: "/tasks", element: <Tasks /> },
      { path: "/tasks/:taskId", element: <Tasks /> },
      { path: "/reminders", element: <Reminders /> },
      { path: "/prs", element: <PullRequests /> },
      { path: "/notifications", element: <Notifications /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <Link to="/">Back home</Link> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
