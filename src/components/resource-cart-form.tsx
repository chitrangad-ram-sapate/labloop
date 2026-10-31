"use client";

import { useActionState, useEffect, useState } from "react";
import { addCartItem } from "@/app/actions/cart";
import { Field, selectCls } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { PURPOSES } from "@/lib/rules";

type Stock = { capacity: number; allocated: number; heldByOthers: number; available: number };

export function ResourceCartForm({
  resourceId, date: initialDate, units, teamCode,
}: { resourceId: string; date: string; units: number; teamCode: string | null }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(addCartItem.bind(null, resourceId), null);
  const [date, setDate] = useState(initialDate);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("12:00");
  const [stockState, setStockState] = useState<{ key: string; value: Stock } | null>(null);
  const [availabilityState, setAvailabilityState] = useState<{ key: string; message: string } | null>(null);
  const key = `${date}|${from}|${to}`;
  const stock = stockState?.key === key ? stockState.value : null;
  const availabilityError = availabilityState?.key === key ? availabilityState.message : "";

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const refresh = async () => {
      try {
        const query = new URLSearchParams({ date, from, to });
        const response = await fetch(`/api/resources/${resourceId}/availability?${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as Stock & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load live availability.");
        if (active) {
          setStockState({ key, value: result });
          setAvailabilityState(null);
        }
      } catch (error) {
        if (active && !controller.signal.aborted)
          setAvailabilityState({ key, message: error instanceof Error ? error.message : "Could not load live availability." });
      }
    };
    const timer = window.setTimeout(() => { void refresh(); }, 180);
    const poll = window.setInterval(() => { void refresh(); }, 15_000);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(poll); controller.abort(); };
  }, [date, from, to, resourceId, key]);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="Date"><Input type="date" name="date" required min={initialDate} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><Input type="time" name="from" required value={from} onChange={(e) => setFrom(e.target.value)} step={900} /></Field>
        <Field label="To"><Input type="time" name="to" required value={to} onChange={(e) => setTo(e.target.value)} step={900} /></Field>
      </div>
      <Field label="Quantity"><Input type="number" name="quantity" min={1} max={units} defaultValue={1} required /></Field>
      <Field label="Purpose" hint="Coursework counts most when requests compete">
        <select name="purpose" className={selectCls} required>
          {Object.entries(PURPOSES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
      </Field>
      <Field label="What will you do?" hint="Visible to the owner and lab staff">
        <Textarea name="purpose_text" required rows={2} maxLength={1000} />
      </Field>
      <Field label="Team / club code (optional)"><Input name="team_code" defaultValue={teamCode ?? ""} /></Field>
      <div aria-live="polite" className="rounded-lg border p-3 text-xs">
        {stock ? <>
          <strong>{stock.available} of {stock.capacity} units currently available for this time.</strong>
          <p className="mt-1">{stock.heldByOthers} of {stock.capacity} units held in other users&apos; carts. Holds expire after 12 minutes.</p>
        </> : <p>{availabilityError || "Checking live availability…"}</p>}
      </div>
      {availabilityError && <p role="status" className="text-xs text-muted-foreground">{availabilityError}</p>}
      {state?.error && <p role="alert" className="text-sm font-medium text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add to cart · hold for 12 min"}</Button>
    </form>
  );
}
