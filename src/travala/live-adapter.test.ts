/**
 * Tests for LiveAdapter: OAuth flow, tool names, 402 payment leg, and all ACs.
 *
 * All external I/O (OAuth /token, MCP /mcp, payment leg) is stubbed via
 * LiveAdapterDeps — no real network calls are made.
 *
 * ACs covered: 1-8, 10-13
 * AC-9 (mock regression): covered by existing src/travala/travala.test.ts
 * AC-14 (build passes):   satisfied when `npm run build && npm run lint && npm test` green
 *
 * Run with: node --experimental-strip-types --test src/travala/live-adapter.test.ts
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LiveAdapter, defaultPaymentLeg } from "./live-adapter.js";
import { getTravelMode, TravalaPaymentRequiredError } from "./adapter.js";
import type { PaymentRequired, PaymentLeg, PaymentLegResult } from "./adapter.js";
import type { MCPCallFn, FetchFn } from "./live-adapter.js";
import { consentTokenFor } from "../consent.js";

// ── Env setup ─────────────────────────────────────────────────────────────────
// Set fake credentials so most tests can construct LiveAdapter without errors.
// Individual tests that need to test missing-credential behaviour restore/delete as needed.

const FAKE_CLIENT_ID = "test-client-id-live-adapter";
const FAKE_CLIENT_SECRET = "test-client-secret-do-not-log";
const FAKE_AGENT_ID = "quackai-q402";
const FAKE_REWARD_WALLET = "0xfDaACE6016EAfC30aC0a5d2d5a333bD1Ed68B3Cb";

// Save originals (may be undefined in CI)
const origClientId = process.env["TRAVALA_CLIENT_ID"];
const origClientSecret = process.env["TRAVALA_CLIENT_SECRET"];
const origAgentId = process.env["TRAVALA_AGENT_ID"];
const origRewardWallet = process.env["TRAVALA_REWARD_WALLET"];
const origTravelMode = process.env["TRAVEL_MODE"];
const origMaxBooking = process.env["TRAVALA_MAX_BOOKING_USD"];

function setDefaults() {
  process.env["TRAVALA_CLIENT_ID"] = FAKE_CLIENT_ID;
  process.env["TRAVALA_CLIENT_SECRET"] = FAKE_CLIENT_SECRET;
  process.env["TRAVALA_AGENT_ID"] = FAKE_AGENT_ID;
  process.env["TRAVALA_REWARD_WALLET"] = FAKE_REWARD_WALLET;
  process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";
  delete process.env["TRAVEL_MODE"];
  delete process.env["TRAVEL_PAYMENT_TESTNET"];
  delete process.env["TRAVEL_PAYMENT_MAINNET"];
}

function restoreDefaults() {
  if (origClientId !== undefined) process.env["TRAVALA_CLIENT_ID"] = origClientId;
  else delete process.env["TRAVALA_CLIENT_ID"];
  if (origClientSecret !== undefined) process.env["TRAVALA_CLIENT_SECRET"] = origClientSecret;
  else delete process.env["TRAVALA_CLIENT_SECRET"];
  if (origAgentId !== undefined) process.env["TRAVALA_AGENT_ID"] = origAgentId;
  else delete process.env["TRAVALA_AGENT_ID"];
  if (origRewardWallet !== undefined) process.env["TRAVALA_REWARD_WALLET"] = origRewardWallet;
  else delete process.env["TRAVALA_REWARD_WALLET"];
  if (origTravelMode !== undefined) process.env["TRAVEL_MODE"] = origTravelMode;
  else delete process.env["TRAVEL_MODE"];
  if (origMaxBooking !== undefined) process.env["TRAVALA_MAX_BOOKING_USD"] = origMaxBooking;
  else delete process.env["TRAVALA_MAX_BOOKING_USD"];
  delete process.env["TRAVEL_PAYMENT_TESTNET"];
  delete process.env["TRAVEL_PAYMENT_MAINNET"];
}

// ── Stub factories ────────────────────────────────────────────────────────────

function makeOAuthFetchStub(
  tokenToReturn = "mock-bearer-token",
  expiresIn = 3600,
): { stub: FetchFn; calls: Array<{ url: string; body?: string }> } {
  const calls: Array<{ url: string; body?: string }> = [];
  const stub: FetchFn = async (url, init) => {
    calls.push({ url, body: init?.body as string | undefined });
    return new Response(
      JSON.stringify({ access_token: tokenToReturn, expires_in: expiresIn }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { stub, calls };
}

function makeMCPCallStub(
  handler: (
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) => unknown = () => ({ content: [{ type: "text", text: "{}" }] }),
): {
  stub: MCPCallFn;
  calls: Array<{ token: string; name: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{
    token: string;
    name: string;
    args: Record<string, unknown>;
  }> = [];
  const stub: MCPCallFn = async (token, name, args) => {
    calls.push({ token, name, args });
    return handler(token, name, args);
  };
  return { stub, calls };
}

function makePaymentLegStub(): {
  stub: PaymentLeg;
  calls: PaymentRequired[];
} {
  const calls: PaymentRequired[] = [];
  const stub: PaymentLeg = async (payment) => {
    calls.push(payment);
    return {
      success: false,
      network: "none",
      error: "stub payment leg: not implemented",
    } satisfies PaymentLegResult;
  };
  return { stub, calls };
}

/** Returns MCP content for a 402 response with a given next_action. */
function make402Response(nextAction: Record<string, unknown>): unknown {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ status: 402, next_action: nextAction }),
      },
    ],
  };
}

