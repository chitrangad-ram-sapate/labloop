// This script truncates core LabLoop tables before loading fictional demo data.
if (process.env.ALLOW_DEMO_SEED !== "true" || process.env.DEMO_MODE !== "true") {
  console.error("Seed refused. It truncates core tables. Set DEMO_MODE=true and ALLOW_DEMO_SEED=true only for a fresh, disposable demo database.");
  process.exitCode = 1;
} else {
  const [{ sql }, { seed }] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/seed"),
  ]);

  try {
    await seed(sql);
    console.log("Demo data loaded.");
  } finally {
    await sql.end();
  }
}
