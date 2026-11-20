// Choices offered at intake. Type decides the default service interval.

export const EQUIPMENT_TYPES = [
  "SOLAS A",
  "SOLAS B",
  "IBA",
  "Coastal",
  "Rec Coastal",
  "Rec Offshore",
  "<24",
  ">24",
  "Other",
] as const;

export const BRANDS = [
  "Crewsaver",
  "Crewsaver Rec.",
  "Elliot",
  "Revere (3Si)",
  "Revere Rec.",
  "RFD Revere",
  "Survitec Zodiac",
  "Zodiac Rec",
  "SSP",
  "Superior",
  "RFD",
  "Ocean Safety",
  "Datrex",
  "DBC",
  "DSB",
  "Viking",
  "Winslow",
  "Switlik",
  "Other",
] as const;

export const PRIORITY_LABELS: Record<string, string> = {
  normal: "Normal",
  hot: "Hot",
  seasonal: "Low / seasonal",
  scheduled: "Scheduled",
  winter_storage: "Winter storage",
};

/** Recreational rafts are serviced every three years, commercial rafts every year. */
export function isRecreational(equipmentType: string, brand: string): boolean {
  const t = equipmentType.trim().toLowerCase();
  return t.startsWith("rec") || t === "<24" || t === ">24" || /\brec\b\.?/i.test(brand);
}

export const serviceIntervalMonths = (equipmentType: string, brand: string) =>
  isRecreational(equipmentType, brand) ? 36 : 12;

export const SERVICE_CLASS_LABELS: Record<string, string> = { raft: "Raft", iba: "IBA", coastal: "Coastal" };
