import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "x402-runner": "src/tools/x402-fetch.ts" },
  format: ["esm"],
  platform: "node",
  outDir: "dist-runner",
  splitting: false,
  sourcemap: false,
  clean: true,
});
