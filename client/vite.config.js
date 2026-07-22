import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /server -> local crime_api (mounts router at /server/crime_api).
// Prod (Catalyst): client + function share the app domain, so /server/crime_api is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/server": { target: "http://localhost:9000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
