"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";

export function ActionForm({
  action, submit, children, variant, className = "space-y-3",
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  submit: string;
  children?: React.ReactNode;
  variant?: "default" | "outline" | "destructive" | "secondary";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="text-sm font-medium text-destructive">⚠ {state.error}</p>}
      {state?.ok && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ {state.ok}</p>}
      <Button type="submit" disabled={pending} variant={variant}>{pending ? "Working…" : submit}</Button>
    </form>
  );
}