/** Returns MCP content for a successful booking receipt. */
function makeBookingResponse(bookingId = "bk-test-001"): unknown {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          bookingId,
          status: "confirmed",
          hotel: { hotelId: "h1", name: "Test Hotel" },
          checkIn: "2025-09-01",
          checkOut: "2025-09-03",
          amount: 240,
          currency: "USD",
          agentID: FAKE_AGENT_ID,
          rewardWallet: FAKE_REWARD_WALLET,
        }),
      },
    ],
  };
}

// ── AC-1: agentId / rewardWallet from env ─────────────────────────────────────

describe("AC-1: env-based agentId and rewardWallet in travala_book request", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("agentId === TRAVALA_AGENT_ID and rewardWallet === TRAVALA_REWARD_WALLET in book args", async () => {
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => makeBookingResponse());

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.bookHotel({
      hotelId: "hotel-1",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Alice",
    });

    const bookCall = mcpStub.calls.find((c) => c.name === "travala_book");
    assert.ok(bookCall, "travala_book was called");
    assert.strictEqual(
      bookCall!.args["agentId"],
      FAKE_AGENT_ID,
      "agentId matches TRAVALA_AGENT_ID env",
    );
    assert.strictEqual(
      bookCall!.args["rewardWallet"],
      FAKE_REWARD_WALLET,
      "rewardWallet matches TRAVALA_REWARD_WALLET env",
    );
    // Confirm field name is agentId (not agentID)
    assert.ok(
      !Object.keys(bookCall!.args).includes("agentID"),
      "field name is agentId not agentID",
    );
  });

  test("values come from process.env at call time, not hardcoded", async () => {
    process.env["TRAVALA_AGENT_ID"] = "different-agent";
    process.env["TRAVALA_REWARD_WALLET"] = "0x0000000000000000000000000000000000000001";

    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => makeBookingResponse());
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.bookHotel({
      hotelId: "h1",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Bob",
    });

    const bookCall = mcpStub.calls.find((c) => c.name === "travala_book");
    assert.strictEqual(bookCall!.args["agentId"], "different-agent");
    assert.strictEqual(
      bookCall!.args["rewardWallet"],
      "0x0000000000000000000000000000000000000001",
    );
  });
});

// ── AC-2: tool names ─────────────────────────────────────────────────────────

