import "server-only";
import { fetchQboInvoice } from "@/lib/qbo/client";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Asks QuickBooks whether a job's invoice has been paid and records the answer.
 * Returns the payment status now on the job, or null if the job has no invoice.
 */
export async function refreshPayment(db: Db, jobId: string): Promise<"paid" | "unpaid" | null> {
  const { data: job } = await db.from("service_jobs").select("qbo_invoice_id").eq("id", jobId).maybeSingle();
  if (!job?.qbo_invoice_id) return null;
  const invoice = await fetchQboInvoice(job.qbo_invoice_id);
  const status = invoice.balance > 0 ? "unpaid" : "paid";
  const { error } = await db
    .from("service_jobs")
    .update({
      invoice_total: invoice.total,
      invoice_balance: invoice.balance,
      qbo_invoice_number: invoice.docNumber,
      payment_status: status,
      payment_checked_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
  return status;
}
