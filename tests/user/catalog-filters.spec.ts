/** Filters, pagination and secondary navigation as a logged-in user. Read-only. */
import { expect, test } from "@playwright/test";

import { expectNoServerErrors } from "../../support/ui";

test("domain sidebar filters the list by domain", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/dataverse/airport-metrics");
    const call = page.waitForResponse((r) => r.url().includes("/api/metrics?") && r.url().includes("domain=Airfield"));
    await page.getByRole("button", { name: /^Airfield/ }).first().click();
    expect((await call).status()).toBe(200);
    await page.getByRole("button", { name: "All Domains" }).click();
  });
});

test("pagination: page 2 shows the next 20 items", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/dataverse/airport-metrics");
    const showing = page.getByText(/Showing 1-20 of \d+ results/);
    await expect(showing).toBeVisible();
    const total = Number((await showing.innerText()).match(/of (\d+)/)![1]);
    test.skip(total <= 20, "only one page of metrics on dev");
    const call = page.waitForResponse((r) => r.url().includes("/api/metrics?") && r.url().includes("offset=20"));
    await page.getByRole("button", { name: "2", exact: true }).click();
    expect((await call).status()).toBe(200);
    await expect(page.getByText(new RegExp(`Showing 21-${Math.min(40, total)} of ${total} results`))).toBeVisible();
    await expect(page.getByRole("link", { name: "View Details" }).first()).toBeVisible();
  });
});

test("metrics: the owning-entity filter is sent to the API", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/dataverse/airport-metrics");
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("combobox").filter({ hasText: "Choose Owning Entity" }).click();
    const call = page.waitForResponse((r) => r.url().includes("/api/metrics?") && r.url().includes("owningEntity="));
    await page.getByRole("option").first().click();
    expect((await call).status()).toBe(200);
  });
});

test("data quality rules: a rule-type toggle filters the list", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/dataverse/data-quality-rules");
    const call = page.waitForResponse((r) => r.url().includes("/api/data-quality-rules?") && /completeness=/.test(r.url()));
    await page.getByRole("button", { name: "Completeness", exact: true }).click();
    expect((await call).status()).toBe(200);
  });
});

test("data model: a model's detail page lists its assets", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/dataverse/data-model");
    await page.getByRole("link", { name: /^View details$/ }).first().click();
    await expect(page).toHaveURL(/\/dataverse\/data-model\/[^/]+/);
    await expect(page.getByText(/Not Found|Error Loading|Unable to Load/)).toHaveCount(0);
  });
});

test("airport community: 'Learn more' loads a committee's details", async ({ page }) => {
  await expectNoServerErrors(page, async () => {
    await page.goto("/airport-community");
    const call = page.waitForResponse((r) => /\/api\/committees\/[^/?]+/.test(r.url()));
    await page.getByRole("button", { name: /Learn more/ }).first().click();
    expect((await call).status()).toBe(200);
    await expect(page.getByRole("button", { name: /Less/ })).toBeVisible();
  });
});