describe("AC-2: live tool names are travala_search_hotel / travala_book / travala_book_status", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("searchHotels calls travala_search_hotel (not search_hotels)", async () => {
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => ({
      content: [
        { type: "text", text: JSON.stringify({ hotels: [{ hotelId: "h1" }] }) },
      ],
    }));
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.searchHotels({
      destination: "Bangkok",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
    });

    assert.ok(
      mcpStub.calls.some((c) => c.name === "travala_search_hotel"),
      "uses travala_search_hotel",
    );
    assert.ok(
      !mcpStub.calls.some((c) => c.name === "search_hotels"),
      "does NOT use old name search_hotels",
    );
  });

  test("bookHotel calls travala_book (not book_hotel)", async () => {
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => makeBookingResponse());
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.bookHotel({
      hotelId: "h1",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Alice",
    });

    assert.ok(
      mcpStub.calls.some((c) => c.name === "travala_book"),
      "uses travala_book",
    );
    assert.ok(
      !mcpStub.calls.some((c) => c.name === "book_hotel"),
      "does NOT use old name book_hotel",
    );
  });

  test("getBookingStatus calls travala_book_status (not get_booking_status)", async () => {
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ bookingId: "bk1", status: "confirmed" }),
        },
      ],
    }));
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.getBookingStatus("bk-001");

    assert.ok(
      mcpStub.calls.some((c) => c.name === "travala_book_status"),
      "uses travala_book_status",
    );
    assert.ok(
      !mcpStub.calls.some((c) => c.name === "get_booking_status"),
      "does NOT use old name get_booking_status",
    );
  });
});

// ── AC-3: travala_book request body keys ─────────────────────────────────────

describe("AC-3: travala_book request body contains all required keys", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("all required keys present in travala_book args", async () => {
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => makeBookingResponse());
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.bookHotel({
      hotelId: "hotel-abc",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Carol",
      packageId: "pkg-001",
      sessionId: "sess-abc",
      roomTypeId: "rtid-deluxe",
      roomName: "Deluxe King",
      price: 240,
      currency: "USD",
      customer: { name: "Carol", email: "carol@example.com" },
    });

    const bookCall = mcpStub.calls.find((c) => c.name === "travala_book");
    assert.ok(bookCall, "travala_book was called");
    const args = bookCall!.args;

    const requiredKeys = [
      "agentId",
      "rewardWallet",
      "packageId",
      "sessionId",
      "hotelId",
      "roomTypeId",
      "roomName",
      "price",
      "currency",
      "customer",
    ] as const;
    for (const key of requiredKeys) {
      assert.ok(key in args, `key "${key}" present in travala_book body`);
    }

    assert.strictEqual(args["hotelId"], "hotel-abc");
    assert.strictEqual(args["packageId"], "pkg-001");
    assert.strictEqual(args["sessionId"], "sess-abc");
    assert.strictEqual(args["roomTypeId"], "rtid-deluxe");
    assert.strictEqual(args["roomName"], "Deluxe King");
    assert.strictEqual(args["price"], 240);
    assert.strictEqual(args["currency"], "USD");
  });
});

// ── AC-4: OAuth token fetch with correct params ───────────────────────────────

describe("AC-4: OAuth /token called with client_credentials + correct scope; MCP gets Bearer", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("POST /oauth/token with grant_type=client_credentials and correct scope", async () => {
    const fetchStub = makeOAuthFetchStub("access-token-for-ac4");
    const mcpStub = makeMCPCallStub(() => ({
      content: [{ type: "text", text: JSON.stringify({ hotels: [] }) }],
    }));
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.searchHotels({
      destination: "Phuket",
      checkIn: "2025-10-01",
      checkOut: "2025-10-03",
    });

    assert.ok(fetchStub.calls.length >= 1, "OAuth fetch was called");
    const oauthCall = fetchStub.calls[0];
    assert.ok(
      oauthCall!.url.includes("/oauth/token"),
      "fetch URL is /oauth/token",
    );
    assert.ok(
      typeof oauthCall!.body === "string",
      "body is a string (URL-encoded form)",
    );
    const params = new URLSearchParams(oauthCall!.body);
    assert.strictEqual(
      params.get("grant_type"),
      "client_credentials",
      "grant_type=client_credentials",
    );
    assert.strictEqual(
      params.get("scope"),
      "mcp:read mcp:book mcp:cancel",
      "scope includes mcp:read mcp:book mcp:cancel",
    );
  });

  test("MCP call receives the bearer token returned by OAuth", async () => {
    const fetchStub = makeOAuthFetchStub("bearer-xyz-789");
    const mcpStub = makeMCPCallStub(() => ({
      content: [{ type: "text", text: JSON.stringify({ hotels: [] }) }],
    }));
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    await adapter.searchHotels({
      destination: "Bangkok",
      checkIn: "2025-10-01",
      checkOut: "2025-10-03",
    });

    assert.ok(mcpStub.calls.length >= 1, "MCP stub was called");
    assert.strictEqual(
      mcpStub.calls[0]!.token,
      "bearer-xyz-789",
      "MCP call received the bearer token from OAuth",
    );
  });
});

