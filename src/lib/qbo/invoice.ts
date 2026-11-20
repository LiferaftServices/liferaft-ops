// Builds the invoice QuickBooks will receive for a service job. Pure, so the exact
// document can be tested without a connection. It follows how service invoices are
// already written by hand: one line per item, then (when there is a discount) a
// "Subtotal" note line and a SERVICE DISCOUNT line.

export interface InvoiceLineInput {
  qboItemId: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
}

export interface InvoiceInput {
  qboCustomerId: string;
  date: string; // YYYY-MM-DD
  lines: InvoiceLineInput[];
  vesselName?: string | null;
  /** Shown to the customer at the foot of the invoice. */
  customerMemo?: string | null;
  /** Internal note, not shown to the customer. */
  privateNote?: string | null;
  billEmail?: string | null;
  discountPercent?: number;
  /** Item ids for the two discount lines; required when discountPercent > 0. */
  subtotalItemId?: string | null;
  discountItemId?: string | null;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function invoiceSubtotal(lines: InvoiceLineInput[]): number {
  return cents(lines.reduce((sum, l) => sum + cents(l.quantity * l.unitPrice), 0));
}

export function discountAmount(lines: InvoiceLineInput[], percent: number): number {
  return percent > 0 ? cents((invoiceSubtotal(lines) * percent) / 100) : 0;
}

export function buildInvoice(input: InvoiceInput): Record<string, unknown> {
  if (!input.lines.length) throw new Error("An invoice needs at least one line.");
  const line = (itemId: string, description: string | null, qty: number, price: number, taxable: boolean) => ({
    DetailType: "SalesItemLineDetail",
    Amount: cents(qty * price),
    ...(description ? { Description: description } : {}),
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: qty,
      UnitPrice: price,
      TaxCodeRef: { value: taxable ? "TAX" : "NON" },
    },
  });
  const lines: Record<string, unknown>[] = input.lines.map((l) =>
    line(l.qboItemId, l.description, l.quantity, l.unitPrice, l.taxable),
  );
  const percent = input.discountPercent ?? 0;
  if (percent > 0) {
    if (!input.subtotalItemId || !input.discountItemId) {
      throw new Error("The discount items were not found in QuickBooks, so a discount cannot be added.");
    }
    lines.push(line(input.subtotalItemId, `Subtotal: ${money(invoiceSubtotal(input.lines))}`, 0, 0, false));
    lines.push(line(input.discountItemId, "Service Discount", 1, -discountAmount(input.lines, percent), true));
  }
  return {
    CustomerRef: { value: input.qboCustomerId },
    TxnDate: input.date,
    Line: lines,
    ...(input.vesselName
      ? { CustomField: [{ DefinitionId: "3", Name: "Vessel", Type: "StringType", StringValue: input.vesselName.slice(0, 31) }] }
      : {}),
    ...(input.customerMemo ? { CustomerMemo: { value: input.customerMemo } } : {}),
    ...(input.privateNote ? { PrivateNote: input.privateNote } : {}),
    ...(input.billEmail ? { BillEmail: { Address: input.billEmail } } : {}),
  };
}

/**
 * True when an invoice in QuickBooks no longer matches what was sent: a different total
 * or a different number of item lines. Payments do not count; they change the balance only.
 */
export function invoiceChanged(
  sent: { total: number; lines: number },
  now: { total: number; lines: number },
): boolean {
  return Math.abs(sent.total - now.total) >= 0.005 || sent.lines !== now.lines;
}
