import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { safeTerm } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const LIMIT = 100;

interface Row {
  qbo_id: string;
  display_name: string;
  fully_qualified_name: string;
  parent_qbo_id: string | null;
  level: number;
  active: boolean;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  balance: number | null;
}

const COLUMNS =
  "qbo_id, display_name, fully_qualified_name, parent_qbo_id, level, active, phone, mobile, email, balance";


export default async function Customers({ searchParams }: PageProps<"/customers">) {
  await requireStaff();
  const params = await searchParams;
  const q = typeof params.q === "string" ? safeTerm(params.q) : "";
  const under = typeof params.under === "string" && /^\d+$/.test(params.under) ? params.under : "";

  const supabase = await createClient();
  let query = supabase.from("qbo_customers").select(COLUMNS, { count: "exact" });
  let heading = "Top-level customers";
  let parent: Row | null = null;

  if (under) {
    const res = await supabase.from("qbo_customers").select(COLUMNS).eq("qbo_id", under).maybeSingle();
    parent = (res.data as Row | null) ?? null;
    query = query.eq("parent_qbo_id", under);
    heading = parent ? `Under ${parent.fully_qualified_name}` : "Sub-customers";
  } else if (q) {
    const pattern = `%${q.split(/\s+/).join("%")}%`;
    query = query.or(
      `fully_qualified_name.ilike.${pattern},phone.ilike.${pattern},mobile.ilike.${pattern},email.ilike.${pattern}`,
    );
    heading = `Results for “${q}”`;
  } else {
    query = query.is("parent_qbo_id", null);
  }

  const { data, count, error } = await query.order("fully_qualified_name").limit(LIMIT);
  const rows = (data as Row[] | null) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm opacity-75">
          A copy of the QuickBooks customer list. Search by name, vessel, phone or email.
        </p>
        <form className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search customers"
            aria-label="Search customers"
            className="w-full rounded border border-zinc-500/60 bg-transparent px-3 py-2"
          />
          <button type="submit" className="rounded bg-[#FF5200] px-4 py-2 font-semibold text-white">
            Search
          </button>
        </form>
      </header>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-semibold">{heading}</h2>
          <p className="text-sm opacity-75">
            {count != null
              ? count > rows.length
                ? `Showing ${rows.length} of ${count.toLocaleString("en-US")}`
                : `${count.toLocaleString("en-US")} found`
              : ""}
          </p>
        </div>
        {parent ? (
          <p className="mt-1 text-sm">
            <Link
              className="underline"
              href={parent.parent_qbo_id ? `/customers?under=${parent.parent_qbo_id}` : "/customers"}
            >
              Up one level
            </Link>
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 text-red-700">Could not load customers: {error.message}</p>
        ) : rows.length === 0 ? (
          <p className="mt-4">
            Nothing here yet. If QuickBooks is connected, copy the customer list from{" "}
            <Link className="underline" href="/settings/quickbooks">
              the QuickBooks page
            </Link>
            .
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-500/40">
                <th className="py-2 pr-4 font-semibold">Name</th>
                <th className="py-2 pr-4 font-semibold">Phone</th>
                <th className="py-2 pr-4 font-semibold">Email</th>
                <th className="py-2 text-right font-semibold">Open balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.qbo_id} className="border-b border-zinc-500/20 align-top">
                  <td className="py-2 pr-4">
                    <Link className="font-semibold underline" href={`/customers/${r.qbo_id}`}>
                      {under ? r.display_name : r.fully_qualified_name}
                    </Link>
                    {r.active ? null : <span className="ml-2 text-xs opacity-75">(inactive)</span>}
                  </td>
                  <td className="py-2 pr-4">{r.phone ?? r.mobile ?? ""}</td>
                  <td className="py-2 pr-4">{r.email ?? ""}</td>
                  <td className="py-2 text-right tabular-nums">
                    {r.balance ? `$${Number(r.balance).toFixed(2)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
