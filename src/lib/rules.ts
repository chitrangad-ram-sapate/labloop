// Pure booking rules: no DB, no framework. Covered by rules.test.ts.

export type BookingStatus =
  | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WAITLISTED" | "OFFERED" | "CANCELLED"
  | "IN_USE" | "OVERDUE" | "RETURNED" | "CLOSED" | "DISPUTED" | "NO_SHOW";

export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING_REVIEW: ["APPROVED", "REJECTED", "WAITLISTED", "CANCELLED"],
  WAITLISTED: ["OFFERED", "APPROVED", "REJECTED", "CANCELLED"],
  OFFERED: ["APPROVED", "CANCELLED"],
  APPROVED: ["IN_USE", "CANCELLED", "NO_SHOW"],
  IN_USE: ["RETURNED", "OVERDUE"],
  OVERDUE: ["RETURNED"],
  RETURNED: ["CLOSED", "DISPUTED"],
  DISPUTED: ["CLOSED"],
  REJECTED: [], CANCELLED: [], CLOSED: [], NO_SHOW: [],
};

export function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`A booking that is ${label(from)} cannot become ${label(to)}.`);
}

export const HOLDING: BookingStatus[] = ["APPROVED", "OFFERED", "IN_USE", "OVERDUE"];
export const MAX_ACTIVE_BOOKINGS = 3;
export const MAX_WEEKLY_HIGH_DEMAND_BOOKINGS = 3;

export const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

export const PURPOSES = {
  COURSEWORK: { label: "Coursework / assessment", weight: 30 },
  RESEARCH: { label: "Research", weight: 25 },
  PROJECT: { label: "Club or startup project", weight: 15 },
  SELF_LEARNING: { label: "Self-learning", weight: 10 },
} as const;
export type Purpose = keyof typeof PURPOSES;

export type ScoreLine = { label: string; points: number; explanation: string };

export type TrustInputs = {
  completedBookings: number;
  onTimeReturns: number;
  cleanConditionReturns: number;
  verifiedTrainings: number;
  incidents: number;
};

/** A transparent 1–5 score. Sparse history starts neutral; good use earns stars and incidents reduce them. */
export function trustStars(i: TrustInputs) {
  const completed = Math.max(0, i.completedBookings);
  const onTimeRate = completed ? i.onTimeReturns / completed : 1;
  const conditionRate = completed ? i.cleanConditionReturns / completed : 1;
  let stars = 3;
  if (completed >= 3 && onTimeRate >= 0.9 && conditionRate >= 0.8 && i.incidents === 0) stars++;
  if (completed >= 10 && onTimeRate >= 0.97 && conditionRate >= 0.95 && i.verifiedTrainings > 0 && i.incidents === 0) stars++;
  if (i.incidents > 0) stars -= Math.min(2, i.incidents);
  return Math.max(1, Math.min(5, stars));
}

/** Fair-Share Score: higher = stronger claim. Every point is explained so owners and users see the same reasoning. */
export function fairShare(i: { purpose: Purpose; hoursUsed30d: number; firstUse: boolean; noShows60d: number }) {
  const lines: ScoreLine[] = [
    { label: "Purpose", points: PURPOSES[i.purpose].weight, explanation: PURPOSES[i.purpose].label },
    {
      label: "Fair share",
      points: Math.round(40 * (1 - Math.min(i.hoursUsed30d / 20, 1))),
      explanation: `${i.hoursUsed30d.toFixed(1)} h used on this resource in the last 30 days (fewer hours = more points)`,
    },
    { label: "Newcomer", points: i.firstUse ? 10 : 0, explanation: i.firstUse ? "First time using this resource" : "Has used it before" },
    {
      label: "Reliability",
      points: -Math.min(i.noShows60d * 10, 30),
      explanation: `${i.noShows60d} no-show(s) in the last 60 days`,
    },
  ];
  return { score: lines.reduce((s, l) => s + l.points, 0), breakdown: lines };
}
