import { describe, expect, it } from "vitest";
import { assertTransition, fairShare, trustStars } from "./rules";

describe("transitions", () => {
  it("allows the happy path", () => {
    for (const [a, b] of [["PENDING_REVIEW", "APPROVED"], ["APPROVED", "IN_USE"], ["IN_USE", "RETURNED"], ["RETURNED", "CLOSED"]] as const)
      expect(() => assertTransition(a, b)).not.toThrow();
  });
  it("blocks skipping steps and reopening closed bookings", () => {
    expect(() => assertTransition("PENDING_REVIEW", "IN_USE")).toThrow();
    expect(() => assertTransition("CLOSED", "APPROVED")).toThrow();
    expect(() => assertTransition("REJECTED", "APPROVED")).toThrow();
  });
});

describe("fairShare", () => {
  it("favours a light user over a heavy one for the same purpose", () => {
    const light = fairShare({ purpose: "RESEARCH", hoursUsed30d: 0, firstUse: true, noShows60d: 0 });
    const heavy = fairShare({ purpose: "RESEARCH", hoursUsed30d: 25, firstUse: false, noShows60d: 0 });
    expect(light.score).toBe(75);
    expect(heavy.score).toBe(25);
  });
  it("caps the no-show penalty at -30", () => {
    expect(fairShare({ purpose: "SELF_LEARNING", hoursUsed30d: 20, firstUse: false, noShows60d: 9 }).score).toBe(-20);
  });
});

describe("Trust Stars", () => {
  it("starts new accounts at a neutral rating", () => {
    expect(trustStars({ completedBookings: 0, onTimeReturns: 0, cleanConditionReturns: 0, verifiedTrainings: 0, incidents: 0 })).toBe(3);
  });
  it("rewards reliable returns and current training, and applies incident penalties", () => {
    expect(trustStars({ completedBookings: 12, onTimeReturns: 12, cleanConditionReturns: 12, verifiedTrainings: 1, incidents: 0 })).toBe(5);
    expect(trustStars({ completedBookings: 4, onTimeReturns: 4, cleanConditionReturns: 4, verifiedTrainings: 1, incidents: 1 })).toBe(2);
  });
});
