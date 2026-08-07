// Preload module: redirect HOME to a fresh temp directory before any test
// module loads. Both config.ts and x402-audit-store.ts call homedir() at
// module-level; they must see this temp HOME so they never read or write
// real ~/.q402 files.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHome = mkdtempSync(join(tmpdir(), "q402-test-home-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
