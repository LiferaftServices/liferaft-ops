import { requireStaff } from "@/lib/auth";
import { ImportUpload } from "./upload";

export const instant = false;

export default async function ImportPage() {
  const staff = await requireStaff();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Import data</h1>
        <p className="mt-2 opacity-75">
          Loads a prepared file of customers, vessels, rafts and service history. Loading the same
          file again is safe: records that already exist are left as they are.
        </p>
      </header>
      {staff.role === "admin" ? <ImportUpload /> : <p>Only an admin can import data.</p>}
    </main>
  );
}
