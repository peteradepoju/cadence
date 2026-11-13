import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { loadStore, flush } from "./lib/store";
import { startSync } from "./lib/sync";
import { startReminders } from "./lib/notify";
import { applyTheme } from "./lib/theme";

// GitHub Pages serves 404.html for deep links; it stashes the path, and this puts it back.
try {
  const p = sessionStorage.getItem("cadence:redirect");
  if (p) { sessionStorage.removeItem("cadence:redirect"); history.replaceState(null, "", p); }
} catch {}

applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

void loadStore().then(() => { startSync(); startReminders(); });
addEventListener("pagehide", () => { void flush(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js", { scope: import.meta.env.BASE_URL }).catch(() => {});
}

// For trying things out in development (never in the published build).
if (import.meta.env.DEV) {
  void Promise.all([import("./lib/store"), import("./lib/actions")]).then(([store, actions]) => { (window as unknown as Record<string, unknown>).__cadence = { store, actions }; });
}
