/**
 * @write Request lifecycle as a normal user. Requests are created WITHOUT domains so no
 * committee member is emailed (the test user still gets a confirmation), and are deleted again.
 */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";
import { createTestRequest, deleteRequest, deleteRunRequests } from "../../support/data";
import { ALLOW_EMAIL_TO_COMMITTEES, RUN_TAG } from "../../support/env";

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await apiAs("user");
});
test.afterAll(async () => {
  await deleteRunRequests(api);
  await api.dispose();
});

test("@write a submitted request is pending, listed under My Requests, and deletable by its owner", async ({ page }) => {
  const req = await createTestRequest(api, "lifecycle");
  try {
    expect(req.status).toBe("pending");

    await page.goto("/submitted-requests?tab=my");
    const searched = page.waitForResponse((r) => r.url().includes("/api/requests?") && r.url().includes("search="));
    await page.getByPlaceholder("Search...").fill(RUN_TAG);
    await searched;
    await expect(page.getByText(`${RUN_TAG} lifecycle`).first()).toBeVisible();

    await page.goto(`/submitted-requests/${req.id}`);
    await expect(page.getByRole("heading", { name: /Add Request Pending/ })).toBeVisible();
    // a normal user (no requests:admin, no committee) cannot approve
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  } finally {
    await deleteRequest(api, req.id);
  }
  expect((await api.get(`/api/requests/${req.id}`)).status()).toBe(404);
});

test("@write a normal user cannot approve their own request (API)", async () => {
  const req = await createTestRequest(api, "self-approve");
  try {
    const res = await api.put(`/api/requests/${req.id}`, { data: { status: "approved", reviewerComment: "e2e" } });
    expect([401, 403]).toContain(res.status());
    expect((await (await api.get(`/api/requests/${req.id}`)).json()).status ?? "pending").toBe("pending");
  } finally {
    await deleteRequest(api, req.id);
  }
});

test("@write create a glossary item through the UI form (emails the domain committee)", async ({ page }) => {
  test.skip(!ALLOW_EMAIL_TO_COMMITTEES, "set E2E_ALLOW_COMMITTEE_EMAILS=1: the form requires a domain, so committee members get an email");
  await page.goto("/dataverse/business-glossary/create");
  await page.getByPlaceholder("Enter item name").fill(`${RUN_TAG} ui item`);
  await page.getByPlaceholder("Enter item definition").fill("Created by the automated e2e suite.");
  await page.getByText("Select domains").first().click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Submit item" }).click();
  const created = page.waitForResponse((r) => r.url().endsWith("/api/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByText("New glossary item submitted successfully")).toBeVisible();
});
