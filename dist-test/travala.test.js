// src/travala/travala.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// src/travala/mock-adapter.ts
import { sha256, toUtf8Bytes } from "ethers";
var FIXTURE_HOTELS = [
  {
    hotelId: "mock-hotel-001",
    name: "Grand Central Hotel",
    location: "Downtown",
    rating: 4.5,
    pricePerNight: 120,
    currency: "USD"
  },
  {
    hotelId: "mock-hotel-002",
    name: "Seaside Resort & Spa",
    location: "Beachfront",
    rating: 4.8,
    pricePerNight: 250,
    currency: "USD"
  },
  {
    hotelId: "mock-hotel-003",
    name: "Budget Inn Express",
    location: "City Center",
    rating: 3.5,
    pricePerNight: 65,
    currency: "USD"
  }
];
function nightsBetween(checkIn, checkOut) {
  const d1 = new Date(checkIn).getTime();
  const d2 = new Date(checkOut).getTime();
  const nights = Math.round((d2 - d1) / (1e3 * 60 * 60 * 24));
  return nights > 0 ? nights : 1;
}
function mockBookingId(params) {
  const key = JSON.stringify({ hotelId: params.hotelId, checkIn: params.checkIn, checkOut: params.checkOut, guestName: params.guestName });
  return "mbk_" + sha256(toUtf8Bytes(key)).slice(2, 18);
}
var bookingStore = /* @__PURE__ */ new Map();
var MockAdapter = class {
  async searchHotels(params) {
    const dest = params.destination.toLowerCase();
    const filtered = FIXTURE_HOTELS.filter(
      (h) => h.location.toLowerCase().includes(dest) || h.name.toLowerCase().includes(dest) || dest.length === 0
    );
    return { hotels: filtered.length > 0 ? filtered : FIXTURE_HOTELS };
  }
  async getQuote(params) {
    const hotel = FIXTURE_HOTELS.find((h) => h.hotelId === params.hotelId);
    const price = hotel?.pricePerNight ?? 120;
    const currency = hotel?.currency ?? "USD";
    const name = hotel?.name ?? "Unknown Hotel";
    const nights = nightsBetween(params.checkIn, params.checkOut);
    const amount = parseFloat((price * nights).toFixed(2));
    const quoteKey = JSON.stringify({ hotelId: params.hotelId, checkIn: params.checkIn, checkOut: params.checkOut });
    const quoteId = "mqt_" + sha256(toUtf8Bytes(quoteKey)).slice(2, 14);
    return {
      hotelId: params.hotelId,
      name,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      nights,
      amount,
      currency,
      quoteId
    };
  }
  async bookHotel(params) {
    const hotel = FIXTURE_HOTELS.find((h) => h.hotelId === params.hotelId);
    const price = hotel?.pricePerNight ?? 120;
    const name = hotel?.name ?? "Unknown Hotel";
    const currency = hotel?.currency ?? "USD";
    const nights = nightsBetween(params.checkIn, params.checkOut);
    const amount = parseFloat((price * nights).toFixed(2));
    const bookingId = mockBookingId(params);
    const receipt = {
      bookingId,
      hotel: { hotelId: params.hotelId, name },
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      amount,
      currency,
      status: "confirmed",
      agentID: process.env["TRAVALA_AGENT_ID"] ?? "",
      rewardWallet: process.env["TRAVALA_REWARD_WALLET"] ?? ""
    };
    bookingStore.set(bookingId, receipt);
    return receipt;
  }
  async getBookingStatus(bookingId) {
    const receipt = bookingStore.get(bookingId);
    if (!receipt) {
      return {
        bookingId,
        status: "not_found",
        hotel: { hotelId: "", name: "Unknown" },
        checkIn: "",
        checkOut: "",
        amount: 0,
        currency: "USD"
      };
    }
    return {
      bookingId: receipt.bookingId,
      status: receipt.status,
      hotel: receipt.hotel,
      checkIn: receipt.checkIn,
      checkOut: receipt.checkOut,
      amount: receipt.amount,
      currency: receipt.currency
    };
  }
};

// src/tools/travel-search-hotels.ts
import { z } from "zod";

// src/travala/adapter.ts
function getTravelMode() {
  return process.env["TRAVEL_MODE"] === "live" ? "live" : "mock";
}

