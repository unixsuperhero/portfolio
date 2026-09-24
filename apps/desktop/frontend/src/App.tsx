import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Detection, ItemType } from "@portfolio/core";
import { createHashRouter, Link, NavLink, Outlet, RouterProvider, useLocation, useNavigate } from "react-router";
import { TerminalDock } from "./terminal/TerminalDock.tsx";
import { useTerminalStore } from "./terminal/store.ts";
import { ContextMenuProvider } from "./context-menu/ContextMenu.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import type { Command } from "./components/CommandPalette.tsx";
import { BrowsePicker } from "./components/BrowsePicker.tsx";
import { createTask, detect, quickAdd } from "./api.ts";
import { ToastStack } from "./components/ToastStack.tsx";
import { useSidecarStatus } from "./hooks/useSidecarStatus.ts";
import { useReminderPolling } from "./hooks/useReminderPolling.ts";
import { usePrEvents } from "./hooks/usePrEvents.ts";
import { home, openInApp, openSystem, pickDirectory, pickFile } from "./native.ts";
import { isWails } from "./lib/wails.ts";
import "./shell.css";

import Home from "./pages/Home.tsx";
import Portfolios from "./pages/Portfolios.tsx";
import Portfolio from "./pages/Portfolio.tsx";
import Library from "./pages/Library.tsx";
import Item from "./pages/Item.tsx";
import Categories from "./pages/Categories.tsx";
import Category from "./pages/Category.tsx";
import Projects from "./pages/Projects.tsx";
import Project from "./pages/Project.tsx";
import Ports from "./pages/Ports.tsx";
import Reminders from "./pages/Reminders.tsx";
import Tasks from "./pages/Tasks.tsx";
import PullRequests from "./pages/PullRequests.tsx";
import Settings from "./pages/Settings.tsx";

const NAV_ITEMS = [
  { to: "/", label: "Home", end: true },
  { to: "/library", label: "Library" },
  { to: "/portfolios", label: "Portfolios" },
  { to: "/categories", label: "Categories" },
  { to: "/projects", label: "Projects" },
  { to: "/ports", label: "Ports" },
  { to: "/tasks", label: "Tasks" },
  { to: "/reminders", label: "Reminders" },
  { to: "/prs", label: "PRs" },
  { to: "/settings", label: "Settings" },
] as const;

const isNativeMac = () => isWails() && /Mac/i.test(navigator.platform);

const TYPE_LABEL: Record<ItemType, string> = { document: "document", note: "note", link: "link", pr: "PR", file: "file", dir: "directory", task: "task" };
type PickerKind = "file" | "dir";

function browserUrlForLocation(pathname: string, search: string): string {
  if (!isWails()) return window.location.href;
  return `http://127.0.0.1:4388/app/#${pathname}${search}`;
}

/** Renders GET /api/prs/events toasts (from usePrEvents) in their own stack, separate from the
 * reminder toasts, with an "Open" action that opens the PR in the in-app browser. */
function PrToastStack() {
  const { toasts, dismiss } = usePrEvents();
  if (!toasts.length) return null;
  return (
    <div className="toast-stack pr-toast-stack">
      {toasts.map(toast => (
        <div className="toast-card" key={toast.id}>
          <strong>{toast.message}</strong>
          <div className="page-actions">
            {toast.url ? (
              <button type="button" className="primary" onClick={() => { void openInApp(toast.url!); dismiss(toast.id); }}>Open</button>
            ) : null}
            <button type="button" className="secondary" onClick={() => dismiss(toast.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
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
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [browseKind, setBrowseKind] = useState<PickerKind | null>(null);

  // Detect what the palette text is (URL, path, or text) the same way the Library quick-add does.
  useEffect(() => {
    if (!paletteQuery) { setDetection(null); return; }
    let live = true;
    const id = setTimeout(() => {
      detect(paletteQuery)
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

    // Adding what was typed: the detected kind first, then the other kinds the text could be.
    const add: Command[] = [];
    const text = paletteQuery;
    if (text) {
      const detectedType = detection?.type;
      const addAs = (type: ItemType, hint: string): Command => ({
        id: `add-as-${type}`,
        label: `Add ${TYPE_LABEL[type]}`,
        hint,
        always: true,
        run: query => { void (type === "task" ? addTask(query) : addItem(query, type)); },
      });
      if (detection && detectedType) {
        add.push({ ...addAs(detectedType, `Detected · ${detection.title}`), id: "add-detected", run: query => { void (detectedType === "task" ? addTask(query) : addItem(query)); } });
      }
      const shape = detection?.shape ?? "text";
      const alternatives: ItemType[] = shape === "url" ? ["link", "pr"] : shape === "path" ? ["file", "dir", ...(detection?.exists ? ["document" as ItemType] : [])] : ["task", "note"];
      for (const type of alternatives) if (type !== detectedType) add.push(addAs(type, type === "task" ? "A task titled with the palette text" : type === "document" ? "Import the file as a rendered document" : `Add the palette text as a ${TYPE_LABEL[type]}`));
    }

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

    return [...nav, ...add, ...pickers, search];
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
        {browserBusy ? "Opening…" : "Open in browser"}
      </button>
      {browserError ? <span className="topbar-error" role="alert">{browserError}</span> : null}
      <button type="button" className="topbar-theme" onClick={toggle}>{theme === "dark" ? "Light" : "Dark"} theme</button>
      <CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} returnFocusRef={returnFocusRef} onQueryChange={setPaletteQuery} />
      {browseKind ? (
        <BrowsePicker kind={browseKind} onClose={() => setBrowseKind(null)} onPick={path => { setBrowseKind(null); void addItem(path, browseKind); }} />
      ) : null}
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
  const { toasts, dismiss, complete, error: reminderToastError } = useReminderPolling();

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
    <div className={`app-shell${isNativeMac() ? " native-macos" : ""}`}>
      <Sidebar />
      <div className="main-area">
        <TopBar />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <div className="terminal-dock-shell">
        <TerminalDock />
      </div>
      <ContextMenuProvider />
      <ToastStack toasts={toasts} onDismiss={dismiss} onComplete={complete} />
      {reminderToastError ? <div className="toast-stack"><div className="toast-card"><strong>Reminder polling failed</strong><p>{reminderToastError}</p></div></div> : null}
      <PrToastStack />
    </div>
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
      { path: "/tasks", element: <Tasks /> },
      { path: "/tasks/:taskId", element: <Tasks /> },
      { path: "/reminders", element: <Reminders /> },
      { path: "/prs", element: <PullRequests /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <Link to="/">Back home</Link> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
