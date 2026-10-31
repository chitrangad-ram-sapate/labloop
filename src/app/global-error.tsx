"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    // The server-side log contains the underlying exception; the digest links
    // this safe client-side report to the corresponding Render log entry.
    console.error("LabLoop root render failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#f4f0e5",
          color: "#20352b",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <main
          style={{
            boxSizing: "border-box",
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "32px 20px",
          }}
        >
          <section
            role="alert"
            style={{
              width: "min(100%, 520px)",
              padding: "clamp(28px, 6vw, 48px)",
              borderRadius: 24,
              background: "#f4f0e5",
              boxShadow: "12px 12px 30px #d4d0c6, -12px -12px 30px #fffaf0",
            }}
          >
            <p style={{ color: "#8b6824", fontSize: 12, fontWeight: 700, letterSpacing: ".16em" }}>
              LABLOOP · CAMPUS RESOURCES
            </p>
            <h1 style={{ margin: "16px 0 10px", fontSize: "clamp(28px, 6vw, 38px)", lineHeight: 1.12 }}>
              We couldn&apos;t load this page.
            </h1>
            <p style={{ color: "#526158", lineHeight: 1.65 }}>
              A server error interrupted the page. Try again. If the problem continues, send the reference code to the site administrator so they can find the matching server log.
            </p>
            {error.digest && (
              <p style={{ color: "#526158", fontSize: 13 }}>
                Reference code: <code>{error.digest}</code>
              </p>
            )}
            <button
              type="button"
              onClick={retry}
              style={{
                marginTop: 12,
                border: 0,
                borderRadius: 999,
                background: "#315a43",
                color: "#fffaf0",
                cursor: "pointer",
                font: "inherit",
                fontWeight: 700,
                padding: "13px 22px",
              }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
