/** @write Profile edit through the API, verified via the API and in the UI, then reverted. */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";
import { KNOWN_BUG, RUN_TAG, storageStatePath } from "../../support/env";

let api: APIRequestContext;
let userId: string;
let original: Record<string, string | undefined> = {};

async function readProfile() {
  const me = await (await api.get(`/api/users/${userId}`)).json();
  return me.data ?? me;
}

test.beforeAll(async ({ browser }) => {
  api = await apiAs("user");
  const page = await browser.newPage({ storageState: storageStatePath("user") });
  const session = await (await page.request.get("/api/auth/session")).json();
  await page.close();
  userId = session?.user?.id ?? session?.userId ?? session?.user?.sub;
  const u = await readProfile();
  original = { jobTitle: u.jobTitle, employerType: u.employerType, employerName: u.employerName, domain: u.domain,
    employerTypeOther: u.employerTypeOther, employerNameOther: u.employerNameOther };
});

test.afterAll(async () => {
  if (original.jobTitle !== undefined) await api.put("/api/users/profile", { data: original });
  await api.dispose();
});

test("@write a job title change is saved and can be reverted (API)", async () => {
  const jobTitle = `${RUN_TAG} QA`;
  const res = await api.put("/api/users/profile", { data: { ...original, jobTitle } });
  expect(res.status(), await res.text()).toBe(200);
  expect((await readProfile()).jobTitle).toBe(jobTitle);
  await api.put("/api/users/profile", { data: original });
  expect((await readProfile()).jobTitle).toBe(original.jobTitle);
});

test("profile settings show the user's saved values in the form", async ({ page }) => {
  test.fail(true, KNOWN_BUG.profileFormEmpty);
  await page.goto("/profile-settings");
  await expect(page.getByPlaceholder("Senior Airport Operations Manager")).toHaveValue(original.jobTitle ?? "");
  await expect(page.getByPlaceholder("Mohammad")).not.toHaveValue("");
});
