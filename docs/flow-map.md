# Airport Acumen (AAP / TAM): E2E flow map for Playwright

Target: `https://dev.airportacumen.emma.aero`.

**Code basis**

| Repo | Commit (origin/main) | Short name used here |
|---|---|---|
| `tam-aap-frontend` | `1013e47` | **FE** |
| `tam-aap-backend` | `2d9042b` | **BE** |
| `tam-aap-integrationhub` | origin/main | **IH** |

- Dev is deployed from `main`. The backend CI deploys to `emma-dev-cluster` on push to main (`.github/workflows/tam-app-backend.yml`).
- All `file:line` references point at origin/main.

> **Important:** the local backend branch `fix/pagination-and-500s` contains security fixes that are **not on main, so not on dev**:
> - auth on `/email/*` and `/histories` writes
> - `requests:admin` on `/data-models` writes
> - forced `pending` on `POST /requests`
> - hashed reset tokens
> - rate-limit key
>
> Everything below describes **main** (dev) behaviour. Where the branch differs, it is called out.

---

## 0. Architecture facts that matter for e2e

- **Browser → backend path.** The browser only calls same-origin `/api/*`.
  - `FE pages/api/[...path].ts` is a catch-all proxy to `BACKEND_URL` (dev: `http://airport-acumen-backend.aap-tam:3020`, `FE deployment/helm/.../values.yaml:76`).
  - It forwards **only** `Content-Type`, `Authorization` and `Origin` (`pages/api/[...path].ts:20-25`). It does not forward `X-Forwarded-For` or cookies.
  - App-router routes take precedence over the catch-all:
    - `/api/auth/*`: NextAuth plus `/api/auth/logout`
    - `/api/password-reset/{request,confirm}`
    - `/api/health`: the frontend's own health check, not the backend's
- **Backend is not public.** Its ingress is disabled (`BE deployment/helm/tam_aap_backend/values.yaml:31-32`), so the backend is reachable only through the FE proxy.
  - For API calls from tests, use `https://dev.airportacumen.emma.aero/api/<backend-path>`.
- **Server-side rendering also calls the backend.** List and detail pages prefetch server-side (`FE lib/api/server-prefetch.ts`, `lib/api/server-request.ts:16-45`), sending the session token directly to the backend from the FE pod.
- **Auth model.** NextAuth (JWT strategy) with a **custom Credentials provider**. There is **no Keycloak redirect**.
  - The backend talks to Keycloak realm `aap-tam` (client `tam-aap-frontend`) internally, using the password grant.
- **Rate limits are effectively global** (see §7):
  - 100 requests/min for the whole backend.
  - 5/hour for password reset.
  - The limiter keys on `X-Forwarded-For` or else `request.ip` (`BE src/configs/rateLimit.ts:51-61`, `124-134`). The FE proxy never forwards XFF, and the FE runs 1 replica (`FE values.yaml:1`). So **every user, every browser and SSR shares a single rate-limit bucket** (the FE pod IP).
- **No `data-testid` anywhere in FE.** Selectors must use role, text, placeholder, `id`, `aria-label` or `title`. Pitfalls are collected in §1.x and §9.
- **Roles** come from the Keycloak JWT.
  - The FE copies realm, client, `roles` and `groups` claims into `session.user.roles` (`FE app/api/auth/auth-options.ts:29-105`).
  - The BE treats every role as a permission (`BE src/utils/auth/permissionExtractor.ts:42-47`).

| Role | Grants |
|---|---|
| `comments:create` | create comment, reply, like comment, report comment |
| `comments:update_own` | edit own comment |
| `comments:delete_own` | delete own comment |
| `reports:read` | comment moderation list |
| `requests:admin` | approve or reject any request, delete any request, see all in `approvableByMe` |
| `endorser:admin` | endorser CRUD and set endorsers |
| `committees:admin` | committee CRUD |
| `admin` | read another user's `/users/:id` |
| Committee membership (stored in DataHub via IH, not a role) | for the committee's domain, same rights as `requests:admin` on requests (`BE src/controllers/requests/updateRequestHandler.ts`, `deleteRequestHandler.ts`) |

- Whether newly registered users get `comments:create` by default depends on the Keycloak realm default roles. That is **unclear from code**; nothing in the BE assigns roles (`BE src/services/login/loginService.ts:221+`).

---

## 1. Pages / routes

**Auth gating layers**

- **Proxy middleware** (`FE proxy.ts:4-39`). Public prefixes: `/`, `/login`, `/register`, `/reset-password`, `/request-password-reset`, `/verify-email`, `/verify-email-sent`, `/terms`, `/tam`, `/airport-community`, `/dataverse`, `/submitted-requests`.
  - Any other path with no session redirects to `/login?callbackUrl=<path>`.
  - `/profile-settings` is therefore protected.
  - So are the **non-existent** pages `/airport-acument-academy` and `/technical-resources`, which are linked in the header (`components/header/index.tsx:100,114`), and `/contact` (footer):
    - anonymous user → redirect to `/login`
    - logged-in user → the "launching soon" not-found page
- **Page-level gate.** Every `/dataverse/*` list and detail page except `business-glossary` renders `<RestrictedAccess/>` server-side when there is no session.
  - It shows h1 **"Access Restricted"** with buttons "Log in" and "Register Now" (`components/dataverse/restricted-access.tsx`).
  - The backend also requires a JWT for metrics, reports, datasets, grdatasets, data-quality-rules, datacontracts and data-models.
  - glossaries and domains are public (`BE src/routes/*Routes.ts`, `requiresAuth`).

### 1.1 Global chrome (`FE components/header/index.tsx`)

- **Logo:** link to `/`.
- **Desktop nav:**
  - Triggers **"Dataverse"** and **"TAM"** (Radix NavigationMenu).
  - Dataverse items: Business Glossary, Airport Metrics, Airport Reports, Datasets, Global Reference Datasets, Data Model, Data Quality Rules, Data Contracts.
  - TAM items: TAM Definition, TAM Use Cases.
  - Links: "Airport Acumen Academy" (404), "Airport Community", "Technical Resources" (404), "Submitted Requests".
- **Mobile:** a Sheet opened by a button with sr-only text "Toggle menu".
- **Theme toggle:** `aria-label="Switch to {dark|light} theme"`.
- **Auth button** (`index.tsx:289-336`):
  - Anonymous: **"Log in"** button, which calls `signIn(undefined, {callbackUrl: location.href})` and lands on `/login`.
  - Authenticated: an **avatar button with no accessible name**. It opens a popover with full name, email, link **"Profile settings"** and button **"Logout"** (`user-profile-popover.tsx:50-66`).
  - Selector suggestion: `header button:has(img), header button >> nth=-1`, or click by initials text.
- **Toasts:** sonner `<Toaster/>` in root layout. Use `page.getByText(toastText)` or `[data-sonner-toast]`.
- **Document title:** "Airport Acumen Portal" (`app/layout.tsx:27`).

### 1.2 Route table

