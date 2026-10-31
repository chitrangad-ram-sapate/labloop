import { sql } from "@/lib/db";
import { trustStars, type TrustInputs } from "@/lib/rules";

export type TrustSummary = TrustInputs & {
  trustId: string;
  verificationStatus: string;
  onTimeRate: number;
  conditionRate: number;
  stars: number;
};

/** Call only for the signed-in profile or for an owner reviewing that user's booking. */
export async function getTrustSummary(profileId: string): Promise<TrustSummary> {
  const [row] = await sql<{
    trust_id: string;
    identity_status: string;
    verified_trainings: number;
    completed_bookings: number;
    on_time_returns: number;
    clean_condition_returns: number;
    incidents: number;
  }[]>`
    select p.trust_id, p.identity_status,
      (select count(*)::int from user_credentials uc
        where uc.profile_id = p.id and uc.status = 'VERIFIED' and (uc.expires_at is null or uc.expires_at > now())) as verified_trainings,
      (select count(*)::int from bookings b where b.user_id = p.id and b.status in ('RETURNED','CLOSED','DISPUTED')) as completed_bookings,
      (select count(*)::int from bookings b where b.user_id = p.id and b.status in ('RETURNED','CLOSED','DISPUTED')
        and b.returned_at is not null and b.returned_at <= b.end_at) as on_time_returns,
      (select count(*)::int from bookings b join condition_reports c on c.booking_id = b.id and c.phase = 'RETURN'
        where b.user_id = p.id and b.status in ('RETURNED','CLOSED','DISPUTED')
          and not exists (select 1 from jsonb_each_text(c.checklist) item where item.value = 'issue')) as clean_condition_returns,
      (select count(*)::int from incidents i join bookings b on b.id = i.booking_id
        where b.user_id = p.id and (i.status <> 'RESOLVED' or i.penalty not in ('NONE') or i.penalty is null)) as incidents
    from profiles p where p.id = ${profileId}`;
  if (!row) throw new Error("Trust profile not found.");
  const inputs = {
    completedBookings: Number(row.completed_bookings),
    onTimeReturns: Number(row.on_time_returns),
    cleanConditionReturns: Number(row.clean_condition_returns),
    verifiedTrainings: Number(row.verified_trainings),
    incidents: Number(row.incidents),
  };
  return {
    ...inputs,
    trustId: row.trust_id,
    verificationStatus: row.identity_status,
    onTimeRate: inputs.completedBookings ? inputs.onTimeReturns / inputs.completedBookings : 1,
    conditionRate: inputs.completedBookings ? inputs.cleanConditionReturns / inputs.completedBookings : 1,
    stars: trustStars(inputs),
  };
}
