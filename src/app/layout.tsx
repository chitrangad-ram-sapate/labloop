import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions/auth";
import { Flash } from "@/components/flash";
import { getActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import "./globals.css";

export const metadata: Metadata = {
  title: "LabLoop",
  description: "Safely share a college's idle labs, equipment and spaces with verified students and startups.",
};

async function Nav() {
  const actor = await getActor();
  const [{ n: unread }] = actor
    ? await sql<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${actor.id} and read_at is null`
    : [{ n: 0 }];
  const staff = actor && ["owner", "manager", "admin"].includes(actor.role);
  const links = actor ? [
    { href: "/", label: "Find resources" },
    { href: "/bookings", label: "My bookings" },
    { href: "/me", label: "My passport" },
    ...(staff ? [{ href: "/manage", label: "Manage" }] : []),
    ...(actor.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ] : [
    { href: "/login#how-it-works", label: "How it works" },
    { href: "/login#shared-resources", label: "The collection" },
    { href: "/login#verified-access", label: "Our approach" },
  ];

  return (
    <>
      <div className="nav-links nav-links-desktop">
        {links.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
      </div>
      <div className="nav-actions nav-actions-desktop">
        {actor ? <>
          <Link href="/notifications" className="nav-notifications" aria-label={`Notifications, ${unread} unread`}>Notifications{unread > 0 && <span>{unread}</span>}</Link>
          <span className="nav-user">{actor.full_name} <i>·</i> {actor.role}</span>
          <form action={logout}><button className="nav-signout">Sign out</button></form>
        </> : <Link href="/signup" className="nav-join">Get started <span aria-hidden="true">↗</span></Link>}
      </div>
      <details className="mobile-menu">
        <summary aria-label="Open navigation menu"><span className="menu-lines" aria-hidden="true"><i /><i /></span><span>Menu</span></summary>
        <div className="mobile-menu-panel">
          {links.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
          {actor ? <>
            <Link href="/notifications">Notifications {unread > 0 && <span className="mobile-unread">{unread}</span>}</Link>
            <span className="mobile-user">{actor.full_name} · {actor.role}</span>
            <form action={logout}><button className="nav-signout">Sign out</button></form>
          </> : <Link href="/signup" className="nav-join">Get started <span aria-hidden="true">↗</span></Link>}
        </div>
      </details>
    </>
  );
}

async function FlashMessage() {
  const flash = (await cookies()).get("flash")?.value;
  return flash ? <Flash key={flash} message={decodeURIComponent(flash)} /> : null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
        <header className="site-header">
          <nav aria-label="Main" className="site-nav">
            <Link href="/" className="site-brand" aria-label="LabLoop home"><span className="brand-mark" aria-hidden="true">L</span><span>labloop<span className="brand-period">.</span></span></Link>
            <Suspense><Nav /></Suspense>
          </nav>
        </header>
        <main id="main" className="app-main flex-1">
          <Suspense><FlashMessage /></Suspense>
          <Suspense fallback={<p className="mx-auto max-w-6xl px-4 py-8 text-muted-foreground">Loading…</p>}>{children}</Suspense>
        </main>
        <footer className="site-footer">
          <Link href="/" className="footer-brand">labloop<span>.</span></Link>
          <p>Shared spaces for bigger ideas.<br /><small>Northfield Institute of Technology</small></p>
          <div className="footer-links"><Link href="/login">Sign in</Link><Link href="/signup">Create account</Link></div>
          <small className="footer-note">Prototype · all people and organisations shown are fictional</small>
        </footer>
      </body>
    </html>
  );
}
