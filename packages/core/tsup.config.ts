import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/ir/index.ts", "src/adapters/openapi.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
});
