import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  root: "src",
  publicDir: "../public",
  // GitHub Pages project sites serve from a subpath (https://<user>.github.io/rocketry/), not the
  // domain root -- without this, built asset references (script/css src) come out as absolute
  // "/assets/..." and 404 under that subpath. Must match the repo name exactly. Build-only (not
  // "serve"/dev) so `npm run dev` keeps working at plain localhost:5309/ like it always has.
  base: command === "build" ? "/rocketry/" : "/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
}));
