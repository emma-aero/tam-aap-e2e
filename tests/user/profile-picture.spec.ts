/** @write Upload a small profile picture through the UI, then remove it (API). */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await apiAs("user");
});
test.afterAll(async () => {
  await api.put("/api/users/profile", { data: { profileImage: {} } });
  await api.dispose();
});

test("@write upload a profile picture", async ({ page }) => {
  // a small JPEG made on the fly (well under the 2MB limit and the proxy's 1MB body limit)
  await page.setContent('<div style="width:200px;height:200px;background:linear-gradient(#2a6,#26a)"></div>');
  const jpeg = await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y: 0, width: 200, height: 200 } });

  await page.goto("/profile-settings");
  await page.getByRole("button", { name: "Upload profile picture" }).first().click();
  await expect(page.getByRole("heading", { name: "Upload Profile Picture" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "e2e.jpg", mimeType: "image/jpeg", buffer: jpeg });
  const put = page.waitForResponse((r) => r.url().includes("/api/users/profile") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Upload picture" }).click();
  expect((await put).status()).toBe(200);
});
