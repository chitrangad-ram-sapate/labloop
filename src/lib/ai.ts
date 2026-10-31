// Advisory AI (Groq, OpenAI-compatible API). Every function returns null when AI is off or fails,
// and callers always have a non-AI path. Nothing here changes a booking, credential or penalty.

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const TEXT_MODEL = process.env.AI_TEXT_MODEL ?? "openai/gpt-oss-120b";
const VISION_MODEL = process.env.AI_VISION_MODEL ?? "qwen/qwen3.8-27b";

export const aiEnabled = () => Boolean(process.env.GROQ_API_KEY);

export type AiMeta = { _model: string; _at: string };

/** Strict JSON schema: every property required, nothing extra. */
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string" };
const bool = { type: "boolean" };
const list = (items: unknown) => ({ type: "array", items });

async function ask<T>(model: string, system: string, content: unknown, schema: object): Promise<(T & AiMeta) | null> {
  if (!aiEnabled()) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0.2, max_tokens: 2000,
        response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } },
        messages: [{ role: "system", content: system }, { role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j = await res.json();
    return { ...JSON.parse(j.choices[0].message.content), _model: model, _at: new Date().toISOString() };
  } catch (e) {
    console.error("AI call failed:", e);
    return null;
  }
}

/** Vision models take raster images only; seeded SVG placeholders are skipped. */
const image = (dataUrl: string | null) =>
  dataUrl && /^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) ? [{ type: "image_url", image_url: { url: dataUrl } }] : [];

export async function findResources(query: string, catalog: { id: string; name: string; category: string; description: string; location: string; requires: string | null }[]) {
  return ask<{ matches: { id: string; why: string }[] }>(
    TEXT_MODEL,
    "You match a student's plain-language need to a college's shared resources. Return only resources that genuinely fit, best first, each with a one-sentence reason that names the task. Never invent ids.",
    `Need: ${query}\n\nCatalog:\n${catalog.map((r) => JSON.stringify(r)).join("\n")}`,
    obj({ matches: list(obj({ id: str, why: str })) }),
  );
}

export async function explainEligibility(blocks: { code: string; message: string }[]) {
  if (!blocks.length) return null;
  return ask<{ guidance: string }>(
    TEXT_MODEL,
    "Explain the supplied deterministic resource eligibility blocks in plain language. Give practical next steps only; do not change or reinterpret policy, waive a requirement, or claim the user is eligible.",
    blocks,
    obj({ guidance: str }),
  );
}

export async function explainConflicts(conflicts: { status: string; start: string; end: string; quantity: number; score: number | null }[]) {
  if (!conflicts.length) return null;
  return ask<{ explanation: string }>(
    TEXT_MODEL,
    "Explain the supplied resource schedule conflicts neutrally. Do not rank people, decide approval, or invent availability. Owners apply the published score and capacity rules.",
    conflicts,
    obj({ explanation: str }),
  );
}

export type DocCheck = { readable: boolean; name_on_document: string; name_matches: boolean; issuer_or_title: string; matches_expected: boolean; date_on_document: string; issues: string[]; summary: string };

export async function checkDocument(dataUrl: string | null, expect: { kind: "identity" | "credential"; name: string; organisation?: string; credential?: string }) {
  if (!image(dataUrl).length) return null;
  const wanted = expect.kind === "identity"
    ? `a student or staff ID, or an incubator letter, from "${expect.organisation}"`
    : `a training certificate for "${expect.credential}"`;
  return ask<DocCheck>(
    VISION_MODEL,
    "You help a lab manager verify uploaded documents. Read the image and report facts only. Flag anything that looks wrong (name mismatch, wrong issuer, expired, unreadable, edited). You do not approve or reject; a person decides.",
    [{ type: "text", text: `Expected: ${wanted}, belonging to "${expect.name}". Use empty strings for anything you cannot read.` }, ...image(dataUrl)],
    obj({ readable: bool, name_on_document: str, name_matches: bool, issuer_or_title: str, matches_expected: bool, date_on_document: str, issues: list(str), summary: str }),
  );
}

export type ConditionDiff = { possible_issues: { item: string; description: string; confidence: string }[]; summary: string };

export async function compareCondition(before: { checklist: object; notes: string; photo: string | null }, after: { checklist: object; notes: string; photo: string | null }): Promise<(ConditionDiff & AiMeta) | null> {
  const photos = [...image(before.photo), ...image(after.photo)];
  const withPhotos = photos.length === 2 ? await compare(before, after, photos) : null;
  return withPhotos ?? compare(before, after, []); // unusable photos still get a checklist/notes comparison
}

function compare(before: { checklist: object; notes: string }, after: { checklist: object; notes: string }, photos: object[]) {
  return ask<ConditionDiff>(
    photos.length === 2 ? VISION_MODEL : TEXT_MODEL,
    "You compare the condition of borrowed lab equipment at check-out and at return. List possible new damage, missing parts or mess, citing the evidence. Be conservative: a lab manager inspects and decides; you only point out what to look at.",
    [
      { type: "text", text: `Check-out checklist: ${JSON.stringify(before.checklist)}. Notes: "${before.notes}".\nReturn checklist: ${JSON.stringify(after.checklist)}. Notes: "${after.notes}".${photos.length === 2 ? "\nFirst image: at check-out. Second image: at return." : ""}` },
      ...(photos.length === 2 ? photos : []),
    ],
    obj({ possible_issues: list(obj({ item: str, description: str, confidence: { type: "string", enum: ["low", "medium", "high"] } })), summary: str }),
  );
}

export async function summariseIncident(context: string) {
  return ask<{ summary: string; suggested_follow_up: string }>(
    TEXT_MODEL,
    "Summarise a lab equipment incident neutrally in two sentences for the reviewing manager, then suggest one practical follow-up (e.g. repair, retraining). Never suggest a penalty; that is a human decision.",
    context,
    obj({ summary: str, suggested_follow_up: str }),
  );
}

export async function summariseComplaint(context: string) {
  return ask<{ summary: string; next_step: string }>(
    TEXT_MODEL,
    "Summarise a campus resource complaint neutrally for a human owner. Separate reported facts from uncertainty. Suggest one practical next step. Never decide fault, liability, or resolution.",
    context,
    obj({ summary: str, next_step: str }),
  );
}
