import "server-only";
import { fetchQboInvoice } from "@/lib/qbo/client";
import { invoiceChanged } from "@/lib/qbo/invoice";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Asks QuickBooks about every invoice on a job: whether it has been paid, and whether it
 * was changed there after it was created. Records the answers and returns the job's
 * payment status, or null if the job has no invoice. The job is unpaid while any of its
 * invoices has a balance.
 */
export async function refreshPayment(db: Db, jobId: string): Promise<"paid" | "unpaid" | null> {
  const { data: invoices } = await db
    .from("job_invoices")
    .select("id, qbo_invoice_id, total_sent, lines_sent")
    .eq("job_id", jobId)
    .order("created_at");
  if (!invoices?.length) return null;
  const checkedAt = new Date().toISOString();
  let total = 0;
  let balance = 0;
  for (const row of invoices) {
    const now = await fetchQboInvoice(row.qbo_invoice_id);
    total += now.total;
    balance += now.balance;
    const { error } = await db
      .from("job_invoices")
      .update({
        doc_number: now.docNumber,
        total: now.total,
        lines_now: now.lineCount,
        balance: now.balance,
        changed_in_qbo: invoiceChanged(
          { total: Number(row.total_sent), lines: row.lines_sent },
          { total: now.total, lines: now.lineCount },
        ),
        checked_at: checkedAt,
      })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
  }
  const status = balance > 0.004 ? "unpaid" : "paid";
  const { error } = await db
    .from("service_jobs")
    .update({
      invoice_total: Math.round(total * 100) / 100,
      invoice_balance: Math.round(balance * 100) / 100,
      payment_status: status,
      payment_checked_at: checkedAt,
    })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
  return status;
}
