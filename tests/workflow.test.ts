import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  MAIN_STAGES,
  SIDE_ACTIONS,
  SIDE_STAGES,
  availableActions,
  checkMove,
  type JobState,
  type Person,
  type Stage,
} from "../src/lib/workflow";

const office: Person = { role: "user", mode: "office" };
const tech: Person = { role: "user", mode: "technician" };
const driver: Person = { role: "user", mode: "driver" };
const admin: Person = { role: "admin", mode: "driver" };

function walk(start: Stage, steps: [Person, string][], extra: Partial<JobState> = {}) {
  let job: JobState = { stage: start, ...extra };
  for (const [person, key] of steps) {
    const result = checkMove(job, person, key);
    if (!result.ok) throw new Error(`${key} refused from ${job.stage}: ${result.reason}`);
    job = { ...job, stage: result.to, stageBeforeSide: result.stageBeforeSide };
  }
  return job;
}

describe("main line", () => {
  it("walks a delivered raft from scheduled pickup to delivered", () => {
    const job = walk(
      "scheduled_pickup",
      [
        [driver, "pick_up"],
        [tech, "receive"],
        [office, "schedule_service"],
        [tech, "begin_service"],
        [tech, "complete_inspection"],
        [office, "invoice_for_delivery"],
        [driver, "load"],
        [driver, "deliver"],
      ],
      { paymentStatus: "paid" },
    );
    expect(job.stage).toBe("delivered");
  });

  it("walks a customer-collected raft", () => {
    const job = walk(
      "received",
      [
        [office, "schedule_service"],
        [tech, "begin_service"],
        [tech, "complete_inspection"],
        [office, "invoice_for_pickup"],
        [office, "customer_collects"],
      ],
      { paymentStatus: "paid" },
    );
    expect(job.stage).toBe("customer_picked_up");
  });

  it("every main stage can be reached and every stage name is used", () => {
    const reachable = new Set<Stage>(["scheduled_pickup", "received"]);
    for (const a of [...ACTIONS, ...SIDE_ACTIONS]) reachable.add(a.to);
    for (const s of [...MAIN_STAGES, ...SIDE_STAGES]) expect(reachable.has(s)).toBe(true);
  });

  it("refuses a jump that skips stages", () => {
    expect(checkMove({ stage: "received" }, office, "deliver")).toEqual({
      ok: false,
      reason: "not_allowed",
    });
  });
});

describe("modes", () => {
  it("shows a driver only driver actions", () => {
    const keys = availableActions({ stage: "ready_for_delivery", paymentStatus: "paid" }, driver).map(
      (a) => a.key,
    );
    expect(keys).toEqual(["load"]);
  });

  it("stops a technician approving an invoice", () => {
    expect(checkMove({ stage: "needs_invoice" }, tech, "invoice_for_delivery").ok).toBe(false);
  });

  it("lets an admin do anything valid whatever mode they are in", () => {
    expect(checkMove({ stage: "needs_invoice" }, admin, "invoice_for_delivery").ok).toBe(true);
  });
});

describe("estimate loop", () => {
  it("holds the job on the floor until the estimate is approved", () => {
    const waiting = walk("on_floor", [[tech, "request_estimate"]]);
    expect(waiting.stage).toBe("awaiting_estimate");
    expect(checkMove(waiting, tech, "complete_inspection").ok).toBe(false);
    const back = walk("awaiting_estimate", [[office, "estimate_approved"]]);
    expect(back.stage).toBe("on_floor");
  });

  it("blocks sign-off while an estimate is still open", () => {
    expect(checkMove({ stage: "on_floor", estimateOpen: true }, tech, "complete_inspection")).toEqual({
      ok: false,
      reason: "estimate_open",
    });
  });
});

describe("payment hold", () => {
  const unpaid: JobState = { stage: "ready_for_delivery", paymentStatus: "unpaid" };

  it("stops an unpaid raft being loaded", () => {
    expect(checkMove(unpaid, driver, "load")).toEqual({ ok: false, reason: "payment_hold" });
  });

  it("stops an unpaid raft being handed to the customer", () => {
    expect(
      checkMove({ stage: "ready_for_pickup", paymentStatus: "unpaid" }, office, "customer_collects"),
    ).toEqual({ ok: false, reason: "payment_hold" });
  });

  it("lets it go once a person acknowledges the hold", () => {
    expect(checkMove({ ...unpaid, paymentHoldAcknowledged: true }, driver, "load").ok).toBe(true);
  });

  it("skips the hold for an exempt customer", () => {
    expect(checkMove({ ...unpaid, customerPaymentHoldExempt: true }, driver, "load").ok).toBe(true);
  });
});

describe("side stages", () => {
  it("parks a job and returns it to where it was", () => {
    const parked = walk("ready_for_delivery", [[office, "to_winter_storage"]]);
    expect(parked.stage).toBe("winter_storage");
    expect(parked.stageBeforeSide).toBe("ready_for_delivery");
    const resumed = checkMove(parked, office, "resume");
    expect(resumed).toMatchObject({ ok: true, to: "ready_for_delivery" });
  });

  it("does not offer a way back from condemned", () => {
    const condemned = walk("on_floor", [[tech, "flag_condemn"]]);
    expect(availableActions(condemned, office).map((a) => a.key)).not.toContain("resume");
    expect(checkMove(condemned, office, "resume").ok).toBe(false);
  });
});
