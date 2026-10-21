/**
 * q402_yield_cancel - schema + two-phase consent (no network).
 *   - the request id must be digits; chain is base only
 *   - the first call (no confirm) only previews and issues a consent token
 *   - confirm:true without the matching token is still only a preview
 *   - the JSON schema and the Zod schema accept the same fields
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { YieldCancelInputSchema, YIELD_CANCEL_TOOL, runYieldCancel } from "./yield-cancel.js";

describe("q402_yield_cancel schema", () => {
  test("accepts a numeric request id and defaults chain to base", () => {
    const p = YieldCancelInputSchema.parse({ requestId: "42" });
    assert.equal(p.chain, "base");
    assert.equal(p.requestId, "42");
  });

  test("rejects a non-numeric request id and a non-base chain", () => {
    assert.throws(() => YieldCancelInputSchema.parse({ requestId: "abc" }));
    assert.throws(() => YieldCancelInputSchema.parse({ requestId: "07" }));
    assert.throws(() => YieldCancelInputSchema.parse({ requestId: "1", chain: "bnb" }));
  });

  test("JSON schema lists the same properties as the Zod schema", () => {
    const json = Object.keys(YIELD_CANCEL_TOOL.inputSchema.properties).sort();
    const zod = Object.keys(YieldCancelInputSchema.shape).sort();
    assert.deepEqual(json, zod);
    assert.deepEqual(YIELD_CANCEL_TOOL.inputSchema.required, ["requestId"]);
  });
});

describe("q402_yield_cancel consent", () => {
  test("first call previews and issues a consent token without any network call", async () => {
    const r = await runYieldCancel(YieldCancelInputSchema.parse({ requestId: "7" }));
    const text = r.content[0].text;
    assert.match(text, /Will cancel pending Zircuit withdraw request #7 on base/);
    assert.match(text, /consentToken="ct_[0-9a-f]+"/);
    assert.equal((r as { isError?: boolean }).isError, undefined);
  });

  test("confirm:true with a wrong token is still a preview", async () => {
    const r = await runYieldCancel(YieldCancelInputSchema.parse({ requestId: "7", confirm: true, consentToken: "ct_0000000000000000" }));
    assert.match(r.content[0].text, /Will cancel pending Zircuit withdraw request #7/);
  });
});
