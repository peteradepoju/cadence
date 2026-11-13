import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves the app at https://<user>.github.io/<repo>/, so every URL starts with the repo name.
// BASE_PATH lets a fork or a custom domain change it (use "/" for a custom domain).
const base = process.env.BASE_PATH ?? "/cadence/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")) },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as never);
