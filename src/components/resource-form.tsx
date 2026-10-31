import { saveResource } from "@/app/actions/resource";
import { ActionForm } from "@/components/action-form";
import { Field, selectCls } from "@/components/bits";
import { PhotoInput } from "@/components/photo-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Resource } from "@/lib/booking";

const D: Partial<Resource> = {
  category: "equipment", open_from: "09:00", open_to: "18:00", max_duration_min: 120, turnaround_min: 15, advance_days: 14,
  max_hours_week: 6, cooldown_hours: 0, external_max_pct: 30, units_available: 1, supervise_externals: true, open_to_externals: true, checklist: [], status: "ACTIVE",
};

export function ResourceForm({ r, credentials, selected, departments = [], allowDepartment = false }: { r?: Resource; credentials: { id: string; name: string }[]; selected: string[]; departments?: { id: string; name: string }[]; allowDepartment?: boolean }) {
  const v = { ...D, ...r };
  const check = (name: keyof Resource, text: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={Boolean(v[name])} /> {text}</label>
  );
  return (
    <ActionForm action={saveResource.bind(null, r?.id ?? null)} submit={r ? "Save changes" : "Publish listing"} className="max-w-2xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input name="name" required defaultValue={v.name} /></Field>
        <Field label="Category">
          <select name="category" defaultValue={v.category} className={selectCls}>
            <option value="equipment">Equipment</option><option value="computing">Computing</option>
            <option value="media">Media</option><option value="space">Space</option>
          </select>
        </Field>
      </div>
      {allowDepartment && !r && <Field label="Department"><select name="department_id" required className={selectCls} defaultValue=""><option value="" disabled>Select a department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>}
      <Field label="Location"><Input name="location" required defaultValue={v.location} /></Field>
      <Field label="Description"><Textarea name="description" rows={2} defaultValue={v.description} /></Field>
      <Field label="Usage rules"><Textarea name="usage_rules" rows={2} defaultValue={v.usage_rules} /></Field>
      <Field label="Condition checklist" hint="One item per line; recorded at check-out and return">
        <Textarea name="checklist" rows={3} defaultValue={v.checklist?.join("\n")} />
      </Field>

      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">Required credentials</legend>
        {credentials.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="credentials" value={c.id} defaultChecked={selected.includes(c.id)} /> {c.name}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Availability</legend>
        <Field label="Opens"><Input type="time" name="open_from" defaultValue={v.open_from?.slice(0, 5)} required /></Field>
        <Field label="Closes"><Input type="time" name="open_to" defaultValue={v.open_to?.slice(0, 5)} required /></Field>
        <Field label="Max booking (min)"><Input type="number" name="max_duration_min" defaultValue={v.max_duration_min} /></Field>
        <Field label="Units available"><Input type="number" name="units_available" min={1} max={1000} defaultValue={v.units_available} required /></Field>
        <Field label="Turnaround (min)" hint="Buffer for cleaning/reset"><Input type="number" name="turnaround_min" defaultValue={v.turnaround_min} /></Field>
        <Field label="Book ahead (days)"><Input type="number" name="advance_days" defaultValue={v.advance_days} /></Field>
        <Field label="Status">
          <select name="status" defaultValue={v.status} className={selectCls}>
            <option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="RETIRED">Retired</option>
          </select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Fair-share and safety</legend>
        <div className="space-y-2 sm:col-span-3">
          {check("high_demand", "High demand: apply weekly limits, cooldown and group caps")}
          {check("requires_supervision", "Always supervised (staff confirms check-out)")}
          {check("supervise_externals", "Supervise external users")}
          {check("open_to_externals", "Open to verified external users")}
        </div>
        <Field label="Max h / person / week"><Input type="number" name="max_hours_week" defaultValue={v.max_hours_week} /></Field>
        <Field label="Cooldown (h)"><Input type="number" name="cooldown_hours" defaultValue={v.cooldown_hours} /></Field>
        <Field label="External share max (%)"><Input type="number" name="external_max_pct" defaultValue={v.external_max_pct} /></Field>
      </fieldset>
      <Field label="Deposit note (optional)" hint="Collected offline; staff confirm it at check-out"><Input name="deposit_note" defaultValue={v.deposit_note ?? ""} /></Field>
      <PhotoInput label="Photo" />
    </ActionForm>
  );
}
