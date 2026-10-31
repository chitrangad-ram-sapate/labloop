export const COMPLAINT_ISSUES = {
  DAMAGED_ITEM: "Damaged item",
  MISSING_ACCESSORY: "Missing accessory",
  UNSAFE_SPACE: "Unsafe space",
  BOOKING_CONFLICT: "Booking conflict",
  ACCESSIBILITY: "Accessibility concern",
  OTHER: "Other",
} as const;

export type ComplaintIssue = keyof typeof COMPLAINT_ISSUES;
export type ComplaintStatus = "OPEN" | "OWNER_REVIEWING" | "ACTION_TAKEN" | "RESOLVED" | "ESCALATED" | "CLOSED";

export const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  OPEN: ["OWNER_REVIEWING", "ACTION_TAKEN", "RESOLVED", "ESCALATED"],
  OWNER_REVIEWING: ["ACTION_TAKEN", "RESOLVED", "ESCALATED"],
  ACTION_TAKEN: ["OWNER_REVIEWING", "RESOLVED", "ESCALATED"],
  RESOLVED: ["CLOSED", "ESCALATED"],
  ESCALATED: ["OWNER_REVIEWING", "ACTION_TAKEN", "RESOLVED"],
  CLOSED: [],
};

export const complaintStatusLabel = (status: ComplaintStatus) =>
  status === "OWNER_REVIEWING" ? "Owner Reviewing" : status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (x) => x.toUpperCase());