// src/travala/live-adapter.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
var TRAVALA_MCP_URL = "https://travel-mcp.travala.com/mcp";
var LiveAdapter = class {
  agentID;
  rewardWallet;
  constructor() {
    this.agentID = process.env["TRAVALA_AGENT_ID"] ?? "";
    this.rewardWallet = process.env["TRAVALA_REWARD_WALLET"] ?? "";
    if (!this.agentID || !this.rewardWallet) {
      process.stderr.write(
        "[q402-mcp] warning: TRAVEL_MODE=live but TRAVALA_AGENT_ID or TRAVALA_REWARD_WALLET is not set. Booking rewards will not be credited. Set these env vars for full Travala agent functionality.\n"
      );
    }
  }
  async withClient(fn) {
    const transport = new StreamableHTTPClientTransport(new URL(TRAVALA_MCP_URL));
    const client = new Client({ name: "q402-mcp-travala-client", version: "1.0.0" });
    try {
      await client.connect(transport);
      return await fn(client);
    } finally {
      await client.close().catch(() => void 0);
    }
  }
  callResult(result) {
    const r = result;
    if (!r?.content?.length) return {};
    const first = r.content[0];
    if (first?.type === "text" && first.text) {
      try {
        return JSON.parse(first.text);
      } catch {
        return { raw: first.text };
      }
    }
    return {};
  }
  async searchHotels(params) {
    return this.withClient(async (client) => {
      const result = await client.callTool({
        name: "search_hotels",
        arguments: {
          destination: params.destination,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests ?? 1
        }
      });
      const data = this.callResult(result);
      return { hotels: data["hotels"] ?? [] };
    });
  }
  async getQuote(params) {
    return this.withClient(async (client) => {
      const result = await client.callTool({
        name: "get_quote",
        arguments: {
          hotelId: params.hotelId,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests ?? 1,
          agentID: this.agentID
        }
      });
      return this.callResult(result);
    });
  }
  async bookHotel(params) {
    return this.withClient(async (client) => {
      const result = await client.callTool({
        name: "book_hotel",
        arguments: {
          hotelId: params.hotelId,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests ?? 1,
          guestName: params.guestName,
          agentID: this.agentID,
          rewardWallet: this.rewardWallet
        }
      });
      return this.callResult(result);
    });
  }
  async getBookingStatus(bookingId) {
    return this.withClient(async (client) => {
      const result = await client.callTool({
        name: "get_booking_status",
        arguments: { bookingId }
      });
      return this.callResult(result);
    });
  }
};

// src/tools/travel-search-hotels.ts
var SearchHotelsInputSchema = z.object({
  destination: z.string().describe("City, region, or address to search for hotels."),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD").describe("Check-in date (YYYY-MM-DD)."),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD").describe("Check-out date (YYYY-MM-DD)."),
  guests: z.number().int().min(1).optional().describe("Number of guests (default 1).")
});
async function runSearchHotels(input) {
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  return adapter.searchHotels(input);
}

// src/tools/travel-get-quote.ts
import { z as z2 } from "zod";
var GetQuoteInputSchema = z2.object({
  hotelId: z2.string().describe("Hotel ID from travel_search_hotels."),
  checkIn: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD").describe("Check-in date (YYYY-MM-DD)."),
  checkOut: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD").describe("Check-out date (YYYY-MM-DD)."),
  guests: z2.number().int().min(1).optional().describe("Number of guests (default 1).")
});
async function runGetQuote(input) {
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  return adapter.getQuote(input);
}

// src/tools/travel-book-hotel.ts
import { z as z3 } from "zod";

// src/consent.ts
import { sha256 as sha2562, toUtf8Bytes as toUtf8Bytes2 } from "ethers";
function canonicalIntent(intent) {
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === "object") {
      const src = v;
      const out = {};
      for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
      return out;
    }
    if (typeof v === "number") return String(v);
    return v;
  };
  return JSON.stringify(sortValue(intent));
}
function consentTokenFor(intent) {
  return "ct_" + sha2562(toUtf8Bytes2(canonicalIntent(intent))).slice(2, 18);
}
function checkConsent(intent, provided) {
  const expected = consentTokenFor(intent);
  return { ok: provided === expected, expected };
}

