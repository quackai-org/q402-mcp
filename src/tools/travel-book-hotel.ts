/**
 * travel_book_hotel - two-phase consent + spend limit guard.
 *
 * Phase 1 (no consentToken): returns needs_confirmation + preview + consentToken.
 * Phase 2 (correct token):   runs the booking through the adapter.
 *
 * If the live adapter receives a 402 from Travala, it throws TravalaPaymentRequiredError.
 * This tool catches it and surfaces the payment consent flow as an additional round-trip.
 *
 * Spend limit: reads TRAVALA_MAX_BOOKING_USD (default: CONFIG.maxAmountPerCallUsd).
 * Reuses consent mechanism from src/consent.ts (checkConsent / consentTokenFor).
 */

import { z } from "zod";
import { checkConsent } from "../consent.js";
import { CONFIG } from "../config.js";
import { getTravelMode } from "../travala/adapter.js";
import { TravalaPaymentRequiredError } from "../travala/adapter.js";
import { MockAdapter } from "../travala/mock-adapter.js";
import { LiveAdapter } from "../travala/live-adapter.js";

export const BookHotelInputSchema = z.object({
  hotelId:             z.string().describe("Hotel ID from travel_search_hotels."),
  checkIn:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD").describe("Check-in date (YYYY-MM-DD)."),
  checkOut:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD").describe("Check-out date (YYYY-MM-DD)."),
  guests:              z.number().int().min(1).optional().describe("Number of guests (default 1)."),
  guestName:           z.string().min(1).describe("Full name of the primary guest."),
  amount:              z.number().positive().describe("Expected booking amount in USD (from travel_get_quote). Used for spend-limit check and consent binding."),
  currency:            z.string().optional().describe("Currency for the booking amount (default USD)."),
  consentToken:        z.string().optional().describe(
    "Two-phase consent. LEAVE UNSET on the first call: the tool returns " +
    "status=\"needs_confirmation\" with a human-readable preview and a consentToken. " +
    "Relay the preview to the user, get their yes, then re-call with the SAME args " +
    "plus this token. The token is re-derived from the params so a previewed booking " +
    "cannot be swapped for a different one.",
  ),
  paymentConsentToken: z.string().optional().describe(
    "Payment consent for Travala 402 flow (live mode only). " +
    "Set only when a previous call returned status=\"payment_needs_confirmation\". " +
    "Leave unset on the first call.",
  ),
});

export type BookHotelInput = z.infer<typeof BookHotelInputSchema>;

export function maxBookingUsd(): number {
  const raw = process.env["TRAVALA_MAX_BOOKING_USD"];
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return CONFIG.maxAmountPerCallUsd;
}

export async function runBookHotel(input: BookHotelInput) {
  const currency = input.currency ?? "USD";

  // Spend limit check (AC-6): runs before consent so the preview reflects rejection.
  const cap = maxBookingUsd();
  if (input.amount > cap) {
    return {
      status: "rejected",
      reason: `booking amount $${input.amount} ${currency} exceeds the spend limit of $${cap}. ` +
        `Set TRAVALA_MAX_BOOKING_USD to a higher value to allow larger bookings.`,
    };
  }

  // Two-phase consent (AC-5)
  const intent = {
    t: "travel_book",
    hotelId: input.hotelId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guestName: input.guestName,
    amount: input.amount,
    currency,
    guests: input.guests ?? 1,
  };
  const consent = checkConsent(intent, input.consentToken);
  if (!consent.ok) {
    return {
      status: "needs_confirmation",
      preview:
        `Book ${input.hotelId} for ${input.guestName}, ` +
        `${input.checkIn} → ${input.checkOut} (${input.guests ?? 1} guest(s)), ` +
        `total $${input.amount} ${currency}. ` +
        `Confirm with the user, then re-call travel_book_hotel with the same args plus ` +
        `consentToken="${consent.expected}".`,
      consentToken: consent.expected,
    };
  }

  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  try {
    const receipt = await adapter.bookHotel({
      hotelId: input.hotelId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
      guestName: input.guestName,
      currency,
      paymentConsentToken: input.paymentConsentToken,
    });
    return { status: "booked", receipt };
  } catch (e) {
    if (e instanceof TravalaPaymentRequiredError) {
      if (e.rejectedReason) {
        return { status: "rejected", reason: e.rejectedReason };
      }
      if (e.needsConsent) {
        return {
          status: "payment_needs_confirmation",
          preview: e.needsConsent.preview,
          paymentConsentToken: e.needsConsent.consentToken,
          paymentRequired: e.paymentRequired,
        };
      }
      if (e.paymentLegResult) {
        return {
          status: "payment_error",
          error: e.paymentLegResult.error ?? "Payment settlement failed.",
          network: e.paymentLegResult.network,
          paymentRequired: e.paymentRequired,
        };
      }
      return {
        status: "payment_error",
        error: "Travala booking requires payment. Settlement not yet configured.",
        paymentRequired: e.paymentRequired,
      };
    }
    throw e;
  }
}

export const TRAVEL_BOOK_HOTEL_TOOL = {
  name: "travel_book_hotel",
  description:
    "Book a hotel. Requires two-phase consent: the first call (without consentToken) " +
    "returns status=\"needs_confirmation\" with a preview and a consentToken - NO booking " +
    "is made. Relay the preview to the user verbatim, get their explicit yes, then " +
    "re-call with the SAME args plus consentToken. A spend limit guard rejects bookings " +
    "above TRAVALA_MAX_BOOKING_USD (default: same as Q402_MAX_AMOUNT_PER_CALL). " +
    "Always call travel_get_quote first to obtain the amount.",
  inputSchema: {
    type: "object" as const,
    properties: {
      hotelId:             { type: "string",  description: "Hotel ID from travel_search_hotels." },
      checkIn:             { type: "string",  description: "Check-in date (YYYY-MM-DD)." },
      checkOut:            { type: "string",  description: "Check-out date (YYYY-MM-DD)." },
      guests:              { type: "number",  description: "Number of guests (default 1)." },
      guestName:           { type: "string",  description: "Full name of the primary guest." },
      amount:              { type: "number",  description: "Expected total amount in USD (from travel_get_quote)." },
      currency:            { type: "string",  description: "Currency (default USD)." },
      consentToken:        { type: "string",  description: "Two-phase consent token from the first call." },
      paymentConsentToken: { type: "string",  description: "Payment consent token (live mode 402 flow only)." },
    },
    required: ["hotelId", "checkIn", "checkOut", "guestName", "amount"],
    additionalProperties: false,
  },
} as const;
