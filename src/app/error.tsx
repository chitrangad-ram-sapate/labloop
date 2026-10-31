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
      <p>Check that the server has Firebase Admin credentials and points to the correct Firestore project. Set <code>FIREBASE_PROJECT_ID</code> and either <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> or local <code>GOOGLE_APPLICATION_CREDENTIALS</code>, plus <code>SESSION_SECRET</code>. Then restart the server. The server log contains the specific Firebase configuration or Firestore error.</p>
      {error.digest && <p>Reference code: <code>{error.digest}</code>. A site administrator can use it to find the matching server log.</p>}
      <div className="catalog-error-actions">
        <button type="button" className="button-primary" onClick={reset}><RefreshCw size={16} /> Try again</button>
        <Link className="button-text" href="/login"><ArrowLeft size={15} /> Back to LabLoop</Link>
      </div>
    </section>
  );
}
