# Airport Acumen e2e suite

End-to-end tests that drive the **deployed dev environment**
(https://dev.airportacumen.emma.aero) like a real user: the browser goes through the
frontend, its `/api` proxy, the backend, the Integration Hub and DataHub. Run it **before
and after** any change to catch regressions across all three repos.

It lives in its own repo, owned by the backend/integration team, so it never touches the
frontend, backend or Integration Hub code. Frontend issues it finds are reported as Jira bugs
(project TT, label `found-by-e2e`) for the frontend team.

## Setup (once)

```bash
git clone git@github.com:emma-aero/tam-aap-e2e.git && cd tam-aap-e2e
npm install            # Playwright 1.63.0 (uses the Chromium already in ~/.cache/ms-playwright)
cp .env.example .env   # fill in the two test accounts; .env is git-ignored
```

Test accounts (create them in the dev Keycloak, realm `aap-tam`):
- `E2E_USER_*`: a normal portal user
- `E2E_ADMIN_*`: a user with the `requests:admin` role

## Run

```bash
npm test                # everything (read + @write tests)
npm run test:read       # read-only: no data is created anywhere
npx playwright test --project=anonymous   # no accounts needed
npm run report          # open the HTML report (traces/screenshots of failures)
```

The suite refuses to run against any host other than dev or localhost.

## What it covers

| Project | Covers |
|---|---|
| `anonymous` | landing page, public glossary (list, search, detail), auth guards, "Access Restricted" pages, committees, TAM, terms, login errors, registration form + API validation, verify/reset-password error pages, API auth rules, pentest regressions (TT-718 PII redaction, F9 unauth reads, F5 Swagger gate, TT-717 audience, TT-703 no extra browser header) |
| `user` | every catalog area (list, search, detail, History), domain sidebar, pagination, metrics filters, DQR toggles, datasets/data-contract tabs, data-model detail, committee details, session, logout, profile (edit, picture upload), comments (add, like, edit, reply, delete), endorsing, request lifecycle, edit/delete requests from the Edit tab, the create form |
| `admin` | review tab, rejecting a request in the UI, approving a create request (DataHub write) and cleaning it up |

Deliberately not covered: completing registration / email verification / password-reset
confirmation (need a mailbox), password-reset requests (5 per hour for all of dev), reporting a
comment (reports cannot be deleted).

## Nightly run (GitHub Actions)

`.github/workflows/e2e-dev.yml` runs the read-only subset against dev every night at 02:00 UTC
and uploads the HTML report as an artifact. **Run workflow** with *include_writes* also runs the
@write tests. Repository secrets needed: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`,
`E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` (the values in your local `.env`). Without them only the
anonymous tests can pass.

## Side effects and safety

- **Serial** (`workers: 1`): dev has one rate-limit bucket (100 req/min) for everybody.
- Every record a run creates contains a run tag `e2e-<timestamp>` and is deleted by the same test
  (plus an `afterAll` safety net): requests are hard-deleted, comments soft-deleted, profile
  values restored.
- Requests are created **without domains**, or with a domain that has no committee on dev
  (Airfield, Operations), so no committee member is emailed. The test user receives the usual
  confirmation emails.
- Opt-in only (in `.env`):
  - `E2E_ALLOW_COMMITTEE_EMAILS=1`: also run the UI create-form test (the form requires a domain,
    so that domain's committee members get an email).
  - `E2E_ALLOW_DATAHUB_WRITES=1`: also run the approve test (creates a glossary term in dev
    DataHub, then removes it with an approved delete request).

## Reference

`docs/flow-map.md`: every page, flow, endpoint, side effect and Playwright pitfall of the app, mapped from the code (2026-11-20).

## Known bugs

Tests for bugs that are live on dev are marked `test.fail(KNOWN_BUG.x)` (see
`support/env.ts`). They pass while the bug exists. When a fix is deployed Playwright reports
**"unexpectedly passed"**: remove the mark.

Currently marked (2026-11-20):

| Key | Bug | Status |
|---|---|---|
| `hubPagination` | page 2+ of glossary/domains/reports/committees is empty, and `total` equals the page length | fixed on backend `fix/pagination-and-500s`, not deployed |
| `glossaryNotFound` | an unknown glossary id shows "Error Loading Glossary Term" instead of "Not Found"; backend code is `GLOSSARY TERM_NOT_FOUND` (space) | frontend: TT-674 |
| `swaggerPublic` | `/api/docs` still 200 because `ENABLE_API_DOCS` is not `false` on dev | set the env, then remove the mark |
| `profileFormEmpty` | profile settings show empty fields (placeholders) instead of the user's values | frontend: TT-671 |

## Test users

`scripts/create-dev-test-users.sh` creates or resets both users in the dev Keycloak and writes
their credentials to `.env` (prints no secrets). Run it yourself: it uses the Keycloak admin
credentials from the dev cluster secret. Both users get the comment roles; the admin also gets
`requests:admin`. Note: a freshly self-registered user gets only the default roles and cannot
comment.
