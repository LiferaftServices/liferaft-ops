// The liferaft inspection form: its sections, fields and the calculations made from the
// readings. Taken from the "New Liferaft Inspection 2023" form the shops have been using.
// Used by the per-raft form and by the batch grid, on the server and in the browser.

export type FieldType = "state" | "choice" | "yesno" | "num" | "text" | "date" | "month" | "time";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  unit?: string;
}

export interface Computed {
  label: string;
  /** Text to show, and whether it needs attention. Null when the readings are not all in yet. */
  value: (v: Values) => { text: string; warn?: boolean } | null;
}

export interface Section {
  key: string;
  title: string;
  fields: Field[];
  computed?: Computed[];
}

export type Values = Record<string, string | undefined>;

export const STATE_OPTIONS = ["Inspected", "Replaced", "Repaired", "Not present"] as const;
export const YESNO_OPTIONS = ["Yes", "No", "N/A"] as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const f = (prefix: string, label: string, type: FieldType, extra: Partial<Field> = {}): Field => ({
  key: `${prefix}_${slug(label)}`,
  label,
  type,
  ...extra,
});
const states = (prefix: string, labels: string[]) => labels.map((l) => f(prefix, l, "state"));
const checks = (prefix: string, labels: string[]) => labels.map((l) => f(prefix, l, "yesno"));
const dated = (prefix: string, label: string): Field[] => [
  f(prefix, label, "state"),
  f(prefix, `${label} quantity`, "num"),
  f(prefix, `${label} expiry`, "month"),
];
const mbar = { unit: "mbar" };

