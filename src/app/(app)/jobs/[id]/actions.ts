"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { refreshPayment } from "@/lib/payments";
import { createQboInvoice } from "@/lib/qbo/client";
import { discountItems } from "@/lib/discounts";
import { buildInvoice } from "@/lib/qbo/invoice";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PartState {
  ok: boolean;
  message: string | null;
  /** A scanned code the system did not recognise, waiting for someone to pick its part. */
  unknownCode: string | null;
  /** A scanned label that was recognised and is waiting for the person to confirm it. */
  candidate?: { code: string; itemId: string; name: string; description: string | null } | null;
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** The active QuickBooks item for a part number, preferring the one filed under Service Parts. */
async function itemForPartNumber(db: Db, partNumber: string) {
  const { data } = await db
    .from("qbo_items")
    .select("qbo_id, name, fully_qualified_name, description")
    .eq("active", true)
    .ilike("name", partNumber.replace(/[%_\\]/g, (c) => `\\${c}`))
    .limit(10);
  const rows = data ?? [];
  return rows.find((r) => r.fully_qualified_name.toLowerCase().startsWith("service parts:")) ?? rows[0] ?? null;
}

/**
 * Handles the scan box. A camera scan is only looked up and shown back, so the person can
 * see which label was read before anything is added; the part is added when they confirm.
 * A typed code is added straight away, since they pressed Add themselves.
 */
export async function addByCode(_prev: PartState, form: FormData): Promise<PartState> {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  // The confirm box sends "confirm" and, when Not this one is pressed, "dismiss" as well.
  const intents = form.getAll("intent").map(String);
  const intent = intents.includes("dismiss") ? "dismiss" : (intents[0] ?? "typed");
  if (!UUID.test(jobId)) return { ok: false, message: "Nothing was scanned.", unknownCode: null };
  const supabase = await createClient();

  if (intent === "dismiss") return { ok: true, message: null, unknownCode: null };

  if (intent === "confirm") {
    const itemId = String(form.get("item_id") ?? "");
    const name = String(form.get("item_name") ?? "").slice(0, 120);
    const quantity = Number(String(form.get("quantity") ?? "1"));
    if (!/^\d+$/.test(itemId) || !(quantity > 0 && quantity <= 9999)) {
      return { ok: false, message: "Enter a quantity above zero.", unknownCode: null };
    }
    const { error } = await supabase.rpc("add_job_line", { p_job: jobId, p_item: itemId, p_quantity: quantity, p_source: "scan" });
    if (error) return { ok: false, message: error.message, unknownCode: null };
    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, message: `Added ${quantity} × ${name}.`, unknownCode: null };
  }

  const code = String(form.get("code") ?? "").trim().slice(0, 120);
  if (!code) return { ok: false, message: "Nothing was scanned.", unknownCode: null };
  const { data: known } = await supabase.from("part_codes").select("part_number").eq("code", code).maybeSingle();
  const item = await itemForPartNumber(supabase, known?.part_number ?? code);
  if (!item) {
    return {
      ok: false,
      message: known
        ? `Scanned ${code}: that label is part ${known.part_number}, which is not an active item in QuickBooks.`
        : `Scanned ${code}: this label is not recognised yet. Find its part below and add it; the label will be remembered.`,
      unknownCode: known ? null : code,
    };
  }
  if (intent === "scan") {
    return {
      ok: true,
      message: null,
      unknownCode: null,
      candidate: { code, itemId: item.qbo_id, name: item.name, description: item.description },
    };
  }
  const { error } = await supabase.rpc("add_job_line", { p_job: jobId, p_item: item.qbo_id, p_quantity: 1, p_source: "manual" });
  if (error) return { ok: false, message: error.message, unknownCode: null };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `Added ${item.name}.`, unknownCode: null };
}