| URL | Auth | Roles | Key UI (selectors) | Backend calls |
|---|---|---|---|---|
| `/` | no | – | ImageSlider: 5 slides all in the DOM, so 5 `<h1>` (first is "Airport Acumen Community Hub"); dots `aria-label="Go to slide N"`; autoplay 5s. `<h2>` "Airport Acumen Dataverse" plus 8 link cards (table below). Footer: "Privacy Policy" (`/terms?tab=privacy-policy`), "Terms and Conditions", "Contact Us" (`/contact`, which redirects to login or 404) | none |
| `/login` | no | – | see §2.1 | NextAuth → `/login`, `/users/:id` |
| `/register` | no | – | h1 "Sign up for Airport Acumen Portal", link "Back to Login", 2-step form (§2.4) | `/register/validate-personal`, `/register/validate-employment`, `/register` |
| `/verify-email-sent` | no | – | h1 "Please check your inbox to activate your account", button "Resend Activation Email" (60s cooldown, "Resend available in Ns"). Redirects to `/` if `sessionStorage.pendingVerificationEmail` is missing | `POST /resend-verification` |
| `/verify-email?token=` | no | – | "Verifying your email..." → "Account Activated Successfully" + button "Log In", or "Verification Failed" | `GET /verify-email?token=` |
| `/request-password-reset[?email=]` | no | – | title "Reset your password", placeholder "Enter your email", button "Send reset link". Success banner "Check your email! We sent a password reset link" with close `aria-label="Close notification"`; 30s countdown "Resend link in N Seconds"; then "Resend link" | `POST /api/password-reset/request` |
| `/reset-password?token=` | no | – | "Reset your password", placeholders "Enter password" / "Re-enter password". "Password Reset Successful!" + "Back to login". No token: "Invalid Reset Link" / "Reset token is missing" | `POST /api/password-reset/confirm` |
| `/profile-settings` | **yes** (proxy, plus client push to `/login`) | any | §4.4 | `GET /users/:id`, `PUT /users/profile` |
| `/submitted-requests[?tab=my\|review]` | page public; My/Review tabs need login | Review tab visible only with `requests:admin` or committee membership | §5.2 | `GET /requests?...`, `GET /users/:id/committees` |
| `/submitted-requests/:id` | page public, content only when logged in | Approve/Reject only if API `canApprove` and status pending | §5.3 | `GET /requests/:id`, plus item fetch (glossary/metrics/reports/data-model) |
| `/submitted-requests/dataverse/:dataverseId?itemName=&dataverseType=` | public | – | h1 "Submitted Requests", "View pending requests for {itemName}"; rows are `<a target=_blank>` | `GET /requests/dataverse/:id` (defaults to pending, under_review) |
| `/dataverse/business-glossary` | **no** | – | §3 | `GET /glossaries` |
| `/dataverse/business-glossary/:id` | no (Edit tab needs login) | – | §3 | `/glossaries/:id`, `/histories/:id`, `/comments`, `/endorsers`, `/dataverse/:id/like` |
| `/dataverse/business-glossary/create` | client redirect to `/login?callbackUrl=...` | any logged-in | §5.1 | `POST /requests` |
| `/dataverse/airport-metrics[/:id][/create]` | yes | any logged-in | §3 / §5.1 | `/metrics...` |
| `/dataverse/airport-reports[/:id][/create]` | yes | any logged-in | §3 / §5.1 | `/reports...`, `POST /reports/thumbnail` (S3) |
| `/dataverse/datasets[/:id]` | yes | – | §3 | `/datasets...` |
| `/dataverse/global-reference-datasets[/:id]` | yes | – | §3 | `/grdatasets...` |
| `/dataverse/data-model[/:id][/create]` | yes | any logged-in | §3 / §5.1 | `/data-models...` |
| `/dataverse/data-quality-rules[/:id]` | yes | – | §3 | `/data-quality-rules...` |
| `/dataverse/data-contracts[/:id]` | yes | – | §3 | `/datacontracts...` |
| `/dataverse/reference-datasets[/:id]` | yes | – | legacy duplicate of datasets. The landing card "Global Reference Datasets" links here, **not** to global-reference-datasets | `/datasets` (no pagination) |
| `/airport-community[?from=&term=&termId=]` | no | – | breadcrumb ... > "Committees"; `<h2>` "Our Committees"; card button "Learn more →" / "← Less" (expands and fetches detail) | `GET /committees`, `GET /committees/:id` |
| `/tam/definition` | no | – | h1 "From Fragmented Operations"; `aria-label` "Previous page"/"Next page", "Go to page N"; link "Explore TAM use cases"; "Request a demo" has no handler | none |
| `/tam/use-cases` | no | – | h1 "TAM Use Cases"; buttons "Passenger Flow", "Baggage Flow", "Aircraft Flow"; "Learn more" or "Coming soon" | none |
| `/tam/use-cases/passenger-flow` | no | – | h1 "Passenger Flows Overview"; "Previous step"/"Next step", "Go to step N" | none |
| `/terms[?tab=]` | no | – | Radix tabs (`role=tab`): "Terms of use", "Registration & contribution terms", "Privacy policy", "Intellectual property takedown policy"; "Back" button | none |
| any unknown path | proxy: login first if not public | – | not-found has **no heading**: "This Page / is launching / very soon" (CSS-uppercased), link "Go Home" | – |

**Landing page dataverse cards** (`components/landing-page/dataverse-cards.tsx`)

| Card text | Links to |
|---|---|
| "Navigate Business glossary" | `/dataverse/business-glossary` |
| "Key Airport metrics" | `/dataverse/airport-metrics` |
| "Reports best practice" | `/dataverse/airport-reports` |
| "Datasets" | `/dataverse/datasets` |
| "Global Reference Datasets" | `/dataverse/reference-datasets` (!) |
| "Explore the airport Data model" | `/dataverse/data-model` |
| "Navigate Data Quality Rules" | `/dataverse/data-quality-rules` |
| "Data Contracts" | `/dataverse/data-contracts` |

---

## 2. Auth flows

### 2.1 Login: custom form, NextAuth Credentials (not a Keycloak redirect)

- **UI** (`FE app/login/page.tsx`):
  - h2 "Log in to Airport Acumen Portal".
  - **The form is rendered twice**: desktop (`hidden md:block`) and mobile (`md:hidden`). `getByLabel('Email')` therefore matches 2 elements.
  - Use ids `#login-email-desktop` / `#login-password-desktop` (or the `-mobile` variants), or `locator('input[placeholder="Enter email"]:visible')`.
  - Placeholders: "Enter email", "Enter Password".
  - Button **"Login"** ("Logging in..." while busy). Link "Forgot password?". Link "Register Now".
  - The eye toggle has no name.
- **Flow:**
  1. `signIn("credentials", {email, password, redirect:false})` (`login/page.tsx:116`) sends `POST /api/auth/callback/credentials` (NextAuth).
  2. Server-side `authorize()` (`auth-options.ts:116-153`) calls backend **`POST /login`** with `{username: email, password, grant_type:"password"}` (`lib/api/auth.ts:155`). The BE runs the Keycloak password grant (`BE src/services/login/loginService.ts:63`).
  3. It then calls **`GET /users/:user_id`** with the Bearer token.
  4. The JWT is stored in the NextAuth cookie (`next-auth.session-token`, or `__Secure-...` on https). Cookie maxAge is 1h (`lib/config/session.ts`).
  5. On success: `router.push(callbackUrl || "/")`.
- **Error:** a banner with the text "The Email/Username or password you entered is incorrect." (BE 401 `INVALID_CREDENTIALS`, `BE src/controllers/login/loginHandler.ts:49-51`).
- **E2E:**
  - Fully automatable with a pre-provisioned test user.
  - Recommended: log in once in `globalSetup` and save `storageState`.
  - For API setup and cleanup, get a bearer token with `POST {BASE}/api/login` body `{"username":email,"password":pw,"grant_type":"password"}`. Response: `{access_token, refresh_token, expires_in, user_id,...}`. Send it as `Authorization: Bearer` to `{BASE}/api/<path>`.
  - Alternatively, `GET {BASE}/api/auth/session` with the browser cookie returns `{accessToken,...}`.

