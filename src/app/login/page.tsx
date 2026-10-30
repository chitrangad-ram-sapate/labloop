import Link from "next/link";
import { demoLogin, login } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/seed";

const steps = [
  { number: "01", title: "Find the right space", body: "Search equipment, studios and workspaces in plain language. See availability and requirements before you request." },
  { number: "02", title: "Get cleared to use it", body: "Your training and identity checks stay with your profile, so each resource can show exactly what you need." },
  { number: "03", title: "Make something good", body: "Book a time, check the item in and out, and leave a clear record for the next person." },
];

const categories = ["Makerspace equipment", "Electronics & computing", "Media studios", "Rooms & workspaces"];

export default function LoginPage() {
  const demo = process.env.DEMO_MODE === "true";

  return (
    <div className="marketing-page">
      <section className="hero-stage" aria-labelledby="hero-title">
        <div className="hero-image" aria-hidden="true" />
        <div className="hero-layout">
          <div className="hero-copy">
            <p className="eyebrow eyebrow-light"><span className="eyebrow-dot" /> Open campus labs · Northfield Institute</p>
            <h1 id="hero-title">Make room for<br className="desktop-break" /> what’s next.</h1>
            <p className="hero-description">The tools, labs and people to bring your next idea to life. Borrow what you need, learn something new, and share the space well.</p>
            <div className="hero-actions">
              <Link href="/signup" className="cta-button">Request access <span aria-hidden="true">↗</span></Link>
              <a href="#how-it-works" className="hero-text-link">See how LabLoop works <span aria-hidden="true">↓</span></a>
            </div>
            <div className="hero-proof"><span className="proof-mark">✓</span> Verified access <span className="proof-divider" /> Clear booking rules <span className="proof-divider" /> Every hand-off recorded</div>
          </div>

          <aside id="sign-in" className="access-card" aria-labelledby="signin-title">
            <div className="access-card-heading">
              <span className="access-icon" aria-hidden="true">↗</span>
              <div><p className="eyebrow">Your next project starts here</p><h2 id="signin-title">Welcome back</h2></div>
            </div>
            <ActionForm action={login} submit="Sign in to LabLoop" className="signin-form">
              <Field label="College email"><Input name="email" type="email" autoComplete="email" placeholder="you@college.edu" required /></Field>
              <Field label="Password"><Input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></Field>
            </ActionForm>
            <p className="access-signup">New to LabLoop? <Link href="/signup">Create an account <span aria-hidden="true">↗</span></Link></p>
            {demo && (
              <details className="demo-access">
                <summary>Explore with a demo account <span aria-hidden="true">＋</span></summary>
                <div className="demo-content">
                  <p>Choose a role to jump into the demo. Password: <code>{DEMO_PASSWORD}</code></p>
                  <ul>
                    {DEMO_ACCOUNTS.map((account) => (
                      <li key={account.email}>
                        <form action={demoLogin.bind(null, account.email)}>
                          <button type="submit"><span><strong>{account.label}</strong><small>{account.hint}</small></span><span aria-hidden="true">↗</span></button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </aside>
        </div>
        <div className="hero-caption"><span>01</span> Shared spaces. Bigger ideas.</div>
      </section>

      <section id="how-it-works" className="steps-section content-wrap">
        <div className="section-heading">
          <p className="eyebrow">A better way to get hands-on</p>
          <h2>Good work starts<br className="mobile-break" /> with the right tools.</h2>
          <p>Access what your project needs, with a clear path from first search to final return.</p>
        </div>
        <div className="steps-grid">
          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <span className="step-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="step-rule" />
            </article>
          ))}
        </div>
      </section>

      <section id="shared-resources" className="collection-section">
        <div className="collection-inner content-wrap">
          <div className="collection-copy">
            <p className="eyebrow eyebrow-red">Made to be shared</p>
            <h2>A whole campus<br />of possibility.</h2>
            <p>From a quiet study room to a laser cutter or a high-powered workstation, find the shared resource that helps move your work forward.</p>
            <Link href="/signup" className="text-cta">See what you can do <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="category-panel">
            <span className="category-label">Explore the collection</span>
            <ul>{categories.map((category, index) => <li key={category}><span className="category-index">0{index + 1}</span>{category}<span className="category-arrow" aria-hidden="true">↗</span></li>)}</ul>
            <p>Every listing includes its location, availability, safety requirements and use conditions.</p>
          </div>
        </div>
      </section>

      <section id="verified-access" className="trust-section content-wrap">
        <div className="trust-note"><span className="trust-symbol" aria-hidden="true">✳</span><span>Shared with care<br />at Northfield Institute</span></div>
        <div className="trust-copy">
          <p className="eyebrow">Access you can understand</p>
          <h2>Clear rules make<br />better neighbours.</h2>
          <p>LabLoop makes the details visible: which credentials a lab needs, how high-demand bookings are prioritised, and what happens at check-in and return.</p>
          <div className="trust-points"><span><b>01</b> Eligibility before you book</span><span><b>02</b> Fair-share rules you can read</span><span><b>03</b> A record for every hand-off</span></div>
        </div>
      </section>

      <section className="closing-section">
        <p className="eyebrow eyebrow-light">Your idea deserves the right space</p>
        <h2>Let’s make something<br />worth sharing.</h2>
        <Link href="/signup" className="cta-button cta-button-light">Get started <span aria-hidden="true">↗</span></Link>
      </section>

      <div className="content-wrap landing-footnote"><span>LabLoop · Northfield Institute of Technology</span><span>All people and organisations shown are fictional.</span></div>
    </div>
  );
}