// ── AC-5: Token caching and expiry refresh ────────────────────────────────────

describe("AC-5: token cached within TTL; exactly one new token fetched after expiry", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("multiple calls within TTL → exactly one OAuth /token request", async () => {
    let fakeNow = 1_000_000_000_000; // arbitrary fixed ms epoch
    const fetchStub = makeOAuthFetchStub("cached-token", 3600);
    const mcpStub = makeMCPCallStub(() => ({
      content: [{ type: "text", text: JSON.stringify({ hotels: [] }) }],
    }));
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      nowFn: () => fakeNow,
    });

    await adapter.searchHotels({
      destination: "Singapore",
      checkIn: "2025-11-01",
      checkOut: "2025-11-03",
    });
    await adapter.searchHotels({
      destination: "Singapore",
      checkIn: "2025-11-01",
      checkOut: "2025-11-03",
    });
    await adapter.getBookingStatus("bk-test");

    assert.strictEqual(
      fetchStub.calls.length,
      1,
      "OAuth called exactly once within TTL",
    );
  });

  test("after TTL expiry, exactly one new token request is made", async () => {
    let fakeNow = 1_000_000_000_000;
    const fetchStub = makeOAuthFetchStub("token-v1", 3600);
    const mcpStub = makeMCPCallStub(() => ({
      content: [{ type: "text", text: JSON.stringify({ hotels: [] }) }],
    }));
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      nowFn: () => fakeNow,
    });

    // First call — fetches token-v1
    await adapter.searchHotels({
      destination: "KL",
      checkIn: "2025-12-01",
      checkOut: "2025-12-03",
    });
    assert.strictEqual(fetchStub.calls.length, 1, "one token fetch after first call");

    // Advance past TTL (3600s) + buffer (30s) → expires
    fakeNow += 3601 * 1000;

    // Second call after expiry — fetches token-v2
    await adapter.searchHotels({
      destination: "KL",
      checkIn: "2025-12-01",
      checkOut: "2025-12-03",
    });
    assert.strictEqual(
      fetchStub.calls.length,
      2,
      "exactly one new token fetch after expiry",
    );
  });
});

// ── AC-6: Mock mode — zero external calls ────────────────────────────────────

describe("AC-6: TRAVEL_MODE unset or 'mock' → mode is 'mock' (no LiveAdapter instantiated)", () => {
  afterEach(restoreDefaults);

  test("TRAVEL_MODE unset → getTravelMode() returns 'mock'", () => {
    delete process.env["TRAVEL_MODE"];
    assert.strictEqual(getTravelMode(), "mock");
  });

  test("TRAVEL_MODE=mock → getTravelMode() returns 'mock'", () => {
    process.env["TRAVEL_MODE"] = "mock";
    assert.strictEqual(getTravelMode(), "mock");
    delete process.env["TRAVEL_MODE"];
  });

  test("TRAVEL_MODE=live → getTravelMode() returns 'live'", () => {
    setDefaults();
    process.env["TRAVEL_MODE"] = "live";
    assert.strictEqual(getTravelMode(), "live");
    delete process.env["TRAVEL_MODE"];
  });
});

// ── AC-7: Missing credentials → readable error ───────────────────────────────

