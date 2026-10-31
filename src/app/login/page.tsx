import Link from "next/link";
import { ArrowRight, ArrowUpRight, Boxes, Cpu, FlaskConical, Laptop, Microscope, Printer, Search, ShieldCheck, Workflow } from "lucide-react";
import { demoLogin, login } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/seed";

const steps = [
  { number: "01", title: "Find your resource", body: "Search campus equipment, studios, and workspaces in plain language. See requirements before you request.", icon: Search },
  { number: "02", title: "Check access", body: "Review training, identity checks, availability, and the rules for each shared resource.", icon: ShieldCheck },
  { number: "03", title: "Make something", body: "Request a time, check in with the lab team, and leave a clear record when you return it.", icon: Workflow },
];

const categories = [
  { title: "Laboratories", icon: FlaskConical, filter: "space" },
  { title: "Electronics equipment", icon: Workflow, filter: "equipment" },
  { title: "Computing resources", icon: Cpu, filter: "computing" },
  { title: "3D & fabrication", icon: Printer, filter: "equipment" },
  { title: "Study spaces", icon: Laptop, filter: "space" },
  { title: "Research facilities", icon: Microscope, filter: "equipment" },
  { title: "Prototyping equipment", icon: Boxes, filter: "equipment" },
];

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { redirectTo: requestedRedirect } = await searchParams;
  const redirectTo = typeof requestedRedirect === "string" && requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")
    ? requestedRedirect
    : "/";
  const demo = process.env.DEMO_MODE === "true";

  return (
    <div className="public-home">
      <section className="public-hero" aria-labelledby="public-title">
        <div className="public-hero-copy">
          <p className="market-eyebrow"><span className="eyebrow-dot" /> OPEN CAMPUS LABS · NORTHFIELD INSTITUTE</p>
          <h1 id="public-title">Your campus has<br /><span>more to offer.</span></h1>
          <p className="public-hero-text">Discover, share, and access laboratories, equipment, and workspaces across your campus.</p>
          <form className="resource-search public-search" role="search" action="/">
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="public-query">Search labs, equipment, or workspaces</label>
            <input id="public-query" name="q" placeholder="Search labs, equipment, or workspaces..." />
            <button type="submit" aria-label="Search resources"><ArrowRight size={18} /></button>
          </form>
          <div className="public-hero-actions"><Link className="button-primary" href="/">Explore resources <ArrowRight size={17} /></Link><Link className="button-text" href="/login#sign-in">Sign in to your account <ArrowUpRight size={15} /></Link></div>
          <div className="market-trust-line"><ShieldCheck size={17} /> Verified access <span /> Clear booking rules <span /> Accountable hand-offs</div>
        </div>
        <div className="public-hero-side">
          <div className="public-visual" role="img" aria-label="A student working in a campus makerspace"><div className="public-visual-shade" /><div className="public-visual-caption"><span className="visual-note-icon"><Workflow size={18} /></span><span><strong>Space for what&apos;s next</strong><small>Tools, labs, and people to move ideas forward</small></span></div></div>
          <aside id="sign-in" className="access-card" aria-labelledby="signin-title">
            <div className="access-card-heading"><span className="access-icon"><ShieldCheck size={20} /></span><div><p className="market-eyebrow">YOUR WORKSPACE AWAITS</p><h2 id="signin-title">Welcome back</h2></div></div>
            <ActionForm action={login} submit="Sign in to LabLoop" className="signin-form">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <Field label="College email"><Input name="email" type="email" autoComplete="email" placeholder="you@college.edu" required /></Field>
              <Field label="Password"><Input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></Field>
            </ActionForm>
            <p className="access-signup">New to LabLoop? <Link href="/signup">Create an account <ArrowUpRight size={13} /></Link></p>
            {demo && <details className="demo-access">
              <summary>Explore with a demo account <span aria-hidden="true">+</span></summary>
              <div className="demo-content">
                <p>Choose a role to enter the demo. Password: <code>{DEMO_PASSWORD}</code></p>
                <ul>{DEMO_ACCOUNTS.map((account) => <li key={account.email}><form action={demoLogin.bind(null, account.email)}><input type="hidden" name="redirectTo" value={redirectTo} /><button type="submit"><span><strong>{account.label}</strong><small>{account.hint}</small></span><span aria-hidden="true">↗</span></button></form></li>)}</ul>
              </div>
            </details>}
          </aside>
        </div>
      </section>

      <section id="shared-resources" className="public-section category-section" aria-labelledby="public-categories-title">
        <div className="section-topline"><div><p className="market-eyebrow">FIND YOUR STARTING POINT</p><h2 id="public-categories-title">Explore shared resources</h2></div><Link className="section-link" href="/">Browse all resources <ArrowRight size={16} /></Link></div>
        <div className="public-category-grid">{categories.map(({ title, icon: Icon, filter }, index) => <Link key={title} href={`/?category=${filter}`} className="public-category-card"><span className={`category-icon tone-${["blue", "violet", "teal", "amber", "sky", "indigo", "orange"][index]}`}><Icon size={21} /></span><strong>{title}</strong><ArrowUpRight size={16} className="category-link-icon" /></Link>)}</div>
      </section>

      <section id="how-it-works" className="public-section how-section" aria-labelledby="public-how-title">
        <div className="section-topline"><div><p className="market-eyebrow">A CLEAR PATH FROM SEARCH TO SHARED</p><h2 id="public-how-title">Good work starts with the right tools.</h2></div><p>Get what you need, with a clear path from discovery to return.</p></div>
        <div className="steps-grid">{steps.map(({ number, title, body, icon: Icon }) => <article className="step-card" key={number}><span className="step-icon"><Icon size={20} /></span><span className="step-index">{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>

      <section id="verified-access" className="trust-section">
        <div className="trust-visual"><ShieldCheck size={30} /><span>Shared with care</span><small>Northfield Institute</small></div>
        <div className="trust-copy"><p className="market-eyebrow">ACCESS YOU CAN UNDERSTAND</p><h2>Clear rules make better neighbours.</h2><p>LabLoop makes each resource&apos;s requirements, fair-share rules, and check-in process visible before you request access.</p><div className="trust-points"><span><b>01</b> Eligibility before you book</span><span><b>02</b> Fair-share rules you can read</span><span><b>03</b> A record for every hand-off</span></div></div>
      </section>

      <section className="closing-section"><p className="market-eyebrow">FOR LABS, COLLEGES & RESOURCE OWNERS</p><h2>Make your resources<br />work harder.</h2><p>Open underused spaces and equipment to people ready to put them to good use.</p><Link className="button-primary" href="/login#sign-in">Sign in as a resource owner <ArrowRight size={17} /></Link></section>
      <div className="public-footnote"><span>LabLoop · Northfield Institute of Technology</span><span>All people and organisations shown are fictional.</span></div>
    </div>
  );
}
