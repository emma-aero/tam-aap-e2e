/** Every catalog area as a logged-in user: list, search, detail, history. Read-only. */
import { expect, test } from "@playwright/test";

import { expectNoServerErrors } from "../../support/ui";

type Area = { path: string; heading: string | RegExp; search?: string; api: string; detailLink: string | RegExp };

const AREAS: Area[] = [
  { path: "/dataverse/business-glossary", heading: "Speak the language of the airport community", search: "Search Airport Glossary", api: "/api/glossaries", detailLink: "Learn more" },
  { path: "/dataverse/airport-metrics", heading: "Measure what matters", search: "Search Airport Metrics", api: "/api/metrics", detailLink: "View Details" },
  { path: "/dataverse/airport-reports", heading: "Communicate your performance with clarity", search: "Search Airport Reports", api: "/api/reports", detailLink: "View Details" },
  { path: "/dataverse/datasets", heading: "Decode your data into actionable insights", search: "Search Airport datasets", api: "/api/datasets", detailLink: "View Details" },
  { path: "/dataverse/global-reference-datasets", heading: "Leverage Community Updated Global Reference datasets", search: "Search Global reference datasets", api: "/api/grdatasets", detailLink: "View Details" },
  { path: "/dataverse/data-quality-rules", heading: "Create trusted quality data for decision making", search: "Search Data Quality Rules", api: "/api/data-quality-rules", detailLink: "View Details" },
  { path: "/dataverse/data-contracts", heading: /Drive Standardization/, search: "Search Global reference datasets", api: "/api/datacontracts", detailLink: "View Details" },
  { path: "/dataverse/data-model", heading: "Build a unified data foundation", api: "/api/data-models", detailLink: /^View details$/ },
];

for (const area of AREAS) {
  test.describe(area.path, () => {
    test("list loads", async ({ page }) => {
      await expectNoServerErrors(page, async () => {
        // Lists are fetched server-side on first load, so check the rendered page.
        await page.goto(area.path);
        await expect(page.getByRole("heading", { name: area.heading }).first()).toBeAttached();
        await expect(page.getByRole("heading", { name: "Access Restricted" })).toHaveCount(0);
        await expect(page.getByText(/Something went wrong|Error Loading|Unable to Load/)).toHaveCount(0);
        // either items or the area's empty state (e.g. dev has no global reference datasets)
        await expect(
          page.getByRole("link", { name: area.detailLink }).or(page.getByText(/^No .* found\.?$/i)).first(),
        ).toBeVisible();
      });
    });

    if (area.search) {
      test("search sends the term to the API and renders the result", async ({ page }) => {
        await expectNoServerErrors(page, async () => {
          await page.goto(area.path);
          const searched = page.waitForResponse((r) => r.url().includes(`${area.api}?`) && r.url().includes("search=e2e-zz-no-match"));
          await page.getByPlaceholder(area.search!).first().fill("e2e-zz-no-match");
          expect((await searched).status()).toBe(200);
          await expect(page.getByRole("link", { name: area.detailLink })).toHaveCount(0);
        });
      });
    }

    test("first item opens its detail page, and History loads", async ({ page }) => {
      await expectNoServerErrors(page, async () => {
        await page.goto(area.path);
        const link = page.getByRole("link", { name: area.detailLink }).first();
        // wait until the list has rendered (items or its empty state) before deciding to skip
        await expect(link.or(page.getByText(/^No .* found\.?$/i)).first()).toBeVisible();
        test.skip(!(await link.isVisible()), "no items in this area on dev");
        const opened = await Promise.all([page.context().waitForEvent("page", { timeout: 3000 }).catch(() => null), link.click()]);
        const detail = opened[0] ?? page;
        await detail.waitForLoadState("domcontentloaded");
        await expect(detail.getByText(/Not Found|Error Loading|Unable to Load/)).toHaveCount(0);
        const history = detail.getByRole("button", { name: "History" });
        if (await history.isVisible().catch(() => false)) {
          const histCall = detail.waitForResponse((r) => r.url().includes("/api/histories/"));
          await history.click();
          expect((await histCall).status()).toBe(200);
        }
      });
    });
  });
}

test("glossary letter filter sends initialLetter", async ({ page }) => {
  await page.goto("/dataverse/business-glossary");
  const call = page.waitForResponse((r) => r.url().includes("/api/glossaries?") && r.url().includes("initialLetter=A"));
  await page.getByRole("button", { name: "A", exact: true }).first().click();
  expect((await call).status()).toBe(200);
});

test("datasets: the Global Reference Dataset tab filters the list", async ({ page }) => {
  await page.goto("/dataverse/datasets");
  const call = page.waitForResponse((r) => r.url().includes("/api/datasets?") && r.url().includes("hasGlobalReference=true"));
  await page.getByRole("tab", { name: "Global Reference Dataset" }).click();
  expect((await call).status()).toBe(200);
});

test("data contracts: the Service tab filters by type", async ({ page }) => {
  await page.goto("/dataverse/data-contracts");
  const call = page.waitForResponse((r) => r.url().includes("/api/datacontracts?") && r.url().includes("type=service"));
  await page.getByRole("tab", { name: "Service" }).click();
  expect((await call).status()).toBe(200);
});
