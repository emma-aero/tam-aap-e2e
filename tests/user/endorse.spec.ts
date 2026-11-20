/**
 * @write Endorsing an item. A like only counts when the user's employer is a known endorser,
 * so the test user's employer is switched to one temporarily and restored afterwards.
 */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";
import { firstId, items } from "../../support/data";
import { storageStatePath } from "../../support/env";

let api: APIRequestContext;
let userId: string;
let original: Record<string, unknown> = {};
let endorser: string | undefined;
let termId: string | undefined;

test.beforeAll(async ({ browser }) => {
  api = await apiAs("user");
  const page = await browser.newPage({ storageState: storageStatePath("user") });
  const session = await (await page.request.get("/api/auth/session")).json();
  await page.close();
  userId = session?.user?.id ?? session?.userId ?? session?.user?.sub;
  const u = (await (await api.get(`/api/users/${userId}`)).json());
  const me = u.data ?? u;
  original = { employerType: me.employerType, employerTypeOther: me.employerTypeOther, employerName: me.employerName,
    employerNameOther: me.employerNameOther, jobTitle: me.jobTitle, domain: me.domain };
  endorser = items(await (await api.get("/api/endorsers")).json()).map((e: any) => e.name).find(Boolean);
  termId = await firstId(api, "/api/glossaries?limit=1");
});

test.afterAll(async () => {
  if (termId) await api.delete(`/api/dataverse/${encodeURIComponent(termId)}/like`);
  await api.put("/api/users/profile", { data: original });
  await api.dispose();
});

test("@write endorse an item as a member of an endorsing employer, then remove it", async ({ page }) => {
  test.skip(!endorser || !termId, "no endorsers or glossary terms on dev");
  const set = await api.put("/api/users/profile", { data: { ...original, employerName: "Others", employerNameOther: endorser } });
  expect(set.status(), await set.text()).toBe(200);

  await page.goto(`/dataverse/business-glossary/${encodeURIComponent(termId!)}`);
  const liked = page.waitForResponse((r) => r.url().includes("/like") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Endorse", exact: true }).click();
  expect((await liked).status()).toBeLessThan(300);
  await expect(page.getByRole("button", { name: /Endorsed/ })).toBeVisible();

  const unliked = page.waitForResponse((r) => r.url().includes("/like") && r.request().method() === "DELETE");
  await page.getByRole("button", { name: /Endorsed/ }).click();
  expect((await unliked).status()).toBeLessThan(300);
  await expect(page.getByRole("button", { name: "Endorse", exact: true })).toBeVisible();
});
