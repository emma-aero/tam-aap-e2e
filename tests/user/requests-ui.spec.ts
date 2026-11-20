/**
 * @write Edit and delete requests proposed from an item's Edit tab. Uses a glossary term in
 * the "Operations" domain (no committee on dev, so only the requester is emailed). The
 * requests are deleted again; the item itself is never changed (nothing is approved).
 */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";
import { deleteRequest, items } from "../../support/data";
import { RUN_TAG } from "../../support/env";

let api: APIRequestContext;
let termId: string | undefined;

test.beforeAll(async () => {
  api = await apiAs("user");
  const list = items(await (await api.get("/api/glossaries?limit=50")).json());
  const committeeDomains = /Flight Operations|Terminal/;
  termId = list.find((g: any) => !committeeDomains.test(JSON.stringify(g.domains ?? g.domain ?? "")))?.id;
});
test.afterAll(async () => api.dispose());

test("@write propose an edit from the Edit tab, then withdraw it", async ({ page }) => {
  test.skip(!termId, "no glossary term outside committee domains on dev");
  await page.goto(`/dataverse/business-glossary/${termId}?view=edit`);
  await expect(page.getByRole("button", { name: "Request edit" })).toBeDisabled();
  const synonyms = page.getByPlaceholder("Enter synonyms");
  await synonyms.fill(`${await synonyms.inputValue()} ${RUN_TAG}`.trim());
  await page.getByPlaceholder("Add context for reviewers").fill(`${RUN_TAG} automated edit request`);
  await page.getByRole("button", { name: "Request edit" }).click();
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  const res = await posted;
  expect(res.status()).toBe(201);
  const req = (await res.json()).data ?? (await res.json());
  try {
    expect(req.action).toBe("update");
    await expect(page.getByText("Edits submitted successfully")).toBeVisible();
  } finally {
    await deleteRequest(api, req.id);
  }
});

test("@write propose a deletion with a reason, then withdraw it", async ({ page }) => {
  test.skip(!termId, "no glossary term outside committee domains on dev");
  await page.goto(`/dataverse/business-glossary/${termId}?view=edit`);
  await page.getByRole("button", { name: "Request delete" }).click();
  await page.getByLabel("Reason").fill(`${RUN_TAG} automated delete request (withdrawn)`);
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit request" }).click();
  const res = await posted;
  expect(res.status()).toBe(201);
  const req = (await res.json()).data ?? (await res.json());
  try {
    expect(req.action).toBe("delete");
    await expect(page.getByText("Delete request submitted")).toBeVisible();
  } finally {
    await deleteRequest(api, req.id);
  }
  // the term itself is untouched
  expect((await api.get(`/api/glossaries/${termId}`)).status()).toBe(200);
});
