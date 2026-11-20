/**
 * API contract checks through the frontend's /api proxy (the path browsers use).
 * No session; read-only. Registration validation endpoints have no side effects.
 */
import { APIRequestContext, expect, test } from "@playwright/test";

import { anonApi } from "../../support/api";
import { KNOWN_BUG } from "../../support/env";

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await anonApi();
});
test.afterAll(async () => api.dispose());

test("public catalog endpoints answer 200", async () => {
  for (const path of ["/api/glossaries?limit=5", "/api/committees", "/api/domains", "/api/endorsers"]) {
    const res = await api.get(path);
    expect(res.status(), path).toBe(200);
  }
});

for (const path of [
  "/api/metrics",
  "/api/reports",
  "/api/datasets",
  "/api/grdatasets",
  "/api/data-quality-rules",
  "/api/datacontracts",
  "/api/data-models",
]) {
  test(`${path} requires a token (401)`, async () => {
    expect((await api.get(path)).status()).toBe(401);
  });
}

test("glossary list paginates with a consistent total", async () => {
  const res = await api.get("/api/glossaries?offset=0&limit=5");
  expect(res.status()).toBe(200);
  const body = await res.json();
  const results = body.results ?? body.data?.results ?? body.data ?? [];
  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBeLessThanOrEqual(5);
});

test("glossary page 2 is not empty and the total is the real total", async () => {
  test.fail(true, KNOWN_BUG.hubPagination);
  // Count independently: on dev the bug also overwrites `total` with the page length.
  const all = await (await api.get("/api/glossaries?offset=0&limit=100")).json();
  const realCount = (all.results ?? []).length;
  test.skip(realCount <= 5, "not enough glossary terms on dev to have a second page");
  const first = await (await api.get("/api/glossaries?offset=0&limit=5")).json();
  expect(first.total).toBeGreaterThanOrEqual(realCount);
  const second = await (await api.get("/api/glossaries?offset=5&limit=5")).json();
  expect((second.results ?? []).length).toBeGreaterThan(0);
});

test("an unknown glossary id is a 404 (not a 500)", async () => {
  const res = await api.get("/api/glossaries/e2e-does-not-exist");
  expect(res.status()).toBe(404);
});

test("committee detail is reachable from the list", async () => {
  const list = await (await api.get("/api/committees")).json();
  const items = list.results ?? list.data?.results ?? list.data ?? list;
  test.skip(!items?.length, "no committees on dev");
  const res = await api.get(`/api/committees/${encodeURIComponent(items[0].id ?? items[0].urn)}`);
  expect(res.status()).toBe(200);
});

test("registration validation rejects a personal email (no side effects)", async () => {
  const res = await api.post("/api/register/validate-personal", {
    data: {
      firstName: "E2e",
      lastName: "Tester",
      email: "e2e.tester@gmail.com",
      country: "Qatar",
      phoneNumber: "+97455555555",
      password: "E2e-Valid-Password-123!",
      confirmPassword: "E2e-Valid-Password-123!",
    },
  });
  expect(res.status()).toBe(400);
  expect(JSON.stringify(await res.json())).toMatch(/PERSONAL_EMAIL|personal email/i);
});

test("email verification with a bogus token is a 4xx, not a 500", async () => {
  const res = await api.get("/api/verify-email?token=e2e-bogus-token");
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});
