import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

/** A printable label for one raft. The QR code holds the raft's Label ID, which never changes. */
export default async function RaftLabel({ params }: PageProps<"/rafts/[id]/label">) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("asset_overview")
    .select("system_id, serial_number, brand, capacity, equipment_type, customer_name, vessel_name")
    .eq("id", id)
    .maybeSingle();
  if (!a?.system_id) notFound();
  const svg = await QRCode.toString(a.system_id, { type: "svg", errorCorrectionLevel: "Q", margin: 1 });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 pb-12">
      <p className="text-sm print:hidden">
        <Link className="underline" href={`/rafts/${id}`}>
          Back to the raft
        </Link>
        {" · "}Print this page from the browser (Ctrl+P). Only the label prints.
      </p>
      <div className="flex w-[3.5in] items-center gap-3 rounded border border-zinc-500/60 bg-white p-3 text-black print:border-0">
        <div className="h-[1.4in] w-[1.4in] shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="min-w-0 text-[11px] leading-tight">
          <p className="text-[13px] font-bold">Liferaft Services</p>
          <p className="mt-1 font-semibold">S/N {a.serial_number ?? "none"}</p>
          <p>{[a.brand, a.capacity ? `${a.capacity}-person` : null, a.equipment_type].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 font-mono text-[10px]">{a.system_id}</p>
          <p className="mt-1">207-363-0220</p>
        </div>
      </div>
      <p className="text-sm print:hidden">
        The label carries no owner or vessel name, so it stays correct if the raft is sold or moved. Scan it from Scan
        in the menu to open this raft.
      </p>
    </main>
  );
}
