import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";

// Rendered fresh for each request: the page depends on who is signed in.
export const instant = false;

// Everything under this layout is for signed-in staff only.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await requireStaff();
  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3">
        <p className="font-semibold">
          <span className="text-[#FF5200]">Liferaft Services</span> Operations
        </p>
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
