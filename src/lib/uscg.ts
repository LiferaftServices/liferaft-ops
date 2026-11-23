// The service station notice sent to the Coast Guard when a raft's service begins.

export const SERVICE_TYPES = ["Annual", "5-yr", "Annual, FS, NAP"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/**
 * A starting suggestion only; the technician makes the call. Floor seam and NAP tests from the
 * tenth year on. Before that, the gas inflation test when about five years have passed since the
 * last one, or since manufacture if the raft has not had one. Manufacture dates can be a year or
 * two older than the sale date, and rafts come in early, so this is often adjusted by hand.
 */
export function suggestServiceType(manufactureDate: string | null, today: Date = new Date(), lastGi: string | null = null): ServiceType {
  const monthsSince = (iso: string) => {
    const d = new Date(`${iso.length === 7 ? `${iso}-15` : iso}T12:00:00`);
    return (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth());
  };
  if (manufactureDate && monthsSince(manufactureDate) >= 114) return "Annual, FS, NAP"; // from six months before the tenth anniversary
  if (lastGi) return monthsSince(lastGi) >= 54 ? "5-yr" : "Annual";
  if (!manufactureDate) return "Annual";
  const months = monthsSince(manufactureDate);
  return months >= 54 && months < 66 ? "5-yr" : "Annual";
}

export interface NoticeInput {
  shopName: string;
  vesselName: string | null;
  brand: string | null;
  approvalNumber: string | null;
  serialNumber: string | null;
  capacity: number | null;
  manufactureDate: string | null;
  serviceType: ServiceType;
}

export function buildNotice(n: NoticeInput): { subject: string; body: string; missing: string[] } {
  const shop = n.shopName.replace(/\s*Raft Service$/i, "").trim() || n.shopName;
  const vessel = n.vesselName?.trim() || "No vessel";
  const made = n.manufactureDate
    ? new Date(`${n.manufactureDate}T12:00:00`).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    : "";
  const missing = [
    !n.vesselName?.trim() ? "vessel name" : null,
    !n.brand ? "manufacturer" : null,
    !n.approvalNumber ? "CG approval number" : null,
    !n.serialNumber ? "serial number" : null,
    !n.capacity ? "capacity" : null,
    !made ? "manufacture date" : null,
  ].filter((x): x is string => Boolean(x));
  return {
    subject: `Liferaft Services ${shop} - Service Station Notice for ${vessel}, ${n.serialNumber ?? "no serial"}`,
    body: [
      `Vessel Name & Type: ${vessel}`,
      `Raft Manufacturer: ${n.brand ?? ""}`,
      `CG Approval #: ${n.approvalNumber ?? ""}`,
      `Serial #: ${n.serialNumber ?? ""}`,
      `Capacity of Raft: ${n.capacity ?? ""}`,
      `MFG Date: ${made}`,
      `Service Type: ${n.serviceType}`,
    ].join("\n"),
    missing,
  };
}

/** A link that opens the notice as a new message in the computer's email program. */
export function mailto(to: string, cc: string, subject: string, body: string): string {
  const q = [cc ? `cc=${encodeURIComponent(cc)}` : null, `subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`]
    .filter(Boolean)
    .join("&");
  return `mailto:${encodeURIComponent(to)}?${q}`;
}