### 2.2 Logout

- **UI:** avatar → "Logout" (`user-profile-popover.tsx:60`), or "Logout" on profile settings. Both call `logoutUser()` (`FE lib/api/base.ts:91-102`):
  1. `GET /api/auth/logout`. Server-side this calls backend **`POST /logout {refresh_token}`**, which revokes the Keycloak session (`app/api/auth/logout/route.ts`), and deletes the next-auth cookies.
  2. `signOut({callbackUrl:"/"})`, which lands on `/`.
- The BE blacklists the access token only if an `Authorization` header is sent (`BE src/controllers/login/logoutHandler.ts:29`). The FE does not send one.
  - **Caveat:** logout revokes the refresh token or session in Keycloak. If tests share one user and one session across workers, a logout test can kill the other workers' sessions. **Use a dedicated user for logout tests**, or log in fresh in that test.

### 2.3 Token refresh

- NextAuth `jwt` callback: when `accessTokenExpires` passes, it calls backend **`POST /refresh {refresh_token}`** (`auth-options.ts:197-299`, `lib/api/auth.ts:253`).
- Client side: on a 401 or `TOKEN_EXPIRED`, `apiRequest` re-reads `/api/auth/session` once, retries, and otherwise logs out (`lib/api/base.ts:135-152`).
- Not practical to test end-to-end without waiting for token expiry, which is set by the Keycloak realm (unknown). You could test it by tampering with the cookie, but that is low value.

### 2.4 Registration: multi-step

- **UI** (`FE components/auth/MultiStepForm.tsx`, `PersonalInfoStep.tsx`, `EmploymentInfoStep.tsx`):
  - **The form is rendered twice** (desktop and mobile, `app/register/page.tsx:66,102`), so **duplicate ids** exist: `#first-name`, `#email`, etc. Always use `:visible` or scope to the visible container.
  - Step indicator: "Personal Information" / "Employment Information".

**Step 1 (Personal Information)**

| Field | Selector / placeholder |
|---|---|
| First Name | `#first-name`, "Enter name" |
| Last Name | `#last-name`, "Enter name" |
| Email | `#email`, "Enter email" |
| Country | combobox `#country`, search "Search countries..." |
| Phone Number | country code search "Search country codes..."; `#phone-number`, "0000000" |
| Password | `#password` |
| Confirm Password | `#confirm-password` |

- Button **"Continue"** → `POST /register/validate-personal`. This only validates; it has **no side effects** (`BE src/controllers/login/validationHandlers.ts`).

**Step 2 (Employment Information)**

| Field | Selector | Options |
|---|---|---|
| Employer Type | `#employer-type` | Airport Operator / Airport Supplier/Vendor / Aviation / Others; "Others" shows `#employer-type-other` |
| Employer Name | `#employer-name` | "Hamad International Airport" / "Others" |
| Job Title | `#job-title` | – |
| Domain | `#domain` | 15 domains, `FE types/registration.ts:52-68` |
| Accept our terms | checkbox `#acceptTerms` | – |

- Buttons "Back" / **"Submit"**.
- Submit calls `POST /register/validate-employment` (no side effects), then **`POST /register`**.
- **What `POST /register` does** (`BE src/controllers/login/registrationHandler.ts`):
  - Checks whether the email already exists in Keycloak → 409 `USER_ALREADY_EXISTS`.
  - Checks for a non-expired pending registration for the email → 409 "A registration is already pending..." (`BE src/services/pendingRegistration/pendingRegistrationService.ts:116-127`).
  - Inserts a **pending_registration DB row** with the encrypted password.
  - **Sends the verification email** via AWS SES to the given address. The link is `${VERIFICATION_BASE_URL}/verify-email?token=...`, and the token is valid `TOKEN_EXPIRY_HOURS=0.5` (30 min) (`registrationHandler.ts:43-58`, BE values.yaml).
  - **No Keycloak user is created yet.**
- FE then stores `sessionStorage.pendingVerificationEmail` and pushes `/verify-email-sent`.
- **Email rules:** must be a **business email**.
  - Disposable domains (MailChecker) → `DISPOSABLE_EMAIL_NOT_ALLOWED`.
  - Free providers (gmail, outlook, ...) → `PERSONAL_EMAIL_NOT_ALLOWED` (`BE src/validators/registration/personalValidators.ts:118-132`).
  - **Mailinator-style catch-all inboxes are rejected.**
- **E2E:**
  - Steps 1 and 2 validation, and the negative cases (free email, weak password, mismatch), are safe READ-like tests.
  - Final submit sends a real email and blocks that address for 30 minutes.
  - Completing verification needs **mailbox access on a business domain**: plus-addressing on a company domain you control, or an SES/IMAP test inbox. **There is no API to fetch the token** and no test hook.
  - **Cleanup is impossible via the app:** there is no user-delete endpoint, so a verified user stays in Keycloak permanently. Pending rows expire after 30 minutes and are replaced on the next registration (`pendingRegistrationService.ts:119-122`). Deleting users needs Keycloak admin access.

### 2.5 Email verification

- `/verify-email?token=` calls `GET /api/verify-email?token=` → BE `verifyAndActivate` (`pendingRegistrationService.ts:177-263`):
  - creates the Keycloak user (enabled, emailVerified)
  - deletes the pending row
  - **sends a welcome email** (`BE src/controllers/emailVerification/verifyEmailHandler.ts:50-80`)
- Error cases: invalid token, already verified, or expired, giving "Verification Failed". Testable with a bogus token (safe READ).
- `/verify-email-sent` → "Resend Activation Email" calls `POST /resend-verification {email}`. This issues a new token and **sends another email** (`resendVerificationHandler.ts:75`). FE cooldown is 60s; there is no BE limit beyond the global limiter.

### 2.6 Password reset

1. `/request-password-reset` calls `POST /api/password-reset/request {email}` → BE `/auth/password-reset/request`.
   - Always returns success; it does not reveal whether the account exists.
   - If the user exists, it stores a token (30 min, **plaintext on main**) and **emails the link** `${VERIFICATION_BASE_URL}/reset-password?token=...` (`BE src/services/passwordReset/passwordResetService.ts:75`, `src/controllers/passwordReset/requestPasswordResetHandler.ts:46-53`).
   - The FE store retries once on 5xx or 429 (`store/services/userService.ts:43-48`).
2. `/reset-password?token=` calls `POST /api/password-reset/confirm {token,newPassword}`. This changes the Keycloak password (`passwordResetService.ts:121-150`).
3. **Rate limit:** 5 requests/hour on both endpoints (`BE src/routes/passwordResetRoutes.ts:34`; values.yaml `PASSWORD_RESET_RATE_LIMIT_MAX: 5`, window 1 hour).
   - This is **effectively global** for everybody on dev (see §0). The 6th call in an hour returns 429 `PASSWORD_RESET_RATE_LIMIT_EXCEEDED`.
4. **E2E:**
   - Requesting for a **non-existent** email sends no email but still consumes the 5/hour budget.
   - Confirming needs the emailed token, so it needs mailbox access. An invalid-token negative test is possible (it also consumes budget).
   - **Do not run in loops or CI on every commit.**

---

## 3. Catalog / browse flows

Data comes from DataHub through IH and is cached in the backend.

### 3.1 Shared behaviour

