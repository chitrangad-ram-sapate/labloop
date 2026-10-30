import Link from "next/link";
import { demoLogin, login } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/seed";

export default function LoginPage() {
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Borrow the lab, not the risk.</h1>
        <p className="text-muted-foreground">
          LabLoop lets Northfield Institute of Technology open its idle makerspace, labs and studios to its own students
          and to verified students and startups nearby. Every user is verified, every hand-off is recorded, and scarce
          equipment is shared by a rule anyone can read.
        </p>
        <ActionForm action={login} submit="Sign in" className="max-w-sm space-y-3">
          <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
          <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        </ActionForm>
        <p className="text-sm">New here? <Link href="/signup" className="underline">Create an account with your college email</Link></p>
      </section>

      {demo && (
        <section aria-labelledby="demo" className="space-y-3 rounded-lg border p-4">
          <h2 id="demo" className="font-semibold">Judges: try it as…</h2>
          <p className="text-sm text-muted-foreground">One click signs you in. Every account&apos;s password is <code>{DEMO_PASSWORD}</code>.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <form action={demoLogin.bind(null, a.email)}>
                  <button className="w-full rounded-md border p-3 text-left hover:bg-muted focus-visible:ring-2">
                    <span className="block font-medium">{a.label}</span>
                    <span className="block text-xs text-muted-foreground">{a.hint}</span>
                    <span className="block text-xs text-muted-foreground">{a.email}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
