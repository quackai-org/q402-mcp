import { z } from "zod";
import { getTravelMode } from "../travala/adapter.js";
import { MockAdapter } from "../travala/mock-adapter.js";
import { LiveAdapter } from "../travala/live-adapter.js";

export const GetBookingStatusInputSchema = z.object({
  bookingId: z.string().describe("Booking ID returned by travel_book_hotel."),
});

export type GetBookingStatusInput = z.infer<typeof GetBookingStatusInputSchema>;

export async function runGetBookingStatus(input: GetBookingStatusInput) {
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  return adapter.getBookingStatus(input.bookingId);
}

export const TRAVEL_GET_BOOKING_STATUS_TOOL = {
  name: "travel_get_booking_status",
  description:
    "Retrieve the current status of a hotel booking using the bookingId returned by " +
    "travel_book_hotel. Returns booking details including hotel, dates, amount, " +
    "currency, and status (confirmed, pending, cancelled, not_found).",
  inputSchema: {
    type: "object" as const,
    properties: {
      bookingId: { type: "string", description: "Booking ID from travel_book_hotel." },
    },
    required: ["bookingId"],
    additionalProperties: false,
  },
} as const;
