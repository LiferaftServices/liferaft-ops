import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "user";
}

export type Session =
  | { status: "signed_out" }
  | { status: "not_staff"; email: string }
  | { status: "staff"; staff: StaffMember };

/** Who is making this request, checked against the staff table. */
export async function getSession(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed_out" };

  const { data } = await supabase
    .from("staff")
    .select("id, full_name, email, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.active) return { status: "not_staff", email: user.email ?? "" };
  return {
    status: "staff",
    staff: { id: data.id, fullName: data.full_name, email: data.email, role: data.role },
  };
}

/** For pages that only staff may see. */
export async function requireStaff(): Promise<StaffMember> {
  const session = await getSession();
  if (session.status === "signed_out") redirect("/login");
  if (session.status === "not_staff") redirect("/login?reason=not-staff");
  return session.staff;
}
