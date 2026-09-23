import React from "react";
import ReactDOM from "react-dom/client";
import "@portfolio/ui/tokens.css";
import "@portfolio/ui/cards.css";
import "./app.css";
import "./complete.css";
import App from "./App.tsx";
// Load the Wails runtime eagerly: bindings, events, and ExecJS from Go depend on it.
import "@wailsio/runtime";
import { installMcpBridge } from "./lib/mcp-bridge.ts";

installMcpBridge();

const stored = localStorage.getItem("theme");
document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
