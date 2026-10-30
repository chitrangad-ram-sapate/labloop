import { expect, test, type Page } from "@playwright/test";

// The full judge journey from IMPLEMENTATION_PLAN §11. Run `npm run seed` first.
const PNG = { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64") };
const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function as(page: Page, label: string) {
  await page.goto("/login");
  if (await page.getByRole("button", { name: "Sign out" }).isVisible()) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
  }
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function photo(page: Page, label: RegExp) {
  await page.waitForLoadState("networkidle"); // the picker only works once the page is hydrated
  await page.getByLabel(label).setInputFiles(PNG);
  await expect(page.getByAltText(/preview/).last()).toBeVisible();
}

test("listing → eligibility → request → approval → check-out → return → incident → history", async ({ page }) => {
  // 1. Owner lists a resource with conditions.
  await as(page, "Owner");
  await page.goto("/resources/new");
  await page.getByLabel("Name").fill("Soldering Station");
  await page.getByLabel("Location").fill("Makerspace bench 4");
  await page.getByLabel(/Condition checklist/).fill("Iron tip clean\nFume extractor works");
  await page.getByLabel("Electrical Safety Level 1").check();
  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page.getByRole("heading", { name: "Soldering Station" })).toBeVisible();
  const resourceUrl = page.url();

  // 2. External user discovers it and sees exactly what is missing.
  await as(page, "External student");
  await page.getByPlaceholder(/I need to/).fill("I need to solder a sensor board");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "Soldering Station" }).click();
  await expect(page.getByText("Your ID has not been verified yet.")).toBeVisible();
  await expect(page.getByText(/Missing “Electrical Safety Level 1”/)).toBeVisible();
  await page.goto("/me");
  await photo(page, /College ID or incubator letter/);
  await page.getByRole("button", { name: "Upload ID" }).click();
  await expect(page.getByText("Uploaded. A lab manager will verify it.")).toBeVisible();
  await page.getByLabel("Credential").selectOption({ label: "Electrical Safety Level 1 — Bench safety and ESD basics" });
  await photo(page, /Certificate photo/);
  await page.getByRole("button", { name: "Upload for verification" }).click();
  await expect(page.getByText("Uploaded. A lab manager will verify it.").last()).toBeVisible();

  // 3. Manager verifies identity and credential.
  await as(page, "Manager");
  await page.goto("/manage");
  await page.getByRole("button", { name: "Verify identity" }).first().click();
  await expect(page.getByText("Decision recorded.").first()).toBeVisible();
  await page.reload();
  const cert = page.locator("div.grid", { hasText: "Electrical Safety Level 1 for Meera Nair" });
  await cert.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("Decision recorded.").first()).toBeVisible();

  // 4. User is now eligible and requests a slot.
  await as(page, "External student");
  await page.goto(resourceUrl);
  await page.getByLabel("Date", { exact: true }).fill(tomorrow);
  await page.getByLabel("From", { exact: true }).fill("10:00");
  await page.getByLabel("To", { exact: true }).fill("12:00");
  await page.getByLabel("What will you do?").fill("Solder the air-quality sensor board for my final-year project");
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.waitForURL("**/bookings/**");
  await expect(page.getByText("pending review", { exact: true })).toBeVisible();
  const bookingUrl = page.url();

  // 5–6. Owner reviews and approves with a reason.
  await as(page, "Owner");
  await page.goto(bookingUrl);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Approved\./)).toBeVisible();

  // 7. Supervised: the user cannot self-check-out; the manager confirms in person.
  await as(page, "External student");
  await page.goto(bookingUrl);
  await expect(page.getByText(/This resource is supervised/)).toBeVisible();
  await as(page, "Manager");
  await page.goto(bookingUrl);
  await photo(page, /Photo of the item now/);
  await page.getByRole("button", { name: "Confirm check-out" }).click();
  await expect(page.getByText(/Checked out\./)).toBeVisible();

  // 8. Return with a reported issue.
  await as(page, "External student");
  await page.goto(bookingUrl);
  await page.getByRole("radio", { name: "Issue" }).first().check();
  await photo(page, /Photo of the item now/);
  await page.getByLabel(/Notes \(anything that changed/).fill("Tip looks pitted");
  await page.getByRole("button", { name: "Confirm return" }).click();
  await expect(page.getByText(/Returned\./)).toBeVisible();

  // 9. Manager sees before/after, opens an incident and resolves it (human decision).
  await as(page, "Manager");
  await page.goto(bookingUrl);
  await expect(page.getByText("← new issue")).toBeVisible();
  await page.getByPlaceholder("What is wrong?").fill("Iron tip pitted, needs replacing");
  await page.getByRole("button", { name: "Open an incident" }).click();
  await expect(page.getByText("Incident opened for review.")).toBeVisible();
  await page.getByLabel("Resolution").fill("Tip replaced from spares; normal wear");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("Incident resolved.")).toBeVisible();

  // 10. Both parties see the complete history.
  await as(page, "External student");
  await page.goto(bookingUrl);
  for (const step of ["requested", "approved", "in use", "returned", "disputed", "closed"])
    await expect(page.locator("ol").getByText(step, { exact: true })).toBeVisible();
});

test("competing requests: approving one waitlists the other with a reason", async ({ page }) => {
  await as(page, "Owner");
  await page.goto("/manage");
  await page.getByRole("link", { name: /Laser Cutter.*Aarav Mehta/ }).click();
  await expect(page.getByText(/Overlapping bookings and requests/)).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Any overlapping requests were waitlisted/)).toBeVisible();
  await as(page, "Startup founder");
  await page.goto("/bookings");
  await expect(page.getByText(/This time was given to another request/)).toBeVisible();
});

test("admin: the overdue camera is flagged and the audit chain verifies", async ({ page }) => {
  await as(page, "Admin");
  await page.goto("/admin");
  await page.getByRole("button", { name: "Run scheduler now" }).click();
  await expect(page.getByText(/Scheduler ran: \d+ overdue/)).toBeVisible();
  // The background scheduler may have flagged it already; either way it must be overdue now.
  await page.goto("/bookings/" + (await page.locator("a", { hasText: "booking.overdue" }).first().getAttribute("href"))?.split("/").pop());
  await expect(page.getByText(/Overdue: this was due back/)).toBeVisible();
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByText(/Audit chain intact/)).toBeVisible();
});
