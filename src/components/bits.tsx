import { Badge } from "@/components/ui/badge";
import { label } from "@/lib/rules";

export const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const TONE: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-900", IN_USE: "bg-sky-100 text-sky-900", OFFERED: "bg-amber-100 text-amber-900",
  WAITLISTED: "bg-amber-100 text-amber-900", PENDING_REVIEW: "bg-slate-100 text-slate-900", OVERDUE: "bg-red-100 text-red-900",
  REJECTED: "bg-red-100 text-red-900", DISPUTED: "bg-red-100 text-red-900", NO_SHOW: "bg-red-100 text-red-900",
  RETURNED: "bg-violet-100 text-violet-900", CLOSED: "bg-zinc-100 text-zinc-700", CANCELLED: "bg-zinc-100 text-zinc-700",
  VERIFIED: "bg-emerald-100 text-emerald-900", PENDING: "bg-amber-100 text-amber-900", OPEN: "bg-red-100 text-red-900", RESOLVED: "bg-zinc-100 text-zinc-700",
};

/** Status is always spelled out, never colour alone. */
export function Status({ s }: { s: string }) {
  return <Badge variant="outline" className={`border-0 font-semibold uppercase ${TONE[s] ?? ""}`}>{label(s)}</Badge>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm font-medium">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Every AI output is boxed and labelled as advisory, with the model that produced it. */
export function AiNote({ title, model, children }: { title: string; model?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border border-dashed border-violet-400 bg-violet-50 p-2 text-sm text-violet-950">
      <p className="text-xs font-semibold uppercase tracking-wide">✦ {title} · AI suggestion, a person decides{model && <span className="font-normal normal-case"> ({model})</span>}</p>
      {children}
    </div>
  );
}

export function ReasonList({ items, tone }: { items: { message: string; fix?: { label: string; href: string } }[]; tone: "block" | "warn" }) {
  if (!items.length) return null;
  return (
    <ul className={`space-y-1 rounded-md border p-3 text-sm ${tone === "block" ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
      {items.map((r) => (
        <li key={r.message}>
          {tone === "block" ? "✗ " : "! "}{r.message}{" "}
          {r.fix && <a href={r.fix.href} className="font-semibold underline">{r.fix.label} →</a>}
        </li>
      ))}
    </ul>
  );
}
