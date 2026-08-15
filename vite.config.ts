import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  // Relative, not "/rocketry/" -- this app has no client-side routing (single index.html, all
  // state lives in query params), so relative asset paths resolve correctly served from anywhere:
  // GitHub Pages' subpath (https://<user>.github.io/rocketry/), plain localhost at root, or a
  // dist/ folder opened straight off disk. An absolute "/rocketry/" base only works when the site
  // happens to be served from that exact subpath -- it 404s everywhere else, which is what broke
  // local testing via a plain http.server pointed at dist/.
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
