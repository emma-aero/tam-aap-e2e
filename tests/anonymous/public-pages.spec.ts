import { expect, test } from "@playwright/test";

import { anonApi } from "../../support/api";
import { expectNoServerErrors, loginThroughForm } from "../../support/ui";

test.describe("public pages", () => {
  test("home page shows the hub and the dataverse entry points", async ({ page }) => {
    await expectNoServerErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByText("Airport Acumen Community Hub").first()).toBeVisible();
      for (const section of ["Glossary", "Reports", "Metrics", "Data Quality Rules"]) {
        await expect(page.getByText(section, { exact: true }).first()).toBeVisible();
      }
      await expect(page.getByText("Log in", { exact: true }).first()).toBeVisible();
    });
  });

  test("login page renders the form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Log in to Airport Acumen Portal").first()).toBeVisible();
    await expect(page.getByPlaceholder("Enter email").locator("visible=true").first()).toBeVisible();
    await expect(page.getByPlaceholder("Enter Password").locator("visible=true").first()).toBeVisible();
    await expect(page.getByText("Forgot password?").first()).toBeVisible();
    await expect(page.getByText("Register Now").first()).toBeVisible();
  });

  test("wrong credentials show an error and stay on the login page", async ({ page }) => {
    const res = await loginThroughForm(page, "e2e-nobody@example.com", "definitely-wrong-password-1");
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    await expect(page.getByText(/incorrect|invalid|failed/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("auth guard", () => {
  for (const path of ["/glossary", "/technical-resources", "/airport-acument-academy"]) {
    test(`${path} redirects an anonymous visitor to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?callbackUrl=${encodeURIComponent(path)}`));
    });
  }
});

test.describe("API without a session", () => {
  test("frontend health endpoint answers", async () => {
    const api = await anonApi();
    const res = await api.get("/api/health");
    expect(res.status()).toBe(200);
  });

  test("protected API calls are rejected with 401, not served", async () => {
    const api = await anonApi();
    const res = await api.get("/api/users/00000000-0000-4000-8000-000000000000");
    expect(res.status()).toBe(401);
  });

  test("backend login rejects wrong credentials with 401 INVALID_CREDENTIALS", async () => {
    const api = await anonApi();
    const res = await api.post("/api/login", {
      data: { username: "e2e-nobody@example.com", password: "definitely-wrong-1", grant_type: "password" },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe("INVALID_CREDENTIALS");
  });

  test("the request list is public (by design) and paginated", async () => {
    // GET /requests uses optionalAuthenticateJWT in the backend: anonymous visitors can read it.
    const api = await anonApi();
    const res = await api.get("/api/requests?limit=2&offset=0");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ offset: 0, limit: 2 });
    expect(body.results.length).toBeLessThanOrEqual(2);
    expect(typeof body.total).toBe("number");
  });
});
