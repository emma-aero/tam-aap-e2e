import { expect, Page } from "@playwright/test";

/**
 * The login page renders the form twice (mobile and desktop layouts); always act on the
 * visible one.
 */
export async function loginThroughForm(page: Page, email: string, password: string, callbackUrl = "/") {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const email$ = page.getByPlaceholder("Enter email").locator("visible=true").first();
  const password$ = page.getByPlaceholder("Enter Password").locator("visible=true").first();
  await email$.fill(email);
  await password$.fill(password);
  // The form signs in through NextAuth's credentials provider (which calls the backend's /login).
  const loginResponse = page.waitForResponse(
    (r) => r.url().includes("/api/auth/callback/credentials") && r.request().method() === "POST",
  );
  await page.locator('button[type="submit"]').locator("visible=true").first().click();
  return loginResponse;
}

/** Fails the test on any uncaught page error or 5xx API response while `fn` runs. */
export async function expectNoServerErrors(page: Page, fn: () => Promise<void>) {
  const problems: string[] = [];
  const onResponse = (r: import("@playwright/test").Response) => {
    if (r.url().includes("/api/") && r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  };
  const onError = (e: Error) => problems.push(`pageerror: ${e.message}`);
  page.on("response", onResponse);
  page.on("pageerror", onError);
  try {
    await fn();
  } finally {
    page.off("response", onResponse);
    page.off("pageerror", onError);
  }
  expect(problems, "server errors / page errors").toEqual([]);
}
