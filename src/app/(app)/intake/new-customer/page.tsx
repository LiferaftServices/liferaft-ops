import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { NewCustomerForm } from "./form";

export const instant = false;

export default async function NewCustomer() {
  await requireStaff();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <header>
        <p className="text-sm">
          <Link className="underline" href="/intake">
            Intake
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">New customer</h1>
        <p className="mt-2 opacity-75">
          Use this only when the customer is not in QuickBooks yet. The system checks for likely
          duplicates by phone, email and name before anything is created.
        </p>
      </header>
      <NewCustomerForm />
    </main>
  );
}
