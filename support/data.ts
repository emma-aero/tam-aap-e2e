import { APIRequestContext, expect } from "@playwright/test";

import { RUN_TAG } from "./env";

/** Lists in this API come back in a few shapes; normalise to an array. */
export function items(body: any): any[] {
  return body?.results ?? body?.data?.results ?? body?.data ?? (Array.isArray(body) ? body : []);
}

export function idOf(item: any): string {
  return String(item.id ?? item.urn ?? item.dataverseId);
}

/**
 * A pending glossary "create" request with NO domains: the backend then skips the
 * committee emails (only the requester gets a confirmation). Never sends `status`.
 */
export async function createTestRequest(api: APIRequestContext, label = "request") {
  const res = await api.post("/api/requests", {
    data: {
      action: "create",
      dataverseType: "glossaries",
      dataverseRequestDetails: {
        title: `${RUN_TAG} ${label}`,
        description: "Created by the automated e2e suite; deleted again by the same test.",
      },
      requesterComment: `${RUN_TAG} automated test`,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return body.data ?? body;
}

export async function deleteRequest(api: APIRequestContext, id: string) {
  const res = await api.delete(`/api/requests/${id}`);
  expect([200, 204, 404]).toContain(res.status());
}

/** Deletes every request this run created that is still around (safety net). */
export async function deleteRunRequests(api: APIRequestContext) {
  const res = await api.get(`/api/requests?search=${encodeURIComponent(RUN_TAG)}&limit=100`);
  if (res.status() !== 200) return;
  for (const r of items(await res.json())) {
    if (String(r.summary ?? r.dataverseRequestDetails?.title ?? "").includes(RUN_TAG)) {
      await api.delete(`/api/requests/${r.id}`);
    }
  }
}

export async function firstId(api: APIRequestContext, listPath: string): Promise<string | undefined> {
  const res = await api.get(listPath);
  expect(res.status(), listPath).toBe(200);
  const list = items(await res.json());
  return list.length ? idOf(list[0]) : undefined;
}
