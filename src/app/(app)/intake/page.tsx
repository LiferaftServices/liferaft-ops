import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { safeTerm } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const INPUT = "w-full rounded border border-zinc-500/60 bg-transparent px-3 py-2";
const BUTTON = "rounded bg-[#FF5200] px-4 py-2 font-semibold text-white";

export default async function Intake({ searchParams }: PageProps<"/intake">) {
  await requireStaff();
  const sp = await searchParams;
  const serial = typeof sp.serial === "string" ? sp.serial.trim().slice(0, 60) : "";
  const q = typeof sp.q === "string" ? safeTerm(sp.q) : "";
  const supabase = await createClient();

  const { data: rafts } = serial
    ? await supabase.rpc("find_assets_by_serial", { p_serial: serial }).limit(10)
    : { data: null };
  const digits = q.replace(/\D/g, "");
  const pattern = `%${q.split(/\s+/).join("%")}%`;
  const { data: customers } = q
    ? await supabase
        .from("qbo_customers")
        .select("qbo_id, fully_qualified_name, phone, mobile, email")
        .eq("active", true)
        .or(
          [
            `fully_qualified_name.ilike.${pattern}`,
            `email.ilike.${pattern}`,
            ...(digits.length >= 4 ? [`phone.ilike.%${digits.slice(-4)}%`, `mobile.ilike.%${digits.slice(-4)}%`] : []),
          ].join(","),
        )
        .order("fully_qualified_name")
        .limit(25)
    : { data: null };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Intake</h1>
        <p className="mt-2 opacity-75">
          Start with the raft&apos;s serial number. If it has been here before, everything is already
          on file.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold">1. Has this raft been here before?</h2>
        <form className="mt-3 flex gap-2">
          <input name="serial" defaultValue={serial} placeholder="Serial number" aria-label="Serial number" className={INPUT} />
          <button type="submit" className={BUTTON}>
            Look up
          </button>
        </form>
        {rafts ? (
          rafts.length ? (
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {rafts.map((r: Record<string, string | number | null>) => (
                <li key={String(r.id)} className="rounded border border-zinc-500/40 p-3">
                  <p className="font-semibold">
                    {r.serial_number} · {[r.brand, r.capacity ? `${r.capacity}-person` : null, r.equipment_type].filter(Boolean).join(" · ")}
                  </p>
                  <p>
                    {r.customer_name ?? "No owner linked"}
                    {r.vessel_name ? ` · ${r.vessel_name}` : ""}
                  </p>
                  <p className="mt-2 flex gap-4">
                    <Link className="font-semibold underline" href={`/rafts/${r.id}?checkin=1`}>
                      Check this raft in
                    </Link>
                    <Link className="underline" href={`/rafts/${r.id}`}>
                      Open the raft
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm">
              No raft on file with that serial. Find or add the customer below, then register it.
            </p>
          )
        ) : null}
      </section>

      <section>
        <h2 className="text-lg font-semibold">2. New raft: who is the customer?</h2>
        <form className="mt-3 flex gap-2">
          {serial ? <input type="hidden" name="serial" value={serial} /> : null}
          <input name="q" defaultValue={q} placeholder="Name, vessel, phone or email" aria-label="Search customers" className={INPUT} />
          <button type="submit" className={BUTTON}>
            Search
          </button>
        </form>
        {customers ? (
          <>
            <ul className="mt-4 text-sm">
              {customers.map((c) => (
                <li key={c.qbo_id} className="border-b border-zinc-500/20 py-2">
                  <Link
                    className="font-semibold underline"
                    href={`/intake/${c.qbo_id}${serial ? `?serial=${encodeURIComponent(serial)}` : ""}`}
                  >
                    {c.fully_qualified_name}
                  </Link>
                  <span className="opacity-75"> {[c.phone ?? c.mobile, c.email].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
            {customers.length === 0 ? <p className="mt-2 text-sm">No QuickBooks customer matches.</p> : null}
            <p className="mt-4 text-sm">
              Not in the list?{" "}
              <Link className="font-semibold underline" href="/intake/new-customer">
                Add a new customer
              </Link>{" "}
              (this also creates them in QuickBooks).
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
