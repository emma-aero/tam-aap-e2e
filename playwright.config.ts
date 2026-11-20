import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, storageStatePath } from "./support/env";

/**
 * Projects:
 *  - setup      logs in once per role through the real login form and saves the session
 *  - anonymous  public pages and auth guards (no session)
 *  - user       a normal logged-in portal user
 *  - admin      a requests:admin user (reviews requests)
 * Tests tagged @write create data on dev and clean it up; `npm run test:read` skips them.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Dev has ONE rate-limit bucket (100 req/min) shared by every user, because the frontend proxy does
  // not forward client IPs. Run serially so the suite never causes 429s for other people.
  workers: 1,
  // One retry everywhere: a one-off failure (e.g. dev's shared rate limit under load) is reported
  // as "flaky" instead of failing the run; a real regression still fails both attempts.
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "anonymous", testMatch: /anonymous\/.*\.spec\.ts/ },
    {
      name: "user",
      testMatch: /user\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: storageStatePath("user") },
    },
    {
      name: "admin",
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: storageStatePath("admin") },
    },
  ],
});
