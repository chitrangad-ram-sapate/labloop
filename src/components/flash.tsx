"use client";

import { useEffect } from "react";

/** Shows the last action's confirmation once, then clears it (the form that sent it may no longer be on screen). */
export function Flash({ message }: { message: string }) {
  useEffect(() => {
    document.cookie = "flash=; path=/; max-age=0";
  }, [message]);
  return (
    <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950">
      ✓ {message}
    </p>
  );
}
