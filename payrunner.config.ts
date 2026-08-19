import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "pay-runner": "src/tools/pay.ts" },
  format: ["esm"], platform: "node", outDir: "dist-payrunner",
  splitting: false, sourcemap: false, clean: true,
});
