import { connection } from "next/server";
import { signup } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/bits";
import { PhotoInput } from "@/components/photo-input";
import { Input } from "@/components/ui/input";
import { sql } from "@/lib/db";

export default async function SignupPage() {
  await connection(); // partner list is live data, not build-time
  const orgs = await sql`select name, kind, email_domain from organizations where agreement_active order by kind, name`;
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Create an account</h1>
      <p className="text-sm text-muted-foreground">
        Use your institutional email. Accepted domains: {orgs.map((o) => `@${o.email_domain} (${o.name})`).join(", ")}.
        Partner users also attach an ID; a host lab manager verifies it before you can book. An AI assistant reads the ID to help
        the manager spot mismatches, but a person makes the decision.
      </p>
      <ActionForm action={signup} submit="Create account">
        <Field label="Full name"><Input name="full_name" required autoComplete="name" /></Field>
        <Field label="Institutional email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 8 characters"><Input name="password" type="password" minLength={8} required autoComplete="new-password" /></Field>
        <Field label="Team or club code (optional)" hint="Lets us apply fair-share caps to groups"><Input name="team_code" /></Field>
        <PhotoInput name="id_doc" label="College ID or incubator letter (partner users)" />
      </ActionForm>
    </div>
  );
}
