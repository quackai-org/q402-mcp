import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/travala/travala.test.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist-test",
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ["@modelcontextprotocol/sdk", "ethers", "zod"],
});