describe("AC-7: TRAVEL_MODE=live with missing credentials throws readable error", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("missing TRAVALA_CLIENT_ID → readable error naming the missing var", () => {
    delete process.env["TRAVALA_CLIENT_ID"];
    assert.throws(
      () => new LiveAdapter(),
      (e: unknown) => {
        assert.ok(e instanceof Error, "is an Error");
        assert.ok(
          e.message.includes("TRAVALA_CLIENT_ID"),
          "error mentions TRAVALA_CLIENT_ID",
        );
        return true;
      },
      "throws when TRAVALA_CLIENT_ID missing",
    );
  });

  test("missing TRAVALA_CLIENT_SECRET → readable error naming the missing var", () => {
    delete process.env["TRAVALA_CLIENT_SECRET"];
    assert.throws(
      () => new LiveAdapter(),
      (e: unknown) => {
        assert.ok(e instanceof Error, "is an Error");
        assert.ok(
          e.message.includes("TRAVALA_CLIENT_SECRET"),
          "error mentions TRAVALA_CLIENT_SECRET",
        );
        return true;
      },
      "throws when TRAVALA_CLIENT_SECRET missing",
    );
  });

  test("both credentials missing → error names both", () => {
    delete process.env["TRAVALA_CLIENT_ID"];
    delete process.env["TRAVALA_CLIENT_SECRET"];
    assert.throws(
      () => new LiveAdapter(),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.ok(e.message.includes("TRAVALA_CLIENT_ID"));
        assert.ok(e.message.includes("TRAVALA_CLIENT_SECRET"));
        return true;
      },
    );
  });
});

// ── AC-8: Credentials and token not exposed in errors ────────────────────────

describe("AC-8: credential values and tokens not exposed in error messages or logs", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("AC-7 error message does not include the secret value", () => {
    const secretValue = "super-secret-value-8675309";
    process.env["TRAVALA_CLIENT_SECRET"] = secretValue;
    delete process.env["TRAVALA_CLIENT_ID"];
    let caughtMessage = "";
    try {
      new LiveAdapter();
    } catch (e) {
      caughtMessage = (e as Error).message;
    }
    assert.ok(caughtMessage.length > 0, "an error was thrown");
    assert.ok(
      !caughtMessage.includes(secretValue),
      "error does not expose the secret value",
    );
  });

  test("OAuth error message does not include client_secret value", async () => {
    const secretValue = "secret-that-must-not-leak-9876";
    process.env["TRAVALA_CLIENT_SECRET"] = secretValue;

    const badFetch: FetchFn = async () =>
      new Response("Unauthorized", { status: 401 });

    const adapter = new LiveAdapter({ fetchFn: badFetch });
    let caughtMessage = "";
    try {
      await adapter.getToken();
    } catch (e) {
      caughtMessage = (e as Error).message;
    }
    assert.ok(caughtMessage.length > 0, "an error was thrown");
    assert.ok(
      !caughtMessage.includes(secretValue),
      "OAuth error does not expose the secret value",
    );
  });
});

// ── AC-10: 402 detection and structured next_action parsing ──────────────────

describe("AC-10: travala_book 402 response detected and next_action parsed as structured object", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("402 with next_action is detected and not treated as success", async () => {
    const nextAction = { type: "crypto_payment", amount: 150, currency: "USDC" };
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => make402Response(nextAction));

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    let thrown: unknown;
    try {
      await adapter.bookHotel({
        hotelId: "h-402",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Dan",
      });
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown instanceof TravalaPaymentRequiredError, "throws TravalaPaymentRequiredError");
    assert.strictEqual(thrown.paymentRequired.status, 402, "status is 402");
    assert.ok(
      thrown.paymentRequired.next_action !== undefined,
      "next_action is set",
    );
    assert.strictEqual(
      thrown.paymentRequired.next_action["type"],
      "crypto_payment",
      "next_action.type parsed correctly",
    );
    assert.strictEqual(
      thrown.paymentRequired.next_action["amount"],
      150,
      "next_action.amount parsed correctly",
    );
    assert.strictEqual(
      thrown.paymentRequired.next_action["currency"],
      "USDC",
      "next_action.currency parsed correctly",
    );
  });

  test("non-402 response is treated as normal booking receipt (not 402 false-positive)", async () => {
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => makeBookingResponse("bk-not-402"));

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
    });

    // Should NOT throw
    const receipt = await adapter.bookHotel({
      hotelId: "h1",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Eve",
    });
    assert.ok(receipt, "receipt returned");
    assert.strictEqual((receipt as unknown as Record<string, unknown>)["bookingId"], "bk-not-402");
  });
});

