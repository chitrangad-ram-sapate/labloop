import type postgres from "postgres";
import { hashPassword } from "./auth";
import { istDateKey, istToDate } from "./format";
import { fairShare, type Purpose } from "./rules";

export const DEMO_PASSWORD = "Demo@1234";

export const DEMO_ACCOUNTS = [
  { email: "meera@rce.demo", label: "External student", hint: "Riverside College, ID not yet verified" },
  { email: "aarav@nitf.demo", label: "Host student", hint: "Has laser and 3D printing badges" },
  { email: "rohan@nitf.demo", label: "Heavy user", hint: "Uses the GPU a lot, so loses ties" },
  { email: "priya@kineticlabs.demo", label: "Startup founder", hint: "Kinetic Labs, verified external" },
  { email: "kavita@nitf.demo", label: "Owner", hint: "Makerspace in-charge (Mechanical)" },
  { email: "sana@nitf.demo", label: "Manager", hint: "Makerspace lab assistant" },
  { email: "admin@nitf.demo", label: "Admin", hint: "Policies, audit, disputes" },
];

/** Placeholder certificate/ID image so seeded uploads have something to show. */
const card = (title: string, line: string) =>
  "data:image/svg+xml;base64," +
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" rx="16" fill="#f4f1ea" stroke="#8a7f6a" stroke-width="4"/><text x="240" y="120" font-family="sans-serif" font-size="26" text-anchor="middle" fill="#333">${title}</text><text x="240" y="170" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#555">${line}</text><text x="240" y="250" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#999">DEMO DOCUMENT · FICTIONAL</text></svg>`).toString("base64");

