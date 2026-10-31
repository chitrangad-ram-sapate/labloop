"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useActionState, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, Eye, EyeOff, X } from "lucide-react";
import type { ActionResult } from "@/lib/action";

const DISMISSED_KEY = "labloop-sign-in-seen";
const OPEN_EVENT = "labloop:open-sign-in";

type LoginAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

export function SignInTrigger({ children, className, returnTo }: { children: React.ReactNode; className?: string; returnTo?: string }) {
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { trigger: event.currentTarget, returnTo } }));
      }}
    >
      {children}
    </button>
  );
}

export function SignInExperience({ authenticated, loginAction }: { authenticated: boolean; loginAction: LoginAction }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [redirectTo, setRedirectTo] = useState("/");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(loginAction, null);
  const emailRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    try { window.sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Storage can be unavailable in private browsing. */ }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (authenticated) return;
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ trigger?: HTMLElement; returnTo?: string }>).detail;
      const trigger = detail?.trigger;
      returnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      const destination = detail?.returnTo;
      setRedirectTo(destination?.startsWith("/") && !destination.startsWith("//") ? destination : `${window.location.pathname}${window.location.search}` || "/");
      try { window.sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Storage can be unavailable in private browsing. */ }
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, [authenticated]);

  useEffect(() => {
    if (authenticated || pathname !== "/") return;
    try {
      if (window.sessionStorage.getItem(DISMISSED_KEY)) return;
    } catch { /* The prompt still works if storage is unavailable. */ }
    const timer = window.setTimeout(() => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setRedirectTo(`${window.location.pathname}${window.location.search}` || "/");
      try { window.sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Storage can be unavailable in private browsing. */ }
      setOpen(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [authenticated, pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    emailRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled)')]
        .filter((item) => item.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [close, open]);

  if (!open || authenticated || typeof document === "undefined") return null;

  return createPortal(
    <div className="signin-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="signin-dialog" role="dialog" aria-modal="true" aria-labelledby="signin-dialog-title" aria-describedby="signin-dialog-copy">
        <button type="button" className="signin-close" onClick={close} aria-label="Close sign-in dialog"><X size={19} /></button>
        <div className="signin-dialog-brand" aria-label="LabLoop"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>labloop<span className="brand-period">.</span></span></div>
        <p className="signin-dialog-eyebrow">YOUR CAMPUS, OPEN TO POSSIBILITY</p>
        <h2 id="signin-dialog-title">Welcome back.</h2>
        <p id="signin-dialog-copy" className="signin-dialog-copy">Sign in to see what your campus can help you create.</p>
        <form action={formAction} className="signin-dialog-form">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label htmlFor="dialog-email">College email</label>
          <input ref={emailRef} id="dialog-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@college.edu" required />
          <label htmlFor="dialog-password">Password</label>
          <span className="signin-password-wrap">
            <input id="dialog-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
            <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </span>
          {state?.error && <p className="signin-error" role="alert">{state.error}</p>}
          <button className="signin-submit" type="submit" disabled={pending}>{pending ? "Signing in…" : <>Sign in to LabLoop <ArrowRight size={17} /></>}</button>
        </form>
        <p className="signin-create">New to LabLoop? <Link href="/signup" onClick={close}>Create account</Link></p>
        <button type="button" className="signin-explore" onClick={close}>Continue exploring <ArrowRight size={15} /></button>
      </section>
    </div>,
    document.body,
  );
}
