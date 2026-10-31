import { describe, expect, it } from "vitest";
import { COMPLAINT_TRANSITIONS, complaintStatusLabel } from "./complaints";

describe("complaint workflow", () => {
  it("supports the published review and resolution statuses", () => {
    expect(COMPLAINT_TRANSITIONS.OPEN).toContain("OWNER_REVIEWING");
    expect(COMPLAINT_TRANSITIONS.OWNER_REVIEWING).toContain("ACTION_TAKEN");
    expect(COMPLAINT_TRANSITIONS.ACTION_TAKEN).toContain("RESOLVED");
    expect(COMPLAINT_TRANSITIONS.RESOLVED).toContain("CLOSED");
    expect(COMPLAINT_TRANSITIONS.CLOSED).toEqual([]);
    expect(complaintStatusLabel("OWNER_REVIEWING")).toBe("Owner Reviewing");
  });
  it("allows customer escalation before final closure", () => {
    expect(COMPLAINT_TRANSITIONS.OPEN).toContain("ESCALATED");
    expect(COMPLAINT_TRANSITIONS.OWNER_REVIEWING).toContain("ESCALATED");
    expect(COMPLAINT_TRANSITIONS.CLOSED).not.toContain("ESCALATED");
  });
});
