// Post-process compiled test bundles: restore "node:" prefix stripped by esbuild.
// esbuild normalises built-in specifiers to the bare form when bundling
// (e.g. "node:test" → "test"), which Node 22 then can't resolve as a package.
// This script runs after tsup and patches the bundles back to the correct form.
"use strict";
const fs = require("fs");
const path = require("path");

const testFiles = [
  path.join(__dirname, "..", "dist-test", "config.test.js"),
  path.join(__dirname, "..", "dist-test", "travala", "travala.test.js"),
  path.join(__dirname, "..", "dist-test", "travala", "live-adapter.test.js"),
  path.join(__dirname, "..", "dist-test", "sandbox-receipt.test.js"),
  path.join(__dirname, "..", "dist-test", "tools", "x402-fetch.test.js"),
  path.join(__dirname, "..", "dist-test", "tools", "guards.test.js"),
  path.join(__dirname, "..", "dist-test", "tools", "delegation-selfheal.test.js"),
];

for (const file of testFiles) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, "utf8");
  content = content
    .replace(/from "test"/g, 'from "node:test"')
    .replace(/from "assert\/strict"/g, 'from "node:assert/strict"')
    .replace(/from "os"/g, 'from "node:os"')
    .replace(/from "fs"/g, 'from "node:fs"')
    .replace(/from "path"/g, 'from "node:path"');
  fs.writeFileSync(file, content);
}
