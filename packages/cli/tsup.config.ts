import { defineConfig } from "tsup";

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
  banner: { js: "#!/usr/bin/env node" },
});