/** Adds a part picked from the search list. If a label was waiting to be identified, remembers it. */
export async function addItem(form: FormData) {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const itemId = String(form.get("item_id") ?? "");
  const quantity = Number(String(form.get("quantity") ?? "1"));
  const learn = String(form.get("learn_code") ?? "").trim().slice(0, 120);
  if (!UUID.test(jobId) || !/^\d+$/.test(itemId) || !(quantity > 0 && quantity <= 9999)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_job_line", { p_job: jobId, p_item: itemId, p_quantity: quantity, p_source: "manual" });
  if (!error && learn) {
    const { data: item } = await supabase.from("qbo_items").select("name").eq("qbo_id", itemId).maybeSingle();
    if (item) {
      await supabase
        .from("part_codes")
        .upsert({ code: learn, part_number: item.name, source: "learned", created_by: staff.id }, { onConflict: "code", ignoreDuplicates: true });
    }
  }
  revalidatePath(`/jobs/${jobId}`);
}

export async function setQuantity(form: FormData) {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  const lineId = String(form.get("line_id") ?? "");
  const quantity = Number(String(form.get("quantity") ?? ""));
  if (!UUID.test(jobId) || !UUID.test(lineId)) return;
  const supabase = await createClient();
  // Lines already on a QuickBooks invoice are never changed from here.
  if (quantity > 0 && quantity <= 9999) {
    await supabase
      .from("job_lines")
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq("id", lineId)
      .eq("job_id", jobId)
      .is("invoice_id", null);
  } else if (quantity === 0) {
    await supabase.from("job_lines").delete().eq("id", lineId).eq("job_id", jobId).is("invoice_id", null);
  }
  revalidatePath(`/jobs/${jobId}`);
}

/** Adds the standard service (labor) line and the certificate line, where there are rules for this raft. */
export async function addStandard(form: FormData) {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  if (!UUID.test(jobId)) return;
  const supabase = await createClient();
  await supabase.rpc("add_standard_service_line", { p_job: jobId });
  await supabase.rpc("add_certificate_line", { p_job: jobId });
  revalidatePath(`/jobs/${jobId}`);
}

/** Reads the discount rows of an invoice form and checks each against the QuickBooks discount items. */
async function readDiscounts(db: Db, form: FormData) {
  const ids = form.getAll("discount_item").map(String);
  const amounts = form.getAll("discount_amount").map((a) => Number(String(a).replace(/[$,\s]/g, "")));
  const none = { discounts: [], subtotalItemId: null as string | null };
  if (!ids.length) return { ...none, problem: null };
  if (ids.length !== amounts.length) return { ...none, problem: "The discount rows were incomplete. Try again." };
  const items = await discountItems(db);
  const discounts = [];
  for (let i = 0; i < ids.length; i++) {
    const item = items.find((x) => x.qbo_id === ids[i]);
    if (!item) return { ...none, problem: "Choose a discount item for each discount row." };
    if (!(amounts[i] > 0)) return { ...none, problem: `Enter a dollar amount above zero for ${item.name}.` };
    discounts.push({ qboItemId: item.qbo_id, description: item.description || item.name, amount: amounts[i], taxable: item.taxable });
  }
  const { data: sub } = await db.from("qbo_items").select("qbo_id").eq("active", true).eq("name", "Services").limit(1);
  return { discounts, subtotalItemId: sub?.[0]?.qbo_id ?? null, problem: null };
}

const jobUrl = (id: string, kind: "done" | "error", message: string) =>
  `/jobs/${id}?${kind}=${encodeURIComponent(message)}`;

/**
 * Approves the parts list and creates the invoice in QuickBooks, then moves the job on.
 * This is the only place the system writes an invoice, and only on this explicit click.
 */
export async function createInvoice(form: FormData) {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  if (!UUID.test(jobId)) redirect("/board");
  const fail = (message: string): never => redirect(jobUrl(jobId, "error", message));

  if (staff.role !== "admin" && (await getMode()) !== "office") fail("Switch to Office mode to approve an invoice.");
  if (form.get("reviewed") !== "on") fail("Tick the box to confirm you have reviewed the parts list.");
  const outcome = String(form.get("outcome") ?? "");
  if (outcome !== "delivery" && outcome !== "pickup") fail("Choose whether the raft will be delivered or collected.");

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("service_jobs")
    .select("id, job_number, stage, asset_id, qbo_invoice_id, closed_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.closed_at) fail("This job is closed or does not exist.");
  if (job!.qbo_invoice_id) fail("This job already has an invoice.");
  if (job!.stage !== "needs_invoice") fail("Only a job at Needs invoice can be invoiced.");

  const [{ data: lines }, { data: asset }, { data: target }] = await Promise.all([
    supabase.from("job_lines").select("id, qbo_item_id, description, quantity, unit_price, taxable").eq("job_id", jobId).is("invoice_id", null).order("created_at"),
    supabase.from("asset_overview").select("serial_number, vessel_name").eq("id", job!.asset_id).maybeSingle(),
    supabase.rpc("invoice_qbo_customer_id", { p_asset_id: job!.asset_id }),
  ]);
  if (!lines?.length) fail("There are no lines to invoice.");
  const qboCustomerId = typeof target === "string" ? target : "";
  if (!qboCustomerId) fail("This raft's owner is not linked to a QuickBooks customer. Set the owner on the raft page first.");
  const { data: billTo } = await supabase
    .from("qbo_customers")
    .select("active, email, fully_qualified_name")
    .eq("qbo_id", qboCustomerId)
    .maybeSingle();
  if (!billTo?.active) {
    fail("The QuickBooks customer for this raft is inactive or was merged. Copy customers again, then fix the owner.");
  }

  const { discounts, subtotalItemId, problem } = await readDiscounts(supabase, form);
  if (problem) fail(problem);

  let payload: Record<string, unknown>;
  try {
    payload = buildInvoice({
      qboCustomerId,
      date: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
      lines: lines!.map((l) => ({
        qboItemId: l.qbo_item_id,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unit_price),
        taxable: l.taxable,
      })),
      vesselName: asset?.vessel_name,
      privateNote: `Liferaft Ops ${job!.job_number}, raft serial ${asset?.serial_number ?? "unknown"}`,
      billEmail: billTo!.email,
      discounts,
      subtotalItemId,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : "The invoice could not be prepared.");
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_job_for_invoice", { p_job: jobId });
  if (claimError || !claimed) fail("Someone else is invoicing this job right now. Refresh the page in a moment.");

  let created;
  try {
    // The request id is tied to the job, so a retry can never produce a second invoice.
    created = await createQboInvoice(payload!, `liferaft-ops-${jobId}`);
  } catch (err) {
    await supabase.from("service_jobs").update({ invoiced_at: null, invoiced_by: null }).eq("id", jobId);
    fail(`QuickBooks did not create the invoice: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  const { data: invoiceRow, error: rowError } = await supabase
    .from("job_invoices")
    .insert({
      job_id: jobId,
      qbo_invoice_id: created!.id,
      doc_number: created!.docNumber,
      kind: "service",
      total_sent: created!.total,
      lines_sent: created!.lineCount,
      total: created!.total,
      lines_now: created!.lineCount,
      balance: created!.balance,
      created_by: staff.id,
      checked_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  const { error: saveError } = await supabase
    .from("service_jobs")
    .update({
      qbo_invoice_id: created!.id,
      qbo_invoice_number: created!.docNumber,
      invoice_total: created!.total,
      invoice_balance: created!.balance,
      payment_status: created!.balance > 0 ? "unpaid" : "paid",
      payment_checked_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (saveError || rowError || !invoiceRow) {
    fail(`Invoice ${created!.docNumber ?? created!.id} was created in QuickBooks, but saving it here failed: ${(saveError ?? rowError)?.message ?? "unknown error"}. Do not create it again; tell an administrator.`);
  }
  await supabase.from("job_lines").update({ invoice_id: invoiceRow!.id }).in("id", lines!.map((l) => l.id));
  const { error: moveError } = await supabase.rpc("move_job", {
    p_job: jobId,
    p_from: "needs_invoice",
    p_to: outcome === "delivery" ? "ready_for_delivery" : "ready_for_pickup",
    p_action: outcome === "delivery" ? "invoice_for_delivery" : "invoice_for_pickup",
    p_closes: false,
    p_stage_before_side: null,
    p_estimate_status: null,
    p_note: `Invoice ${created!.docNumber ?? created!.id}`,
  });
  revalidatePath("/board");
  revalidatePath(`/jobs/${jobId}`);
  redirect(
    jobUrl(
      jobId,
      moveError ? "error" : "done",
      moveError
        ? `Invoice ${created!.docNumber ?? ""} was created, but the job did not move: ${moveError.message}`
        : `Invoice ${created!.docNumber ?? ""} created in QuickBooks for ${billTo!.fully_qualified_name}.`,
    ),
  );
}

/**
 * Creates a second, separate QuickBooks invoice for items added after the service invoice.
 * The first invoice is left exactly as it was, so SOS Inventory ships the new items from
 * an invoice of their own.
 */
export async function createAdditionalInvoice(form: FormData) {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  if (!UUID.test(jobId)) redirect("/board");
  const fail = (message: string): never => redirect(jobUrl(jobId, "error", message));

  if (staff.role !== "admin" && (await getMode()) !== "office") fail("Switch to Office mode to approve an invoice.");
  if (form.get("reviewed") !== "on") fail("Tick the box to confirm you have reviewed the added items.");

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("service_jobs")
    .select("id, job_number, asset_id, qbo_invoice_id, qbo_invoice_number, invoice_total, invoice_balance, closed_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.closed_at) fail("This job is closed or does not exist.");
  if (!job!.qbo_invoice_id) fail("This job has no service invoice yet. Add the items and approve the service invoice instead.");

  const [{ data: lines }, { data: asset }, { data: target }] = await Promise.all([
    supabase.from("job_lines").select("id, qbo_item_id, description, quantity, unit_price, taxable").eq("job_id", jobId).is("invoice_id", null).order("created_at"),
    supabase.from("asset_overview").select("serial_number, vessel_name").eq("id", job!.asset_id).maybeSingle(),
    supabase.rpc("invoice_qbo_customer_id", { p_asset_id: job!.asset_id }),
  ]);
  if (!lines?.length) fail("There are no added items waiting for an invoice.");
  const qboCustomerId = typeof target === "string" ? target : "";
  if (!qboCustomerId) fail("This raft's owner is not linked to a QuickBooks customer. Set the owner on the raft page first.");
  const { data: billTo } = await supabase
    .from("qbo_customers")
    .select("active, email, fully_qualified_name")
    .eq("qbo_id", qboCustomerId)
    .maybeSingle();
  if (!billTo?.active) {
    fail("The QuickBooks customer for this raft is inactive or was merged. Copy customers again, then fix the owner.");
  }

  const extra = await readDiscounts(supabase, form);
  if (extra.problem) fail(extra.problem);
  let payload: Record<string, unknown>;
  try {
    payload = buildInvoice({
    qboCustomerId,
    date: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    lines: lines!.map((l) => ({
      qboItemId: l.qbo_item_id,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      taxable: l.taxable,
    })),
    vesselName: asset?.vessel_name,
    privateNote: `Liferaft Ops ${job!.job_number}, raft serial ${asset?.serial_number ?? "unknown"}. Items added after invoice ${job!.qbo_invoice_number ?? job!.qbo_invoice_id}.`,
    billEmail: billTo!.email,
    discounts: extra.discounts,
    subtotalItemId: extra.subtotalItemId,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : "The invoice could not be prepared.");
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_job_for_additional_invoice", { p_job: jobId });
  if (claimError || !claimed) fail("Someone else is invoicing this job right now. Refresh the page in a moment.");

  let created;
  try {
    // Tied to the first waiting line, so a retry of the same items cannot make a second invoice.
    created = await createQboInvoice(payload!, `lo-x-${lines![0].id}`);
  } catch (err) {
    await supabase.from("service_jobs").update({ extra_invoice_claimed_at: null }).eq("id", jobId);
    fail(`QuickBooks did not create the invoice: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  const { data: invoiceRow, error: rowError } = await supabase
    .from("job_invoices")
    .insert({
      job_id: jobId,
      qbo_invoice_id: created!.id,
      doc_number: created!.docNumber,
      kind: "additional",
      total_sent: created!.total,
      lines_sent: created!.lineCount,
      total: created!.total,
      lines_now: created!.lineCount,
      balance: created!.balance,
      created_by: staff.id,
      checked_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (rowError || !invoiceRow) {
    fail(`Invoice ${created!.docNumber ?? created!.id} was created in QuickBooks, but saving it here failed: ${rowError?.message ?? "unknown error"}. Do not create it again; tell an administrator.`);
  }
  await supabase.from("job_lines").update({ invoice_id: invoiceRow!.id }).in("id", lines!.map((l) => l.id));
  const owing = created!.balance > 0;
  await supabase
    .from("service_jobs")
    .update({
      invoice_total: Number(job!.invoice_total ?? 0) + created!.total,
      invoice_balance: Number(job!.invoice_balance ?? 0) + created!.balance,
      extra_invoice_claimed_at: null,
      // A new unpaid invoice puts the raft back on hold, even if an earlier hold was released.
      ...(owing ? { payment_status: "unpaid" as const, payment_hold_override_by: null, payment_hold_override_note: null } : {}),
    })
    .eq("id", jobId);
  revalidatePath("/board");
  revalidatePath(`/jobs/${jobId}`);
  redirect(jobUrl(jobId, "done", `Additional invoice ${created!.docNumber ?? ""} created in QuickBooks for ${billTo!.fully_qualified_name}.`));
}

/** Checks with QuickBooks whether the invoice has been paid. */
export async function checkPayment(form: FormData) {
  await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  if (!UUID.test(jobId)) redirect("/board");
  const supabase = await createClient();
  let message: string;
  let kind: "done" | "error" = "done";
  try {
    const status = await refreshPayment(supabase, jobId);
    message = status === "paid" ? "QuickBooks shows everything on this job as paid." : status === "unpaid" ? "QuickBooks shows a balance still owing." : "This job has no invoice yet.";
  } catch (err) {
    kind = "error";
    message = err instanceof Error ? err.message : "Could not reach QuickBooks.";
  }
  revalidatePath("/board");
  redirect(jobUrl(jobId, kind, message));
}

/** An admin accepts that the raft will leave with the invoice unpaid. */
export async function acknowledgeHold(form: FormData) {
  const staff = await requireStaff();
  const jobId = String(form.get("job_id") ?? "");
  if (!UUID.test(jobId)) redirect("/board");
  if (staff.role !== "admin") redirect(jobUrl(jobId, "error", "Only an admin can release a raft with an unpaid invoice."));
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!note) redirect(jobUrl(jobId, "error", "Add a short note saying why the raft is being released unpaid."));
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_jobs")
    .update({ payment_hold_override_by: staff.id, payment_hold_override_note: note })
    .eq("id", jobId);
  revalidatePath("/board");
  redirect(jobUrl(jobId, error ? "error" : "done", error ? error.message : "Payment hold acknowledged. The raft can be released."));
}
