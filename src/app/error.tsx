"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ServerCrash } from "lucide-react";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("LabLoop catalog render failed", error);
  }, [error]);

  return (
    <section className="catalog-error" role="alert" aria-labelledby="route-error-title">
      <span className="catalog-error-icon"><ServerCrash size={24} /></span>
      <p className="market-eyebrow">RESOURCE CATALOG</p>
      <h1 id="route-error-title">We couldn&apos;t load this page.</h1>
      <p>Check that <code>DATABASE_URL</code> points to the project&apos;s PostgreSQL database and that every required migration in <code>db/migrations/</code> has been applied in numeric order. Signed-in pages also require <code>004_cart_trust_complaints.sql</code> for the cart and trust tables. Restart the server after changing environment variables.</p>
      {error.digest && <p>Reference code: <code>{error.digest}</code>. A site administrator can use it to find the matching server log.</p>}
      <div className="catalog-error-actions">
        <button type="button" className="button-primary" onClick={reset}><RefreshCw size={16} /> Try again</button>
        <Link className="button-text" href="/login"><ArrowLeft size={15} /> Back to LabLoop</Link>
      </div>
    </section>
  );
}
