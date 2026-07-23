import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /server -> local crime_api (mounts router at /server/crime_api).
// Prod (Catalyst): the web client is hosted under /app/, so built assets must be
// base-prefixed with /app/. The function stays at the domain root (/server/crime_api),
// so the API base (absolute path) is unaffected. Dev keeps base "/" for simplicity.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/app/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/server": { target: "http://localhost:9000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
}));
