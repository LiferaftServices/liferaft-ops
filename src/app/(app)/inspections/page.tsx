import Link from "next/link";
import { InspectionTable, type InspectionColumn } from "@/components/inspection-table";
import { requireStaff } from "@/lib/auth";
import { SECTIONS, type Values } from "@/lib/inspection-form";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const MAX_RAFTS = 30;

/** The batch grid: one section of the inspection, across every raft on the floor in a shop. */
export default async function BatchGrid({ searchParams }: PageProps<"/inspections">) {
  await requireStaff();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: shops } = await supabase.from("locations").select("id, name").order("name");
  const shopId = typeof sp.shop === "string" && shops?.some((s) => s.id === sp.shop) ? sp.shop : (shops?.[0]?.id ?? "");
  const sectionKey = typeof sp.section === "string" && SECTIONS.some((s) => s.key === sp.section) ? sp.section : "pressure";

  const { data: jobs } = shopId
    ? await supabase
        .from("job_board")
        .select("id, job_number, serial_number, brand, capacity, customer_name, vessel_name, scheduled_start")
        .eq("location_id", shopId)
        .eq("stage", "on_floor")
        .order("scheduled_start", { ascending: true, nullsFirst: false })
        .order("job_number")
        .limit(MAX_RAFTS)
    : { data: [] };
  const ids = (jobs ?? []).map((j) => j.id);
  const { data: saved } = ids.length ? await supabase.from("inspections").select("job_id, data").in("job_id", ids) : { data: [] };
  const byJob = new Map((saved ?? []).map((r) => [r.job_id, r.data as Values]));
  const columns: InspectionColumn[] = (jobs ?? []).map((j) => ({
    jobId: j.id,
    title: `${j.customer_name ?? "No owner"}${j.vessel_name ? ` · ${j.vessel_name}` : ""}`,
    subtitle: [j.serial_number, j.brand, j.capacity ? `${j.capacity}p` : null].filter(Boolean).join(" · "),
    values: byJob.get(j.id) ?? {},
  }));
  const link = (shop: string, section: string) => `/inspections?shop=${shop}&section=${section}`;

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-6 pb-12">
      <div>
        <h1 className="text-xl font-semibold">Batch grid</h1>
        <p className="text-sm">
          One section of the inspection for every raft on the floor. Each cell saves as soon as you leave it, into that
          raft&apos;s own inspection.
        </p>
      </div>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Shop">
        {(shops ?? []).map((s) => (
          <Link key={s.id} href={link(s.id, sectionKey)} className={s.id === shopId ? "font-semibold" : "underline"}>
            {s.name}
          </Link>
        ))}
      </nav>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Section">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={link(shopId, s.key)} className={s.key === sectionKey ? "font-semibold" : "underline"}>
            {s.title}
          </Link>
        ))}
      </nav>
      {columns.length ? (
        <>
          <InspectionTable key={`${shopId}:${sectionKey}:${ids.join(",")}`} sectionKey={sectionKey} columns={columns} />
          <p className="text-sm">
            Open one raft&apos;s full form:{" "}
            {(jobs ?? []).map((j) => (
              <Link key={j.id} className="mr-3 underline" href={`/jobs/${j.id}/inspection`}>
                {j.serial_number ?? j.job_number}
              </Link>
            ))}
          </p>
        </>
      ) : (
        <p className="text-sm">No rafts are on the floor in this shop. Rafts appear here after Begin service on the board.</p>
      )}
    </main>
  );
}
