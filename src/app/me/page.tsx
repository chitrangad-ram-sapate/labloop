import { submitCredential, submitIdentity } from "@/app/actions/verify";
import { ActionForm } from "@/components/action-form";
import { Field, selectCls, Status } from "@/components/bits";
import { PhotoInput } from "@/components/photo-input";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmt } from "@/lib/format";

export default async function Passport() {
  const actor = await requireActor();
  const [me] = await sql`select identity_status, identity_reason, id_doc is not null as has_doc from profiles where id = ${actor.id}`;
  const creds = await sql`select uc.status, uc.decision_reason, uc.expires_at, uc.created_at, ct.name from user_credentials uc
    join credential_types ct on ct.id = uc.credential_type_id where uc.profile_id = ${actor.id} order by ct.name`;
  const types = await sql`select id, name, description from credential_types order by name`;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">My passport</h1>
        <p className="text-sm text-muted-foreground">{actor.full_name} · {actor.email} · {actor.org_name}</p>
      </div>

      {actor.role === "external" && (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">Identity</h2>
          <p className="text-sm">
            Status: <Status s={me.has_doc || me.identity_status !== "PENDING" ? me.identity_status : "NOT_UPLOADED"} />
            {me.identity_reason && <span className="ml-2 text-muted-foreground">“{me.identity_reason}”</span>}
          </p>
          <p className="text-xs text-muted-foreground">Your ID is visible only to host lab managers, and only for verification. An AI assistant reads it to help the manager spot mismatches; it never makes the decision.</p>
          {me.identity_status !== "VERIFIED" && (
            <ActionForm action={submitIdentity} submit={me.has_doc ? "Replace ID" : "Upload ID"}>
              <PhotoInput name="id_doc" label="College ID or incubator letter" required />
            </ActionForm>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Credentials</h2>
        {creds.length === 0 && <p className="text-sm">None yet.</p>}
        <ul className="divide-y rounded-lg border text-sm">
          {creds.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-3 p-3">
              <Status s={c.status === "VERIFIED" && c.expires_at && new Date(c.expires_at) < new Date() ? "EXPIRED" : c.status} />
              <span className="font-medium">{c.name}</span>
              {c.status === "VERIFIED" && <span className="text-muted-foreground">valid until {fmt(c.expires_at)}</span>}
              {c.decision_reason && <span className="w-full text-muted-foreground">“{c.decision_reason}”</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Add a credential</h2>
        <p className="text-sm text-muted-foreground">Upload your training certificate. A lab manager checks it before it counts. Nothing is approved automatically.</p>
        <ActionForm action={submitCredential} submit="Upload for verification">
          <Field label="Credential">
            <select name="credential_type_id" className={selectCls} required>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
            </select>
          </Field>
          <PhotoInput name="evidence" label="Certificate photo" required />
        </ActionForm>
      </section>
    </div>
  );
}
