import { describe, expect, it } from "vitest";
import { calculatedTurnaround, describeDays, measuredTurnaround } from "../src/lib/turnaround";

describe("turnaround", () => {
  it("describes days the way it is said on the phone", () => {
    expect(describeDays(5)).toBe("5 days");
    expect(describeDays(1)).toBe("1 day");
    expect(describeDays(14)).toBe("about 2 weeks");
    expect(describeDays(18)).toBe("about 2.5 weeks");
  });

  it("waits for enough completed jobs, then reports the middle wait", () => {
    const job = (received: string, servicedOn: string) => ({ received, servicedOn });
    const few = [job("2026-11-01", "2026-11-10")];
    expect(measuredTurnaround(few)).toBeNull();
    const many = [3, 5, 8, 10, 12, 14, 15, 18, 20, 40, 60].map((d) =>
      job("2026-09-01", new Date(Date.parse("2026-09-01") + d * 86_400_000).toISOString().slice(0, 10)),
    );
    expect(measuredTurnaround(many)).toEqual({ days: 14, count: 11 });
  });

  it("calculates from the queue and the batch rhythm", () => {
    const york = { batchSize: 20, batchDays: 3, handoffDays: 2 };
    // Empty shop: one batch window plus handoff = 5 working days = 7 calendar days.
    expect(calculatedTurnaround(0, 0, york)).toBe(7);
    // A batch on the floor and 15 waiting: wait out the current batch, then join the next.
    expect(calculatedTurnaround(15, 20, york)).toBe(Math.ceil(((1 * 3 + 3 + 2) * 7) / 5));
    // 60 waiting behind a working floor: four batches ahead.
    expect(calculatedTurnaround(60, 20, york)).toBe(Math.ceil(((4 * 3 + 3 + 2) * 7) / 5));
  });
});
