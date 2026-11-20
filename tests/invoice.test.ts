import { describe, expect, it } from "vitest";
import { buildInvoice, discountAmount, invoiceSubtotal, type InvoiceLineInput } from "../src/lib/qbo/invoice";

// The lines of a real service invoice, to check the arithmetic against QuickBooks.
const lines: InvoiceLineInput[] = [
  { qboItemId: "8999", description: "4 Person Coastal Liferaft Standard Service", quantity: 1, unitPrice: 475, taxable: false },
  { qboItemId: "9516", description: "ELLIOT CERTIFICATE OF RE-INSPECTION", quantity: 1, unitPrice: 195, taxable: false },
  { qboItemId: "8785", description: "NEXT SERVICE LABEL USCG - EACH", quantity: 1, unitPrice: 10, taxable: true },
  { qboItemId: "9152", description: "PLATE, INSPECTION RECORD", quantity: 1, unitPrice: 23.08, taxable: true },
  { qboItemId: "9103", description: "STRAPS/CRIMPS", quantity: 2, unitPrice: 25.52, taxable: true },
  { qboItemId: "8805", description: "D Cell Battery, Dated", quantity: 6, unitPrice: 3.04, taxable: true },
  { qboItemId: "9170", description: "SERVICING MATERIALS", quantity: 1, unitPrice: 35, taxable: true },
  { qboItemId: "9154", description: "HAMMAR H20R", quantity: 1, unitPrice: 98, taxable: true },
];

describe("service invoice", () => {
  it("matches the subtotal and 5% discount of the hand-written invoice", () => {
    expect(invoiceSubtotal(lines)).toBe(905.36);
    expect(discountAmount(lines, 5)).toBe(45.27);
  });

  it("writes one line per item with tax marked, and the vessel field", () => {
    const inv = buildInvoice({ qboCustomerId: "36250", date: "2026-11-20", lines, vesselName: "Ms Silda" }) as {
      CustomerRef: { value: string };
      Line: { Amount: number; SalesItemLineDetail: { ItemRef: { value: string }; Qty: number; TaxCodeRef: { value: string } } }[];
      CustomField: { DefinitionId: string; StringValue: string }[];
    };
    expect(inv.CustomerRef.value).toBe("36250");
    expect(inv.Line).toHaveLength(8);
    expect(inv.Line[0].SalesItemLineDetail.TaxCodeRef.value).toBe("NON");
    expect(inv.Line[4]).toMatchObject({ Amount: 51.04, SalesItemLineDetail: { Qty: 2, TaxCodeRef: { value: "TAX" } } });
    expect(inv.CustomField[0]).toMatchObject({ DefinitionId: "3", StringValue: "Ms Silda" });
  });

  it("adds the subtotal note and the discount line the way they are done today", () => {
    const inv = buildInvoice({
      qboCustomerId: "36250", date: "2026-11-20", lines, discountPercent: 5, subtotalItemId: "10649", discountItemId: "9579",
    }) as { Line: { Amount: number; Description?: string; SalesItemLineDetail: { ItemRef: { value: string }; TaxCodeRef: { value: string } } }[] };
    expect(inv.Line).toHaveLength(10);
    expect(inv.Line[8]).toMatchObject({ Amount: 0, Description: "Subtotal: $905.36" });
    expect(inv.Line[9]).toMatchObject({ Amount: -45.27, SalesItemLineDetail: { ItemRef: { value: "9579" }, TaxCodeRef: { value: "TAX" } } });
    const total = inv.Line.reduce((s, l) => s + l.Amount, 0);
    expect(Math.round(total * 100) / 100).toBe(860.09);
  });

  it("refuses a discount when the discount items are missing, and an empty invoice", () => {
    expect(() => buildInvoice({ qboCustomerId: "1", date: "2026-11-20", lines, discountPercent: 5 })).toThrow(/discount/);
    expect(() => buildInvoice({ qboCustomerId: "1", date: "2026-11-20", lines: [] })).toThrow(/at least one line/);
  });
});
