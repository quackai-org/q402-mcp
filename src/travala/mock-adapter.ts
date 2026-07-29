/**
 * MockAdapter - deterministic in-memory Travala adapter.
 *
 * All responses are fixture-based: same inputs always produce the same outputs.
 * No network requests are made. Stores booked reservations in a module-level
 * Map so `getBookingStatus` can look up bookings created in the same process.
 */

import { sha256, toUtf8Bytes } from "ethers";
import type {
  TravalaAdapter,
  Hotel,
  Quote,
  BookingReceipt,
  BookingStatus,
  SearchParams,
  QuoteParams,
  BookParams,
} from "./adapter.js";

const FIXTURE_HOTELS: Hotel[] = [
  {
    hotelId: "mock-hotel-001",
    name: "Grand Central Hotel",
    location: "Downtown",
    rating: 4.5,
    pricePerNight: 120,
    currency: "USD",
  },
  {
    hotelId: "mock-hotel-002",
    name: "Seaside Resort & Spa",
    location: "Beachfront",
    rating: 4.8,
    pricePerNight: 250,
    currency: "USD",
  },
  {
    hotelId: "mock-hotel-003",
    name: "Budget Inn Express",
    location: "City Center",
    rating: 3.5,
    pricePerNight: 65,
    currency: "USD",
  },
];

function nightsBetween(checkIn: string, checkOut: string): number {
  const d1 = new Date(checkIn).getTime();
  const d2 = new Date(checkOut).getTime();
  const nights = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : 1;
}

function mockBookingId(params: BookParams): string {
  const key = JSON.stringify({ hotelId: params.hotelId, checkIn: params.checkIn, checkOut: params.checkOut, guestName: params.guestName });
  return "mbk_" + sha256(toUtf8Bytes(key)).slice(2, 18);
}

const bookingStore = new Map<string, BookingReceipt>();

export class MockAdapter implements TravalaAdapter {
  async searchHotels(params: SearchParams): Promise<{ hotels: Hotel[] }> {
    // Filter by destination (partial match, case-insensitive) or return all fixtures.
    const dest = params.destination.toLowerCase();
    const filtered = FIXTURE_HOTELS.filter(
      h =>
        h.location.toLowerCase().includes(dest) ||
        h.name.toLowerCase().includes(dest) ||
        dest.length === 0,
    );
    return { hotels: filtered.length > 0 ? filtered : FIXTURE_HOTELS };
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    const hotel = FIXTURE_HOTELS.find(h => h.hotelId === params.hotelId);
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
      quoteId,
    };
  }

  async bookHotel(params: BookParams): Promise<BookingReceipt> {
    const hotel = FIXTURE_HOTELS.find(h => h.hotelId === params.hotelId);
    const price = hotel?.pricePerNight ?? 120;
    const name = hotel?.name ?? "Unknown Hotel";
    const currency = hotel?.currency ?? "USD";
    const nights = nightsBetween(params.checkIn, params.checkOut);
    const amount = parseFloat((price * nights).toFixed(2));
    const bookingId = mockBookingId(params);
    const receipt: BookingReceipt = {
      bookingId,
      hotel: { hotelId: params.hotelId, name },
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      amount,
      currency,
      status: "confirmed",
      agentID: process.env["TRAVALA_AGENT_ID"] ?? "",
      rewardWallet: process.env["TRAVALA_REWARD_WALLET"] ?? "",
    };
    bookingStore.set(bookingId, receipt);
    return receipt;
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatus> {
    const receipt = bookingStore.get(bookingId);
    if (!receipt) {
      return {
        bookingId,
        status: "not_found",
        hotel: { hotelId: "", name: "Unknown" },
        checkIn: "",
        checkOut: "",
        amount: 0,
        currency: "USD",
      };
    }
    return {
      bookingId: receipt.bookingId,
      status: receipt.status,
      hotel: receipt.hotel,
      checkIn: receipt.checkIn,
      checkOut: receipt.checkOut,
      amount: receipt.amount,
      currency: receipt.currency,
    };
  }
}