// src/config.ts
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isAddress } from "ethers";
var Q402_ENV_FILE = join(homedir(), ".q402", "mcp.env");
var lastReadError = null;
var MAX_ENV_FILE_BYTES = 64 * 1024;
function loadQ402EnvFileFromPath(path) {
  lastReadError = null;
  if (!existsSync(path)) return {};
  if (process.platform !== "win32") {
    try {
      const mode = statSync(path).mode & 511;
      if (mode & 63) {
        process.stderr.write(
          `[q402-mcp] warning: ${path} is readable by group/other (mode ${mode.toString(8)}). Run: chmod 600 ${path}
`
        );
      }
    } catch {
    }
  }
  try {
    const size = statSync(path).size;
    if (size > MAX_ENV_FILE_BYTES) {
      const msg = `file is ${size} bytes (max ${MAX_ENV_FILE_BYTES}); refusing to load. Check ~/.q402/mcp.env - is it a misdirected log file or symlink?`;
      lastReadError = msg;
      process.stderr.write(`[q402-mcp] warning: ${msg}
`);
      return {};
    }
  } catch {
  }
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    const msg = `could not read ${path}: ${e instanceof Error ? e.message : String(e)}`;
    lastReadError = msg;
    process.stderr.write(`[q402-mcp] warning: ${msg}
`);
    return {};
  }
  if (raw.charCodeAt(0) === 65279) raw = raw.slice(1);
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k.startsWith("Q402_")) continue;
    let rawVal = t.slice(eq + 1).trim();
    const quoted = /^(['"])(.*)\1\s*(?:#.*)?$/.exec(rawVal);
    if (quoted) {
      rawVal = quoted[2];
    } else {
      const hashIdx = rawVal.search(/\s#/);
      if (hashIdx >= 0) rawVal = rawVal.slice(0, hashIdx).trimEnd();
    }
    if (rawVal === "") continue;
    out[k] = rawVal;
  }
  return out;
}
function loadQ402EnvFile() {
  return loadQ402EnvFileFromPath(Q402_ENV_FILE);
}
var FILE_ENV = loadQ402EnvFile();
var ENV = Object.freeze({
  ...FILE_ENV,
  ...process.env
});
var Q402_ENV_FILE_PRESENT = existsSync(Q402_ENV_FILE);
var Q402_ENV_FILE_KEYS = Object.freeze(
  new Set(
    Object.keys(FILE_ENV).filter((k) => process.env[k] === void 0)
  )
);
var Q402_ENV_FILE_KEYS_ALL = Object.freeze(
  new Set(Object.keys(FILE_ENV))
);
var DEFAULT_RELAY_BASE = "https://q402.quackai.ai/api";
var DEFAULT_MAX_AMOUNT = 200;
function classifyApiKey(k) {
  if (!k) return "missing";
  if (k.startsWith("q402_live_")) return "live";
  if (k.startsWith("q402_test_")) return "test";
  return "missing";
}
function parseAllowedRecipients(raw) {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0 && isAddress(s));
}
function parseMaxAmount(raw) {
  if (!raw) return DEFAULT_MAX_AMOUNT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_AMOUNT;
  return n;
}
function loadConfig() {
  const trialApiKey = ENV.Q402_TRIAL_API_KEY ?? null;
  const multichainApiKey = ENV.Q402_MULTICHAIN_API_KEY ?? null;
  const legacyApiKey = ENV.Q402_API_KEY ?? null;
  const apiKey = multichainApiKey ?? trialApiKey ?? legacyApiKey;
  const apiKeyKind = classifyApiKey(apiKey);
  const privateKey = ENV.Q402_PRIVATE_KEY ?? null;
  const agenticPrivateKey = ENV.Q402_AGENTIC_PRIVATE_KEY ?? null;
  const walletIdRaw = ENV.Q402_AGENT_WALLET_ADDRESS ?? ENV.Q402_WALLET_ID;
  if (!ENV.Q402_AGENT_WALLET_ADDRESS && ENV.Q402_WALLET_ID) {
    process.stderr.write(
      "[q402-mcp] Q402_WALLET_ID is deprecated - rename to Q402_AGENT_WALLET_ADDRESS. Old name will be removed in a future release.\n"
    );
  }
  const walletId = typeof walletIdRaw === "string" && walletIdRaw.length > 0 ? walletIdRaw.toLowerCase() : null;
  const realPaymentsRequested = ENV.Q402_ENABLE_REAL_PAYMENTS === "1";
  const anyLiveKey = classifyApiKey(trialApiKey) === "live" || classifyApiKey(multichainApiKey) === "live" || classifyApiKey(legacyApiKey) === "live";
  const live = realPaymentsRequested && anyLiveKey;
  const travelMode = process.env["TRAVEL_MODE"] === "live" ? "live" : "mock";
  const travalaAgentId = process.env["TRAVALA_AGENT_ID"] ?? null;
  const travalaRewardWallet = process.env["TRAVALA_REWARD_WALLET"] ?? null;
  return {
    trialApiKey,
    multichainApiKey,
    legacyApiKey,
    apiKey,
    apiKeyKind,
    privateKey,
    agenticPrivateKey,
    walletId,
    realPaymentsRequested,
    mode: live ? "live" : "sandbox",
    relayBaseUrl: (ENV.Q402_RELAY_BASE_URL ?? DEFAULT_RELAY_BASE).replace(/\/$/, ""),
    maxAmountPerCallUsd: parseMaxAmount(ENV.Q402_MAX_AMOUNT_PER_CALL),
    allowedRecipients: parseAllowedRecipients(ENV.Q402_ALLOWED_RECIPIENTS),
    travelMode,
    travalaAgentId,
    travalaRewardWallet
  };
}
var CONFIG = loadConfig();

