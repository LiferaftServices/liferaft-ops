// Checks how the customer sync behaves when QuickBooks answers with an error:
// a syntax error in a query, a validation fault, and a rejected sign-in.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface Call {
  table: string;
  op: string;
  payload?: unknown;
}
const calls: Call[] = [];
let connection: Record<string, unknown> | null;

function table(name: string) {
  const done = { error: null };
  return {
    select: () => ({ maybeSingle: async () => ({ data: connection, error: null }) }),
    update: (payload: unknown) => ({
      eq: async () => (calls.push({ table: name, op: "update", payload }), done),
    }),
    upsert: async (payload: unknown) => (calls.push({ table: name, op: "upsert", payload }), done),
    delete: () => ({
      eq: async () => (calls.push({ table: name, op: "delete" }), done),
      lt: async () => (calls.push({ table: name, op: "prune" }), done),
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: table }) }));

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

const fault = (type: string, code: string, message: string) => ({
  Fault: { Error: [{ Message: message, Detail: message, code }], type },
});

beforeEach(() => {
  calls.length = 0;
  connection = {
    environment: "sandbox",
    realm_id: "123",
    access_token: "ACCESS",
    access_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    refresh_token: "REFRESH",
  };
  process.env.QBO_CLIENT_ID = "id";
  process.env.QBO_CLIENT_SECRET = "secret";
  process.env.QBO_REDIRECT_URI = "https://example.test/api/qbo/callback";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function runSync(fetchImpl: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => fetchImpl(String(url))));
  const { syncCustomers } = await import("../src/lib/qbo/client");
  return syncCustomers();
}

describe("QuickBooks API errors", () => {
  it("stops on a query syntax error, records it, and removes nothing", async () => {
    await expect(
      runSync(() =>
        reply(400, fault("ValidationFault", "4000", "Error parsing query"), { intuit_tid: "tid-1" }),
      ),
    ).rejects.toThrow(/400/);
    expect(calls.some((c) => c.op === "prune" || c.op === "upsert")).toBe(false);
    const recorded = calls.find((c) => c.table === "qbo_connection" && c.op === "update");
    expect(JSON.stringify(recorded?.payload)).toContain("Error parsing query");
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("intuit_tid=tid-1");
  });

  it("stops on a validation fault part-way through without pruning the copy", async () => {
    let page = 0;
    const full = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i + 1), DisplayName: `TRAINING ${i}` }));
    await expect(
      runSync(() => {
        page += 1;
        return page === 1
          ? reply(200, { QueryResponse: { Customer: full } })
          : reply(400, fault("ValidationFault", "2020", "Required param missing"));
      }),
    ).rejects.toThrow(/Required param missing/);
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(2); // first page saved in two batches
    expect(calls.some((c) => c.op === "prune")).toBe(false);
  });

  it("renews a rejected access token once and carries on", async () => {
    let apiCalls = 0;
    const count = await runSync((url) => {
      if (url.includes("openid")) return reply(404, "");
      if (url.includes("tokens/bearer")) {
        return reply(200, { access_token: "NEW", expires_in: 3600, refresh_token: "NEWREFRESH" });
      }
      apiCalls += 1;
      return apiCalls === 1
        ? reply(401, fault("AUTHENTICATION", "3200", "Token expired"))
        : reply(200, { QueryResponse: { Customer: [{ Id: "1", DisplayName: "TRAINING Co" }] } });
    });
    expect(count).toBe(1);
    const saved = calls.find((c) => c.op === "update" && JSON.stringify(c.payload).includes("NEWREFRESH"));
    expect(saved).toBeTruthy();
  });

  it("drops a dead connection and asks for a reconnect on invalid_grant", async () => {
    connection!.access_expires_at = new Date(Date.now() - 1000).toISOString();
    const { QboReconnectError } = await import("../src/lib/qbo/oauth");
    await expect(
      runSync((url) =>
        url.includes("openid") ? reply(404, "") : reply(400, { error: "invalid_grant" }),
      ),
    ).rejects.toBeInstanceOf(QboReconnectError);
    expect(calls.some((c) => c.table === "qbo_connection" && c.op === "delete")).toBe(true);
  });
});
