import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

/** Where a scanned or typed code lands: a raft's Label ID, or failing that its serial number. */
export default async function OpenByCode({ params }: PageProps<"/r/[code]">) {
  await requireStaff();
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).trim().slice(0, 80);
  const supabase = await createClient();
  const { data: byLabel } = /^LRS-[A-Z0-9]{6,16}$/i.test(code)
    ? await supabase.from("assets").select("id").eq("system_id", code.toUpperCase()).maybeSingle()
    : { data: null };
  let assetId = byLabel?.id as string | undefined;
  if (!assetId) {
    const { data: bySerial } = await supabase.rpc("find_assets_by_serial", { p_serial: code });
    if (Array.isArray(bySerial) && bySerial.length === 1) assetId = bySerial[0].id;
    else if (Array.isArray(bySerial) && bySerial.length > 1) redirect(`/rafts?q=${encodeURIComponent(code)}`);
  }
  if (assetId) {
    // Straight to the work in hand when the raft is in the shop.
    const { data: job } = await supabase.from("service_jobs").select("id, stage").eq("asset_id", assetId).is("closed_at", null).maybeSingle();
    redirect(job?.stage === "on_floor" ? `/jobs/${job.id}/inspection` : `/rafts/${assetId}`);
  }
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 px-6 pb-12">
      <h1 className="text-xl font-semibold">No raft found</h1>
      <p className="text-sm">
        Nothing matches <span className="font-semibold">{code}</span>. It may be a part label, or a raft that is not in
        the system yet.
      </p>
      <p className="flex gap-4 text-sm">
        <Link className="underline" href="/scan">
          Scan again
        </Link>
        <Link className="underline" href="/intake">
          Go to intake
        </Link>
      </p>
    </main>
  );
}
