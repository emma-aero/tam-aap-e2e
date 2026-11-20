/** Registration form validation in the UI (step 1). Nothing is submitted to /register. */
import { expect, test } from "@playwright/test";

test("step 1 blocks an empty form and a mismatched password confirmation", async ({ page }) => {
  let registerCalled = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/register") && r.method() === "POST") registerCalled = true;
  });
  await page.goto("/register");
  // The form is rendered twice (desktop + mobile layouts); act on the visible one.
  const visible = (sel: string) => page.locator(sel).locator("visible=true").first();
  const cont = page.getByRole("button", { name: "Continue" }).locator("visible=true").first();
  await cont.click();
  await expect(page.getByText(/required/i).locator("visible=true").first()).toBeVisible();

  await visible("#password").fill("E2e-Valid-Password-123!");
  await visible("#confirm-password").fill("E2e-Different-123!");
  await cont.click();
  await expect(page.getByText(/match/i).locator("visible=true").first()).toBeVisible();
  await expect(page.getByText("Employment Information").first()).toBeVisible(); // still the step indicator
  expect(registerCalled).toBe(false);
});
