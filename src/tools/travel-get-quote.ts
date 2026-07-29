import { z } from "zod";
import { getTravelMode } from "../travala/adapter.js";
import { MockAdapter } from "../travala/mock-adapter.js";
import { LiveAdapter } from "../travala/live-adapter.js";

export const GetQuoteInputSchema = z.object({
  hotelId:  z.string().describe("Hotel ID from travel_search_hotels."),
  checkIn:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD").describe("Check-in date (YYYY-MM-DD)."),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD").describe("Check-out date (YYYY-MM-DD)."),
  guests:   z.number().int().min(1).optional().describe("Number of guests (default 1)."),
});

export type GetQuoteInput = z.infer<typeof GetQuoteInputSchema>;

export async function runGetQuote(input: GetQuoteInput) {
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  return adapter.getQuote(input);
}

export const TRAVEL_GET_QUOTE_TOOL = {
  name: "travel_get_quote",
  description:
    "Get a price quote for a specific hotel and date range. Returns the total amount " +
    "in currency for the stay. Use the hotelId from travel_search_hotels. " +
    "Present the quote to the user before proceeding to travel_book_hotel.",
  inputSchema: {
    type: "object" as const,
    properties: {
      hotelId:  { type: "string", description: "Hotel ID from travel_search_hotels." },
      checkIn:  { type: "string", description: "Check-in date (YYYY-MM-DD)." },
      checkOut: { type: "string", description: "Check-out date (YYYY-MM-DD)." },
      guests:   { type: "number", description: "Number of guests (default 1)." },
    },
    required: ["hotelId", "checkIn", "checkOut"],
    additionalProperties: false,
  },
} as const;
