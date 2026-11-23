import { describe, expect, it } from "vitest";
import { firstEmail, isTraining, MESSAGES, type MessageContext } from "../src/lib/notifications";

const c: MessageContext = {
  firstName: "Danny", vesselName: "F/V Ms Silda", raft: "Elliot 4-person liferaft", serialNumber: "5132600201125", shopName: "York",
  invoiceNumber: "23454", balance: 870.54, nextDue: "December 31, 2027", turnaround: "about 2 weeks",
};

describe("customer messages", () => {
  it("fills in every message without leftovers", () => {
    for (const m of MESSAGES) {
      const text = `${m.subject(c)}\n${m.body(c)}`;
      expect(text).not.toMatch(/undefined|null|\{|\}/);
      expect(m.body(c)).toContain("Hi Danny,");
      expect(m.body(c)).toContain("207-363-0220");
    }
  });
  it("still reads well with details missing", () => {
    const bare = { ...c, firstName: null, vesselName: null, serialNumber: null, invoiceNumber: null, balance: null, nextDue: null, turnaround: null };
    for (const m of MESSAGES) {
      const text = `${m.subject(bare)}\n${m.body(bare)}`;
      expect(text).not.toMatch(/undefined|null|  /);
      expect(m.body(bare)).toContain("Hi there,");
    }
  });
  it("never messages training records, and picks one address from several", () => {
    expect(isTraining("TRAINING Dan Greer", "X")).toBe(true);
    expect(isTraining("Dan Greer", "training-001")).toBe(true);
    expect(isTraining("Dan Greer", "5132600201125")).toBe(false);
    expect(firstEmail("jon@foss.com, ap@foss.com")).toBe("jon@foss.com");
    expect(firstEmail("")).toBeNull();
  });
});
