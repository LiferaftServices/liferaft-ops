"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { MESSAGES } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Notes that a customer message was opened for sending. */
export async function recordMessage(jobId: string, kind: string, recipient: string): Promise<void> {
  const staff = await requireStaff();
  if (!UUID.test(String(jobId)) || !MESSAGES.some((m) => m.key === kind) || typeof recipient !== "string") return;
  const supabase = await createClient();
  await supabase.from("job_notifications").insert({ job_id: jobId, kind, recipient: recipient.slice(0, 200), created_by: staff.id });
  revalidatePath(`/jobs/${jobId}`);
}
