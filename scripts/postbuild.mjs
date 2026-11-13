// After the build: writes the service worker (with every built file to keep for offline use)
// and 404.html, which GitHub Pages serves for deep links like /cadence/today.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dist = "dist";
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p).split("\\").join("/"));
  }
})(dist);
const keep = files.filter(f => !/^(sw\.js|404\.html)$/.test(f) && !f.endsWith(".map") && !/\.(woff|ttf|eot)$/.test(f) && !(f.includes("cyrillic") || f.includes("greek") || f.includes("vietnamese")));
const version = Date.now().toString(36);
const sw = readFileSync("scripts/sw.template.js", "utf8").replace("__VERSION__", version).replace("__FILES__", JSON.stringify(["", "index.html", ...keep.filter(f => f !== "index.html")]));
writeFileSync(join(dist, "sw.js"), sw);

const base = process.env.BASE_PATH ?? "/cadence/";
writeFileSync(join(dist, "404.html"), `<!doctype html><meta charset="utf-8"><title>Cadence</title><script>
try { sessionStorage.setItem("cadence:redirect", location.pathname + location.search + location.hash); } catch (e) {}
location.replace(${JSON.stringify(base)});
</script>`);
console.log(`postbuild: sw.js (${keep.length} files, ${version}) and 404.html`);
