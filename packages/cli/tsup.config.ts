import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/bin.ts", "src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  // Bundle workspace packages so a single `npm i -g loadam` works
  // without needing every @loadam/* sub-package on the registry.
  noExternal: [/^@loadam\//],
  define: {
    __LOADAM_VERSION__: JSON.stringify(pkg.version),
  },
  banner: { js: "#!/usr/bin/env node" },
});
