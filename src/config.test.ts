/**
 * Tests for isTrialChain window-aware routing.
 *
 * AC-2  Mantle is a trial chain within the window and not outside it.
 * AC-4  BNB and Avalanche are always trial chains (unchanged behavior).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isTrialChain,
  MANTLE_TRIAL_START_UTC,
  MANTLE_TRIAL_END_EXCLUSIVE_UTC,
} from "./config.js";

// ── AC-4: BNB + Avax are always trial chains ────────────────────────────────

describe("AC-4: permanent trial chains", () => {
  const beforeWindow = new Date("2026-08-01T00:00:00.000Z");
  const duringWindow = new Date("2026-08-24T00:00:00.000Z");
  const afterWindow  = new Date("2026-09-01T00:00:00.000Z");

  test("bnb is trial before window", () => {
    assert.equal(isTrialChain("bnb", beforeWindow), true);
  });
  test("bnb is trial during window", () => {
    assert.equal(isTrialChain("bnb", duringWindow), true);
  });
  test("bnb is trial after window", () => {
    assert.equal(isTrialChain("bnb", afterWindow), true);
  });
  test("avax is trial before window", () => {
    assert.equal(isTrialChain("avax", beforeWindow), true);
  });
  test("avax is trial during window", () => {
    assert.equal(isTrialChain("avax", duringWindow), true);
  });
  test("avax is trial after window", () => {
    assert.equal(isTrialChain("avax", afterWindow), true);
  });
});

// ── AC-2: Mantle is time-gated ──────────────────────────────────────────────

describe("AC-2: Mantle limited-time trial window", () => {
  // 1 ms before window opens
  const justBefore = new Date(MANTLE_TRIAL_START_UTC.getTime() - 1);
  // exactly at window open (inclusive)
  const atStart = new Date(MANTLE_TRIAL_START_UTC.getTime());
  // mid-window
  const midWindow = new Date("2026-08-24T12:00:00.000Z");
  // 1 ms before window closes (still inside, exclusive end)
  const justBeforeEnd = new Date(MANTLE_TRIAL_END_EXCLUSIVE_UTC.getTime() - 1);
  // exactly at window close (exclusive — NOT inside)
  const atEnd = new Date(MANTLE_TRIAL_END_EXCLUSIVE_UTC.getTime());
  // well after window
  const afterWindow = new Date("2026-09-01T00:00:00.000Z");

  test("mantle is NOT trial 1 ms before window", () => {
    assert.equal(isTrialChain("mantle", justBefore), false);
  });
  test("mantle IS trial at window start (inclusive)", () => {
    assert.equal(isTrialChain("mantle", atStart), true);
  });
  test("mantle IS trial mid-window", () => {
    assert.equal(isTrialChain("mantle", midWindow), true);
  });
  test("mantle IS trial 1 ms before window end", () => {
    assert.equal(isTrialChain("mantle", justBeforeEnd), true);
  });
  test("mantle is NOT trial at window end (exclusive)", () => {
    assert.equal(isTrialChain("mantle", atEnd), false);
  });
  test("mantle is NOT trial after window", () => {
    assert.equal(isTrialChain("mantle", afterWindow), false);
  });
});

// ── Non-trial chains are never trial ────────────────────────────────────────

describe("non-trial chains", () => {
  const duringWindow = new Date("2026-08-24T00:00:00.000Z");

  test("eth is not a trial chain even during window", () => {
    assert.equal(isTrialChain("eth", duringWindow), false);
  });
  test("arbitrum is not a trial chain", () => {
    assert.equal(isTrialChain("arbitrum", duringWindow), false);
  });
});