// src/tools/travel-book-hotel.ts
var BookHotelInputSchema = z3.object({
  hotelId: z3.string().describe("Hotel ID from travel_search_hotels."),
  checkIn: z3.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD").describe("Check-in date (YYYY-MM-DD)."),
  checkOut: z3.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD").describe("Check-out date (YYYY-MM-DD)."),
  guests: z3.number().int().min(1).optional().describe("Number of guests (default 1)."),
  guestName: z3.string().min(1).describe("Full name of the primary guest."),
  amount: z3.number().positive().describe("Expected booking amount in USD (from travel_get_quote). Used for spend-limit check and consent binding."),
  currency: z3.string().optional().describe("Currency for the booking amount (default USD)."),
  consentToken: z3.string().optional().describe(
    'Two-phase consent. LEAVE UNSET on the first call: the tool returns status="needs_confirmation" with a human-readable preview and a consentToken. Relay the preview to the user, get their yes, then re-call with the SAME args plus this token. The token is re-derived from the params so a previewed booking cannot be swapped for a different one.'
  )
});
function maxBookingUsd() {
  const raw = process.env["TRAVALA_MAX_BOOKING_USD"];
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return CONFIG.maxAmountPerCallUsd;
}
async function runBookHotel(input) {
  const currency = input.currency ?? "USD";
  const cap = maxBookingUsd();
  if (input.amount > cap) {
    return {
      status: "rejected",
      reason: `booking amount $${input.amount} ${currency} exceeds the spend limit of $${cap}. Set TRAVALA_MAX_BOOKING_USD to a higher value to allow larger bookings.`
    };
  }
  const intent = {
    t: "travel_book",
    hotelId: input.hotelId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guestName: input.guestName,
    amount: input.amount,
    currency,
    guests: input.guests ?? 1
  };
  const consent = checkConsent(intent, input.consentToken);
  if (!consent.ok) {
    return {
      status: "needs_confirmation",
      preview: `Book ${input.hotelId} for ${input.guestName}, ${input.checkIn} \u2192 ${input.checkOut} (${input.guests ?? 1} guest(s)), total $${input.amount} ${currency}. Confirm with the user, then re-call travel_book_hotel with the same args plus consentToken="${consent.expected}".`,
      consentToken: consent.expected
    };
  }
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  const receipt = await adapter.bookHotel({
    hotelId: input.hotelId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    guestName: input.guestName
  });
  return { status: "booked", receipt };
}

// src/tools/travel-get-booking-status.ts
import { z as z4 } from "zod";
var GetBookingStatusInputSchema = z4.object({
  bookingId: z4.string().describe("Booking ID returned by travel_book_hotel.")
});
async function runGetBookingStatus(input) {
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  return adapter.getBookingStatus(input.bookingId);
}