- **HeroSection** (`components/dataverse/hero-section.tsx`):
  - h1 title.
  - Search `<Input>` with **placeholder only** (no label). Uncontrolled, **300ms debounce**, then sends `search=`.
  - With HighlightText active, matched text is split into spans, so use `toContainText` and wait for the response, for example `page.waitForResponse(r => r.url().includes('/api/glossaries?') && r.url().includes('search='))`.
  - Hero button "Learn about our committees →" does a full navigation to `/airport-community?from=<area>`.
- **DomainsSidebar** (`components/dataverse/domains-sidebar.tsx`), filters on `domain=`:
  - At 1024px and wider it is expanded by default, with a collapse button `aria-label="Collapse sidebar"`/`"Expand sidebar"`.
  - Below 1024px the domain buttons are hidden until `aria-label="Toggle sidebar"` is clicked.
  - Options: `button[title="All Domains"]` plus 15 domain buttons (`title=<Domain>`). Prefer `getByTitle('Airfield')`.
  - Clicking the active domain toggles back to All.
- **Pagination** (`components/ui/pagination.tsx`): offset/limit with pageSize 20; text "Showing {a}-{b} of {n} results".
  - Page-number buttons are named by their number; the active one is disabled.
  - **Prev/next are icon-only with no accessible name.** Locate them as the first and last button in the pagination container.
- **Detail tabs:** plain buttons (not `role=tab`): "Main Page", "Edit", "History". The tab is in the URL `?view=edit|history`; inactive tabs are unmounted.
- **Breadcrumb:** `nav[aria-label="breadcrumb"]`. The current crumb is `role=link aria-current=page`, so the item name appears in both the breadcrumb and the h1. Use `.first()` or scope the locator.
- **Detail extras** on glossary, metrics, reports, datasets, GR and DQR:
  - **EndorsersSection**: h1 "Endorsed by members from". Calls `POST /endorsers {ids}` and, when logged in, `GET /dataverse/:id/like`. Button "Endorse"/"Endorsed".
  - **CommentsSection**: `GET /comments?entityId=<id>&limit=5&offset=&replyDepth=1&repliesLimit=2`.
  - **History tab**: `GET /histories/:id`. Shows "No history yet"; items link "Request details" → `/submitted-requests/{requestId}`.
- **PendingRequestBanner:**
  - "Request pending" + "View submitted request" (`target=_blank`), or
  - "Requests pending" + "View submitted requests" → `/submitted-requests/dataverse/:id?...`.

### 3.2 Per area

The **"Endpoint (via /api)"** column below is the backend path called through the proxy.

| Area | List URL / heading / search placeholder | Endpoint (via /api) | Filters | Item link | Detail page |
|---|---|---|---|---|---|
| Glossary (public) | `/dataverse/business-glossary`; h1 "Speak the language of the airport community"; "Search Airport Glossary"; button "Add new glossary item" (anonymous → `/login?callbackUrl=/dataverse/business-glossary/create`) | `GET /glossaries?search&domain&initialLetter&offset&limit=20` (adds `maxItemsPerCharacters=3` when unfiltered, `lib/api/glossary.ts:8-10`) | domain sidebar; AlphabetNav buttons "All", "A"–"Z" (`initialLetter`); per-letter "View All" | `<h3>` title + link **"Learn more"** → `/dataverse/business-glossary/{id}` | `GET /glossaries/:id`; h3 cards Acronym / Domain / Synonyms / Definition Owning Entity; link "Learn about our committees" → `/airport-community?from=business-glossary&term=…&termId=`; tabs Main / Edit / History. Not found: h1 "Glossary Term Not Found" + "Return to Glossary". Empty list: "No glossary terms found." |
| Metrics | h1 "Measure what matters"; "Search Airport Metrics"; "Add new metric" | `GET /metrics?search&domain&owningEntity&endorsers&offset&limit=20` (opening Filters also fetches `limit=1000`) | sidebar; button "Filters" → MultiSelects "Choose Owning Entity", "Choose Endorsers" (`role=combobox`, options `role=checkbox`, duplicate `id="multi-select-dropdown"`) | card `<h1>` + **"View Details"** | `GET /metrics/:id`; h2 "Formula"; tabs Main / Edit / History; "Metric Item Not Found" |
| Reports | h1 "Communicate your performance with clarity"; "Search Airport Reports"; "Add new report" | `GET /reports?search&domain&offset&limit=20` | sidebar | "View Details" | `GET /reports/:id`; "Report Type", "Report Audience", "Purpose", "Metrics Included"; tabs Main / Edit / History (**Edit tab not auth-gated client-side**); "Unable to Load Report" / "Report Term Not Found" |
| Datasets | h1 "Decode your data into actionable insights"; "Search Airport datasets" | `GET /datasets?search&domain&hasGlobalReference=true&offset&limit=20` | sidebar; Radix tabs (`role=tab`) "All" / "Global Reference Dataset" | `<h1>` + "View Details"; icon-only globe link (no name) → GR detail | `GET /datasets/:id`; tabs Main / History only; "Data Dictionary" table; "Dataset Not Found" |
| Global Reference Datasets | h1 "Leverage Community Updated Global Reference datasets"; "Search Global reference datasets" | `GET /grdatasets?search&domain&offset&limit=20` | sidebar | "View Details" | `GET /grdatasets/:id`; button "Download Table" (client CSV); tabs Main / History; "Global Reference Dataset Not Found" |
| Data Model | h1 "Build a unified data foundation" (hero `hidden lg:block`, toggle `aria-label="Collapse hero section"`); no search, no pagination | `GET /data-models?limit=100` | none | card `<h3>` + link **"View details"** (lowercase d); final card "Suggest new item" → create | `GET /data-models/:id`; breadcrumb "Data Model" > name (no Home); asset cards "View Details" (`target=_blank`); **no comments, no endorsers**; tabs Main / Edit / History |
| Data Quality Rules | h1 "Create trusted quality data for decision making"; "Search Data Quality Rules" | `GET /data-quality-rules?search&domain&completeness=true…&offset&limit=20` | sidebar; toggle buttons Completeness / Validity / Accuracy / Consistency / Uniqueness / Ambiguity / Timeliness (every card also has a hard-coded "Consistency" badge, so use `getByRole('button',{name:'Consistency'})`) | `<h3>` + "View Details" | `GET /data-quality-rules/:id`; h3 "Rule Overview", "SQL Check for violations"; tabs Main / History |
| Data Contracts | h1 "Drive Standardization, Reusability and Interoperability when Integrating Airport Systems"; placeholder **"Search Global reference datasets"** (copy-paste bug) | `GET /datacontracts?search&type=system2system\|service&domainName&offset&limit=20` (domain param is **`domainName`**) | sidebar; Radix tabs "System to System" / "Service" | "View Details" (domain icons rendered twice) | `GET /datacontracts/:id`; **no tabs, no comments, no history**; "Data Contract Not Found" |
| Reference datasets (legacy) | h1 "Measure what matters" (copy-paste); "Search Airport Datasets" | `GET /datasets?search&domain` (no pagination) | sidebar | "View Details" → `/dataverse/reference-datasets/{id}` | `GET /datasets/:id`; tabs Main / History; comments but no endorsers |

- **IDs:** opaque. Glossary-backed types (glossaries, metrics, reports) are DataHub glossary-term ids or URNs; GR datasets map to `urn:li:dataset:(urn:li:dataPlatform:postgres,<id>,PROD)` (`BE src/services/requests/requestsOrchestrator.ts:~460`).
- **Recommendation:** discover ids at test time from the list API rather than hard-coding them.

### 3.3 Domains, committees, search

