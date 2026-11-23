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
  const svg = await QRCode.toString(a.system_id, { type: "svg", errorCorrectionLevel: "Q", margin: 0 });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 pb-12">
      <p className="text-sm print:hidden">
        <Link className="underline" href={`/rafts/${id}`}>
          Back to the raft
        </Link>
        {" · "}Print this page from the browser (Ctrl+P) to the P-touch printer with 24 mm tape loaded. Set margins to None and scale to 100%. Only the label prints.
      </p>
      {/* For 24 mm laminated tape (Brother TZe). The printer can only print an 18 mm band down the
          middle, so everything sits inside that band and fills its full height. Label length 48 mm. */}
      <style>{`@page { size: 48mm 24mm; margin: 0 } @media print { header, nav { display: none !important } html, body { margin: 0 !important; padding: 0 !important } main { padding: 0 !important; margin: 0 !important; max-width: none !important; gap: 0 !important } }`}</style>
      <div className="flex h-[24mm] w-[48mm] items-center overflow-hidden border border-zinc-500/60 bg-white text-black print:border-0">
        <div className="flex h-[18mm] w-full items-stretch gap-[1.5mm] px-[1mm]">
          <div className="h-[18mm] w-[18mm] shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="flex min-w-0 flex-1 flex-col justify-between text-[8pt] leading-none">
            <p className="text-[9pt] font-bold">Liferaft Services</p>
            <p className="text-[9pt] font-bold">{a.serial_number ?? "No serial"}</p>
            <p className="truncate">{[a.brand, a.capacity ? `${a.capacity}P` : null].filter(Boolean).join(" ")}</p>
            <p className="font-mono text-[7.5pt]">{a.system_id}</p>
            <p className="font-semibold">207-363-0220</p>
          </div>
        </div>
      </div>
      <p className="text-sm print:hidden">
        The label carries no owner or vessel name, so it stays correct if the raft is sold or moved. Scan it from Scan
        in the menu to open this raft.
      </p>
    </main>
  );
}
