import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const COLUMNS = [
  "qbo_id",
  "parent_qbo_id",
  "level",
  "active",
  "display_name",
  "fully_qualified_name",
  "company_name",
  "given_name",
  "family_name",
  "email",
  "phone",
  "mobile",
  "balance",
  "qbo_updated_at",
] as const;

const PAGE = 1000;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Stop a spreadsheet from treating a value as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Admin-only download of the QuickBooks customer copy, used to prepare the data import.
export async function GET() {
  const session = await getSession();
  if (session.status !== "staff" || session.staff.role !== "admin") {
    return new NextResponse("Only an admin can download the customer list.", { status: 403 });
  }
  const supabase = await createClient();
  const lines = [COLUMNS.join(",")];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("qbo_customers")
      .select(COLUMNS.join(","))
      .order("qbo_id")
      .range(from, from + PAGE - 1);
    if (error) return new NextResponse(`Could not read customers: ${error.message}`, { status: 500 });
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of rows) lines.push(COLUMNS.map((c) => cell(row[c])).join(","));
    if (rows.length < PAGE) break;
  }
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="quickbooks-customers.csv"',
      "Cache-Control": "no-store",
    },
  });
}
