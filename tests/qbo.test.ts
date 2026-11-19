import { describe, expect, it } from "vitest";
import { apiBase, missingQboSettings, qboConfig } from "../src/lib/qbo/config";
import { customerPageQuery, toCustomerRow } from "../src/lib/qbo/customers";
import { authorizeUrl, toTokenSet } from "../src/lib/qbo/oauth";

const env = {
  QBO_CLIENT_ID: "client",
  QBO_CLIENT_SECRET: "secret",
  QBO_REDIRECT_URI: "https://example.test/api/qbo/callback",
  SUPABASE_SECRET_KEY: "k",
} as unknown as NodeJS.ProcessEnv;

describe("QuickBooks settings", () => {
  it("defaults to the practice company unless production is set explicitly", () => {
    expect(qboConfig(env).environment).toBe("sandbox");
    expect(qboConfig({ ...env, QBO_ENVIRONMENT: "production" }).environment).toBe("production");
    expect(apiBase("sandbox")).toContain("sandbox");
    expect(apiBase("production")).not.toContain("sandbox");
  });

  it("names the settings that are missing", () => {
    expect(missingQboSettings({} as NodeJS.ProcessEnv)).toHaveLength(4);
    expect(missingQboSettings(env)).toEqual([]);
  });
});

describe("QuickBooks sign-in", () => {
  it("asks for accounting access only and carries the state value", () => {
    const url = new URL(authorizeUrl(qboConfig(env), "abc123"));
    expect(url.origin).toBe("https://appcenter.intuit.com");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("redirect_uri")).toBe(env.QBO_REDIRECT_URI);
    expect(url.toString()).not.toContain("secret");
  });

  it("treats the access token as expiring a minute early", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const t = toTokenSet(
      { access_token: "a", expires_in: 3600, refresh_token: "r", x_refresh_token_expires_in: 86400 },
      now,
    );
    expect(t.accessExpiresAt.toISOString()).toBe("2026-11-19T12:59:00.000Z");
    expect(t.refreshExpiresAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });
});

describe("QuickBooks customers", () => {
  const at = new Date("2026-11-19T12:00:00Z");

  it("maps a sub-customer with its parent link", () => {
    const row = toCustomerRow(
      {
        Id: "204",
        SyncToken: "3",
        DisplayName: "F/V TRAINING",
        FullyQualifiedName: "TRAINING Fleet Co:F/V TRAINING",
        Job: true,
        Level: 1,
        ParentRef: { value: "88" },
        Active: true,
        PrimaryEmailAddr: { Address: " training@example.test " },
        PrimaryPhone: { FreeFormNumber: "207-555-0100" },
        BillAddr: { Line1: "1 Wharf St", City: "York", CountrySubDivisionCode: "ME", PostalCode: "03909" },
        Balance: 125.5,
        MetaData: { LastUpdatedTime: "2026-10-01T10:00:00-07:00" },
      },
      at,
    );
    expect(row).toMatchObject({
      qbo_id: "204",
      display_name: "F/V TRAINING",
      fully_qualified_name: "TRAINING Fleet Co:F/V TRAINING",
      parent_qbo_id: "88",
      level: 1,
      email: "training@example.test",
      phone: "207-555-0100",
      balance: 125.5,
      bill_address: { lines: "1 Wharf St", city: "York", state: "ME", postal_code: "03909" },
    });
  });

  it("copes with a bare top-level record", () => {
    const row = toCustomerRow({ Id: "9", DisplayName: "TRAINING Solo" }, at);
    expect(row.parent_qbo_id).toBeNull();
    expect(row.level).toBe(0);
    expect(row.active).toBe(true);
    expect(row.fully_qualified_name).toBe("TRAINING Solo");
    expect(row.bill_address).toBeNull();
  });

  it("pages through inactive customers too", () => {
    const q = customerPageQuery(1001, 1000);
    expect(q).toContain("Active in (true, false)");
    expect(q).toContain("startposition 1001 maxresults 1000");
  });
});
