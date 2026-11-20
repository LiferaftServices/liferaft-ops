import { requireStaff } from "@/lib/auth";
import { RaftScanner } from "./scan";

export const instant = false;

export default async function ScanPage() {
  await requireStaff();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 pb-12">
      <div>
        <h1 className="text-xl font-semibold">Scan a raft</h1>
        <p className="text-sm">
          Scan the Liferaft Services label on a raft to open it. A raft on the floor opens at its inspection; any other
          raft opens at its record.
        </p>
      </div>
      <RaftScanner />
    </main>
  );
}
