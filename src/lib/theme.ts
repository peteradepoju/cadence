export type Theme = "system" | "light" | "dark";
export function getTheme(): Theme { try { return (localStorage.getItem("cadence:theme") as Theme) || "system"; } catch { return "system"; } }
export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111018" : "#F7F5F0");
}
export function setTheme(t: Theme) { try { localStorage.setItem("cadence:theme", t); } catch {} applyTheme(t); }