// src/travala/travala.test.ts
delete process.env["TRAVEL_MODE"];
process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";
describe("travel_search_hotels (mock)", () => {
  test("returns non-empty hotels array", async () => {
    const result = await runSearchHotels({
      destination: "beach",
      checkIn: "2025-09-01",
      checkOut: "2025-09-05"
    });
    assert.ok(Array.isArray(result.hotels), "hotels is an array");
    assert.ok(result.hotels.length > 0, "hotels is non-empty");
    const first = result.hotels[0];
    assert.ok(first !== void 0, "first hotel exists");
    assert.ok(typeof first.hotelId === "string" && first.hotelId.length > 0, "hotelId is set");
    assert.ok(typeof first.name === "string", "name is set");
    assert.ok(typeof first.pricePerNight === "number", "pricePerNight is number");
    assert.ok(typeof first.currency === "string", "currency is set");
  });
  test("same inputs \u2192 same fixture (deterministic)", async () => {
    const r1 = await runSearchHotels({ destination: "downtown", checkIn: "2025-09-01", checkOut: "2025-09-03" });
    const r2 = await runSearchHotels({ destination: "downtown", checkIn: "2025-09-01", checkOut: "2025-09-03" });
    assert.deepStrictEqual(r1, r2, "results are deterministic");
  });
});
describe("travel_get_quote (mock)", () => {
  test("returns quote with amount and currency for a hotelId", async () => {
    const result = await runGetQuote({
      hotelId: "mock-hotel-001",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03"
    });
    assert.ok(typeof result.amount === "number" && result.amount > 0, "amount > 0");
    assert.ok(typeof result.currency === "string" && result.currency.length > 0, "currency set");
    assert.ok(typeof result.quoteId === "string" && result.quoteId.length > 0, "quoteId set");
    assert.strictEqual(result.hotelId, "mock-hotel-001");
    assert.strictEqual(result.nights, 2);
  });
  test("same inputs \u2192 same quote (deterministic)", async () => {
    const q1 = await runGetQuote({ hotelId: "mock-hotel-002", checkIn: "2025-10-01", checkOut: "2025-10-04" });
    const q2 = await runGetQuote({ hotelId: "mock-hotel-002", checkIn: "2025-10-01", checkOut: "2025-10-04" });
    assert.deepStrictEqual(q1, q2);
  });
});
describe("travel_book_hotel + travel_get_booking_status (mock chain)", () => {
  test("bookingId from book is found by status lookup", async () => {
    const phase1 = await runBookHotel({
      hotelId: "mock-hotel-001",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Alice Test",
      amount: 240
    });
    assert.strictEqual(phase1.status, "needs_confirmation", "phase 1 returns needs_confirmation");
    assert.ok("consentToken" in phase1 && typeof phase1.consentToken === "string", "consentToken present");
    assert.ok("preview" in phase1 && typeof phase1.preview === "string", "preview present");
    const phase2 = await runBookHotel({
      hotelId: "mock-hotel-001",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Alice Test",
      amount: 240,
      consentToken: phase1.consentToken
    });
    assert.strictEqual(phase2.status, "booked");
    assert.ok("receipt" in phase2, "receipt present");
    const receipt = phase2.receipt;
    assert.ok(typeof receipt["bookingId"] === "string" && receipt["bookingId"].length > 0, "bookingId set");
    const status = await runGetBookingStatus({ bookingId: receipt["bookingId"] });
    assert.strictEqual(status.bookingId, receipt["bookingId"]);
    assert.notStrictEqual(status.status, "not_found", "booking found");
  });
  test("same booking params \u2192 same bookingId (deterministic)", async () => {
    const adapter = new MockAdapter();
    const intent = { t: "travel_book", hotelId: "mock-hotel-001", checkIn: "2025-11-01", checkOut: "2025-11-03", guestName: "Bob", amount: 240, currency: "USD", guests: 1 };
    const token = consentTokenFor(intent);
    const r1 = await runBookHotel({ hotelId: "mock-hotel-001", checkIn: "2025-11-01", checkOut: "2025-11-03", guestName: "Bob", amount: 240, consentToken: token });
    const r2 = await runBookHotel({ hotelId: "mock-hotel-001", checkIn: "2025-11-01", checkOut: "2025-11-03", guestName: "Bob", amount: 240, consentToken: token });
    assert.strictEqual(r1.status, "booked");
    assert.strictEqual(r2.status, "booked");
    const id1 = r1.receipt["bookingId"];
    const id2 = r2.receipt["bookingId"];
    assert.strictEqual(id1, id2, "same params \u2192 same bookingId");
    void adapter;
  });
});
describe("travel_book_hotel receipt fields (AC-4)", () => {
  test("receipt contains all required fields", async () => {
    const intent = { t: "travel_book", hotelId: "mock-hotel-002", checkIn: "2025-12-01", checkOut: "2025-12-05", guestName: "Carol", amount: 1e3, currency: "USD", guests: 1 };
    const token = consentTokenFor(intent);
    const result = await runBookHotel({
      hotelId: "mock-hotel-002",
      checkIn: "2025-12-01",
      checkOut: "2025-12-05",
      guestName: "Carol",
      amount: 1e3,
      consentToken: token
    });
    assert.strictEqual(result.status, "booked");
    const receipt = result.receipt;
    assert.ok("bookingId" in receipt, "bookingId");
    assert.ok("hotel" in receipt, "hotel");
    assert.ok("checkIn" in receipt, "checkIn");
    assert.ok("checkOut" in receipt, "checkOut");
    assert.ok("amount" in receipt, "amount");
    assert.ok("currency" in receipt, "currency");
    assert.ok("status" in receipt, "status");
    assert.ok("agentID" in receipt, "agentID");
    assert.ok("rewardWallet" in receipt, "rewardWallet");
    const hotel = receipt["hotel"];
    assert.ok("hotelId" in hotel, "hotel.hotelId");
    assert.ok("name" in hotel, "hotel.name");
  });
});
describe("travel_book_hotel two-phase consent (AC-5)", () => {
  test("first call without token \u2192 needs_confirmation, no booking", async () => {
    const result = await runBookHotel({
      hotelId: "mock-hotel-003",
      checkIn: "2025-10-10",
      checkOut: "2025-10-12",
      guestName: "Dave",
      amount: 130
    });
    assert.strictEqual(result.status, "needs_confirmation");
    assert.ok("consentToken" in result, "consentToken returned");
    assert.ok("preview" in result, "preview returned");
    const status = await runGetBookingStatus({ bookingId: "nonexistent-id" });
    assert.strictEqual(status.status, "not_found");
  });
  test("wrong consentToken \u2192 still needs_confirmation", async () => {
    const result = await runBookHotel({
      hotelId: "mock-hotel-003",
      checkIn: "2025-10-10",
      checkOut: "2025-10-12",
      guestName: "Dave",
      amount: 130,
      consentToken: "ct_wrongtoken00000"
    });
    assert.strictEqual(result.status, "needs_confirmation");
  });
  test("correct consentToken \u2192 booking executes", async () => {
    const intent = { t: "travel_book", hotelId: "mock-hotel-003", checkIn: "2025-10-15", checkOut: "2025-10-17", guestName: "Eve", amount: 130, currency: "USD", guests: 1 };
    const token = consentTokenFor(intent);
    const result = await runBookHotel({
      hotelId: "mock-hotel-003",
      checkIn: "2025-10-15",
      checkOut: "2025-10-17",
      guestName: "Eve",
      amount: 130,
      consentToken: token
    });
    assert.strictEqual(result.status, "booked");
    assert.ok("receipt" in result, "receipt in result");
  });
});
describe("travel_book_hotel spend limit (AC-6)", () => {
  test("amount exceeds configured limit \u2192 rejected with readable error", async () => {
    process.env["TRAVALA_MAX_BOOKING_USD"] = "200";
    try {
      const result = await runBookHotel({
        hotelId: "mock-hotel-002",
        checkIn: "2025-09-01",
        checkOut: "2025-09-30",
        guestName: "Frank",
        amount: 99999
      });
      assert.strictEqual(result.status, "rejected");
      assert.ok("reason" in result && typeof result.reason === "string", "reason is a string");
      assert.ok(result.reason.includes("spend limit"), "reason mentions spend limit");
    } finally {
      process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";
    }
  });
  test("amount within limit \u2192 passes guard (proceeds to consent phase)", async () => {
    process.env["TRAVALA_MAX_BOOKING_USD"] = "500";
    try {
      const result = await runBookHotel({
        hotelId: "mock-hotel-001",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Grace",
        amount: 400
      });
      assert.notStrictEqual(result.status, "rejected", "not rejected within limit");
      assert.strictEqual(result.status, "needs_confirmation", "proceeds to consent phase");
    } finally {
      process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";
    }
  });
});