- **Domains:** the backend exposes `GET /domains`, `GET /domains/:id` (public). The FE uses a static domain list (`lib/constants/domains.ts`) and **does not call `/domains`**.
- **Committees:** `/airport-community` → `GET /committees` (public), `GET /committees/:id` (public).
- **Search:** there is no global search. Search is per-list via `search=`.

---

## 4. Collaboration

### 4.1 Comments (`FE components/comments/**`, `BE src/routes/commentsRoutes.ts`)

- **Placement:** on detail Main Page tabs of glossary, metrics, reports, datasets, GR, DQR and reference datasets.
- **Header:** "Discussion" (a div, not a heading).
- **Empty state:**
  - With create permission: "Start the Discussion".
  - Otherwise: "No Comments Yet".
  - Image `role=img aria-label="No discussions"`.

| Action | UI | API | Role | Side effect |
|---|---|---|---|---|
| List | infinite scroll; "Load more comments" after 52 | `GET /comments?entityId&limit&offset&replyDepth&repliesLimit` | public (optional auth) | none |
| Create | click overlay "Add a comment" → textarea "Type your comment here" → "Submit". Buttons exist hidden in DOM before focus | `POST /comments {entityId, content}` | `comments:create` | DB insert |
| Reply | "Reply" → "Type your message here" → "Submit" | `POST /comments/reply/:id {content}` | `comments:create` | DB insert |
| Edit | "Edit" (own comment, no replies) → "Apply edit" | `PUT /comments/:id {content}` | `comments:update_own` | DB update ("Edited") |
| Like (toggle) | "Like" / "Like (N)". Anonymous → `signIn()` → `/login` | `POST /comments/like/:id` | `comments:create` | DB toggle (reversible by calling again) |
| Report | "Report" → dialog "Why are you reporting this comment?"; radios "False information", "Hate speech", "Irrelevant or off-topic", "Personal information disclosure", "Duplicate content", "Other" (`aria-label="Other reason"`) → "Submit" | `POST /comments/report/:id {reason}` | `comments:create` | DB insert into reports. **No API to delete reports.** No email |
| Delete | "Delete" → "Delete Confirmation" → "Delete" | `DELETE /comments/:id` | `comments:delete_own`, **owner only** (`BE src/services/comments/commentMutationService.ts:134-140`) | **soft delete** (with descendants) |
| Moderation list | not in FE | `GET /comments/reports` | `reports:read` | none |

- **Toasts:** "Comment deleted successfully", "Reply posted successfully", "Comment reported successfully", "Comment updated successfully".
- **Cleanup:** `DELETE /api/comments/:id` with the **author's** token. This soft-deletes, so rows remain in the DB but are hidden. A report row cannot be removed.

### 4.2 Endorsements

- `GET/POST/DELETE /dataverse/:id/like` (`authenticateJWT`, `BE src/routes/endorserLikesRoutes.ts`).
- A like is recorded only if the user's **employerName** (or employerNameOther) matches an existing **endorser** name. The first like from that employer also adds the endorser to `dataverse_endorsers`; the last unlike removes it (`BE src/services/endorserLikes/endorserLikesService.ts:1-70`).
- **Visible to all users.** It is DB only, with no DataHub write.
- **Cleanup:** `DELETE /api/dataverse/:id/like` with the same user.
- If the test user's employer is not an endorser, the like has no effect or errors. Check the response.
- **UI:** "Endorse" / "Endorsed" (hover tooltip "Click to remove endorsement"); empty state "This item has not yet been endorsed by any members".
- **Admin-only** (not in FE):
  - `POST /endorsers/create`, `PUT/DELETE /endorsers/:id`, `PUT /dataverse/:id/endorsers` (`endorser:admin`)
  - reads `GET /endorsers`, `POST /endorsers`, `POST /endorsers/by-ids`, `GET /dataverse/endorsers`, `GET /dataverse/:id/endorsers` are public

### 4.3 Notifications

- **There is no in-app notification feature.** There is no notifications route in the BE and no UI in the FE.
- "Notifications" means **emails** sent by `BE src/services/requestNotification/requestNotificationService.ts` (see §5.4).

### 4.4 User profile (`FE app/profile-settings/page.tsx`, `components/profile-settings/*`)

- **Header:** h1 full name + email; camera `aria-label="Upload profile picture"`; button "Request password reset" → `/request-password-reset?email=`.
- **Cards** (h3): "Personal Information", "Professional Information", "Need to Update Restricted Fields?" (button "Contact admin" = mailto), "Account Actions" ("Logout").
  - The edit button on each card is **icon-only with no name** (`profile-card.tsx:78`). Then "Cancel" / "Save".
  - Labels are not associated with inputs (no `htmlFor`), so use placeholders: First "Mohammad", Last "Ali", Job title "Senior Airport Operations Manager", Phone "0000000".
- **Save:** `PUT /users/profile` with:
  - `{firstName,lastName,country,phoneNumber}`, or
  - `{employerType,employerTypeOther?,employerName,employerNameOther?,jobTitle,domain}`.
  - This updates Keycloak user attributes (reversible by saving the old values).
  - **No success toast.**
  - Changing `employerName` affects endorsement behaviour.
- **Possible FE bug:** the form state is not synced from the store until you click edit (`page.tsx:90-122`). Unverified.
- **Picture upload:**
  - Custom overlay (no `role=dialog`), h2 "Upload Profile Picture".
  - Drop zone also has `aria-label="Upload profile picture"`, so there are 2 matches.
  - Uses a hidden `<input type=file>`: use `setInputFiles`. Then a crop UI and button **"Upload picture"**.
  - Sends `PUT /users/profile {profileImage:{imageData:"data:image/jpeg;base64,…", format:"jpeg"}}`. The image is stored in the **Postgres** `profile_images` table, not S3 (`BE src/services/imageService.ts:33-66`).
  - Client limit 2MB. BE `MAX_IMAGE_SIZE_MB=2`, body limit 5MB.
  - The **Next.js API proxy has the default 1MB bodyParser limit** (no `config` export in `pages/api/[...path].ts`), so base64 payloads over ~1MB probably fail with 413. Use a small image.
- **Picture removal:** hover the image in the dialog (icons have no aria-label) → dialog "Remove Profile Picture?" → "Remove". Sends `{profileImage:{}}`; toast "Profile picture removed successfully".
- **Cleanup:** `PUT /api/users/profile {"profileImage":{}}`, and re-PUT the original field values.

---

## 5. Request workflow (suggest / edit / delete catalog items)

### 5.1 Creating requests (UI)

Only 4 dataverse types are supported in the FE: `glossaries`, `metrics`, `reports`, `datamodels` (`FE types/dataverse-forms.ts:1`).

- **Create pages:** `/dataverse/{business-glossary|airport-metrics|airport-reports|data-model}/create`.
  - Any logged-in user can use them; anonymous users are client-redirected to `/login?callbackUrl=...`.
  - Header button: "Submit item" (or "Submit report"). It is disabled until the required fields are filled.
  - Clicking it opens the dialog "Submit item for review?" → **"Submit"** / "Cancel".
- **Form fields:**
  - **Glossary:** "Enter item name"*, "Enter item definition"*, Domain dropdown* ("Select domains", search "Search..."), "Enter acronym", "Enter synonyms", "Enter entity name".
  - **Metrics:** "Enter metric name"*, "Enter metric definition"*, domain*, "Enter acronym", "Enter unit", "Enter entity name", "Enter formula".
  - **Reports:**
    - "Enter report name"*, description* (with `@` mentions), single domain*, "Report Type"* ("Select Type"), "Enter audience", "Enter purpose", "Add Metric" (sheet "Add metrics" → "Apply changes").
    - Thumbnail (`aria-label="Upload image"` → dialog "Edit Picture" → drop zone `aria-label="Upload picture"`) → **`POST /reports/thumbnail` uploads to S3 immediately**, before the request is submitted.
  - **Data model:** "Enter item name"*, "Add Datasets" (sheet → "Apply changes").
  - All forms: "Add context for reviewers" (additional comment).
