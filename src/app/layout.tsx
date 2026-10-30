import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions/auth";
import { Flash } from "@/components/flash";
import { getActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LabLoop",
  description: "Safely share a college's idle labs, equipment and spaces with verified students and startups.",
};

async function Nav() {
  const actor = await getActor();
  if (!actor) return null;
  const [{ n: unread }] = await sql<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${actor.id} and read_at is null`;
  const staff = ["owner", "manager", "admin"].includes(actor.role);
  return (
    <>
      <Link href="/">Find resources</Link>
      <Link href="/bookings">My bookings</Link>
      <Link href="/me">My passport</Link>
      {staff && <Link href="/manage">Manage</Link>}
      {actor.role === "admin" && <Link href="/admin">Admin</Link>}
      <span className="ml-auto flex items-center gap-4">
        <Link href="/notifications" aria-label={`Notifications, ${unread} unread`}>
          🔔 {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{unread}</span>}
        </Link>
        <span className="text-muted-foreground">{actor.full_name} · {actor.role}</span>
        <form action={logout}><button className="underline">Sign out</button></form>
      </span>
    </>
  );
}

async function FlashMessage() {
  const flash = (await cookies()).get("flash")?.value;
  return flash ? <Flash key={flash} message={decodeURIComponent(flash)} /> : null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
        <header className="border-b">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-bold tracking-tight">LabLoop</Link>
            <Suspense><Nav /></Suspense>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <Suspense><FlashMessage /></Suspense>
          <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>{children}</Suspense>
        </main>
        <footer className="border-t py-4 text-center text-xs text-muted-foreground">
          LabLoop prototype · all people and organisations shown are fictional
        </footer>
      </body>
    </html>
  );
}
