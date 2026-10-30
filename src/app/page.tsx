import Link from "next/link";
import { Field, selectCls } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import { findResources } from "@/lib/ai";
import { rankByQuery } from "@/lib/finder";

type Row = {
  id: string; name: string; category: string; location: string; description: string; dept: string; status: string;
  high_demand: boolean; requires_supervision: boolean; open_to_externals: boolean; photo: string | null; missing: number; requires: string | null;
};

export default async function Catalog({ searchParams }: PageProps<"/">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const q = String(sp.q ?? "");
  const category = String(sp.category ?? "");
  const eligibleOnly = sp.eligible === "1";

  const rows = await sql<Row[]>`
    select r.id, r.name, r.category, r.location, r.description, d.name as dept, r.status, r.high_demand,
           r.requires_supervision, r.open_to_externals, r.photo,
           (select count(*)::int from resource_requirements rr where rr.resource_id = r.id and not exists (
              select 1 from user_credentials uc where uc.profile_id = ${actor.id} and uc.credential_type_id = rr.credential_type_id
              and uc.status = 'VERIFIED' and (uc.expires_at is null or uc.expires_at > now()))) as missing,
           (select string_agg(ct.name, ', ') from resource_requirements rr join credential_types ct on ct.id = rr.credential_type_id
              where rr.resource_id = r.id) as requires
    from resources r join departments d on d.id = r.department_id
    where r.status <> 'RETIRED' and (${category} = '' or r.category = ${category})
    order by r.high_demand desc, r.name`;

  const visible = rows.filter((r) => (!eligibleOnly || r.missing === 0) && (actor.role !== "external" || r.open_to_externals));
  const ai = q ? await findResources(q, visible.map(({ id, name, category, description, location, requires }) => ({ id, name, category, description, location, requires }))) : null;
  const byId = new Map(visible.map((r) => [r.id, r]));
  const aiResults = ai?.matches.flatMap((m) => (byId.has(m.id) ? [{ item: byId.get(m.id)!, why: m.why }] : []));
  const results = aiResults?.length ? aiResults : rankByQuery(visible, q);

  return (
    <div className="space-y-6">
      {actor.role === "external" && actor.identity_status !== "VERIFIED" && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          You can browse now. To book, a host lab manager must verify your ID.{" "}
          <Link href="/me" className="font-semibold underline">{actor.identity_status === "PENDING" ? "Check or upload your ID →" : "Upload your ID →"}</Link>
        </p>
      )}
      <div>
        <h1 className="text-2xl font-bold">Find a resource</h1>
        <p className="text-sm text-muted-foreground">Describe what you need in plain words, or filter.</p>
      </div>
      <form className="grid gap-3 md:grid-cols-[1fr_180px_auto_auto] md:items-end" role="search">
        <Field label="What do you need?">
          <Input name="q" defaultValue={q} placeholder="e.g. I need to cut acrylic for a drone frame" />
        </Field>
        <Field label="Category">
          <select name="category" defaultValue={category} className={selectCls}>
            <option value="">All</option>
            <option value="equipment">Equipment</option>
            <option value="computing">Computing</option>
            <option value="media">Media</option>
            <option value="space">Spaces</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="eligible" value="1" defaultChecked={eligibleOnly} /> Only ones I&apos;m eligible for
        </label>
        <Button type="submit">Search</Button>
      </form>

      {aiResults?.length ? (
        <p className="text-sm text-muted-foreground">✦ Ranked by AI from your description ({ai!._model}). Eligibility badges are checked by LabLoop&apos;s rules, not the AI.</p>
      ) : null}
      {results.length === 0 && <p>No resources match. Try fewer words or clear the filters.</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map(({ item: r, why }) => (
          <li key={r.id}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle><Link href={`/resources/${r.id}`} className="hover:underline">{r.name}</Link></CardTitle>
                <p className="text-xs text-muted-foreground">{r.dept} · {r.location}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {r.photo && <img src={r.photo} alt="" className="h-32 w-full rounded-md object-cover" />}
                <p className="line-clamp-2">{r.description}</p>
                <div className="flex flex-wrap gap-1">
                  {r.missing === 0
                    ? <Badge variant="outline" className="border-emerald-400">✓ You&apos;re eligible</Badge>
                    : <Badge variant="outline" className="border-red-400">✗ Needs: {r.requires}</Badge>}
                  {r.high_demand && <Badge variant="secondary">High demand · fair-share rules</Badge>}
                  {r.requires_supervision && <Badge variant="secondary">Supervised</Badge>}
                  {r.status === "MAINTENANCE" && <Badge variant="destructive">Under maintenance</Badge>}
                </div>
                {why && <p className="text-xs text-muted-foreground">{aiResults?.length ? "✦ " : ""}{why}</p>}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
