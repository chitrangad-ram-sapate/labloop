import { offerNext } from "./booking";
import { sql } from "./db";
import { audit, notify, notifyDepartment } from "./log";

/** Scheduler pass: reminders, no-shows, overdue returns and expired waitlist offers. Safe to run any time. */
export async function tick() {
  return sql.begin(async (tx) => {
    const reminded = await tx`update bookings b set reminded_at = now() from resources r
      where r.id = b.resource_id and b.status = 'APPROVED' and b.reminded_at is null and b.start_at between now() and now() + interval '1 hour'
      returning b.id, b.user_id, r.name`;
    for (const b of reminded) await notify(tx, b.user_id, `${b.name} starts within the hour`, "Remember to record its condition at check-out.", `/bookings/${b.id}`);

    const noShows = await tx`update bookings set status = 'NO_SHOW' where status = 'APPROVED' and start_at < now() - interval '15 minutes'
      returning id, user_id, resource_id`;
    for (const b of noShows) {
      await audit(tx, null, "booking.no_show", "booking", b.id, "Not checked out within 15 minutes of the start, so the slot was released. This counts against the reliability part of future Fair-Share Scores.");
      await notify(tx, b.user_id, "Marked as no-show", "You didn't check out within 15 minutes of your start time, so the slot was released.", `/bookings/${b.id}`);
      await offerNext(tx, b.resource_id);
    }

    const overdue = await tx`update bookings b set status = 'OVERDUE' from resources r
      where r.id = b.resource_id and b.status = 'IN_USE' and b.end_at < now() returning b.id, b.user_id, r.name, r.department_id`;
    for (const b of overdue) {
      await audit(tx, null, "booking.overdue", "booking", b.id, "Not returned by the end time.");
      await notify(tx, b.user_id, `${b.name} is overdue`, "Please return it now and record its condition. Repeated late returns are reviewed by staff.", `/bookings/${b.id}`);
      await notifyDepartment(tx, b.department_id, `${b.name} is overdue`, "The borrower has been reminded.", `/bookings/${b.id}`);
    }

    const expired = await tx`update bookings set status = 'CANCELLED', decision_reason = 'Waitlist offer expired before it was accepted.'
      where status = 'OFFERED' and offer_expires_at < now() returning id, user_id, resource_id`;
    for (const b of expired) {
      await audit(tx, null, "booking.cancelled", "booking", b.id, "Waitlist offer expired; passed to the next person.");
      await notify(tx, b.user_id, "Waitlist offer expired", "The slot has been offered to the next person.", `/bookings/${b.id}`);
      await offerNext(tx, b.resource_id);
    }

    return { reminded: reminded.length, noShows: noShows.length, overdue: overdue.length, expiredOffers: expired.length };
  });
}
