import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Separate config from vite.config.ts (the app build, root:"src") — library
 * mode needs its own entry/output shape, so it's its own `vite build --config`
 * invocation rather than a mode-flag branch in one config. Produces both an
 * IIFE (window.Rocketry, for splashcast's no-bundler vanilla JS setup) and
 * an ES module build (for any consumer that does use a bundler).
 */
export default defineConfig({
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/lib.ts"),
      name: "Rocketry",
      formats: ["iife", "es"],
      fileName: (format) => (format === "iife" ? "rocketry.iife.js" : "rocketry.esm.js"),
    },
  },
});
