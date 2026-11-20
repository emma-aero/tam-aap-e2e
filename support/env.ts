import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

/** Hosts the suite may run against. Write tests create and delete data, so prod is never allowed. */
const ALLOWED_HOSTS = ["dev.airportacumen.emma.aero", "localhost", "127.0.0.1"];

export const BASE_URL = process.env.E2E_BASE_URL || "https://dev.airportacumen.emma.aero";

const host = new URL(BASE_URL).hostname;
if (!ALLOWED_HOSTS.includes(host)) {
  throw new Error(
    `E2E_BASE_URL host "${host}" is not allowed. The e2e suite only runs against: ${ALLOWED_HOSTS.join(", ")}`,
  );
}

export type Role = "user" | "admin";

export function credentials(role: Role): { email: string; password: string } {
  const prefix = role === "admin" ? "E2E_ADMIN" : "E2E_USER";
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`${prefix}_EMAIL / ${prefix}_PASSWORD are not set (see e2e/.env.example)`);
  }
  return { email, password };
}

export const storageStatePath = (role: Role) => path.join(__dirname, "..", ".auth", `${role}.json`);

/** Prefix for every record a test creates, so leftovers are easy to find and clean up. */
export const RUN_TAG = `e2e-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

/** Opt-in switches for tests with side effects outside our own test data. */
export const ALLOW_EMAIL_TO_COMMITTEES = process.env.E2E_ALLOW_COMMITTEE_EMAILS === "1";
export const ALLOW_DATAHUB_WRITES = process.env.E2E_ALLOW_DATAHUB_WRITES === "1";

/**
 * Bugs that are live on dev but already fixed on an unmerged branch. Tests for them assert
 * the CORRECT behaviour and are marked test.fail(KNOWN_BUG.x) so the suite stays green;
 * once the fix is deployed Playwright reports "unexpectedly passed" -> remove the mark.
 */
export const KNOWN_BUG = {
  hubPagination: "backend fix/pagination-and-500s: page 2+ of hub-paginated lists is empty",
  // Not fixed yet: glossary-detail-client.tsx renders the generic error for a 404, and the
  // backend code is "GLOSSARY TERM_NOT_FOUND" (space) from responseTransformer.ts:66.
  // Not fixed yet: profile-settings form fields stay empty (placeholders only) until "edit"
  // is clicked, although the header shows the user's name (app/profile-settings/page.tsx:90-122).
  profileFormEmpty: "TT-671: profile settings show empty fields instead of the user's values",
  glossaryNotFound: "TT-674: unknown glossary id shows 'Error Loading Glossary Term' instead of 'Not Found'",
} as const;
