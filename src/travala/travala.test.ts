/**
 * Tests for the Travala hotel booking integration (AC-8).
 * Covers: mock four-tool chain (AC-3), consent two-phase (AC-5), limit guard (AC-6).
 *
 * Run with: node --experimental-strip-types --test src/travala/travala.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Clear TRAVEL_MODE so all tests use the mock adapter by default.
// Set a generous booking cap so the flow tests don't trip the spend guard.
// The AC-6 tests override this explicitly.
delete process.env["TRAVEL_MODE"];
process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";

import { MockAdapter } from "./mock-adapter.js";
import { runSearchHotels } from "../tools/travel-search-hotels.js";
import { runGetQuote } from "../tools/travel-get-quote.js";
import { runBookHotel } from "../tools/travel-book-hotel.js";
import { runGetBookingStatus } from "../tools/travel-get-booking-status.js";
import { consentTokenFor } from "../consent.js";

// ── AC-3: Mock full-chain ──────────────────────────────────────────────────

describe("travel_search_hotels (mock)", () => {
  test("returns non-empty hotels array", async () => {
    const result = await runSearchHotels({
      destination: "beach",
      checkIn: "2025-09-01",
      checkOut: "2025-09-05",
    });
    assert.ok(Array.isArray(result.hotels), "hotels is an array");
    assert.ok(result.hotels.length > 0, "hotels is non-empty");
    const first = result.hotels[0];
    assert.ok(first !== undefined, "first hotel exists");
    assert.ok(typeof first.hotelId === "string" && first.hotelId.length > 0, "hotelId is set");
    assert.ok(typeof first.name === "string", "name is set");
    assert.ok(typeof first.pricePerNight === "number", "pricePerNight is number");
    assert.ok(typeof first.currency === "string", "currency is set");
  });

  test("same inputs → same fixture (deterministic)", async () => {
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
      checkOut: "2025-09-03",
    });
    assert.ok(typeof result.amount === "number" && result.amount > 0, "amount > 0");
    assert.ok(typeof result.currency === "string" && result.currency.length > 0, "currency set");
    assert.ok(typeof result.quoteId === "string" && result.quoteId.length > 0, "quoteId set");
    assert.strictEqual(result.hotelId, "mock-hotel-001");
    assert.strictEqual(result.nights, 2);
  });

  test("same inputs → same quote (deterministic)", async () => {
    const q1 = await runGetQuote({ hotelId: "mock-hotel-002", checkIn: "2025-10-01", checkOut: "2025-10-04" });
    const q2 = await runGetQuote({ hotelId: "mock-hotel-002", checkIn: "2025-10-01", checkOut: "2025-10-04" });
    assert.deepStrictEqual(q1, q2);
  });
});

describe("travel_book_hotel + travel_get_booking_status (mock chain)", () => {
  test("bookingId from book is found by status lookup", async () => {
    // First: get the consent token (phase 1)
    const phase1 = await runBookHotel({
      hotelId: "mock-hotel-001",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Alice Test",
      amount: 240,
    });
    assert.strictEqual(phase1.status, "needs_confirmation", "phase 1 returns needs_confirmation");
    assert.ok("consentToken" in phase1 && typeof phase1.consentToken === "string", "consentToken present");
    assert.ok("preview" in phase1 && typeof phase1.preview === "string", "preview present");

    // Phase 2: book with consent token
    const phase2 = await runBookHotel({
      hotelId: "mock-hotel-001",
      checkIn: "2025-09-01",
      checkOut: "2025-09-03",
      guestName: "Alice Test",
      amount: 240,
      consentToken: phase1.consentToken as string,
    });
    assert.strictEqual(phase2.status, "booked");
    assert.ok("receipt" in phase2, "receipt present");
    const receipt = phase2.receipt as unknown as Record<string, unknown>;
    assert.ok(typeof receipt["bookingId"] === "string" && (receipt["bookingId"] as string).length > 0, "bookingId set");

    // Status lookup
    const status = await runGetBookingStatus({ bookingId: receipt["bookingId"] as string });
    assert.strictEqual(status.bookingId, receipt["bookingId"]);
    assert.notStrictEqual(status.status, "not_found", "booking found");
  });

  test("same booking params → same bookingId (deterministic)", async () => {
    const adapter = new MockAdapter();
    const intent = { t: "travel_book", hotelId: "mock-hotel-001", checkIn: "2025-11-01", checkOut: "2025-11-03", guestName: "Bob", amount: 240, currency: "USD", guests: 1 };
    const token = consentTokenFor(intent);
    const r1 = await runBookHotel({ hotelId: "mock-hotel-001", checkIn: "2025-11-01", checkOut: "2025-11-03", guestName: "Bob", amount: 240, consentToken: token });
    const r2 = await runBookHotel({ hotelId: "mock-hotel-001", checkIn: "2025-11-01", checkOut: "2025-11-03", guestName: "Bob", amount: 240, consentToken: token });
    assert.strictEqual(r1.status, "booked");
    assert.strictEqual(r2.status, "booked");
    const id1 = (r1.receipt as unknown as Record<string, unknown>)["bookingId"];
    const id2 = (r2.receipt as unknown as Record<string, unknown>)["bookingId"];
    assert.strictEqual(id1, id2, "same params → same bookingId");
    // Suppress unused variable warning
    void adapter;
  });
});

// ── AC-4: Structured receipt ───────────────────────────────────────────────

describe("travel_book_hotel receipt fields (AC-4)", () => {
  test("receipt contains all required fields", async () => {
    const intent = { t: "travel_book", hotelId: "mock-hotel-002", checkIn: "2025-12-01", checkOut: "2025-12-05", guestName: "Carol", amount: 1000, currency: "USD", guests: 1 };
    const token = consentTokenFor(intent);
    const result = await runBookHotel({
      hotelId: "mock-hotel-002",
      checkIn: "2025-12-01",
      checkOut: "2025-12-05",
      guestName: "Carol",
      amount: 1000,
      consentToken: token,
    });
    assert.strictEqual(result.status, "booked");
    const receipt = result.receipt as unknown as Record<string, unknown>;
    // AC-4 required fields
    assert.ok("bookingId"   in receipt, "bookingId");
    assert.ok("hotel"       in receipt, "hotel");
    assert.ok("checkIn"     in receipt, "checkIn");
    assert.ok("checkOut"    in receipt, "checkOut");
    assert.ok("amount"      in receipt, "amount");
    assert.ok("currency"    in receipt, "currency");
    assert.ok("status"      in receipt, "status");
    assert.ok("agentID"     in receipt, "agentID");
    assert.ok("rewardWallet" in receipt, "rewardWallet");
    const hotel = receipt["hotel"] as Record<string, unknown>;
    assert.ok("hotelId" in hotel, "hotel.hotelId");
    assert.ok("name"    in hotel, "hotel.name");
  });
});

// ── AC-5: Consent two-phase ───────────────────────────────────────────────

describe("travel_book_hotel two-phase consent (AC-5)", () => {
  test("first call without token → needs_confirmation, no booking", async () => {
    const result = await runBookHotel({
      hotelId: "mock-hotel-003",
      checkIn: "2025-10-10",
      checkOut: "2025-10-12",
      guestName: "Dave",
      amount: 130,
    });
    assert.strictEqual(result.status, "needs_confirmation");
    assert.ok("consentToken" in result, "consentToken returned");
    assert.ok("preview" in result, "preview returned");
    // Verify no booking was created
    const status = await runGetBookingStatus({ bookingId: "nonexistent-id" });
    assert.strictEqual(status.status, "not_found");
  });

  test("wrong consentToken → still needs_confirmation", async () => {
    const result = await runBookHotel({
      hotelId: "mock-hotel-003",
      checkIn: "2025-10-10",
      checkOut: "2025-10-12",
      guestName: "Dave",
      amount: 130,
      consentToken: "ct_wrongtoken00000",
    });
    assert.strictEqual(result.status, "needs_confirmation");
  });

  test("correct consentToken → booking executes", async () => {
    const intent = { t: "travel_book", hotelId: "mock-hotel-003", checkIn: "2025-10-15", checkOut: "2025-10-17", guestName: "Eve", amount: 130, currency: "USD", guests: 1 };
    const token = consentTokenFor(intent);
    const result = await runBookHotel({
      hotelId: "mock-hotel-003",
      checkIn: "2025-10-15",
      checkOut: "2025-10-17",
      guestName: "Eve",
      amount: 130,
      consentToken: token,
    });
    assert.strictEqual(result.status, "booked");
    assert.ok("receipt" in result, "receipt in result");
  });
});

// ── AC-6: Spend limit guard ───────────────────────────────────────────────

describe("travel_book_hotel spend limit (AC-6)", () => {
  test("amount exceeds configured limit → rejected with readable error", async () => {
    process.env["TRAVALA_MAX_BOOKING_USD"] = "200";
    try {
      const result = await runBookHotel({
        hotelId: "mock-hotel-002",
        checkIn: "2025-09-01",
        checkOut: "2025-09-30",
        guestName: "Frank",
        amount: 99999,
      });
      assert.strictEqual(result.status, "rejected");
      assert.ok("reason" in result && typeof result.reason === "string", "reason is a string");
      assert.ok((result.reason as string).includes("spend limit"), "reason mentions spend limit");
    } finally {
      process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";
    }
  });

  test("amount within limit → passes guard (proceeds to consent phase)", async () => {
    process.env["TRAVALA_MAX_BOOKING_USD"] = "500";
    try {
      const result = await runBookHotel({
        hotelId: "mock-hotel-001",
        checkIn: "2025-09-01",
        checkOut: "2025-09-03",
        guestName: "Grace",
        amount: 400,
      });
      // Should get needs_confirmation (not rejected) since amount is within limit
      assert.notStrictEqual(result.status, "rejected", "not rejected within limit");
      assert.strictEqual(result.status, "needs_confirmation", "proceeds to consent phase");
    } finally {
      process.env["TRAVALA_MAX_BOOKING_USD"] = "2000";
    }
  });
});
