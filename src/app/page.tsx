import Link from "next/link";
import { Suspense } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, Cpu, FlaskConical, Laptop, MapPin, Microscope, Printer, Search, ShieldCheck, Users, Workflow } from "lucide-react";
import { getActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { findResources } from "@/lib/ai";
import { rankByQuery } from "@/lib/finder";
import { SignInTrigger } from "@/components/sign-in-experience";

type Row = {
  id: string; name: string; category: string; location: string; description: string; dept: string; status: string;
  high_demand: boolean; requires_supervision: boolean; open_to_externals: boolean; photo: string | null; missing: number; requires: string | null;
};

const categories = [
  { label: "Laboratories", detail: "Shared lab spaces", value: "space", icon: FlaskConical, tone: "blue" },
  { label: "Electronics equipment", detail: "Test, build, repair", value: "equipment", icon: Workflow, tone: "violet" },
  { label: "Computing resources", detail: "Workstations & GPUs", value: "computing", icon: Cpu, tone: "teal" },
  { label: "3D & fabrication", detail: "Prototype your ideas", value: "equipment", icon: Printer, tone: "amber" },
  { label: "Study spaces", detail: "Quiet places to focus", value: "space", icon: Laptop, tone: "sky" },
  { label: "Meeting rooms", detail: "Bring your team together", value: "space", icon: Users, tone: "rose" },
  { label: "Research facilities", detail: "Tools for deeper work", value: "equipment", icon: Microscope, tone: "indigo" },
  { label: "Prototyping equipment", detail: "From sketch to sample", value: "equipment", icon: Boxes, tone: "orange" },
];

function resourceHref(category: string) {
  return `/?category=${encodeURIComponent(category)}`;
}

export default function CatalogPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="marketplace-page" role="status"><p className="catalog-loading">Loading campus resources…</p></div>}>
      <CatalogContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CatalogContent({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const actor = await getActor();
  const sp = await searchParams;
  const q = String(sp.q ?? "");
  const category = String(sp.category ?? "");
  const eligibleOnly = sp.eligible === "1";

  const db = getFirebaseDb();
  const [resourceSnapshot, requirementSnapshot, credentialTypeSnapshot, departmentSnapshot, userCredentialSnapshot] = await Promise.all([
    db.collection("resources").get(),
    db.collection("resource_requirements").get(),
    db.collection("credential_types").get(),
    db.collection("departments").get(),
    actor ? db.collection("user_credentials").where("profile_id", "==", actor.id).where("status", "==", "VERIFIED").get() : Promise.resolve(null),
  ]);
  const credentialTypes = new Map(credentialTypeSnapshot.docs.map((doc) => [doc.id, String(doc.get("name"))]));
  const departments = new Map(departmentSnapshot.docs.map((doc) => [doc.id, String(doc.get("name"))]));
  const requirements = new Map<string, string[]>();
  for (const doc of requirementSnapshot.docs) {
    const resourceId = String(doc.get("resource_id"));
    requirements.set(resourceId, [...(requirements.get(resourceId) ?? []), String(doc.get("credential_type_id"))]);
  }
  const verified = new Set((userCredentialSnapshot?.docs ?? [])
    .filter((doc) => !doc.get("expires_at") || new Date(doc.get("expires_at").toDate?.() ?? doc.get("expires_at")).getTime() > Date.now())
    .map((doc) => String(doc.get("credential_type_id"))));
  const rows = resourceSnapshot.docs
    .map((doc) => fromFirestore(doc.id, doc.data()))
    .filter((r) => r.status !== "RETIRED" && (!category || r.category === category))
    .map((r) => {
      const requiredIds = requirements.get(r.id) ?? [];
      return {
        id: r.id, name: r.name, category: r.category, location: r.location, description: r.description,
        dept: departments.get(r.department_id) ?? "Campus", status: r.status, high_demand: Boolean(r.high_demand),
        requires_supervision: Boolean(r.requires_supervision), open_to_externals: Boolean(r.open_to_externals), photo: r.photo ?? null,
        missing: actor ? requiredIds.filter((id) => !verified.has(id)).length : requiredIds.length,
        requires: requiredIds.map((id) => credentialTypes.get(id)).filter(Boolean).join(", ") || null,
      } satisfies Row;
    })
    .sort((a, b) => Number(b.high_demand) - Number(a.high_demand) || a.name.localeCompare(b.name));

  const identityVerified = actor?.role !== "external" || actor.identity_status === "VERIFIED";
  const visible = rows.filter((r) => (!eligibleOnly || !actor || (r.missing === 0 && identityVerified)) && (actor?.role !== "external" || r.open_to_externals));
  const ai = q ? await findResources(q, visible.map(({ id, name, category, description, location, requires }) => ({ id, name, category, description, location, requires }))) : null;
  const byId = new Map(visible.map((r) => [r.id, r]));
  const aiResults = ai?.matches.flatMap((m) => (byId.has(m.id) ? [{ item: byId.get(m.id)!, why: m.why }] : []));
  const results = aiResults?.length ? aiResults : rankByQuery(visible, q);
  const ownerDestination = actor?.role === "owner" ? "/resources/new"
    : actor?.role === "manager" ? "/manage"
    : actor?.role === "admin" ? "/admin"
    : actor ? "/owner-access" : null;
  const ownerActionLabel = actor?.role === "owner" ? "List a resource"
    : actor?.role === "manager" ? "Manage resources"
    : actor?.role === "admin" ? "Admin dashboard"
    : actor ? "Request owner access" : "For lab owners";
  return (
    <div className="marketplace-page">
      {actor?.role === "external" && actor.identity_status !== "VERIFIED" && (
        <p role="status" className="identity-notice">
          You can browse now. A host lab manager must verify your ID before you can request access. {" "}
          <Link href="/me">{actor.identity_status === "PENDING" ? "Check your verification" : "Upload your ID"}<ArrowRight size={15} /></Link>
        </p>
      )}

      <section className="market-hero" aria-labelledby="market-title">
        <div className="market-hero-copy">
          <p className="market-eyebrow"><span className="eyebrow-dot" /> NORTHFIELD INSTITUTE · OPEN CAMPUS LABS</p>
          <h1 id="market-title">Your campus has<br /><span>more to offer.</span></h1>
          <p className="market-intro">Discover, share, and access laboratories, equipment, and workspaces across your campus.</p>
          <form className="resource-search" role="search">
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="resource-query">Search resources</label>
            <input id="resource-query" name="q" defaultValue={q} placeholder="Search labs, equipment, or workspaces..." />
            <label className="sr-only" htmlFor="resource-category">Resource category</label>
            <select id="resource-category" name="category" defaultValue={category}>
              <option value="">All resources</option>
              <option value="equipment">Equipment</option>
              <option value="computing">Computing</option>
              <option value="media">Media</option>
              <option value="space">Spaces</option>
            </select>
            {actor && <label className="eligible-filter"><input type="checkbox" name="eligible" value="1" defaultChecked={eligibleOnly} /> Only resources I&apos;m eligible for</label>}
            <button type="submit">Search <ArrowRight size={16} /></button>
          </form>
          <div className="market-hero-actions">
            <a className="button-primary" href="#resources">Explore resources <ArrowDownRight size={17} /></a>
            <Link className="button-text" href="#how-it-works">How LabLoop works <ArrowUpRight size={15} /></Link>
            {ownerDestination
              ? <Link className="button-text" href={ownerDestination}>{ownerActionLabel} <ArrowUpRight size={15} /></Link>
              : <SignInTrigger className="button-text" returnTo="/owner-access">{ownerActionLabel} <ArrowUpRight size={15} /></SignInTrigger>}
          </div>
          <div className="market-trust-line"><ShieldCheck size={17} /> Verified access <span /> Clear booking rules <span /> Accountable hand-offs</div>
        </div>
        <div className="market-hero-visual" role="img" aria-label="A student working with equipment in a campus makerspace">
          <div className="visual-image" />
          <div className="visual-note"><span className="visual-note-icon"><Workflow size={18} /></span><span><strong>Room to make things happen</strong><small>Find the right space for your next idea</small></span><ArrowUpRight size={17} /></div>
          <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
        </div>
      </section>

      <section className="category-section" aria-labelledby="category-title">
        <div className="section-topline"><div><p className="market-eyebrow">FIND YOUR STARTING POINT</p><h2 id="category-title">Explore by category</h2></div><p>Browse the tools and places already shared across campus.</p></div>
        <div className="category-grid">
          {categories.map(({ label, detail, value, icon: Icon, tone }) => (
            <Link key={label} href={resourceHref(value)} className="category-card">
              <span className={`category-icon tone-${tone}`}><Icon size={21} strokeWidth={1.8} /></span>
              <span className="category-label"><strong>{label}</strong><small>{detail}</small></span>
              <ArrowUpRight className="category-link-icon" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section id="resources" className="featured-section" aria-labelledby="featured-title">
        <div className="section-topline"><div><p className="market-eyebrow">MADE TO BE SHARED</p><h2 id="featured-title">{q || category || eligibleOnly ? "Resources for your search" : "Find something worth making"}</h2></div><p>See requirements and booking details before you send a request.</p></div>
        {aiResults?.length ? <p className="ai-ranking-note">✦ Ranked by AI from your description ({ai!._model}). Eligibility is checked against LabLoop&apos;s rules.</p> : null}
        {results.length === 0 ? <div className="empty-resources"><Search size={22} /><strong>No resources match those filters.</strong><span>Try a broader search or clear the filters.</span><Link href="/">Clear filters <ArrowRight size={15} /></Link></div> : (
          <div className="resource-grid">
            {results.slice(0, 6).map(({ item: r, why }) => (
              <article className="resource-card" key={r.id}>
                <Link href={`/resources/${r.id}`} className="resource-image-link" aria-label={`View ${r.name}`}>
                  {r.photo ? <img className="resource-image" src={r.photo} alt="" /> : <div className={`resource-image resource-placeholder placeholder-${r.category}`}><span><FlaskConical size={30} strokeWidth={1.5} /></span><small>{r.category}</small></div>}
                  <span className={`resource-status ${r.status === "ACTIVE" ? "status-active" : "status-maintenance"}`}>{r.status === "ACTIVE" ? "Access by request" : "Under maintenance"}</span>
                </Link>
                <div className="resource-card-body">
                  <div className="resource-type-row"><span>{r.category}</span>{r.high_demand && <span>High demand</span>}</div>
                  <h3><Link href={`/resources/${r.id}`}>{r.name}</Link></h3>
                  <p className="resource-location"><MapPin size={14} /> {r.dept} · {r.location}</p>
                  <p className="resource-description">{r.description}</p>
                  <div className="resource-meta">
                    <span className={actor ? (r.missing === 0 && identityVerified ? "eligible-label" : "requirements-label") : "requirements-label"}>{actor ? (!identityVerified ? <>Identity verification needed</> : r.missing === 0 ? <><ShieldCheck size={14} /> Requirements met</> : <>Requirements apply{r.requires ? ` · ${r.requires}` : ""}</>) : <>Sign in to check eligibility</>}</span>
                    {r.requires_supervision && <span>Supervised</span>}
                  </div>
                  {why && <p className="resource-match">{aiResults?.length ? "✦ " : ""}{why}</p>}
                  <Link className="resource-details-link" href={`/resources/${r.id}`}>View details <ArrowRight size={16} /></Link>
                </div>
              </article>
            ))}
          </div>
        )}
        {results.length > 6 && <p className="results-count">Showing 6 of {results.length} matching resources. Refine your search above to narrow the list.</p>}
      </section>

      <section id="how-it-works" className="how-section" aria-labelledby="how-title">
        <div className="section-topline"><div><p className="market-eyebrow">A CLEAR PATH FROM SEARCH TO SHARED</p><h2 id="how-title">Good work starts with the right tools.</h2></div><p>Every listing shows what you need, who can approve it, and how to return it well.</p></div>
        <div className="steps-grid">
          <article className="step-card"><span className="step-icon"><Search size={20} /></span><span className="step-index">01</span><h3>Discover a resource</h3><p>Search equipment, labs, and workspaces by name, category, or what you want to make.</p></article>
          <article className="step-card"><span className="step-icon"><ShieldCheck size={20} /></span><span className="step-index">02</span><h3>Check and request</h3><p>Review availability, training, and access rules before requesting a time.</p></article>
          <article className="step-card"><span className="step-icon"><Workflow size={20} /></span><span className="step-index">03</span><h3>Use and collaborate</h3><p>Check out with the lab team, make your work, then record a clear return.</p></article>
        </div>
      </section>

      <section className="listing-cta" aria-labelledby="listing-title">
        <div><p className="market-eyebrow">FOR LABS, COLLEGES & RESOURCE OWNERS</p><h2 id="listing-title">Make your resources work harder.</h2><p>Share underused campus equipment and spaces with people who are ready to put them to good use.</p></div>
        {ownerDestination
          ? <Link className="button-primary" href={ownerDestination}>{ownerActionLabel} <ArrowRight size={17} /></Link>
          : <SignInTrigger className="button-primary" returnTo="/owner-access">Owner sign in <ArrowRight size={17} /></SignInTrigger>}
      </section>
    </div>
  );
}
