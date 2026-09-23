import { useEffect, useRef, useState } from "react";
import { createHashRouter, Link, NavLink, Outlet, RouterProvider, useNavigate } from "react-router";
import { TerminalDock } from "./terminal/TerminalDock.tsx";
import { useTerminalStore } from "./terminal/store.ts";
import { ContextMenuProvider } from "./context-menu/ContextMenu.tsx";
import { ToastStack } from "./components/ToastStack.tsx";
import { useSidecarStatus } from "./hooks/useSidecarStatus.ts";
import { useReminderPolling } from "./hooks/useReminderPolling.ts";
import { usePrEvents } from "./hooks/usePrEvents.ts";
import { openInApp } from "./native.ts";

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
];

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
  const { theme, toggle } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onChange = (value: string) => {
    setQ(value);
    navigate(`/library?q=${encodeURIComponent(value)}`);
  };

  return (
    <div className="topbar">
      <input
        ref={searchRef}
        className="topbar-search"
        type="search"
        placeholder="Search… (⌘K)"
        value={q}
        onChange={event => onChange(event.target.value)}
      />
      <button type="button" className="topbar-theme" onClick={toggle}>{theme === "dark" ? "Light" : "Dark"} theme</button>
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
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
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
  const { toasts, dismiss, complete } = useReminderPolling();

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
    <div className="app-shell">
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
