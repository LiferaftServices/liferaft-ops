import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { formatDate, safeTerm } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, type Stage } from "@/lib/workflow";
import { SERVICE_CLASS_LABELS } from "@/lib/raft-options";
import { addItem, addStandard, setQuantity } from "./actions";
import { PartScanner } from "./scanner";

export const instant = false;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function JobPage({ params, searchParams }: PageProps<"/jobs/[id]">) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? safeTerm(sp.q) : "";
  const learn = typeof sp.learn === "string" ? sp.learn.slice(0, 120) : "";

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("service_jobs")
    .select("id, job_number, stage, asset_id, date_received, closed_at, qbo_invoice_id, notes")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const [{ data: a }, { data: lines }, { data: items }] = await Promise.all([
    supabase.from("asset_overview").select("serial_number, brand, capacity, equipment_type, customer_name, vessel_name, service_class").eq("id", job.asset_id).maybeSingle(),
    supabase.from("job_lines").select("id, part_number, description, quantity, unit_price, source").eq("job_id", id).order("created_at"),
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
  const open = !job.closed_at && !job.qbo_invoice_id;
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

      <section>
        <h1 className="text-lg font-semibold">Parts used</h1>
        {(lines ?? []).length === 0 ? (
          <p className="mt-2 text-sm">No parts recorded yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-500/40">
                <th className="py-2 pr-4 font-semibold">Part</th>
                <th className="py-2 pr-4 font-semibold">Qty</th>
                <th className="py-2 pr-4 text-right font-semibold">Each</th>
                <th className="py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => (
                <tr key={l.id} className="border-b border-zinc-500/20 align-top">
                  <td className="py-2 pr-4">
                    <span className="font-semibold">{l.part_number}</span>
                    {l.source === "standard" ? <span className="ml-2 text-xs opacity-75">standard service</span> : null}
                    {l.description ? <span className="block opacity-75">{l.description}</span> : null}
                  </td>
                  <td className="py-2 pr-4">
                    {open ? (
                      <form action={setQuantity} className="flex items-center gap-2">
                        <input type="hidden" name="job_id" value={id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <input
                          name="quantity"
                          inputMode="decimal"
                          defaultValue={Number(l.quantity)}
                          aria-label={`Quantity of ${l.part_number}`}
                          className="w-16 rounded border border-zinc-500/60 bg-transparent px-2 py-1"
                        />
                        <button type="submit" className="underline">
                          Save
                        </button>
                      </form>
                    ) : (
                      Number(l.quantity)
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{money(Number(l.unit_price))}</td>
                  <td className="py-2 text-right tabular-nums">{money(Number(l.quantity) * Number(l.unit_price))}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="py-2 pr-4 text-right font-semibold">
                  Parts total, before tax
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">{money(total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {open ? <p className="mt-1 text-sm opacity-75">Set a quantity to 0 to remove a part.</p> : null}
        {open && !(lines ?? []).some((l) => l.source === "standard") ? (
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
                Add standard service line
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {open ? (
        <>
          <section>
            <h2 className="text-lg font-semibold">Add parts</h2>
            <div className="mt-2">
              <PartScanner jobId={id} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Find a part</h2>
            {learn ? (
              <p className="mt-1 text-sm font-semibold">
                The part you add next will be remembered for the label that was just scanned.
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
        <p className="text-sm">This job is closed or invoiced, so its parts can no longer be changed.</p>
      )}
    </main>
  );
}
