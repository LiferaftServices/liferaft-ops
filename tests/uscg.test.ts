import { describe, expect, it } from "vitest";
import { buildNotice, mailto, suggestServiceType } from "../src/lib/uscg";

describe("USCG notice", () => {
  it("matches the notice the shops send today", () => {
    const n = buildNotice({
      shopName: "Belfast Raft Service", vesselName: "F/V Julie Ann", brand: "Revere", approvalNumber: "160.051/336/0",
      serialNumber: "20A(I)04077", capacity: 4, manufactureDate: "2020-10-23", serviceType: "Annual",
    });
    expect(n.subject).toBe("Liferaft Services Belfast - Service Station Notice for F/V Julie Ann, 20A(I)04077");
    expect(n.body.split("\n")).toEqual([
      "Vessel Name & Type: F/V Julie Ann", "Raft Manufacturer: Revere", "CG Approval #: 160.051/336/0", "Serial #: 20A(I)04077",
      "Capacity of Raft: 4", "MFG Date: 10/23/2020", "Service Type: Annual",
    ]);
    expect(n.missing).toEqual([]);
  });
  it("lists what is missing", () => {
    const n = buildNotice({ shopName: "York Raft Service", vesselName: null, brand: "Revere", approvalNumber: null, serialNumber: "X1", capacity: 6, manufactureDate: null, serviceType: "Annual" });
    expect(n.missing).toEqual(["vessel name", "CG approval number", "manufacture date"]);
  });
  it("suggests the service type from the raft's age", () => {
    const today = new Date("2026-11-23T12:00:00");
    expect(suggestServiceType("2024-06-01", today)).toBe("Annual");
    expect(suggestServiceType("2021-11-01", today)).toBe("5-yr");
    expect(suggestServiceType("2016-10-01", today)).toBe("Annual, FS, NAP");
    expect(suggestServiceType("2010-01-01", today)).toBe("Annual, FS, NAP");
    expect(suggestServiceType(null, today)).toBe("Annual");
  });
  it("builds an email link with the copy address", () => {
    const link = mailto("a@uscg.mil", "service@survivalatsea.com", "Notice for F/V X", "Line 1\nLine 2");
    expect(link).toContain("mailto:a%40uscg.mil?cc=service%40survivalatsea.com&subject=Notice%20for%20F%2FV%20X&body=Line%201%0D%0ALine%202");
  });
});
