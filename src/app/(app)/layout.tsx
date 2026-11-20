import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";

// Rendered fresh for each request: the page depends on who is signed in.
export const instant = false;

// Everything under this layout is for signed-in staff only.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await requireStaff();
  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-500/40 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold">
            <span className="text-[#FF5200]">Liferaft Services</span> Operations
          </Link>
          <nav className="flex gap-4 text-sm font-semibold">
            <Link href="/rafts" className="underline">
              Rafts
            </Link>
            <Link href="/customers" className="underline">
              Customers
            </Link>
            <Link href="/settings/quickbooks" className="underline">
              QuickBooks
            </Link>
            {staff.role === "admin" ? (
              <Link href="/settings/import" className="underline">
                Import
              </Link>
            ) : null}
          </nav>
        </div>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <span>
            {staff.fullName} · {staff.role === "admin" ? "Admin" : "User"}
          </span>
          <button type="submit" className="font-semibold underline">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </>
  );
}