// ── AC-11: policy/consent enforcement before payment leg ─────────────────────

describe("AC-11: consent + limit enforced before payment leg; leg NOT called when failing", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("no paymentConsentToken → payment leg never called, returns needs_confirmation info", async () => {
    const nextAction = { amount: 100, currency: "USDC" };
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => make402Response(nextAction));
    const legStub = makePaymentLegStub();

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      paymentLeg: legStub.stub,
    });

    let thrown: unknown;
    try {
      await adapter.bookHotel({
        hotelId: "h-consent",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Frank",
        // No paymentConsentToken
      });
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown instanceof TravalaPaymentRequiredError);
    assert.ok(thrown.needsConsent !== undefined, "needsConsent is set (needs_confirmation)");
    assert.ok(
      typeof thrown.needsConsent!.preview === "string" &&
        thrown.needsConsent!.preview.length > 0,
      "preview is a non-empty string",
    );
    assert.ok(
      typeof thrown.needsConsent!.consentToken === "string",
      "consentToken is provided",
    );
    // Payment leg must NOT have been called
    assert.strictEqual(legStub.calls.length, 0, "payment leg not called (count=0)");
  });

  test("wrong paymentConsentToken → payment leg not called", async () => {
    const nextAction = { amount: 100, currency: "USDC" };
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => make402Response(nextAction));
    const legStub = makePaymentLegStub();

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      paymentLeg: legStub.stub,
    });

    let thrown: unknown;
    try {
      await adapter.bookHotel({
        hotelId: "h-consent",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Frank",
        paymentConsentToken: "ct_wrongtoken0000000", // wrong token
      });
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown instanceof TravalaPaymentRequiredError);
    assert.strictEqual(legStub.calls.length, 0, "payment leg not called on wrong token");
  });

  test("amount exceeds limit → rejected, payment leg not called", async () => {
    process.env["TRAVALA_MAX_BOOKING_USD"] = "50";
    const nextAction = { amount: 200, currency: "USDC" }; // 200 > 50 limit
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => make402Response(nextAction));
    const legStub = makePaymentLegStub();

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      paymentLeg: legStub.stub,
    });

    let thrown: unknown;
    try {
      await adapter.bookHotel({
        hotelId: "h-limit",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Grace",
        paymentConsentToken: "ct_anytoken", // even with a token, limit blocks first
      });
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown instanceof TravalaPaymentRequiredError);
    assert.ok(thrown.rejectedReason !== undefined, "rejectedReason is set");
    assert.ok(
      thrown.rejectedReason!.includes("spend limit"),
      "rejection reason mentions spend limit",
    );
    assert.strictEqual(legStub.calls.length, 0, "payment leg not called when limit exceeded");
  });
});

// ── AC-12: payment leg called with correct PaymentRequired; returns safe error ─

