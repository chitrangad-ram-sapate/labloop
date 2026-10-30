import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { getActor } from "@/lib/auth";
import { sql } from "@/lib/db";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LabLoop",
  description: "Safely share a college's idle labs, equipment and spaces with verified students and startups.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const actor = await getActor();
  const unread = actor
    ? (await sql<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${actor.id} and read_at is null`)[0].n
    : 0;
  const staff = actor && ["owner", "manager", "admin"].includes(actor.role);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
        <header className="border-b">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-bold tracking-tight">LabLoop</Link>
            {actor && (
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
            )}
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t py-4 text-center text-xs text-muted-foreground">
          LabLoop prototype · all people and organisations shown are fictional
        </footer>
      </body>
    </html>
  );
}
