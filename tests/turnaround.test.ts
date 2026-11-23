import { describe, expect, it } from "vitest";
import { calculatedTurnaround, describeDays, measuredTurnaround } from "../src/lib/turnaround";
import { addWorkingDays, suggestSchedule } from "../src/lib/turnaround";

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

describe("suggested schedule", () => {
  const york = { batchSize: 2, batchDays: 3, handoffDays: 2 };
  const monday = new Date(2026, 10, 23); // Mon Nov 23, 2026
  it("skips weekends", () => {
    expect(addWorkingDays(new Date(2026, 10, 27), 1).getDate()).toBe(30); // Fri -> Mon
    expect(addWorkingDays(new Date(2026, 10, 28), 0).getDate()).toBe(30); // Sat -> Mon
  });
  it("fills batches in order, urgent first, then longest waiting", () => {
    const jobs = [
      { id: "a", priority: "normal", received: "2026-11-10" },
      { id: "b", priority: "normal", received: "2026-11-02" },
      { id: "c", priority: "rush", received: "2026-11-20" },
    ];
    const s = suggestSchedule(jobs, false, york, monday);
    expect(s.get("c")).toEqual({ start: "2026-11-24", due: "2026-11-30" }); // first batch: Tue, 3 days + 2 handoff
    expect(s.get("b")?.start).toBe("2026-11-24");
    expect(s.get("a")?.start).toBe("2026-11-27"); // second batch, three working days later
  });
  it("waits for the batch on the floor", () => {
    const s = suggestSchedule([{ id: "a", priority: "normal", received: null }], true, york, monday);
    expect(s.get("a")?.start).toBe("2026-11-26");
  });
});
