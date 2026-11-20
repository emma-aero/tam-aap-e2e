/** Logout with a separate, fresh session (logout revokes that session's refresh token). */
import { expect, test } from "@playwright/test";

import { credentials } from "../../support/env";
import { loginThroughForm } from "../../support/ui";

test.use({ storageState: { cookies: [], origins: [] } });

test("log in and log out through the avatar menu", async ({ page }) => {
  const { email, password } = credentials("user");
  await loginThroughForm(page, email, password);
  const avatar = page.locator("header").getByRole("button", { name: /^(?!TAM$)[A-Z]{1,3}$/ }) // initials, not the "TAM" menu;
  await expect(avatar).toBeVisible();
  await avatar.click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session?.user ?? null).toBeNull();
});
