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
