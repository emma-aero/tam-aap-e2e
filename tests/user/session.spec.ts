import { expect, test } from "@playwright/test";

import { credentials } from "../../support/env";

test("the header shows the logged-in user instead of 'Log in'", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
});

test("the session endpoint returns the user's token", async ({ page }) => {
  await page.goto("/");
  const res = await page.request.get("/api/auth/session");
  expect(res.status()).toBe(200);
  const session = await res.json();
  expect(JSON.stringify(session)).toContain(credentials("user").email.split("@")[0]);
});

test("profile settings show the user's email", async ({ page }) => {
  await page.goto("/profile-settings");
  await expect(page.getByText(credentials("user").email).first()).toBeVisible();
  for (const card of ["Personal Information", "Professional Information"]) {
    await expect(page.getByRole("heading", { name: card })).toBeVisible();
  }
});

test("submitted requests: My Requests tab works for a logged-in user", async ({ page }) => {
  await page.goto("/submitted-requests?tab=my");
  await expect(page.getByRole("heading", { name: "Submitted Requests" })).toBeVisible();
  await expect(page.getByText("Log in to view your requests")).toHaveCount(0);
});