- **Payload:** `POST /requests {action:"create", dataverseType, dataverseRequestDetails:{...}, requesterComment}`. The FE never sends `status` (`FE hooks/dataverse/use-dataverse-submit.ts:31-41`).
- **Success:** toast e.g. "New glossary item submitted successfully", then redirect to the list page.
- **Edit/delete:** detail page → "Edit" tab (`?view=edit`). The header text is "Select the field you want to update, make your changes, and submit your edit request".
  - "Request edit": disabled until there is a change → "Submit edits for review?" → "Submit" → toast "Edits submitted successfully".
  - "Request delete" → dialog "Request Deletion", `getByLabel('Reason')` (`#delete-reason`, max 200) → "Submit request" → toast "Delete request submitted".
  - Payloads: `{action:"update", dataverseId, dataverseType, dataverseRequestDetails:<changed keys>}`, and `{action:"delete", dataverseId, dataverseRequestDetails:{}, requesterComment:reason}`.
  - There is **no role check** for proposing edits; any logged-in user can.

### 5.2 Listing (`/submitted-requests`)

- h1 "Submitted Requests".
- **Tabs** (plain buttons):
  - "All Requests"
  - "My Requests" (adds `userId=<me>`)
  - "For My Review" (adds `approvableByMe=true`; visible only with `requests:admin` or committee membership from `GET /users/:id/committees`)
  - Initial tab from `?tab=my|review`, read at mount only.
- **Filters:**
  - search "Search..." (300ms debounce)
  - multiselects "All Dataverse Types", "All Request Types" (Add/Edit/Delete), "All Statuses" (Approved/Pending/Rejected)
  - sort icons have no names
  - **filters persist in localStorage key `aap-storage`**; clear it per test
- **Query:** `GET /requests?offset&limit=20&sortBy=dateOfSubmission&sortOrder=desc[&userId][&search][&dataverseType][&action][&status][&approvableByMe=true]`.
  - The endpoint is **public**: anonymous users can list all requests (`BE src/routes/requestsRoutes.ts:57-64`).
- **Table:** columns "Request Summary", "Dataverse Type", "Request Type", "Submission Date", "Action Date", "Status", "Requested by".
  - **Rows are `<tr onClick>`, not links.** Click the row text.
  - Pagination: "Showing X-Y of N results".
- **Empty states:** "No submitted requests yet", "You haven't submitted any requests yet", "No requests awaiting your review", "No results for the selected filters".

### 5.3 Reviewing (`/submitted-requests/:id`)

- The detail fetches `GET /requests/:id` only when logged in. Anonymous users see "Log in to view request details".
- **Status banner** h3: "<Add|Edit|Delete> Request <Approved|Rejected|Pending>".
- **Action bar:** "Reject" / "Approve". Shown only when `canApprove && status==="pending"`.
  - `canApprove` is computed by the BE from `requests:admin` or committee membership for the request's domains (`BE src/controllers/requests/getRequestByIdHandler.ts:38-53`).
- **Dialogs:** "Approve Request" / "Reject Request".
  - Textarea `getByLabel('Add comment')`, **required**, max 200.
  - Confirm button "Approve Request" / "Reject Request".
- **Bodies sent:** `PUT /requests/:id {status:"approved", reviewerComment}` or `{status:"rejected", reviewerComment}`.
- **After success:** toast "Request approved successfully" / "Request rejected", then redirect to `/submitted-requests?tab=review`.
- **Histories:** `GET /histories/:entityId` (History tab).

### 5.4 What approval triggers (`BE src/services/requests/requestsService.ts`)

**On `PUT /requests/:id` with status changing to `approved`** (line 205+):

1. **DataHub write via IH** (`callIntegrationHubForAction`, `requestsOrchestrator.ts`):

| Type | create | update | delete |
|---|---|---|---|
| glossaries / metrics / reports (all DataHub glossary terms) | `POST /glossary` | `PUT /glossary` | `DELETE /glossary` (DataHub GraphQL `deleteGlossaryEntity`, IH `src/services/glossaryService.ts:125-140`) |
| datamodels | `POST /dataproduct` (+ `/dataproduct/assets`) | `PUT /dataproduct` | `DELETE /dataproduct` |
| grdatasets | dataset | dataset | dataset |

   - The new DataHub id is written back to `request.dataverse_id`.
   - Backend caches for the type are invalidated.
2. **History** row created via `handleHistoryForApprovedRequest`. For a **delete**, all histories of the entity are deleted.
3. If the approver is a committee member, an **approver record** is added (shown as "Reviewed and approved by").
4. For a delete approval, other pending requests for the same item are **auto-resolved** (`resolveSiblingRequestsForDeletedItem`, line 275 / 489).
5. **Email** to the requester (`notifyRequesterOnStatusChange`, `requestNotificationService.ts:387`). Rejection also emails the requester; rejection makes no DataHub write.

**On `POST /requests` (create, pending)**

- DB insert.
- For update/delete: a **read** of the current item from DataHub (`previousDataverseDetails`).
- **Emails:**
  - to **every committee member of each domain** in `dataverseRequestDetails.domains` (or the previous domains) (`notifyCommitteeMembersOnRequestCreation`, `requestNotificationService.ts:260-320`)
  - plus a confirmation to the requester (`notifyRequesterOnRequestSubmission`, line 333)
- These are fire-and-forget **real SES emails to real committee members on dev**.

> **Main-branch security hole (dev):** `POST /requests` accepts a client-supplied `status`. With `"status":"approved"`, any logged-in user writes straight to DataHub with no review (`requestsService.ts:54,69-85`, schema `src/schemas/requestsSchema.ts:133-146`). Fixed on the unmerged branch (`b3650f7`). **Never send `status` in tests.**

### 5.5 Cleanup via API (exact endpoints)

