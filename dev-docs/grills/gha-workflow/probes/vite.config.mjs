import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal Vite config for the Phase 0 spike playground.
// Each spike has its own .html entry; Vite serves them at /spike-X.html.
export default defineConfig({
  plugins: [react()],
  server: { port: 5274, strictPort: true },
});
