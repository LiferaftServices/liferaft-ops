import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

/** A printable label for one raft. The QR code holds the raft's Label ID, which never changes. */
export default async function RaftLabel({ params, searchParams }: PageProps<"/rafts/[id]/label">) {
  await requireStaff();
  const { id } = await params;
  // 36 mm tape prints a 32 mm band; 24 mm tape prints an 18 mm band.
  const wide = (await searchParams).tape !== "24";
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
        {" · "}Print this page from the browser (Ctrl+P) to the P-touch printer. Pick the tape that is loaded, set margins to None and scale to 100%, and set the driver's Length to {wide ? "3.07 in (78 mm)" : "1.89 in (48 mm)"} with Trim tape after data ticked. Only the label prints.
      </p>
      <p className="flex flex-wrap gap-4 text-sm print:hidden">
        <span className="font-semibold">Tape loaded:</span>
        <Link className={wide ? "font-semibold" : "underline"} href={`/rafts/${id}/label`}>
          36 mm (large label)
        </Link>
        <Link className={wide ? "underline" : "font-semibold"} href={`/rafts/${id}/label?tape=24`}>
          24 mm (small label)
        </Link>
      </p>
      {/* Laminated Brother TZe tape. The printer leaves a blank strip along each edge, so everything
          sits inside the printable band and fills its full height. */}
      <style>{`@page { size: ${wide ? "78mm 36mm" : "48mm 24mm"}; margin: 0 } @media print { header, nav { display: none !important } html, body { margin: 0 !important; padding: 0 !important } main { padding: 0 !important; margin: 0 !important; max-width: none !important; gap: 0 !important } }`}</style>
      {wide ? (
        <div className="flex h-[36mm] w-[78mm] items-center overflow-hidden border border-zinc-500/60 bg-white text-black print:border-0">
          <div className="flex h-[32mm] w-full items-stretch gap-[2.5mm] px-[1.5mm]">
            <div className="h-[32mm] w-[32mm] shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="flex min-w-0 flex-1 flex-col justify-between text-[11pt] leading-none">
              <p className="text-[13pt] font-bold">Liferaft Services</p>
              <p className="text-[14pt] font-bold">{a.serial_number ?? "No serial"}</p>
              <p className="truncate">{[a.brand, a.capacity ? `${a.capacity}-person` : null].filter(Boolean).join(" · ")}</p>
              <p className="font-mono text-[10pt]">{a.system_id}</p>
              <p className="text-[13pt] font-bold">207-363-0220</p>
            </div>
          </div>
        </div>
      ) : (
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
      )}
      <p className="text-sm print:hidden">
        The label carries no owner or vessel name, so it stays correct if the raft is sold or moved. Scan it from Scan
        in the menu to open this raft.
      </p>
    </main>
  );
}
