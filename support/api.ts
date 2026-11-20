import { APIRequestContext, expect, request } from "@playwright/test";

import { BASE_URL, credentials, Role } from "./env";

/**
 * Direct API access through the frontend's /api proxy (same path the browser uses),
 * authenticated with a bearer token obtained from POST /api/login.
 * Used for API-level checks and for cleaning up data created by @write tests.
 */
export async function apiAs(role: Role): Promise<APIRequestContext> {
  const anon = await request.newContext({ baseURL: BASE_URL });
  const { email, password } = credentials(role);
  const res = await anon.post("/api/login", {
    data: { username: email, password, grant_type: "password" },
  });
  expect(res.status(), `login as ${role}`).toBe(200);
  const body = await res.json();
  const token = body.access_token ?? body.data?.access_token ?? body.token;
  expect(token, "access token in login response").toBeTruthy();
  await anon.dispose();
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
}

export async function anonApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL });
}