/** Wipes every table and loads the fictional demo world. */
export async function seed(sql: postgres.Sql) {
  const pw = hashPassword(DEMO_PASSWORD);
  const H = 3_600_000;
  const now = Date.now();
  const tomorrow = istDateKey(new Date(now + 24 * H));
  const at = (hoursFromNow: number) => new Date(now + hoursFromNow * H);

  await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5s'`; // fail fast rather than queue every live request behind the reset
    await tx`truncate audit_log, notifications, incidents, condition_reports, bookings, resource_requirements, resources,
             user_credentials, credential_types, profiles, departments, organizations restart identity cascade`;

    const [host] = await tx`insert into organizations (name, kind, email_domain) values ('Northfield Institute of Technology', 'HOST', 'nitf.demo') returning id`;
    const [rce] = await tx`insert into organizations (name, kind, email_domain) values ('Riverside College of Engineering', 'PARTNER_COLLEGE', 'rce.demo') returning id`;
    const [kin] = await tx`insert into organizations (name, kind, email_domain) values ('Kinetic Labs (incubated startup)', 'STARTUP', 'kineticlabs.demo') returning id`;

    const dept: Record<string, string> = {};
    for (const [code, name] of [["MECH", "Mechanical Makerspace"], ["ECE", "Electronics Lab"], ["CSE", "Computing Lab"], ["MEDIA", "Media Studio"]]) {
      const [d] = await tx`insert into departments (name, code) values (${name}, ${code}) returning id`;
      dept[code] = d.id;
    }

    const cred: Record<string, string> = {};
    for (const [key, name, description, days] of [
      ["LASER", "Laser Cutter Safety Induction", "90-minute supervised induction at the makerspace", 365],
      ["ELEC", "Electrical Safety Level 1", "Bench safety and ESD basics", 365],
      ["PRINT", "3D Printing Basics", "Slicing, bed levelling and filament handling", null],
      ["MEDIA", "Media Studio Orientation", "Camera handling and studio rules", 180],
    ] as const) {
      const [c] = await tx`insert into credential_types (name, description, validity_days) values (${name}, ${description}, ${days}) returning id`;
      cred[key] = c.id;
    }

    const person = async (email: string, full_name: string, role: string, org: string, d: string | null, extra: { identity_status?: string; team_code?: string; id_doc?: string } = {}) => {
      const [p] = await tx`insert into profiles (email, password_hash, full_name, role, org_id, department_id, identity_status, team_code, id_doc)
        values (${email}, ${pw}, ${full_name}, ${role}, ${org}, ${d}, ${extra.identity_status ?? "NOT_REQUIRED"}, ${extra.team_code ?? null}, ${extra.id_doc ?? null}) returning id`;
      return p.id as string;
    };
    const admin = await person("admin@nitf.demo", "Campus Admin", "admin", host.id, null);
    const kavita = await person("kavita@nitf.demo", "Dr. Kavita Rao", "owner", host.id, dept.MECH);
    const sana = await person("sana@nitf.demo", "Sana Iqbal", "manager", host.id, dept.MECH);
    const vikram = await person("vikram@nitf.demo", "Prof. Vikram Iyer", "owner", host.id, dept.ECE);
    const anil = await person("anil@nitf.demo", "Dr. Anil Kumar", "owner", host.id, dept.CSE);
    const neha = await person("neha@nitf.demo", "Neha Joshi", "owner", host.id, dept.MEDIA);
    const aarav = await person("aarav@nitf.demo", "Aarav Mehta", "user", host.id, dept.MECH);
    const rohan = await person("rohan@nitf.demo", "Rohan Das", "user", host.id, dept.CSE);
    await person("meera@rce.demo", "Meera Nair", "external", rce.id, null, { identity_status: "PENDING" });
    const priya = await person("priya@kineticlabs.demo", "Priya Shah", "external", kin.id, null, { identity_status: "VERIFIED", team_code: "KINETIC", id_doc: card("Kinetic Labs", "Incubation letter · Priya Shah") });
    void admin;

    const grant = (who: string, c: string, status = "VERIFIED", evidence: string | null = null) =>
      tx`insert into user_credentials (profile_id, credential_type_id, status, evidence, decided_by, decision_reason, decided_at, expires_at)
         values (${who}, ${c}, ${status}, ${evidence}, ${status === "VERIFIED" ? sana : null}, ${status === "VERIFIED" ? "Induction attendance confirmed" : null},
                 ${status === "VERIFIED" ? at(-24 * 30) : null}, ${status === "VERIFIED" ? at(24 * 300) : null})`;
    await grant(aarav, cred.LASER);
    await grant(aarav, cred.PRINT);
    await grant(aarav, cred.MEDIA);
    await grant(rohan, cred.PRINT);
    await grant(rohan, cred.ELEC);
    await grant(rohan, cred.MEDIA, "PENDING", card("Media Studio Orientation", "Certificate · Rohan Das · Sep 2026"));
    await grant(priya, cred.LASER);
    await grant(priya, cred.PRINT);

    const resource = async (r: Record<string, unknown>, creds: string[]) => {
      const [row] = await tx`insert into resources ${tx(r as never)} returning id, turnaround_min`;
      for (const c of creds) await tx`insert into resource_requirements (resource_id, credential_type_id) values (${row.id}, ${c})`;
      return row as { id: string; turnaround_min: number };
    };
    const laser = await resource({ department_id: dept.MECH, owner_id: kavita, name: "Laser Cutter (60 W CO₂)", category: "equipment", location: "Makerspace, Block C ground floor",
      description: "600×400 mm bed. Cuts acrylic, plywood and MDF up to 6 mm; engraves glass and leather.", usage_rules: "No PVC or vinyl. Never leave the machine while cutting. Bring your own material.",
      checklist: ["Lens clean", "Honeycomb bed clear", "Exhaust fan running", "Emergency stop tested"], open_from: "10:00", open_to: "17:00", max_duration_min: 120,
      requires_supervision: true, high_demand: true, max_hours_week: 4, cooldown_hours: 24 }, [cred.LASER]);
    const printerA = await resource({ department_id: dept.MECH, owner_id: kavita, name: "3D Printer A (FDM, 25 cm bed)", category: "equipment", location: "Makerspace, Block C ground floor",
      description: "PLA/PETG printer, 0.4 mm nozzle.", usage_rules: "PLA and PETG only. Remove your print and clean the bed.", checklist: ["Nozzle clean", "Build plate level", "Filament loaded"],
      open_from: "09:00", open_to: "18:00", max_duration_min: 240 }, [cred.PRINT]);
    await resource({ department_id: dept.MECH, owner_id: kavita, name: "3D Printer B (Resin)", category: "equipment", location: "Makerspace, Block C ground floor",
      description: "High-detail resin printer for small parts.", usage_rules: "Gloves and mask required. Dispose of resin in the marked bin.", checklist: ["Vat clean", "Build plate clean", "Gloves available"],
      open_from: "09:00", open_to: "18:00", max_duration_min: 240 }, [cred.PRINT]);
    const scope = await resource({ department_id: dept.ECE, owner_id: vikram, name: "Digital Oscilloscope (4-ch, 200 MHz)", category: "equipment", location: "Electronics Lab, Room 112",
      description: "Four-channel scope with logic analyser add-on.", usage_rules: "Use the ESD mat. Return both probes.", checklist: ["Probes intact (2)", "Screen clean", "Power cable present"],
      open_from: "09:00", open_to: "18:00" }, [cred.ELEC]);
    await resource({ department_id: dept.ECE, owner_id: vikram, name: "Seminar Room 204 (40 seats)", category: "space", location: "Academic Block, 2nd floor",
      description: "Projector, whiteboard, 40 chairs.", usage_rules: "Leave the room as you found it. No food.", checklist: ["Projector works", "Chairs arranged", "Whiteboard clean"],
      open_from: "08:00", open_to: "20:00", max_duration_min: 240, supervise_externals: false }, []);
    const gpu = await resource({ department_id: dept.CSE, owner_id: anil, name: "GPU Workstation (2× RTX)", category: "computing", location: "Computing Lab, Room 305",
      description: "Two GPUs, 128 GB RAM, for training and rendering.", usage_rules: "Log out and clear the scratch disk. No crypto mining.", checklist: ["Previous session logged out", "Scratch disk cleared"],
      open_from: "09:00", open_to: "21:00", max_duration_min: 240, high_demand: true, max_hours_week: 8, supervise_externals: false }, []);
    const camera = await resource({ department_id: dept.MEDIA, owner_id: neha, name: "DSLR Camera Kit", category: "media", location: "Media Studio desk, Library basement",
      description: "24 MP DSLR, 18–55 mm and 50 mm lenses, tripod.", usage_rules: "Carry in the padded bag. Report any drop immediately.", checklist: ["Body and lens free of scratches", "2 batteries charged", "SD card present", "Bag and strap"],
      open_from: "09:00", open_to: "18:00", max_duration_min: 240, deposit_note: "₹2,000 refundable deposit collected at the Media Studio desk" }, [cred.MEDIA]);
    await resource({ department_id: dept.MEDIA, owner_id: neha, name: "Podcast Booth", category: "space", location: "Media Studio, Library basement",
      description: "Sound-treated booth with two mics and an audio interface.", usage_rules: "No food or drinks inside.", checklist: ["Mics on stands", "Headphones present", "Booth tidy"],
      open_from: "09:00", open_to: "20:00", max_duration_min: 120 }, [cred.MEDIA]);

    const book = async (res: { id: string; turnaround_min: number }, user: string, start: Date, end: Date, purpose: Purpose, text: string, status: string, extra: { team?: string; reason?: string; score?: ReturnType<typeof fairShare> } = {}) => {
      const [b] = await tx`insert into bookings (resource_id, user_id, start_at, end_at, slot, purpose_category, purpose_text, team_code, status, decision_reason, score, score_breakdown, checked_out_at, returned_at, created_at)
        values (${res.id}, ${user}, ${start}, ${end}, tstzrange(${start}::timestamptz, ${end}::timestamptz + make_interval(mins => ${res.turnaround_min})),
                ${purpose}, ${text}, ${extra.team ?? null}, ${status}, ${extra.reason ?? null}, ${extra.score?.score ?? null}, ${extra.score ? tx.json(extra.score.breakdown as never) : null},
                ${["IN_USE", "RETURNED", "CLOSED"].includes(status) ? start : null}, ${["RETURNED", "CLOSED"].includes(status) ? end : null}, ${new Date(start.getTime() - 48 * H)}) returning id`;
      await tx`insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, reason, data)
               values (${user}, 'seed', 'booking.requested', 'booking', ${b.id}, 'Demo history', ${tx.json({ status } as never)})`;
      return b.id as string;
    };

    // Rohan's heavy GPU history (16 h in 3 weeks) and Aarav's past laser use.
    for (const d of [3, 8, 13, 18]) await book(gpu, rohan, at(-24 * d - 6), at(-24 * d - 2), "RESEARCH", "Training a segmentation model", "CLOSED");
    for (const d of [10, 20]) await book(laser, aarav, at(-24 * d - 5), at(-24 * d - 3), "COURSEWORK", "Design lab assignment", "CLOSED");
    const oldPrint = await book(printerA, rohan, at(-24 * 4 - 6), at(-24 * 4 - 3), "PROJECT", "Robot chassis brackets", "CLOSED");

    // Competing requests tomorrow: the owner sees both ranked by Fair-Share Score.
    const t = (hh: string) => istToDate(tomorrow, hh);
    await book(laser, aarav, t("11:00"), t("13:00"), "COURSEWORK", "Acrylic enclosure for design project", "PENDING_REVIEW", { score: fairShare({ purpose: "COURSEWORK", hoursUsed30d: 4, firstUse: false, noShows60d: 0 }) });
    await book(laser, priya, t("11:30"), t("13:00"), "PROJECT", "Drone frame prototype, plywood", "PENDING_REVIEW", { team: "KINETIC", score: fairShare({ purpose: "PROJECT", hoursUsed30d: 0, firstUse: true, noShows60d: 0 }) });
    await book(gpu, rohan, t("14:00"), t("18:00"), "RESEARCH", "Hyper-parameter sweep", "PENDING_REVIEW", { score: fairShare({ purpose: "RESEARCH", hoursUsed30d: 16, firstUse: false, noShows60d: 0 }) });
    await book(gpu, aarav, t("15:00"), t("17:00"), "SELF_LEARNING", "Learning Blender rendering", "PENDING_REVIEW", { score: fairShare({ purpose: "SELF_LEARNING", hoursUsed30d: 0, firstUse: true, noShows60d: 0 }) });

    // Camera out past its return time: the scheduler will flag it overdue.
    const cam = await book(camera, aarav, at(-5), at(-2), "PROJECT", "Club event photography", "IN_USE", { reason: "Approved" });
    await tx`insert into condition_reports (booking_id, phase, checklist, notes, recorded_by)
             values (${cam}, 'CHECKOUT', ${tx.json({ "Body and lens free of scratches": "ok", "2 batteries charged": "ok", "SD card present": "ok", "Bag and strap": "ok" } as never)}, 'All good at pickup', ${aarav})`;

    // Oscilloscope returned with a bent probe, waiting for inspection.
    const sc = await book(scope, rohan, at(-4), at(-1), "COURSEWORK", "Signals lab assignment 3", "RETURNED", { reason: "Approved" });
    await tx`insert into condition_reports (booking_id, phase, checklist, notes, recorded_by) values
      (${sc}, 'CHECKOUT', ${tx.json({ "Probes intact (2)": "ok", "Screen clean": "ok", "Power cable present": "ok" } as never)}, '', ${rohan}),
      (${sc}, 'RETURN', ${tx.json({ "Probes intact (2)": "issue", "Screen clean": "ok", "Power cable present": "ok" } as never)}, 'One probe tip is bent, it happened when the cable snagged', ${rohan})`;

    await tx`insert into incidents (booking_id, resource_id, reported_by, type, severity, description)
             values (${oldPrint}, ${printerA.id}, ${sana}, 'DAMAGE', 'LOW', 'Nozzle clogged after the print; needed a cold pull to clear.')`;
  });
}
