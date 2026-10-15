import { test, expect } from "@playwright/test";
import { authenticator } from "otplib";
import { readFileSync } from "node:fs";

const PUBLIC_PAGES = ["/", "/about", "/sessions", "/couples", "/programmes", "/return-to-wonder", "/events", "/book", "/testimonials", "/faq", "/contact", "/privacy", "/terms", "/cancellation-policy", "/portal"];

test("every public page renders with a heading and no server error", async ({ page }) => {
  for (const p of PUBLIC_PAGES) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBe(200);
    await expect(page.locator("h1").first(), p).toBeVisible();
  }
});

test("homepage hero and CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/next chapter begins within/i);
  await expect(page.getByRole("link", { name: "Book Your Complimentary Discovery Call" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore Healing Experiences" })).toBeVisible();
  await page.screenshot({ path: "e2e-artifacts/home.png", fullPage: true });
});

test("visitor books a complimentary discovery call", async ({ page }) => {
  await page.goto("/book?service=discovery-call");
  const slot = page.locator("fieldset button").first();
  await expect(slot).toBeVisible({ timeout: 20_000 });
  await slot.click();
  await page.getByLabel("Name").fill("E2E Visitor (test)");
  await page.getByLabel("Email").fill("e2e-visitor@example.test");
  await page.getByRole("checkbox", { name: /agree to the terms/ }).check();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("You're booked")).toBeVisible();
});

test("visitor pays for a session through the (mock) hosted checkout", async ({ page }) => {
  await page.goto("/book?service=signature-private-session");
  const slot = page.locator("fieldset button").nth(3);
  await expect(slot).toBeVisible({ timeout: 20_000 });
  await slot.click();
  await page.getByLabel("Name").fill("E2E Payer (test)");
  await page.getByLabel("Email").fill("e2e-payer@example.test");
  await page.getByRole("checkbox", { name: /agree to the terms/ }).check();
  await page.getByRole("button", { name: /Continue to secure payment/ }).click();
  await expect(page.getByText("Not a real payment")).toBeVisible();
  await page.getByRole("button", { name: "Simulate successful test payment" }).click();
  await expect(page).toHaveURL(/thank-you/);
});

test("contact form + AI assistant identifies itself", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await page.getByLabel("Your name").fill("E2E Enquirer (test)");
  await page.getByLabel("Email", { exact: true }).fill("e2e-enquiry@example.test");
  await page.getByLabel("Your message").fill("I'd love to know more about Return to Wonder.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thank you")).toBeVisible();
  await page.getByRole("button", { name: /Chat with our AI assistant/ }).click();
  await page.locator("#chat-input").fill("How much is the signature session?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/AI assistant \(not Felicia\)/)).toBeVisible();
});

async function signIn(page: import("@playwright/test").Page) {
  const url = readFileSync("e2e-artifacts/admin.txt", "utf8").match(/otpauth:\/\/\S+/)![0];
  const secret = new URL(url).searchParams.get("secret")!;
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await page.getByLabel("Email").fill("e2e-owner@example.test");
  await page.getByLabel("Password").fill("e2e-owner-password-long");
  // A fresh code each attempt; wait out the window if this code was just used by another test.
  await page.getByLabel(/Authenticator code/).fill(authenticator.generate(secret));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("Felicia creates an event, a visitor registers and pays, and appears on the list", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/events");
  const title = `Breath & Stillness Morning (e2e ${Date.now()})`;
  await page.locator("#new-title").fill(title);
  await page.locator("#new-description").fill("A gentle morning of guided breath and reflection. (Test event.)");
  await page.locator("#new-location").fill("Bath, UK (test venue)");
  const d = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  await page.locator("#new-starts").fill(`${d}T10:00`);
  await page.locator("#new-ends").fill(`${d}T13:00`);
  await page.locator("#new-capacity").fill("8");
  await page.locator("#new-price").fill("111");
  await page.locator("#new-status").selectOption("open");
  await page.locator("#new-breathwork").check();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const eventPath = new URL(page.url()).pathname.replace("/admin", "");

  const visitor = await page.context().browser()!.newPage();
  await visitor.goto("/events");
  await visitor.getByRole("link", { name: "Details & booking" }).first().click();
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(visitor.getByText("This event includes breathwork")).toBeVisible();
  await visitor.screenshot({ path: "e2e-artifacts/event-page.png", fullPage: true });
  await expect(visitor.getByRole("button", { name: /Continue to secure payment/ })).toBeEnabled();
  await visitor.locator("#reg-name").fill("E2E Attendee (test)");
  await visitor.locator("#reg-email").fill("e2e-attendee@example.test");
  await visitor.locator("#reg-health").check();
  await visitor.locator("#reg-terms").check();
  await visitor.getByRole("button", { name: /Continue to secure payment/ }).click();
  await expect(visitor.getByText("Not a real payment")).toBeVisible();
  await visitor.getByRole("button", { name: "Simulate successful test payment" }).click();
  await expect(visitor).toHaveURL(/thank-you/);
  await visitor.close();

  await page.goto(`/admin${eventPath}`);
  await expect(page.getByRole("cell", { name: "E2E Attendee (test)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "confirmed" })).toBeVisible();
  await page.screenshot({ path: "e2e-artifacts/admin-event.png", fullPage: true });
});

test("admin requires sign-in with MFA and shows the Command Center", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/login/);
  const url = readFileSync("e2e-artifacts/admin.txt", "utf8").match(/otpauth:\/\/\S+/)![0];
  const secret = new URL(url).searchParams.get("secret")!;
  await page.getByLabel("Email").fill("e2e-owner@example.test");
  await page.getByLabel("Password").fill("e2e-owner-password-long");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/6-digit code/)).toBeVisible();
  await page.getByLabel(/Authenticator code/).fill(authenticator.generate(secret));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible();
  await expect(page.getByText(/not connected — using mock/).first()).toBeVisible();
  await page.screenshot({ path: "e2e-artifacts/command-center.png", fullPage: true });
  for (const p of ["/admin/approvals", "/admin/clients", "/admin/finance", "/admin/content", "/admin/services", "/admin/knowledge", "/admin/agents", "/admin/audit"]) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBe(200);
  }
  await page.goto("/admin/clients");
  await expect(page.getByText("E2E Payer (test)")).toBeVisible();
  await page.goto("/admin/finance");
  await page.screenshot({ path: "e2e-artifacts/finance.png", fullPage: true });
  await page.goto("/admin/analytics?days=7");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  // Earlier tests browsed the public site, so cookieless page views were recorded.
  await expect(page.getByRole("cell", { name: "/sessions", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "/" }).first()).toBeVisible();
  await page.screenshot({ path: "e2e-artifacts/analytics.png", fullPage: true });
});