describe("AC-12: consent passed → payment leg called; result is catchable error, no crash", () => {
  beforeEach(setDefaults);
  afterEach(restoreDefaults);

  test("valid paymentConsentToken → leg called with correct PaymentRequired", async () => {
    const nextAction = { type: "crypto_payment", amount: 100, currency: "USDC" };
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => make402Response(nextAction));
    const legStub = makePaymentLegStub();

    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      paymentLeg: legStub.stub,
    });

    // Build the correct consent token for this exact payment intent
    const paymentIntent = {
      t: "travala_payment",
      hotelId: "h-pay",
      next_action: nextAction,
    };
    const paymentToken = consentTokenFor(paymentIntent);

    let thrown: unknown;
    try {
      await adapter.bookHotel({
        hotelId: "h-pay",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Henry",
        paymentConsentToken: paymentToken,
      });
    } catch (e) {
      thrown = e;
    }

    // Payment leg must have been called
    assert.strictEqual(legStub.calls.length, 1, "payment leg called exactly once");
    const callArg = legStub.calls[0]!;
    assert.strictEqual(callArg.status, 402, "leg received PaymentRequired.status=402");
    assert.deepStrictEqual(
      callArg.next_action,
      nextAction,
      "leg received correct next_action",
    );

    // Result should be a catchable error (Phase A: not yet implemented)
    assert.ok(thrown instanceof TravalaPaymentRequiredError, "threw TravalaPaymentRequiredError");
    const pErr = thrown as TravalaPaymentRequiredError;
    assert.ok(pErr.paymentLegResult !== undefined, "paymentLegResult is set");
    assert.strictEqual(pErr.paymentLegResult!.success, false, "success=false (not implemented)");
    assert.ok(
      typeof pErr.paymentLegResult!.error === "string" &&
        pErr.paymentLegResult!.error.length > 0,
      "error message is a non-empty string",
    );
  });

  test("real-settlement error is catchable and contains no private keys or credentials", async () => {
    const nextAction = { amount: 50, currency: "USDC" };
    const fetchStub = makeOAuthFetchStub();
    const mcpStub = makeMCPCallStub(() => make402Response(nextAction));

    const secretKey = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env["TRAVALA_CLIENT_SECRET"] = secretKey;

    // Use defaultPaymentLeg to test the real implementation
    const adapter = new LiveAdapter({
      fetchFn: fetchStub.stub,
      mcpCallFn: mcpStub.stub,
      paymentLeg: defaultPaymentLeg,
    });

    const paymentIntent = {
      t: "travala_payment",
      hotelId: "h-cred",
      next_action: nextAction,
    };
    const paymentToken = consentTokenFor(paymentIntent);

    let thrown: unknown;
    try {
      await adapter.bookHotel({
        hotelId: "h-cred",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Iris",
        paymentConsentToken: paymentToken,
      });
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown instanceof TravalaPaymentRequiredError);
    const pErr = thrown as TravalaPaymentRequiredError;
    const errMsg = pErr.paymentLegResult?.error ?? "";
    assert.ok(!errMsg.includes(secretKey), "error does not include secret key value");
  });
});

// ── AC-13: network selection — testnet configurable, mainnet off by default ───

describe("AC-13: Base Sepolia testnet configurable; mainnet disabled by default", () => {
  afterEach(restoreDefaults);

  test("default (no env) → network is 'none', not mainnet", async () => {
    delete process.env["TRAVEL_PAYMENT_TESTNET"];
    delete process.env["TRAVEL_PAYMENT_MAINNET"];
    const result = await defaultPaymentLeg({ status: 402, next_action: {} });
    assert.notStrictEqual(result.network, "mainnet", "mainnet NOT selected by default");
    assert.strictEqual(result.network, "none", "network is 'none' by default");
  });

  test("TRAVEL_PAYMENT_TESTNET=1 → network is 'testnet'", async () => {
    process.env["TRAVEL_PAYMENT_TESTNET"] = "1";
    delete process.env["TRAVEL_PAYMENT_MAINNET"];
    const result = await defaultPaymentLeg({ status: 402, next_action: {} });
    assert.strictEqual(result.network, "testnet", "Sepolia testnet selected");
    assert.notStrictEqual(result.network, "mainnet", "not mainnet");
  });

  test("TRAVEL_PAYMENT_MAINNET=1 → network is 'mainnet' (explicit opt-in)", async () => {
    process.env["TRAVEL_PAYMENT_MAINNET"] = "1";
    delete process.env["TRAVEL_PAYMENT_TESTNET"];
    const result = await defaultPaymentLeg({ status: 402, next_action: {} });
    assert.strictEqual(result.network, "mainnet", "mainnet selected when explicitly enabled");
  });

  test("result from defaultPaymentLeg is never success=true (settlement unimplemented)", async () => {
    delete process.env["TRAVEL_PAYMENT_MAINNET"];
    delete process.env["TRAVEL_PAYMENT_TESTNET"];
    const result = await defaultPaymentLeg({
      status: 402,
      next_action: { amount: 100 },
    });
    assert.strictEqual(result.success, false, "success=false (not implemented)");
    assert.ok(result.error && result.error.length > 0, "error message present");
  });
});