| Created thing | Cleanup | Who may call |
|---|---|---|
| Pending/rejected request | `DELETE /api/requests/:id`. **Hard delete** (`requestsService.ts:290-304`) | the request owner, a `requests:admin`, or a committee member for its domain (`deleteRequestHandler.ts`). Emails already sent cannot be recalled |
| Approved **create** of glossary / metric / report | 1. Find the new DataHub id: `GET /api/requests/:id` → `dataverseId`. 2. `POST /api/requests {action:"delete", dataverseType, dataverseId, dataverseRequestDetails:{}, requesterComment:"e2e cleanup"}` (any user; **emails committee members**). 3. `PUT /api/requests/<deleteReqId> {status:"approved", reviewerComment:"cleanup"}` (`requests:admin`) → DataHub delete + history purge. 4. Optionally `DELETE /api/requests/:id` for both request rows | `requests:admin` (or committee member) |
| Approved create of a data model | Same as above, **or** directly `DELETE /api/data-models/:id`. On main this needs only **any valid JWT**, which is a hole (`BE src/routes/dataProductRoutes.ts:76-82`; branch requires `requests:admin`) | any authenticated (main) |
| Approved update | Submit and approve another update restoring the old values (taken from the request's `previousDataverseDetails`) | `requests:admin` |
| Comment | `DELETE /api/comments/:id` (soft) | author with `comments:delete_own` |
| Comment like | `POST /api/comments/like/:id` again (toggle) | `comments:create` |
| Comment report | **none** | – |
| Endorsement like | `DELETE /api/dataverse/:id/like` | same user |
| Profile fields / picture | `PUT /api/users/profile` with old values / `{"profileImage":{}}` | self |
| Report thumbnail (S3 `tam-aap` bucket) | **no delete endpoint** | – |
| History rows (`POST /histories/:entityId`, **unauthenticated on main**) | no delete endpoint (only removed as a side effect of an approved delete) | – |
| Registered + verified user | **none in the app** (needs Keycloak admin) | – |

---

## 6. Backend endpoint table

Base for tests: `{BASE}/api` + path. Notation: "JWT" means any valid token. **FE?** says whether the frontend uses the endpoint.

**Auth and users**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| POST | /login | yes (NextAuth server) | public | Keycloak token |
| POST | /logout | yes | public (refresh token in body) | Keycloak session revoke; blacklists access token if a header is sent |
| POST | /refresh | yes | public | Keycloak |
| POST | /register/validate-personal | yes | public | none |
| POST | /register/validate-employment | yes | public | none |
| POST | /register | yes | public | DB pending row + **email** |
| GET | /verify-email?token= | yes | public | **Keycloak user create** + DB delete + **welcome email** |
| POST | /resend-verification | yes | public | DB token update + **email** |
| POST | /auth/password-reset/request (FE: /api/password-reset/request) | yes | public, **5/h** | DB token + **email** |
| POST | /auth/password-reset/confirm (FE: /api/password-reset/confirm) | yes | public, **5/h** | **Keycloak password change** |
| GET | /auth/password-reset/{request,confirm} | no | public | none |
| POST | /users/check-exists | no | public | none |
| GET | /users/:id | yes | JWT; self, or role `admin` for others | none |
| PUT | /users/profile | yes | JWT (self) | Keycloak attributes; DB `profile_images` |
| GET | /users/:id/committees | yes | public | none (IH read) |

**Catalog reads**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| GET | /glossaries, /glossaries/:id | yes | public | IH read (cached) |
| GET | /domains, /domains/:id | no | public | IH read |
| GET | /metrics[/:id], /reports[/:id], /datasets[/:id], /grdatasets[/:id], /datacontracts[/:id], /data-quality-rules[/:id] | yes | JWT | IH read |
| GET | /data-models, /data-models/:id | yes | JWT | IH read |

**Catalog writes**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| POST/PUT/DELETE | /data-models, /data-models/:id, POST /data-models/assets | no | **JWT only on main** (`requests:admin` on branch) | **DataHub write** |
| POST | /reports/thumbnail | yes | JWT | **S3 upload** (no delete) |

**Requests**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| POST | /requests | yes | JWT | DB insert; **emails** (committee + requester); if `status:"approved"` → **DataHub write** (main) |
| GET | /requests | yes | public; optional JWT (`approvableByMe` needs a JWT) | none |
| GET | /requests/dataverse/:dataverseId | yes | public | none |
| GET | /requests/:id | yes | public; optional JWT (adds `canApprove`) | none |
| PUT | /requests/:id | yes | JWT. Owner may edit details only; status/reviewerComment need `requests:admin` or a committee member | on approve: **DataHub write**, history, approver, sibling auto-resolve, **email**; on reject: **email** |
| DELETE | /requests/:id | yes (API only, no UI button) | JWT: owner / `requests:admin` / committee member | hard delete in DB |

**Histories**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| GET | /histories/:entityId | yes | public | none |
| POST | /histories/:entityId | no | **none on main** (`requests:admin` on branch) | DB insert |
| PUT | /histories/:entityId/:historyId | no | **none on main** | DB update |

**Comments**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| GET | /comments, /comments/:id, /comments/thread/:id, /comments/likes/:id | yes | public | none |
| POST | /comments | yes | `comments:create` | DB |
| PUT | /comments/:id | yes | `comments:update_own` (owner) | DB |
| DELETE | /comments/:id | yes | `comments:delete_own` (owner) | DB soft delete |
| POST | /comments/reply/:id | yes | `comments:create` | DB |
| POST | /comments/like/:id | yes | `comments:create` | DB toggle |
| POST | /comments/report/:id | yes | `comments:create` | DB (no undo) |
| GET | /comments/reports | no | `reports:read` | none |

**Endorsers and committees**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| GET/POST/DELETE | /dataverse/:id/like | yes | JWT | DB (endorsers) |
| GET | /endorsers, /endorsers/:id; POST /endorsers, /endorsers/by-ids | yes (POST /endorsers) | public | none |
| POST /endorsers/create; PUT/DELETE /endorsers/:id; PUT /dataverse/:id/endorsers | – | no | `endorser:admin` | DB |
| GET | /dataverse/endorsers, /dataverse/:id/endorsers | no | public | none |
| GET | /committees, /committees/:id | yes | public | IH read |
| POST/PUT/DELETE | /committees[/:id] | no | `committees:admin` | **DataHub write** |

**Email and health**

| Method | Path | FE? | Auth / role | Side effects |
|---|---|---|---|---|
| POST | /email/send, /email/send/{welcome,password-reset,notification,system-alert} | no | **NONE on main** (open relay; fixed on branch) | **sends arbitrary email** |
| GET | /email/status | no | none on main | none |
| GET | /health, / | no (FE `/api/health` is the FE's own) | public | none |

- Global limiter: **100 requests/min per key**, applied to all routes. The key is effectively the FE pod for all browser and SSR traffic.

---

## 7. Risky-for-e2e notes

1. **Shared rate-limit bucket.**
   - 100 requests/min (`RATE_LIMIT_MAX: 100`, `RATE_LIMIT_TIME_WINDOW: "1 minute"`) for **all dev traffic combined**. The FE proxy does not forward XFF; there is 1 FE replica.
   - One detail page load is roughly 5–8 backend calls (SSR prefetch, client refetch, endorsers, like status, comments, histories).
   - A parallel Playwright suite **will** hit 429 and break dev for everyone else.
   - Keep `workers: 1–2`, add pacing, and reuse `storageState` instead of logging in per test.
   - Errors surface as `RATE_LIMIT_EXCEEDED` / HTTP 429 with a `retry-after` header.
2. **Password reset: 5 per hour, globally.** Use it at most once per run, or not at all in CI.
3. **Real emails (AWS SES from `noreply@emma-platform.com`):**
   - `POST /register`
   - `POST /resend-verification`
   - verify-email (welcome)
   - password-reset request
   - every `POST /requests`: to all committee members of the request's domains, plus the requester
   - every approve or reject: to the requester
   - Requests with **no `domains`** in `dataverseRequestDetails` skip the committee emails (`requestNotificationService.ts:266-273`). The UI forms require a domain for glossary, metrics and reports; data models have none.
   - So API-created test requests can avoid committee spam by omitting `domains`. The requester confirmation is still sent.
4. **DataHub writes:** approving any create, update or delete request; `/data-models` writes; committee CRUD; and (on main) `POST /requests` with `status:"approved"`. These affect shared catalog content seen by all dev users. Cleanup requires a second approve cycle (§5.5).
5. **Irreversible actions:**
   - Keycloak user creation via verify-email
   - password change via reset confirm (re-reset needs the mailbox)
   - S3 thumbnails
   - comment reports
   - soft-deleted comments (rows remain)
   - sent emails
   - history rows created by approvals
   - approver records ("Reviewed and approved by")
6. **Logout** revokes the Keycloak session for that refresh token. Use a separate session or user, otherwise shared `storageState` breaks.
7. **Main-branch holes to avoid triggering:**
   - `POST /requests` with `status`
   - open `/email/*`
   - unauthenticated `/histories` writes
   - `/data-models` writes with any JWT
8. **Safe to run repeatedly:**
   - all GET pages and lists, search, filters, pagination
   - static pages
   - login (moderately; it counts against 100/min) and session checks
   - registration step 1 and 2 validation endpoints, including negative cases
   - verify-email with a bogus token
   - restricted-access checks
   - comment create + delete (soft), like/unlike toggles, endorsement like/unlike
   - profile field edit + revert
   - creating a request + deleting it as owner (but this **emails the requester**, and committee members if domains are set)

---

## 8. Suggested e2e test list

Conventions: R = READ (no side effects); W = WRITE, with the cleanup in brackets.

**Smoke / navigation**
- R: Landing renders the "Airport Acumen Dataverse" h2 and the 8 cards with the correct hrefs (note: the GR card goes to `/dataverse/reference-datasets`).
- R: Header Dataverse menu links to each list. TAM menu works. "Airport Community" loads committees.
- R: Anonymous user on `/dataverse/airport-metrics` (and the other gated lists) sees "Access Restricted".
- R: Anonymous `/profile-settings` → redirect to `/login?callbackUrl=%2Fprofile-settings`.
- R: Anonymous `/technical-resources` → login redirect. Logged-in → "launching soon" page (documents the broken nav links).
- R: `/terms` tabs switch. `/tam/definition` arrows work.

**Auth**
- R: Login success (dedicated user) → avatar visible; popover shows the email.
- R: Login with a wrong password → "The Email/Username or password you entered is incorrect."
- W: Logout → "Log in" button visible. [no cleanup; use a dedicated session]
- R: Register step 1 client and server validation: password rules, mismatch, gmail → "Personal email addresses are not allowed…", disposable email → error. Step 2 validation, terms checkbox.
- W (manual/nightly only): Full registration with a business-domain test mailbox → verify link → login. [irreversible Keycloak user; needs mailbox]
- R: `/verify-email?token=bogus` → "Verification Failed".
- R: `/reset-password` without a token → "Invalid Reset Link".
- W (rare): Request password reset for the test user → success banner. [consumes the 5/h global budget; sends an email]

**Catalog (logged in, R)**
- Each list page: hero h1, default results, "Showing 1-20 of N results", search narrows results (wait for the `search=` response), domain filter (`getByTitle`), pagination page 2, empty-search message.
- Glossary: AlphabetNav letter → `initialLetter`; "View All". Anonymous access works.
- Metrics: Filters → owning entity multiselect.
- Datasets: "Global Reference Dataset" tab adds `hasGlobalReference=true`.
- DQR: rule-type toggle buttons.
- Data contracts: "Service" tab → `type=service`; domain uses `domainName`.
- Data model: cards → detail asset cards.
- Each detail page: breadcrumb, h1 = item name, tabs Main/History(/Edit), History tab loads (`/histories`), comments section renders, not-found page for an invalid id (e.g. "Glossary Term Not Found").
- GR detail: "Download Table" triggers a download (`page.waitForEvent('download')`).

**Collaboration**
- W: Add comment on a glossary term → appears → delete it. [API `DELETE /api/comments/:id` in `afterEach`]
- W: Reply to own comment → delete parent (cascading soft delete).
- W: Like / unlike a comment. [toggle back]
- W: Edit own comment → "Edited". [delete]
- W (avoid or limit): Report comment. [no cleanup; only report own throwaway comments]
- R: Anonymous user sees no add-comment form; clicking Like → login redirect.
- W: Endorse / unendorse (only if the test user's employer is an endorser). [`DELETE /api/dataverse/:id/like`]
- W: Profile: edit job title → save → reload shows the new value → revert. [PUT old values]
- W: Profile picture upload (small jpeg) → avatar shows image → remove. [PUT `{"profileImage":{}}`]

**Requests**
- R: `/submitted-requests` All tab table renders. Anonymous "My Requests" tab → "Log in to view your requests". Filters (clear localStorage `aap-storage` first).
- W: Create a glossary item via the UI (unique title, e.g. `E2E-<timestamp>`) → toast "New glossary item submitted successfully" → appears in My Requests as Pending → open detail → status "Add Request Pending". [`DELETE /api/requests/:id` as owner; emails requester + committee of chosen domain, so pick a domain whose committee is OK to spam or coordinate with the team]
- W: Edit request from a detail Edit tab ("Request edit") → "Edits submitted successfully" → pending banner "Request pending". [delete request]
- W: "Request delete" with a reason → "Delete request submitted". [delete request; **never approve on real items**]
- W (admin user): Reject a self-created test request → "Request rejected" → status Rejected. [delete request; emails requester]
- W (admin user, nightly only): Approve a create request for a throwaway glossary term → term appears in the glossary list → cleanup by creating and approving a delete request, then deleting both request rows. [DataHub write + delete; emails]
- R: Non-admin user without committees sees no "For My Review" tab, and no Approve/Reject on a request detail.

**API-level checks** (fast, low-cost; still count against the rate limit)
- R: `GET /api/glossaries` 200 without a token. `GET /api/metrics` → 401 without a token.
- R: `PUT /api/requests/:id {status}` as a non-admin owner → 403.
- R: `DELETE /api/comments/:id` of another user's comment → 403/400.

---

## 9. Playwright gotchas (collected)

- **Duplicate renders:** login and register forms render twice (desktop and mobile) with duplicate ids. Use `:visible`, or `#login-email-desktop` at desktop viewport.
- **Icon-only buttons with no accessible name:**
  - pagination prev/next
  - avatar/user menu button
  - profile card edit
  - sort arrows on submitted requests
  - multiselect clear "x"
  - sheet close buttons
  - datasets globe link
  - password eye toggle
- **Not semantic:**
  - detail tabs are plain buttons (`getByRole('button',{name:'Edit'})`); Radix `role=tab` is used only on datasets, data-contracts and terms
  - submitted-request rows are `<tr onClick>`
  - profile upload overlay has no `role=dialog`
- **Multiple h1s** on detail pages (item title, "Endorsed by members from", report section headers) and 5 on the landing slider.
- **Hidden-but-present elements:** add-comment Cancel/Submit before focus; slider slides; the mention textarea's transparent text (assert with `toHaveValue`).
- **Hover-only elements:** "Endorsed" tooltip; profile picture change/delete icons; committee description tooltip; DQR frequency tooltip.
- **New tabs:** the single pending-request link, history "Request details", data-model asset "View Details", per-item request rows (`target=_blank`). Handle with `context.waitForEvent('page')`.
- **Persisted state:** submitted-request filters in localStorage `aap-storage`. Registration email in sessionStorage `pendingVerificationEmail`.
- **Debounce:** 300ms on all searches. Wait for network responses, not timeouts.
- **Text quirks:**
  - data-contracts search placeholder reads "Search Global reference datasets"
  - reference-datasets hero reads "Measure what matters"
  - data-model cards use "View details" (lowercase d)
  - "No Reports found." has a capital R
- **Session:** the NextAuth cookie lives 1h; the client caches the session for 5 minutes (`lib/config/session.ts`). Re-create `storageState` per run.

**Unclear / not verifiable from code**
- Keycloak access-token lifetime and default realm roles for new users.
- Whether Redis is enabled for the limiter on dev (it is shared either way).
- Exact DataHub semantics of `deleteGlossaryEntity` (hard vs soft).
- The profile-settings view-mode population bug.
