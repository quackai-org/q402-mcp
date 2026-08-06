/**
 * TravalaAdapter - interface + factory.
 *
 * TRAVEL_MODE env var selects the implementation:
 *   - unset / "mock" → MockAdapter (default; no network, deterministic fixtures)
 *   - "live"         → LiveAdapter (MCP client to travel-mcp.travala.com)
 *
 * Note: TRAVEL_MODE is read directly from process.env because config.ts only
 * auto-merges Q402_* keys from ~/.q402/mcp.env.
 */

export interface Hotel {
  hotelId: string;
  name: string;
  location: string;
  rating: number;
  pricePerNight: number;
  currency: string;
}

export interface Quote {
  hotelId: string;
  name: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  amount: number;
  currency: string;
  quoteId: string;
}

export interface BookingReceipt {
  bookingId: string;
  hotel: { hotelId: string; name: string };
  checkIn: string;
  checkOut: string;
  amount: number;
  currency: string;
  status: string;
  agentID: string;
  rewardWallet: string;
}

export interface BookingStatus {
  bookingId: string;
  status: string;
  hotel: { hotelId: string; name: string };
  checkIn: string;
  checkOut: string;
  amount: number;
  currency: string;
}

export interface SearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
}

export interface QuoteParams {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
}

export interface BookParams {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  guests?: number;
  guestName: string;
  // Extended fields for Travala live API (travala_book tool contract)
  packageId?: string;
  sessionId?: string;
  roomTypeId?: string;
  roomName?: string;
  price?: number;
  currency?: string;
  customer?: Record<string, unknown>;
  // Payment consent token for the 402 payment leg (live adapter only)
  paymentConsentToken?: string;
}

export interface TravalaAdapter {
  searchHotels(params: SearchParams): Promise<{ hotels: Hotel[] }>;
  getQuote(params: QuoteParams): Promise<Quote>;
  bookHotel(params: BookParams): Promise<BookingReceipt>;
  getBookingStatus(bookingId: string): Promise<BookingStatus>;
}

export function getTravelMode(): "mock" | "live" {
  return process.env["TRAVEL_MODE"] === "live" ? "live" : "mock";
}

// ── 402 Payment leg types ────────────────────────────────────────────────────

/**
 * Structured representation of a Travala 402 Payment Required response.
 *
 * next_action contract (to be confirmed with a real Travala 402 sample):
 *   next_action.type?:      payment type identifier (e.g. "crypto_payment")
 *   next_action.amount?:    amount to pay (number)
 *   next_action.currency?:  currency code (e.g. "USDC")
 *   next_action.recipient?: recipient address (hex string on Base)
 *   Further fields: TBD from actual travala_book 402 response.
 *
 * All fields are passed through as-is (no fabrication) per Phase A spec.
 */
export interface PaymentRequired {
  status: 402;
  next_action: Record<string, unknown>;
}

export interface PaymentLegResult {
  success: boolean;
  /** Which network the payment leg would target. "none" = not configured. */
  network?: "none" | "testnet" | "mainnet";
  error?: string;
  txHash?: string;
}

export type PaymentLeg = (payment: PaymentRequired) => Promise<PaymentLegResult>;

/**
 * Thrown by LiveAdapter.bookHotel() when Travala returns HTTP 402.
 * Callers (runBookHotel) catch this to surface the appropriate tool status.
 *
 * Cases:
 *   needsConsent set    → caller should return needs_confirmation to the agent
 *   rejectedReason set  → caller should return rejected (spend limit exceeded)
 *   paymentLegResult set → payment leg ran; surface the result (error in Phase A)
 */
export class TravalaPaymentRequiredError extends Error {
  constructor(
    public readonly paymentRequired: PaymentRequired,
    public readonly needsConsent?: { preview: string; consentToken: string },
    public readonly rejectedReason?: string,
    public readonly paymentLegResult?: PaymentLegResult,
  ) {
    super("Travala booking requires payment (HTTP 402)");
    this.name = "TravalaPaymentRequiredError";
  }
}
