import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { formatDate, safeTerm } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, type Stage } from "@/lib/workflow";
import { SERVICE_CLASS_LABELS } from "@/lib/raft-options";
import { DiscountRows } from "./discounts";
import { LinesList, type ListRow } from "./lines";
import { acknowledgeHold, addItem, addStandard, checkPayment, createAdditionalInvoice, createInvoice } from "./actions";
import { discountItems } from "@/lib/discounts";
import { PartScanner } from "./scanner";

export const instant = false;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function JobPage({ params, searchParams }: PageProps<"/jobs/[id]">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? safeTerm(sp.q) : "";
  const learn = typeof sp.learn === "string" ? sp.learn.slice(0, 120) : "";

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("service_jobs")
    .select("id, job_number, stage, asset_id, date_received, closed_at, qbo_invoice_id, qbo_invoice_number, invoice_total, invoice_balance, payment_status, payment_checked_at, payment_hold_override_by, payment_hold_override_note, notes")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const [{ data: a }, { data: lines }, { data: items }] = await Promise.all([
    supabase.from("asset_overview").select("serial_number, brand, capacity, equipment_type, customer_name, vessel_name, service_class").eq("id", job.asset_id).maybeSingle(),
    supabase.from("job_lines").select("id, part_number, description, quantity, unit_price, source, invoice_id, position").eq("job_id", id).order("position"),
    q
      ? supabase
          .from("qbo_items")
          .select("qbo_id, name, fully_qualified_name, description, unit_price")
          .eq("active", true)
          .or(`name.ilike.%${q.split(/\s+/).join("%")}%,description.ilike.%${q.split(/\s+/).join("%")}%`)
          .order("name")
          .limit(25)
      : Promise.resolve({ data: null }),
  ]);
  const { data: markers } = await supabase.from("job_markers").select("id, position").eq("job_id", id);
  const listRows: ListRow[] = [
    ...(lines ?? []).map((l) => ({
      id: l.id,
      kind: "line" as const,
      position: Number(l.position),
      partNumber: l.part_number,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      tag: l.source === "standard" ? "standard service" : l.source === "certificate" ? "certificate" : null,
      waiting: Boolean(job.qbo_invoice_id) && !l.invoice_id,
      locked: Boolean(l.invoice_id),
    })),
    ...(markers ?? []).map((m) => ({ id: m.id, kind: "subtotal" as const, position: Number(m.position) })),
  ]
    .sort((x, y) => x.position - y.position)
    .map((row) => ({ ...row, position: undefined }));
  const open = !job.closed_at;
  const invoiced = Boolean(job.qbo_invoice_id);
  const { data: invoices } = invoiced
    ? await supabase
        .from("job_invoices")
        .select("id, qbo_invoice_id, doc_number, kind, total_sent, lines_sent, total, lines_now, balance, changed_in_qbo")
        .eq("job_id", id)
        .order("created_at")
    : { data: null };
  const waiting = invoiced ? (lines ?? []).filter((l) => !l.invoice_id) : [];
  const discounts = !job.closed_at ? (await discountItems(supabase)).map(({ qbo_id, name, description }) => ({ qbo_id, name, description })) : [];
  const waitingTotal = waiting.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unit_price), 0);
  const done = typeof sp.done === "string" ? sp.done : "";
  const failed = typeof sp.error === "string" ? sp.error : "";
  const { data: billId } = await supabase.rpc("invoice_qbo_customer_id", { p_asset_id: job.asset_id });
  const { data: billTo } =
    typeof billId === "string"
      ? await supabase.from("qbo_customers").select("fully_qualified_name, active").eq("qbo_id", billId).maybeSingle()
      : { data: null };
  const total = (lines ?? []).reduce((sum, l) => sum + Number(l.quantity) * Number(l.unit_price), 0);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 pb-12">
      {/* Always in view, so nobody records a part against the wrong raft. */}
      <header className="sticky top-0 z-10 -mx-6 border-b-2 border-[#FF5200] bg-[var(--background)] px-6 py-3">
        <p className="text-xl font-semibold">
          {a?.customer_name ?? "No owner"}
          {a?.vessel_name ? ` · ${a.vessel_name}` : ""}
        </p>
        <p className="text-sm">
          <Link className="font-semibold underline" href={`/rafts/${job.asset_id}`}>
            {a?.serial_number ?? "No serial"}
          </Link>{" "}
          · {[a?.brand, a?.capacity ? `${a.capacity}-person` : null, a?.equipment_type].filter(Boolean).join(" · ")} ·{" "}
          {job.job_number} · {STAGE_LABELS[job.stage as Stage]}
          {job.date_received ? ` · received ${formatDate(job.date_received)}` : ""}
        </p>
      </header>

      <p className="text-sm">
        <Link className="underline" href="/board">
          Service board
        </Link>
      </p>

      {done ? (
        <p role="status" className="font-semibold">
          {done}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="font-semibold text-red-700">
          {failed}
        </p>
      ) : null}

      <section>
        <h1 className="text-lg font-semibold">Parts used</h1>
        {(lines ?? []).length === 0 ? (
          <p className="mt-2 text-sm">No parts recorded yet.</p>
        ) : (
          <LinesList
            key={listRows.map((r) => `${r.id}:${r.quantity ?? ""}`).join("|")}
            jobId={id}
            rows={listRows}
            canEdit={open}
            canArrange={open && !invoiced && job.stage === "needs_invoice"}
          />
        )}
        {open && !invoiced ? <p className="mt-1 text-sm opacity-75">Set a quantity to 0 to remove a part.</p> : null}
        {open && !invoiced && !(lines ?? []).some((l) => l.source === "standard") ? (
          <div className="mt-3 rounded border border-zinc-500/40 p-3 text-sm">
            <p>
              No standard service line on this job.{" "}
              {a?.service_class && a?.capacity
                ? `This raft is ${SERVICE_CLASS_LABELS[a.service_class]}, ${a.capacity}-person. If nothing is added, there is no labor item for that combination: add one from Find a part.`
                : "The raft needs a service class and a capacity first (set them on the raft page), or add the labor item from Find a part."}
            </p>
            <form action={addStandard} className="mt-2">
              <input type="hidden" name="job_id" value={id} />
              <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                Add standard service and certificate lines
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {job.qbo_invoice_id ? (
        <section className="rounded border border-[#FF5200] p-4 text-sm">
          <h2 className="text-lg font-semibold">{(invoices ?? []).length > 1 ? "Invoices" : "Invoice"}</h2>
          <ul className="mt-1">
            {(invoices ?? []).map((inv) => (
              <li key={inv.id} className="border-b border-zinc-500/20 py-2">
                <a
                  className="font-semibold underline"
                  href={`https://qbo.intuit.com/app/invoice?txnId=${inv.qbo_invoice_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {inv.doc_number ?? "Invoice"}
                </a>
                {inv.kind === "additional" ? " (added items)" : " (service)"} · {money(Number(inv.total))} ·{" "}
                {Number(inv.balance) > 0 ? (
                  <span className="font-semibold text-red-700">{money(Number(inv.balance))} owing</span>
                ) : (
                  <span className="font-semibold">Paid</span>
                )}
                {inv.changed_in_qbo ? (
                  <p role="alert" className="mt-1 font-semibold text-red-700">
                    This invoice was changed in QuickBooks after it was created here. It was sent as{" "}
                    {money(Number(inv.total_sent))} with {inv.lines_sent} item lines and now shows {money(Number(inv.total))}{" "}
                    with {inv.lines_now}. Anything added there after SOS built its shipment will not ship, so check
                    SOS. Add later items below instead, and they go on an invoice of their own.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Job total {money(Number(job.invoice_total ?? 0))} ·{" "}
            {job.payment_status === "paid" ? (
              <span className="font-semibold">Paid</span>
            ) : (
              <span className="font-semibold text-red-700">Unpaid, {money(Number(job.invoice_balance ?? 0))} owing</span>
            )}
            {job.payment_checked_at ? ` · checked ${formatDate(job.payment_checked_at)}` : ""}
          </p>
          <form action={checkPayment} className="mt-2">
            <input type="hidden" name="job_id" value={id} />
            <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
              Check payment now
            </button>
          </form>
          {job.payment_status !== "paid" ? (
            job.payment_hold_override_by ? (
              <p className="mt-3">
                Payment hold acknowledged: {job.payment_hold_override_note}. This raft can be released unpaid.
              </p>
            ) : (
              <div className="mt-3">
                <p>This raft cannot be loaded, delivered or handed over until the invoice is paid.</p>
                {staff.role === "admin" ? (
                  <form action={acknowledgeHold} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="job_id" value={id} />
                    <label className="flex-1">
                      Release it unpaid anyway? Say why
                      <input name="note" required className="block w-full rounded border border-zinc-500/60 bg-transparent px-2 py-1" />
                    </label>
                    <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                      Acknowledge and release
                    </button>
                  </form>
                ) : (
                  <p className="mt-1">An admin can acknowledge the hold if it needs to leave unpaid.</p>
                )}
              </div>
            )
          ) : null}
        </section>
      ) : job.stage === "needs_invoice" && !job.closed_at ? (
        <section className="rounded border border-[#FF5200] p-4 text-sm">
          <h2 className="text-lg font-semibold">Review and invoice</h2>
          <p className="mt-1">
            Bill to:{" "}
            <span className="font-semibold">{billTo?.fully_qualified_name ?? "No QuickBooks customer linked"}</span>
            {billTo && !billTo.active ? " (inactive in QuickBooks)" : ""}
            {a?.vessel_name ? ` · vessel ${a.vessel_name}` : ""}
          </p>
          <p className="mt-1">
            Check the parts list above against the work done. Correct quantities, add anything missing,
            then approve. Sales tax is worked out by QuickBooks.
          </p>
          <form action={createInvoice} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="job_id" value={id} />
            <DiscountRows items={discounts} subtotal={total} />
            <fieldset className="flex flex-wrap gap-4">
              <legend className="font-semibold">After invoicing, the raft will be</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="outcome" value="delivery" required /> Delivered by us
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="outcome" value="pickup" required /> Collected by the customer
              </label>
            </fieldset>
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" name="reviewed" required /> I have reviewed the parts list and it is correct
            </label>
            <button type="submit" className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white">
              Approve and create invoice in QuickBooks
            </button>
            <p className="opacity-75">This creates a real invoice in QuickBooks. It is not emailed to the customer.</p>
          </form>
        </section>
      ) : null}

      {open && invoiced && waiting.length ? (
        <section className="rounded border border-[#FF5200] p-4 text-sm">
          <h2 className="text-lg font-semibold">Added items waiting for an invoice</h2>
          <p className="mt-1">
            {waiting.length} {waiting.length === 1 ? "item" : "items"}, {money(waitingTotal)} before tax. These go on a
            new, separate invoice. The invoice already in QuickBooks is not changed, so SOS ships these from their own
            order. The raft stays on hold until every invoice on this job is paid.
          </p>
          <form action={createAdditionalInvoice} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="job_id" value={id} />
            <DiscountRows items={discounts} subtotal={waitingTotal} />
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" name="reviewed" required /> I have reviewed the added items and they are correct
            </label>
            <button type="submit" className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white">
              Approve and create additional invoice in QuickBooks
            </button>
            <p className="opacity-75">This creates a real invoice in QuickBooks. It is not emailed to the customer.</p>
          </form>
        </section>
      ) : null}

      {open ? (
        <>
          <section>
            <h2 className="text-lg font-semibold">{invoiced ? "Add items for another invoice" : "Add parts"}</h2>
            {invoiced ? (
              <p className="mt-1 text-sm">
                The service invoice is already in QuickBooks. Anything added now, such as an EPIRB or a hydrostatic
                release, goes on a separate invoice.
              </p>
            ) : null}
            <div className="mt-2">
              <PartScanner jobId={id} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Find a part</h2>
            {learn ? (
              <p className="mt-1 rounded border-2 border-[#FF5200] p-3 text-sm">
                Scanned label <span className="text-base font-semibold">{learn}</span> is not recognised yet. The part
                you add next will be remembered for this label, so check it is the label you meant to scan.{" "}
                <Link className="underline" href={`/jobs/${id}`}>
                  Wrong label, start over
                </Link>
              </p>
            ) : null}
            <form id="part-search" className="mt-2 flex gap-2">
              {learn ? <input type="hidden" name="learn" value={learn} /> : null}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Part number or description"
                aria-label="Search parts"
                className="w-full rounded border border-zinc-500/60 bg-transparent px-3 py-2"
              />
              <button type="submit" className="rounded border border-zinc-500/60 px-4 py-2 font-semibold">
                Search
              </button>
            </form>
            {items ? (
              items.length ? (
                <ul className="mt-3 text-sm">
                  {items.map((i) => (
                    <li key={i.qbo_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-500/20 py-2">
                      <span>
                        <span className="font-semibold">{i.name}</span>{" "}
                        <span className="opacity-75">
                          {i.description ?? ""} {i.unit_price != null ? `· ${money(Number(i.unit_price))}` : ""}
                        </span>
                      </span>
                      <form action={addItem} className="flex items-center gap-2">
                        <input type="hidden" name="job_id" value={id} />
                        <input type="hidden" name="item_id" value={i.qbo_id} />
                        {learn ? <input type="hidden" name="learn_code" value={learn} /> : null}
                        <input
                          name="quantity"
                          inputMode="decimal"
                          defaultValue={1}
                          aria-label={`Quantity of ${i.name}`}
                          className="w-16 rounded border border-zinc-500/60 bg-transparent px-2 py-1"
                        />
                        <button type="submit" className="rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white">
                          Add
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm">No active QuickBooks item matches.</p>
              )
            ) : null}
          </section>
        </>
      ) : (
        <p className="text-sm">This job is closed, so nothing more can be added to it.</p>
      )}
    </main>
  );
}
