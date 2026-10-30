import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

export type ActionResult = { error?: string; ok?: string } | null;

/** Runs a server action body, turns thrown errors into a message the form can show, and refreshes the UI. */
export async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const ok = await fn();
    revalidatePath("/", "layout");
    return ok ? { ok } : null;
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    if ((e as { code?: string }).code === "23P01")
      return { error: "That time overlaps a booking that is already approved. Pick another slot, or waitlist this request." };
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export function need(fd: FormData, k: string, what = k) {
  const v = str(fd, k);
  if (!v) throw new Error(`Please give ${what}.`);
  return v;
}

/** Compressed photos arrive as data URLs; cap them so one upload can't bloat the DB. */
export function photo(fd: FormData, k = "photo") {
  const v = str(fd, k);
  if (!v) return null;
  if (!/^data:image\/(jpeg|png|webp|svg\+xml);base64,/.test(v) || v.length > 1_500_000) throw new Error("Photo must be an image under about 1 MB.");
  return v;
}
