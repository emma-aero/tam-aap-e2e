/**
 * @write Reviewing as a requests:admin. A normal user submits a request (no domains: no
 * committee email); the admin reviews it in the UI. Approval writes to DataHub, so it only
 * runs with E2E_ALLOW_DATAHUB_WRITES=1 and is cleaned up with an approved delete request.
 */
import { APIRequestContext, expect, test } from "@playwright/test";

import { apiAs } from "../../support/api";
import { createTestRequest, deleteRequest, deleteRunRequests } from "../../support/data";
import { ALLOW_DATAHUB_WRITES, RUN_TAG } from "../../support/env";

let user: APIRequestContext;
let admin: APIRequestContext;
test.beforeAll(async () => {
  user = await apiAs("user");
  admin = await apiAs("admin");
});
test.afterAll(async () => {
  await deleteRunRequests(admin);
  await Promise.all([user.dispose(), admin.dispose()]);
});

test("@write the admin sees the review tab and rejects a request through the UI", async ({ page }) => {
  const req = await createTestRequest(user, "to-reject");
  try {
    await page.goto("/submitted-requests");
    await expect(page.getByRole("button", { name: "For My Review" })).toBeVisible();

    await page.goto(`/submitted-requests/${req.id}`);
    await expect(page.getByRole("heading", { name: /Add Request Pending/ })).toBeVisible();
    await page.getByRole("button", { name: "Reject" }).click();
    await page.getByLabel("Add comment").fill(`${RUN_TAG} rejected by e2e`);
    const put = page.waitForResponse((r) => r.url().includes(`/api/requests/${req.id}`) && r.request().method() === "PUT");
    await page.getByRole("button", { name: "Reject Request" }).click();
    expect((await put).status()).toBe(200);
    await expect(page.getByText("Request rejected").first()).toBeVisible();

    const after = await (await admin.get(`/api/requests/${req.id}`)).json();
    expect((after.data ?? after).status).toBe("rejected");
  } finally {
    await deleteRequest(admin, req.id);
  }
});

test("@write approve a create request, see the term in the glossary, then remove it again", async ({ page }) => {
  test.skip(!ALLOW_DATAHUB_WRITES, "set E2E_ALLOW_DATAHUB_WRITES=1: approval writes to dev DataHub");
  const req = await createTestRequest(user, "to-approve");
  let createdTermId: string | undefined;
  try {
    await page.goto(`/submitted-requests/${req.id}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByLabel("Add comment").fill(`${RUN_TAG} approved by e2e`);
    const put = page.waitForResponse((r) => r.url().includes(`/api/requests/${req.id}`) && r.request().method() === "PUT");
    await page.getByRole("button", { name: "Approve Request" }).click();
    expect((await put).status()).toBe(200);

    const approved = await (await admin.get(`/api/requests/${req.id}`)).json();
    createdTermId = (approved.data ?? approved).dataverseId;
    expect(createdTermId).toBeTruthy();
    expect((await admin.get(`/api/glossaries/${encodeURIComponent(createdTermId!)}`)).status()).toBe(200);
  } finally {
    if (createdTermId) {
      const del = await user.post("/api/requests", {
        data: { action: "delete", dataverseType: "glossaries", dataverseId: createdTermId, dataverseRequestDetails: {}, requesterComment: `${RUN_TAG} cleanup` },
      });
      const delReq = (await del.json()).data ?? (await del.json());
      await admin.put(`/api/requests/${delReq.id}`, { data: { status: "approved", reviewerComment: `${RUN_TAG} cleanup` } });
      expect((await admin.get(`/api/glossaries/${encodeURIComponent(createdTermId)}`)).status()).toBe(404);
      await deleteRequest(admin, delReq.id);
    }
    await deleteRequest(admin, req.id);
  }
});
