// Post-process compiled test bundle: restore "node:" prefix stripped by esbuild.
// esbuild normalises built-in specifiers to the bare form when bundling
// (e.g. "node:test" → "test"), which Node 22 then can't resolve as a package.
// This script runs after tsup and patches the bundle back to the correct form.
"use strict";
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "dist-test", "travala.test.js");
let content = fs.readFileSync(file, "utf8");
content = content
  .replace(/from "test"/g, 'from "node:test"')
  .replace(/from "assert\/strict"/g, 'from "node:assert/strict"');
fs.writeFileSync(file, content);
