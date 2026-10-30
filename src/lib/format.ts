// ponytail: the app runs in one timezone (IST); add per-user zones if it ever spans regions.
export const TZ = "Asia/Kolkata";

export const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : "—";

export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtDay = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

/** "2026-10-31" + "10:00" (IST) → Date */
export const istToDate = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

/** Minutes since midnight IST, for opening-hours checks. */
export const istMinutes = (d: Date) => {
  const [h, m] = fmtTime(d).split(":").map(Number);
  return h * 60 + m;
};

export const istDateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
