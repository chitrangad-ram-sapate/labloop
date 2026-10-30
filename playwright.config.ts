import { defineConfig } from "@playwright/test";

// Runs against a running app: BASE_URL=https://… npx playwright test (defaults to local dev).
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
});
