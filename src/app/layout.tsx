import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { login, logout } from "@/app/actions/auth";
import { Flash } from "@/components/flash";
import { SignInExperience, SignInTrigger } from "@/components/sign-in-experience";
import { getActor } from "@/lib/auth";
import { getFirebaseDb } from "@/lib/firebase";
import "./globals.css";

export const metadata: Metadata = {
  title: "LabLoop | Campus resources, made shareable",
  description: "Discover, share, and access laboratories, equipment, and workspaces across your campus.",
};

async function Nav() {
  const actor = await getActor();
  const [notifications, cartItems] = actor ? await Promise.all([
    getFirebaseDb().collection("notifications").where("user_id", "==", actor.id).get(),
    getFirebaseDb().collection("cart_items").where("user_id", "==", actor.id).get(),
  ]) : [null, null];
  const unread = notifications?.docs.filter((doc) => !doc.get("read_at")).length ?? 0;
  const cartCount = cartItems?.docs.filter((doc) => new Date(doc.get("hold_expires_at")?.toDate?.() ?? doc.get("hold_expires_at")).getTime() > Date.now()).length ?? 0;
  const staff = actor && ["owner", "manager", "admin"].includes(actor.role);
  const links = actor ? [
    { href: "/", label: "Explore resources" },
    { href: "/?category=equipment", label: "Laboratories" },
    { href: "/?category=equipment", label: "Equipment" },
    { href: "/?category=space", label: "Workspaces" },
    { href: "/#how-it-works", label: "How it works" },
    { href: "/bookings", label: "My bookings" },
    { href: "/cart", label: "Cart" },
    ...(staff ? [{ href: "/manage", label: "Manage" }] : []),
    ...(actor.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ] : [
    { href: "/", label: "Explore resources" },
    { href: "/?category=space", label: "Laboratories" },
    { href: "/?category=equipment", label: "Equipment" },
    { href: "/?category=space", label: "Workspaces" },
    { href: "/#how-it-works", label: "How it works" },
  ];

  return (
    <>
      <div className="nav-links nav-links-desktop">
        {links.map((item, index) => <Link href={item.href} key={`${item.label}-${index}`}>{item.label}{item.href === "/cart" && cartCount > 0 ? ` (${cartCount})` : ""}</Link>)}
      </div>
      <div className="nav-actions nav-actions-desktop">
        {actor ? <>
          <Link href="/notifications" className="nav-notifications" aria-label={`Notifications, ${unread} unread`}>Notifications{unread > 0 && <span>{unread}</span>}</Link>
          <Link href="/me" className="nav-account">{actor.full_name}</Link>
          <form action={logout}><button className="nav-signout">Sign out</button></form>
        </> : <><SignInTrigger className="nav-signin nav-signin-trigger">Sign in</SignInTrigger><Link href="/signup" className="nav-join">Get started <span aria-hidden="true">↗</span></Link></>}
      </div>
      <details className="mobile-menu">
        <summary aria-label="Open navigation menu"><span className="menu-lines" aria-hidden="true"><i /><i /></span><span>Menu</span></summary>
        <div className="mobile-menu-panel">
          {links.map((item, index) => <Link href={item.href} key={`${item.label}-${index}`}>{item.label}{item.href === "/cart" && cartCount > 0 ? ` (${cartCount})` : ""}</Link>)}
          {actor ? <>
            <Link href="/me">My passport</Link>
            <Link href="/notifications">Notifications {unread > 0 && <span className="mobile-unread">{unread}</span>}</Link>
            <span className="mobile-user">{actor.full_name} · {actor.role}</span>
            <form action={logout}><button className="nav-signout">Sign out</button></form>
          </> : <><SignInTrigger className="mobile-signin mobile-signin-trigger">Sign in</SignInTrigger><Link href="/signup" className="nav-join">Get started <span aria-hidden="true">↗</span></Link></>}
        </div>
      </details>
      {!actor && <SignInExperience authenticated={false} loginAction={login} />}
    </>
  );
}

async function FlashMessage() {
  const flash = (await cookies()).get("flash")?.value;
  return flash ? <Flash key={flash} message={decodeURIComponent(flash)} /> : null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a href="#main" className="skip-link">Skip to content</a>
        <header className="site-header">
          <nav aria-label="Main" className="site-nav">
            <Link href="/" className="site-brand" aria-label="LabLoop home"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>labloop<span className="brand-period">.</span></span></Link>
            <Suspense><Nav /></Suspense>
          </nav>
        </header>
        <main id="main" className="app-main flex-1">
          <Suspense><FlashMessage /></Suspense>
          <Suspense fallback={<p className="loading-message">Loading LabLoop…</p>}>{children}</Suspense>
        </main>
        <footer className="site-footer">
          <div className="footer-brand-wrap"><Link href="/" className="footer-brand">labloop<span>.</span></Link><small>Campus resources, made shareable.</small></div>
          <p>Shared spaces for bigger ideas.<br /><small>Northfield Institute of Technology</small></p>
          <div className="footer-links"><Link href="/">Discover resources</Link><Link href="/login#how-it-works">How it works</Link><Link href="/signup">Create account</Link></div>
          <small className="footer-note">Prototype · all people and organisations shown are fictional</small>
        </footer>
      </body>
    </html>
  );
}
