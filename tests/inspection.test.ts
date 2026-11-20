import { describe, expect, it } from "vitest";
import { cleanValue, correctedChange, FIELDS, pressureCorrection, SECTIONS } from "../src/lib/inspection-form";

describe("inspection form", () => {
  it("has a unique key for every field", () => {
    const keys = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(FIELDS.size).toBe(keys.length);
  });

  it("corrects ending pressures the way the FastField form did", () => {
    // 0.2 °C warmer, barometer unchanged: correction -0.74 mbar (3.7 per degree)
    const v = { pt_room_temp_start: "19", pt_room_temp_end: "19.2", pt_barometer_start: "1018", pt_barometer_end: "1018", pt_top_start: "220", pt_top_end: "218" };
    expect(pressureCorrection(v)).toBeCloseTo(-0.74, 5);
    expect(correctedChange(v, "top")).toBeCloseTo(((218 - 0.74 - 220) / 220) * 100, 5);
    // barometer up 2: +2 mbar
    expect(pressureCorrection({ ...v, pt_room_temp_end: "19", pt_barometer_end: "1020" })).toBeCloseTo(2, 5);
    expect(correctedChange(v, "bottom")).toBeNull();
  });

  it("flags a failed chamber and a dating beyond six months", () => {
    const pressure = SECTIONS.find((s) => s.key === "pressure")!;
    const top = pressure.computed!.find((c) => c.label === "Top tube")!;
    const base = { pt_room_temp_start: "19", pt_room_temp_end: "19", pt_barometer_start: "1018", pt_barometer_end: "1018", pt_top_start: "220" };
    expect(top.value({ ...base, pt_top_end: "215" })).toMatchObject({ warn: false });
    expect(top.value({ ...base, pt_top_end: "200" })).toMatchObject({ warn: true });
    const dating = SECTIONS[0].computed![0];
    expect(dating.value({ work_date: "2026-10-22", dated_as: "2026-12" })?.warn).toBeFalsy();
    expect(dating.value({ work_date: "2026-10-22", dated_as: "2027-05" })?.warn).toBe(true);
  });

  it("accepts only valid values", () => {
    const n = FIELDS.get("pt_top_start")!;
    expect(cleanValue(n, " 220.3 ")).toBe("220.3");
    expect(cleanValue(n, "abc")).toBeUndefined();
    expect(cleanValue(n, "")).toBeNull();
    expect(cleanValue(FIELDS.get("dated_as")!, "2026-12")).toBe("2026-12");
    expect(cleanValue(FIELDS.get("rf_upper_buoyancy")!, "Inspected")).toBe("Inspected");
    expect(cleanValue(FIELDS.get("rf_upper_buoyancy")!, "Whatever")).toBeUndefined();
  });
});
