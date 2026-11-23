import Link from "next/link";
import { notFound } from "next/navigation";
import { InspectionTable } from "@/components/inspection-table";
import { JobPhotos } from "@/components/job-photos";
import { jobPhotos } from "@/lib/photo-data";
import { REQUIRED_PHOTOS } from "@/lib/photos";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { SECTIONS, sectionProgress, type Values } from "@/lib/inspection-form";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, type Stage } from "@/lib/workflow";

export const instant = false;

export default async function InspectionPage({ params, searchParams }: PageProps<"/jobs/[id]/inspection">) {
  const sp = await searchParams;
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("service_jobs")
    .select("id, job_number, stage, asset_id, location_id, date_received, closed_at")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const [{ data: a }, { data: insp }] = await Promise.all([
    supabase.from("asset_overview").select("serial_number, brand, capacity, equipment_type, customer_name, vessel_name").eq("id", job.asset_id).maybeSingle(),
    supabase.from("inspections").select("data, updated_at").eq("job_id", id).maybeSingle(),
  ]);
  const values = (insp?.data ?? {}) as Values;
  const photos = await jobPhotos(supabase, id);
  const photosDone = REQUIRED_PHOTOS.filter((k) => photos.some((p) => p.kind === k)).length;
  const title = `${a?.customer_name ?? "No owner"}${a?.vessel_name ? ` · ${a.vessel_name}` : ""}`;
  const subtitle = [a?.serial_number, a?.brand, a?.capacity ? `${a.capacity}-person` : null].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 pb-12">
      {/* Always in view, so nobody enters a reading against the wrong raft. */}
      <header className="sticky top-0 z-20 -mx-6 border-b-2 border-[#FF5200] bg-[var(--background)] px-6 py-3">
        <p className="text-xl font-semibold">{title}</p>
        <p className="text-sm">
          <Link className="font-semibold underline" href={`/rafts/${job.asset_id}`}>
            {a?.serial_number ?? "No serial"}
          </Link>{" "}
          · {[a?.brand, a?.capacity ? `${a.capacity}-person` : null, a?.equipment_type].filter(Boolean).join(" · ")} · {job.job_number} ·{" "}
          {STAGE_LABELS[job.stage as Stage]}
        </p>
      </header>
      <p className="flex flex-wrap gap-4 text-sm">
        <Link className="underline" href="/board">
          Service board
        </Link>
        <Link className="underline" href={`/jobs/${id}`}>
          Parts for this raft
        </Link>
        <Link className="underline" href={`/inspections?shop=${job.location_id}`}>
          Batch grid for this shop
        </Link>
      </p>
      <div>
        <h1 className="text-lg font-semibold">Inspection</h1>
        <p className="text-sm">
          Every field saves as soon as you leave it, and the form can be picked up on any device.
          {insp?.updated_at ? ` Last change ${formatDate(insp.updated_at)}.` : ""}
          {job.closed_at ? " This job is closed, so the inspection can no longer be changed." : ""}
        </p>
      </div>
      {typeof sp.error === "string" ? (
        <p role="alert" className="font-semibold text-red-700">
          {sp.error}
        </p>
      ) : null}
      <details open={photosDone < REQUIRED_PHOTOS.length} className="rounded border border-zinc-500/40">
        <summary className="cursor-pointer px-3 py-3 text-base font-semibold">
          Photos for this service ({job.job_number}){" "}
          <span className="font-normal opacity-75">
            {photosDone} of {REQUIRED_PHOTOS.length}
          </span>
        </summary>
        <div className="px-3 pb-3">
          <p className="mb-2 text-sm">
            These are taken new at every service. Photos from earlier services stay with those jobs and do not count
            here. The inspection cannot be completed until all three are added.
          </p>
          <JobPhotos jobId={id} photos={photos} kinds={["serial", "painter_op_head", "painter_raft", "other"]} canRemove={!job.closed_at} />
        </div>
      </details>
      {SECTIONS.map((s, i) => {
        const p = sectionProgress(s, values);
        return (
          <details key={s.key} open={i === 0} className="rounded border border-zinc-500/40">
            <summary className="cursor-pointer px-3 py-3 text-base font-semibold">
              {s.title}{" "}
              <span className="font-normal opacity-75">
                {p.done} of {p.of}
              </span>
            </summary>
            <div className="px-3 pb-3">
              <InspectionTable sectionKey={s.key} columns={[{ jobId: id, title, subtitle, values, locked: Boolean(job.closed_at) }]} />
            </div>
          </details>
        );
      })}
    </main>
  );
}
