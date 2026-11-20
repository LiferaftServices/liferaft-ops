"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createQboCustomer, QboDuplicateNameError } from "@/lib/qbo/client";
import { createClient } from "@/lib/supabase/server";

export interface Match {
  qbo_id: string;
  fully_qualified_name: string;
  phone: string | null;
  email: string | null;
  why: string;
}

export interface NewCustomerState {
  error: string | null;
  matches: Match[];
  /** True once possible duplicates have been shown and the person must tick the box to proceed. */
  needsConfirm: boolean;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim().slice(0, 200);

export async function addCustomer(_prev: NewCustomerState, form: FormData): Promise<NewCustomerState> {
  await requireStaff();
  const first = text(form, "first");
  const last = text(form, "last");
  const company = text(form, "company");
  const phone = text(form, "phone");
  const email = text(form, "email");
  if (!company && !(first && last)) {
    return { error: "Enter a first and last name, or a company name.", matches: [], needsConfirm: false };
  }
  if (!phone && !email) {
    return { error: "Enter a phone number or an email so the customer can be reached.", matches: [], needsConfirm: false };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address does not look right.", matches: [], needsConfirm: false };
  }
  // The same naming the customer list already uses: "Last, First" for people.
  const displayName = company || `${last}, ${first}`;

  // Look for people who may already be in QuickBooks under another spelling.
  const supabase = await createClient();
  const found = new Map<string, Match>();
  const add = (rows: Omit<Match, "why">[] | null, why: string) => {
    for (const r of rows ?? []) if (!found.has(r.qbo_id)) found.set(r.qbo_id, { ...r, why });
  };
  const cols = "qbo_id, fully_qualified_name, phone, email";
  const safe = (s: string) => s.replace(/[%_,()\\*"]/g, " ").trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 7) {
    const tail = `%${digits.slice(-7, -4)}%${digits.slice(-4)}%`;
    add((await supabase.from("qbo_customers").select(cols).or(`phone.ilike.${tail},mobile.ilike.${tail}`).limit(5)).data, "Same phone number");
  }
  if (email) add((await supabase.from("qbo_customers").select(cols).ilike("email", safe(email)).limit(5)).data, "Same email");
  if (last && first) {
    add(
      (await supabase.from("qbo_customers").select(cols).ilike("display_name", `%${safe(last)}%`).ilike("display_name", `%${safe(first)}%`).limit(5)).data,
      "Similar name",
    );
  }
  if (company) {
    add((await supabase.from("qbo_customers").select(cols).ilike("display_name", `%${safe(company)}%`).limit(5)).data, "Similar name");
  }
  const matches = [...found.values()];
  if (matches.length && form.get("confirm") !== "on") {
    return { error: null, matches, needsConfirm: true };
  }

  let qboId: string;
  try {
    qboId = await createQboCustomer({
      displayName,
      givenName: first || undefined,
      familyName: last || undefined,
      companyName: company || undefined,
      phone: phone || undefined,
      email: email || undefined,
      addressLine: text(form, "address") || undefined,
      city: text(form, "city") || undefined,
      state: text(form, "state") || undefined,
      postalCode: text(form, "zip") || undefined,
    });
  } catch (err) {
    const message =
      err instanceof QboDuplicateNameError
        ? `${err.message} Search for "${displayName}" on the intake page and use that record.`
        : err instanceof Error
          ? err.message
          : "QuickBooks did not accept the new customer.";
    return { error: message, matches, needsConfirm: matches.length > 0 };
  }
  redirect(`/intake/${qboId}?created=1`);
}
