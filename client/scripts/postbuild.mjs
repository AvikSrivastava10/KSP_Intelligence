// Copy dist/index.html -> dist/404.html so Catalyst web hosting serves the SPA
// for deep links / client-side routes (client-package.json "404": "404.html").
import { copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const index = join(dist, "index.html");
if (existsSync(index)) {
  copyFileSync(index, join(dist, "404.html"));
  console.log("postbuild: wrote dist/404.html (SPA fallback)");
} else {
  console.warn("postbuild: dist/index.html not found — did vite build run?");
}
