import React from "react";
import ReactDOM from "react-dom/client";
import "@portfolio/ui/tokens.css";
import "@portfolio/ui/cards.css";
import "./app.css";
import App from "./App.tsx";

const stored = localStorage.getItem("theme");
document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
