// Plain-language resource finder. Keyword + synonym ranking is the always-on path;
// the AI ranking (lib/ai.ts) only reorders and explains when a key is configured.

const SYNONYMS: Record<string, string[]> = {
  laser: ["cut", "cutting", "engrave", "acrylic", "plywood", "mdf", "laser"],
  "3d": ["print", "printing", "printer", "prototype", "bracket", "3d", "resin", "pla"],
  oscilloscope: ["signal", "scope", "waveform", "circuit", "debug", "oscilloscope", "electronics", "sensor"],
  solder: ["solder", "soldering", "pcb", "board", "sensor", "wire"],
  gpu: ["gpu", "train", "training", "model", "ml", "ai", "render", "rendering", "deep", "compute"],
  camera: ["camera", "photo", "photography", "video", "shoot", "film", "dslr", "event"],
  podcast: ["podcast", "audio", "record", "recording", "interview", "voice", "mic"],
  seminar: ["meeting", "talk", "seminar", "room", "workshop", "presentation", "class", "lecture"],
};

const STOP = new Set(["i", "a", "an", "the", "to", "for", "my", "need", "want", "some", "and", "of", "by", "on", "with", "is", "it", "in", "me", "can"]);

export function rankByQuery<T extends { name: string; description: string; category: string; location: string }>(items: T[], q: string) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
  if (!words.length) return items.map((item) => ({ item, why: "" }));
  return items
    .map((item) => {
      const hay = `${item.name} ${item.description} ${item.category} ${item.location}`.toLowerCase();
      const hits = new Set<string>();
      for (const w of words) {
        if (hay.includes(w)) hits.add(w);
        for (const [key, syn] of Object.entries(SYNONYMS)) if (syn.includes(w) && hay.includes(key)) hits.add(w);
      }
      return { item, score: hits.size, why: hits.size ? `Matches “${[...hits].join("”, “")}”` : "" };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
