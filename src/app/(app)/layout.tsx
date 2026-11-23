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
      {/* On a phone: name and sign-out on the first row, the menu wrapped underneath. On a wide
          screen everything sits on one row. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-zinc-500/40 px-4 py-3 sm:px-6">
        <Link href="/" className="whitespace-nowrap font-semibold">
          <span className="text-[#FF5200]">Liferaft Services</span> Operations
        </Link>
        <form action={signOut} className="flex items-center gap-3 text-sm lg:order-3">
          <span className="hidden sm:inline">
            {staff.fullName} · {staff.role === "admin" ? "Admin" : "User"}
          </span>
          <button type="submit" className="font-semibold underline">
            Sign out
          </button>
        </form>
        <nav className="flex w-full flex-wrap gap-x-2 gap-y-2 text-sm font-semibold lg:order-2 lg:w-auto lg:flex-1 lg:gap-x-4">
          {(
            [
              ["/board", "Board"],
              ["/scan", "Scan"],
              ["/inspections", "Batch grid"],
              ["/intake", "Intake"],
              ["/rafts", "Rafts"],
              ["/customers", "Customers"],
              ["/settings/quickbooks", "QuickBooks"],
              ...(staff.role === "admin" ? [["/settings/import", "Import"]] : []),
            ] as [string, string][]
          ).map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="whitespace-nowrap rounded border border-zinc-500/50 px-3 py-1.5 lg:border-0 lg:px-0 lg:py-0 lg:underline"
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </>
  );
}
