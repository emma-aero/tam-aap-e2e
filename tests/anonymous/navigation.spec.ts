import { expect, test } from "@playwright/test";

import { KNOWN_BUG } from "../../support/env";
import { expectNoServerErrors } from "../../support/ui";

test("landing page links every dataverse card to its list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Airport Acumen Dataverse" })).toBeVisible();
  const cards: Record<string, string> = {
    "Navigate Business glossary": "/dataverse/business-glossary",
    "Key Airport metrics": "/dataverse/airport-metrics",
    "Reports best practice": "/dataverse/airport-reports",
    "Explore the airport Data model": "/dataverse/data-model",
    "Navigate Data Quality Rules": "/dataverse/data-quality-rules",
  };
  for (const [text, href] of Object.entries(cards)) {
    await expect(page.locator(`a[href="${href}"]`).filter({ hasText: text }).first()).toBeVisible();
  }
});

test("the business glossary is public: list, search and detail", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/dataverse/business-glossary");
    await expect(page.getByRole("heading", { name: "Speak the language of the airport community" })).toBeVisible();
    const firstTitle = page.locator("h3").first();
    await expect(firstTitle).toBeVisible();
    const term = (await firstTitle.innerText()).trim();

    const searched = page.waitForResponse((r) => r.url().includes("/api/glossaries?") && r.url().includes("search="));
    await page.getByPlaceholder("Search Airport Glossary").fill(term);
    expect((await searched).status()).toBe(200);
    await expect(page.locator("h3").first()).toContainText(term.split(" ")[0]);

    await page.getByRole("link", { name: "Learn more" }).first().click();
    await expect(page).toHaveURL(/\/dataverse\/business-glossary\/[^/]+$/);
    await expect(page.getByRole("button", { name: "Main Page" })).toBeVisible();
  });
});

test("an unknown glossary id shows the not-found state, not a crash", async ({ page }) => {
  test.fail(true, KNOWN_BUG.glossaryNotFound);
  await page.goto("/dataverse/business-glossary/e2e-does-not-exist");
  await expect(page.getByText("Glossary Term Not Found")).toBeVisible();
});

for (const path of [
  "/dataverse/airport-metrics",
  "/dataverse/airport-reports",
  "/dataverse/datasets",
  "/dataverse/global-reference-datasets",
  "/dataverse/data-model",
  "/dataverse/data-quality-rules",
  "/dataverse/data-contracts",
]) {
  test(`${path} shows "Access Restricted" to anonymous visitors`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible();
  });
}

test("profile settings require login", async ({ page }) => {
  await page.goto("/profile-settings");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fprofile-settings/);
});

test("airport community lists the committees", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/airport-community");
    await expect(page.getByRole("heading", { name: "Our Committees" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Learn more/ }).first()).toBeVisible();
  });
});

test("TAM pages render", async ({ page }) => {
  await page.goto("/tam/definition");
  await expect(page.getByRole("heading", { name: /From Fragmented Operations/ })).toBeVisible();
  await page.goto("/tam/use-cases");
  await expect(page.getByRole("heading", { name: "TAM Use Cases" })).toBeVisible();
  await page.goto("/tam/use-cases/passenger-flow");
  await expect(page.getByRole("heading", { name: "Passenger Flows Overview" })).toBeVisible();
});

test("terms page switches tabs", async ({ page }) => {
  await page.goto("/terms");
  await page.getByRole("tab", { name: "Privacy policy" }).click();
  await expect(page.getByRole("tab", { name: "Privacy policy" })).toHaveAttribute("aria-selected", "true");
});

test("submitted requests: anonymous visitors see the list but must log in for My Requests", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/submitted-requests");
    await expect(page.getByRole("heading", { name: "Submitted Requests" })).toBeVisible();
    await expect(page.getByText("Request Summary")).toBeVisible();
  });
});

test("verify-email with a bogus token fails cleanly", async ({ page }) => {
  await page.goto("/verify-email?token=e2e-bogus-token");
  await expect(page.getByText("Verification Failed")).toBeVisible();
});

test("reset-password without a token explains the link is invalid", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText("Invalid Reset Link")).toBeVisible();
});

test("registration step 1 shows the form", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Sign up for Airport Acumen Portal" })).toBeVisible();
  await expect(page.getByText("Personal Information").first()).toBeVisible();
});