const num = (v: Values, key: string): number | null => {
  const raw = v[key];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

/** A corrected pressure drop of this many percent or more fails; anything less passes. */
export const MAX_DROP_PERCENT = 5;
/** True when a percent change passes: a drop of 4.9999% passes, a drop of 5% fails. */
export const passesDrop = (changePercent: number) => -changePercent < MAX_DROP_PERCENT - 1e-9;
/** Pressure correction per degree C of temperature change, as on the FastField form. */
export const MBAR_PER_DEGREE = 3.7;
/** A temperature change larger than this means the pressure test must be restarted. */
export const MAX_TEMP_CHANGE = 3;

/** The correction added to the ending pressures: barometer change, less 3.7 mbar per degree of warming. */
export function pressureCorrection(v: Values): number | null {
  const [t0, t1, b0, b1] = [num(v, "pt_room_temp_start"), num(v, "pt_room_temp_end"), num(v, "pt_barometer_start"), num(v, "pt_barometer_end")];
  if (t0 === null || t1 === null || b0 === null || b1 === null) return null;
  return b1 - b0 - MBAR_PER_DEGREE * (t1 - t0);
}

/** Percent change of a chamber over the pressure test, after correction. */
export function correctedChange(v: Values, chamber: "top" | "bottom" | "floor"): number | null {
  const start = num(v, `pt_${chamber}_start`);
  const end = num(v, `pt_${chamber}_end`);
  const corr = pressureCorrection(v);
  if (start === null || end === null || corr === null || start <= 0) return null;
  return ((end + corr - start) / start) * 100;
}

const chamberResult = (chamber: "top" | "bottom" | "floor"): Computed["value"] => (v) => {
  const change = correctedChange(v, chamber);
  if (change === null) return null;
  const pass = passesDrop(change);
  return { text: `${pct(change)} · ${pass ? "Pass" : "FAIL"}`, warn: !pass };
};

const napChange = (chamber: "top" | "bottom"): Computed["value"] => (v) => {
  const on = num(v, `nap_${chamber}_reading_on`);
  const off = num(v, `nap_${chamber}_reading_off`);
  if (on === null || off === null || on <= 0) return null;
  const change = ((off - on) / on) * 100;
  const pass = passesDrop(change);
  return { text: `${pct(change)} · ${pass ? "Pass" : "FAIL"}`, warn: !pass };
};

export const SECTIONS: Section[] = [
  {
    key: "details",
    title: "Service details",
    fields: [
      { key: "work_date", label: "Date work was done", type: "date" },
      { key: "dated_as", label: "Dated as (month on the sticker, up to 6 months ahead)", type: "month" },
      f("d", "Inspecting technician", "text"),
      f("d", "Last service location", "text"),
      f("d", "Date of last inspection", "month"),
      f("d", "Approval number", "text"),
      f("d", "Painter length", "num"),
      f("d", "Drop height", "num"),
      f("d", "Fabric", "choice", { options: ["PU", "Rubber", "PVC", "Butyl"] }),
      f("d", "Container type", "choice", { options: ["LPC", "Valise", "Round"] }),
      f("d", "Floor type", "choice", { options: ["Insulated", "Single", "Inflatable"] }),
    ],
    computed: [
      {
        label: "Dating check",
        value: (v) => {
          if (!v.dated_as) return null;
          const work = v.work_date ? new Date(`${v.work_date}T12:00:00`) : new Date();
          const [y, m] = v.dated_as.split("-").map(Number);
          const ahead = (y - work.getFullYear()) * 12 + (m - 1 - work.getMonth());
          if (ahead < 0) return { text: "The dated-as month is before the work date.", warn: true };
          if (ahead > 6) return { text: "More than 6 months ahead of the work date: not allowed.", warn: true };
          return { text: ahead === 0 ? "Dated the month of service." : `Dated ${ahead} month${ahead === 1 ? "" : "s"} ahead. The raft must stay in the shop until then.` };
        },
      },
    ],
  },
  {
    key: "inflation",
    title: "Inflation tests",
    fields: [
      f("gi", "Date of last GI", "month"),
      f("gi", "Inflation time", "num", { unit: "sec" }),
      f("gi", "GI test result", "choice", { options: ["Pass", "Fail", "Not due"] }),
      f("gi", "Blast test result", "choice", { options: ["Pass", "Fail"] }),
    ],
  },
  {
    key: "prv",
    title: "Pressure relief valves",
    fields: [
      f("prv", "PRVs replaced", "yesno"),
      f("prv", "Top tube opening pressure", "num", mbar),
      f("prv", "Top tube closing pressure", "num", mbar),
      f("prv", "Bottom tube opening pressure", "num", mbar),
      f("prv", "Bottom tube closing pressure", "num", mbar),
    ],
  },
  {
    key: "nap",
    title: "NAP test and floor seam",
    fields: [
      { key: "nap_time_on", label: "Time on", type: "time" },
      { key: "nap_top_reading_on", label: "Top tube reading on", type: "num", ...mbar },
      { key: "nap_bottom_reading_on", label: "Bottom tube reading on", type: "num", ...mbar },
      { key: "nap_time_off", label: "Time off", type: "time" },
      { key: "nap_top_reading_off", label: "Top tube reading off", type: "num", ...mbar },
      { key: "nap_bottom_reading_off", label: "Bottom tube reading off", type: "num", ...mbar },
      f("nap", "Last floor seam test", "date"),
      f("nap", "Floor seam test result", "choice", { options: ["Pass", "Fail", "Not due"] }),
    ],
    computed: [
      { label: "Top tube change", value: napChange("top") },
      { label: "Bottom tube change", value: napChange("bottom") },
    ],
  },
  {
    key: "pressure",
    title: "Pressure test",
    fields: [
      { key: "pt_start_time", label: "Start time", type: "time" },
      { key: "pt_room_temp_start", label: "Room temperature, start", type: "num", unit: "°C" },
      { key: "pt_barometer_start", label: "Barometer, start", type: "num", ...mbar },
      { key: "pt_top_start", label: "Top tube, start", type: "num", ...mbar },
      { key: "pt_bottom_start", label: "Bottom tube, start", type: "num", ...mbar },
      { key: "pt_floor_start", label: "Inflatable floor, start", type: "num", ...mbar },
      { key: "pt_end_time", label: "End time", type: "time" },
      { key: "pt_room_temp_end", label: "Room temperature, end", type: "num", unit: "°C" },
      { key: "pt_barometer_end", label: "Barometer, end", type: "num", ...mbar },
      { key: "pt_top_end", label: "Top tube, end", type: "num", ...mbar },
      { key: "pt_bottom_end", label: "Bottom tube, end", type: "num", ...mbar },
      { key: "pt_floor_end", label: "Inflatable floor, end", type: "num", ...mbar },
    ],
    computed: [
      {
        label: "Temperature change",
        value: (v) => {
          const [t0, t1] = [num(v, "pt_room_temp_start"), num(v, "pt_room_temp_end")];
          if (t0 === null || t1 === null) return null;
          const change = t1 - t0;
          const bad = Math.abs(change) > MAX_TEMP_CHANGE;
          return { text: `${change > 0 ? "+" : ""}${change.toFixed(1)} °C${bad ? " · more than 3 °C: restart the test" : ""}`, warn: bad };
        },
      },
      {
        label: "Correction",
        value: (v) => {
          const c = pressureCorrection(v);
          return c === null ? null : { text: `${c > 0 ? "+" : ""}${c.toFixed(2)} mbar` };
        },
      },
      { label: "Top tube", value: chamberResult("top") },
      { label: "Bottom tube", value: chamberResult("bottom") },
      { label: "Floor", value: chamberResult("floor") },
    ],
  },
  {
    key: "cylinder",
    title: "Operating head and cylinder",
    fields: [
      f("oh", "Operating head type", "text"),
      f("oh", "Operating head serial or batch", "text"),
      f("oh", "Operating head expiry", "month"),
      f("oh", "Second operating head type", "text"),
      f("oh", "Second operating head serial or batch", "text"),
      f("oh", "Second operating head expiry", "month"),
      f("cyl", "Cylinder serial number", "text"),
      f("cyl", "Cylinder hydrostatic test date", "month"),
      f("cyl", "Weight units", "choice", { options: ["kg", "lbs"] }),
      f("cyl", "CO2 weight", "num"),
      f("cyl", "N2 weight", "num"),
      f("cyl", "Full weight", "num"),
      f("cyl", "Second cylinder serial number", "text"),
      f("cyl", "Second cylinder hydrostatic test date", "month"),
      f("cyl", "Second cylinder CO2 weight", "num"),
      f("cyl", "Second cylinder N2 weight", "num"),
      f("cyl", "Second cylinder full weight", "num"),
    ],
  },
  {
    key: "painter",
    title: "Painter and hydrostatic release",
    fields: [
      f("pa", "Painter line", "choice", { options: ["Inspected", "Re-flaked", "Replaced"] }),
      f("pa", "Painter plug or gasket", "state"),
      f("pa", "Hydrostatic release", "state"),
      f("pa", "Hydrostatic release expiry", "month"),
    ],
  },
  {
    key: "inflation_system",
    title: "Inflation system",
    fields: states("is", ["Firing cable or pin", "Safety or break cap", "Guide and O-rings", "Inflation hoses", "Inlet check valves"]),
  },
  {
    key: "raft",
    title: "Raft, canopy and floor",
    fields: states("rf", [
      "Upper buoyancy", "Lower buoyancy", "Canopy arch", "Boarding ramp", "Boarding ladder", "Lifeline, outer", "Lifeline, inner",
      "Topping-up valves", "Tow or bowsing patch", "Outer canopy", "Inner canopy", "Canopy reflective tape", "Ties and zippers",
      "Observation port", "Rain collector", "Floor reflective tape", "Righting strap", "Ballast bags", "Pack ties",
    ]),
  },
  {
    key: "attachments",
    title: "Lights and attachments",
    fields: [
      f("at", "Exterior light", "state"),
      f("at", "Exterior light expiry", "month"),
      f("at", "Interior light", "state"),
      f("at", "Interior light expiry", "month"),
      f("at", "Anti-seasickness tablets in raft", "state"),
      f("at", "Anti-seasickness tablets expiry", "month"),
      ...states("at", ["Safety knife", "Rescue quoit", "Sea anchors", "Bowsing line", "Survival instructions", "Radar reflector"]),
    ],
  },
  {
    key: "packing",
    title: "Packing prep",
    fields: states("pk", ["Vacuum bag", "O-rings and fiber washers", "Firing head protection"]),
  },
  {
    key: "container",
    title: "Container",
    fields: [
      f("ct", "Container and equipment technician", "text"),
      ...states("ct", ["Outer shell or valise", "Gasket", "Handles", "Labels", "Drain holes", "Burst strap or band", "Hinge patch"]),
      f("ct", "Container washed and cleaned", "yesno"),
    ],
  },
  {
    key: "equipment",
    title: "Equipment pack",
    fields: [
      f("eq", "Equipment bag quantity", "num"),
      ...states("eq", [
        "Flashlight and bulb", "Flashlight batteries", "Pump or bellows", "Signal mirror", "Whistle", "Rescue signal table", "Can openers",
        "Fishing kit", "Leak stoppers", "Sponges", "Thermal protective aid", "Repair kit", "Drinking cup", "Rain water bags",
        "Seasickness bags", "Paddles", "Bailers",
      ]),
    ],
  },
  {
    key: "dated",
    title: "Dated items",
    fields: [
      ...dated("dt", "Drinking water"), ...dated("dt", "Food rations"), ...dated("dt", "Pararocket flares"), ...dated("dt", "Handheld flares"),
      ...dated("dt", "Smoke signals"), ...dated("dt", "First aid kit"), ...dated("dt", "Seasickness tablets in pack"), ...dated("dt", "Repair kit adhesive"),
    ],
  },
  {
    key: "cradle",
    title: "Cradle and lashing",
    fields: states("cr", ["Cradle", "Cradle strap or lashing", "Shackles", "Pelican hook or snap shackle"]),
  },
  {
    key: "final",
    title: "Final checks",
    fields: [
      ...checks("fc", [
        "Container drains clear", "Tools removed", "Log and ID card filled out", "Knife or TDA installed in operating head", "Hoses connected and torqued",
        "Cylinder secured", "Pads on firing head", "Caps on top-up valves", "Caps off PRVs", "Floor drain open", "Lights connected",
        "Service bulletins applied", "Temporary ties removed", "Painter connected to operating head and raft",
      ]),
      f("fc", "Service bulletins and technician notes", "text"),
    ],
  },
  {
    key: "uscg",
    title: "USCG witness and problems",
    fields: [
      f("cg", "Service witnessed by USCG inspector", "yesno"),
      f("cg", "Date witnessed", "date"),
      f("cg", "Tests witnessed", "text"),
      f("cg", "USCG inspector name", "text"),
      f("cg", "USCG inspector comments", "text"),
      f("cg", "Problems found during service", "yesno"),
      f("cg", "Describe the problem", "text"),
    ],
  },
];

export const FIELDS: Map<string, Field> = new Map(SECTIONS.flatMap((s) => s.fields.map((x) => [x.key, x] as const)));

/** Checks and tidies a value typed into a field. Returns null to clear it, or undefined if it is not valid. */
export function cleanValue(field: Field, raw: string): string | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  switch (field.type) {
    case "state": return (STATE_OPTIONS as readonly string[]).includes(v) ? v : undefined;
    case "yesno": return (YESNO_OPTIONS as readonly string[]).includes(v) ? v : undefined;
    case "choice": return field.options?.includes(v) ? v : undefined;
    case "num": return /^-?\d{1,7}(\.\d{1,4})?$/.test(v) ? v : undefined;
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    case "month": return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined;
    case "time": return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined;
    default: return v.slice(0, 500);
  }
}

/** How many of a section's fields have been filled in. */
export function sectionProgress(section: Section, v: Values): { done: number; of: number } {
  return { done: section.fields.filter((x) => v[x.key] !== undefined && v[x.key] !== "").length, of: section.fields.length };
}
