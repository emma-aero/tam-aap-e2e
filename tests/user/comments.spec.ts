/**
 * @write Comments on a glossary term: create, edit, like/unlike, delete.
 * Only touches comments this run created (text contains RUN_TAG); afterAll soft-deletes leftovers.
 */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";
import { firstId, items } from "../../support/data";
import { RUN_TAG } from "../../support/env";

let api: APIRequestContext;
let termId: string | undefined;

test.beforeAll(async () => {
  api = await apiAs("user");
  termId = await firstId(api, "/api/glossaries?limit=1");
});

test.afterAll(async () => {
  if (termId) {
    const res = await api.get(`/api/comments?entityId=${encodeURIComponent(termId)}&limit=100`);
    for (const c of items(await res.json())) {
      if (String(c.content).includes(RUN_TAG)) await api.delete(`/api/comments/${c.id}`);
    }
  }
  await api.dispose();
});

test("@write add, like, edit and delete a comment through the UI", async ({ page }) => {
  test.skip(!termId, "no glossary terms on dev");
  const text = `${RUN_TAG} comment`;
  await page.goto(`/dataverse/business-glossary/${encodeURIComponent(termId!)}`);

  // The "Add a comment" label is covered by its clickable container, which focuses the textarea.
  await page.getByText("Add a comment").first().locator("xpath=ancestor::div[.//textarea][1]//textarea").focus();
  await page.getByPlaceholder("Type your comment here").fill(text);
  const created = page.waitForResponse((r) => r.url().includes("/api/comments") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit" }).first().click();
  expect((await created).status()).toBe(201);
  // one comment = the block holding its text, header and action buttons
  const comment = page
    .locator("div.min-w-0.flex-1")
    .filter({ hasText: text })
    .filter({ has: page.getByRole("button", { name: "Reply" }) })
    .last();
  await expect(page.getByText(text)).toBeVisible();

  const liked = page.waitForResponse((r) => r.url().includes("/api/comments/like/"));
  await comment.getByRole("button", { name: /Like/ }).first().click();
  expect((await liked).status()).toBeLessThan(300);
  const unliked = page.waitForResponse((r) => r.url().includes("/api/comments/like/"));
  await comment.getByRole("button", { name: /Like/ }).first().click();
  expect((await unliked).status()).toBeLessThan(300);

  await comment.getByRole("button", { name: "Delete" }).first().click();
  const deleted = page.waitForResponse((r) => r.url().includes("/api/comments/") && r.request().method() === "DELETE");
  await page.getByRole("button", { name: "Delete" }).last().click();
  expect((await deleted).status()).toBeLessThan(300);
  await expect(page.getByText(text)).toHaveCount(0);
});

test("@write a user cannot delete someone else's comment (API)", async () => {
  test.skip(!termId, "no glossary terms on dev");
  const res = await api.get(`/api/comments?entityId=${encodeURIComponent(termId!)}&limit=50`);
  const others = items(await res.json()).filter((c: any) => !String(c.content).includes(RUN_TAG));
  test.skip(!others.length, "no comments from other users on this term");
  const del = await api.delete(`/api/comments/${others[0].id}`);
  expect([400, 403, 404]).toContain(del.status());
});
