import { defineConfig } from "vite";
import { writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [react(), wails("./bindings"), keepDist()],
});

// vite empties dist on every build; Go embeds all:frontend/dist and needs at least one
// file there before the first build, so the placeholder is written back afterwards.
function keepDist() {
  return { name: "keep-dist", closeBundle() { writeFileSync("dist/.gitkeep", "# keeps the embed target present before the first frontend build\n"); } };
}
