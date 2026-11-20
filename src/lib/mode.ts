import "server-only";
import { cookies } from "next/headers";
import type { Mode } from "@/lib/workflow";

// The mode a person is working in right now. It only changes which buttons are
// offered; anyone can switch at any time.

export const MODES: readonly Mode[] = ["office", "technician", "driver"];
export const MODE_LABELS: Record<Mode, string> = { office: "Office", technician: "Technician", driver: "Driver" };
export const MODE_COOKIE = "working_mode";

export async function getMode(): Promise<Mode> {
  const value = (await cookies()).get(MODE_COOKIE)?.value;
  return (MODES as readonly string[]).includes(value ?? "") ? (value as Mode) : "office";
}
