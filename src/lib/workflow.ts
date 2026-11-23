// The service workflow: every stage a job can be in and every move allowed between them.
// This one file drives the scan screen, the service board and the server-side checks,
// so the three can never disagree.

export const MAIN_STAGES = [
  "scheduled_pickup",
  "picked_up",
  "received",
  "incoming",
  "on_floor",
  "awaiting_estimate",
  "needs_invoice",
  "ready_for_delivery",
  "ready_for_pickup",
  "loaded",
  "delivered",
  "customer_picked_up",
] as const;

export const SIDE_STAGES = [
  "winter_storage",
  "transferred",
  "outside_service",
  "to_be_condemned",
  "do_not_service",
] as const;

export type MainStage = (typeof MAIN_STAGES)[number];
export type SideStage = (typeof SIDE_STAGES)[number];
export type Stage = MainStage | SideStage;

/** The mode a person is working in. One person can switch modes during the day. */
export type Mode = "office" | "technician" | "driver";

export const STAGE_LABELS: Record<Stage, string> = {
  scheduled_pickup: "Scheduled pickup",
  picked_up: "Picked up",
  received: "Received",
  incoming: "Incoming",
  on_floor: "On floor",
  awaiting_estimate: "Awaiting estimate approval",
  needs_invoice: "Needs invoice",
  ready_for_delivery: "Ready for delivery",
  ready_for_pickup: "Ready for pickup",
  loaded: "Loaded",
  delivered: "Delivered",
  customer_picked_up: "Customer picked up",
  winter_storage: "Winter storage",
  transferred: "Transferred to other shop",
  outside_service: "Outside service",
  to_be_condemned: "To be condemned",
  do_not_service: "Do not service",
};

export interface Action {
  key: string;
  label: string;
  from: readonly Stage[];
  to: Stage;
  /** Modes whose screen shows this action. Admins see every action in every mode. */
  modes: readonly Mode[];
  /** Closes the job: the raft has left the shop's hands. */
  closesJob?: boolean;
  /** Blocked by an unpaid invoice unless the customer is exempt or the hold is acknowledged. */
  paymentHold?: boolean;
  /** Not offered while an estimate is waiting on the customer. */
  blockedByOpenEstimate?: boolean;
}

export const ACTIONS: readonly Action[] = [
  {
    key: "pick_up",
    label: "Pick up",
    from: ["scheduled_pickup"],
    to: "picked_up",
    modes: ["office", "driver"],
  },
  {
    key: "receive",
    label: "Receive at shop",
    from: ["scheduled_pickup", "picked_up"],
    to: "received",
    modes: ["office", "technician", "driver"],
  },
  {
    key: "schedule_service",
    label: "Add to service queue",
    from: ["received"],
    to: "incoming",
    modes: ["office"],
  },
  {
    key: "begin_service",
    label: "Begin service",
    from: ["incoming"],
    to: "on_floor",
    modes: ["office", "technician"],
  },
  {
    key: "request_estimate",
    label: "Estimate needed",
    from: ["on_floor"],
    to: "awaiting_estimate",
    modes: ["office", "technician"],
  },
  {
    key: "estimate_approved",
    label: "Estimate approved",
    from: ["awaiting_estimate"],
    to: "on_floor",
    modes: ["office"],
  },
  {
    key: "complete_inspection",
    label: "Inspection signed off",
    from: ["on_floor"],
    to: "needs_invoice",
    modes: ["office", "technician"],
    blockedByOpenEstimate: true,
  },
  {
    key: "invoice_for_delivery",
    label: "Invoice approved: deliver",
    from: ["needs_invoice"],
    to: "ready_for_delivery",
    modes: ["office"],
  },
  {
    key: "invoice_for_pickup",
    label: "Invoice approved: customer collects",
    from: ["needs_invoice"],
    to: "ready_for_pickup",
    modes: ["office"],
  },
  {
    key: "load",
    label: "Load for delivery",
    from: ["ready_for_delivery"],
    to: "loaded",
    modes: ["office", "driver"],
    paymentHold: true,
  },
  {
    key: "deliver",
    label: "Delivered",
    from: ["loaded"],
    to: "delivered",
    modes: ["office", "driver"],
    closesJob: true,
    paymentHold: true,
  },
  {
    key: "customer_collects",
    label: "Customer picked up",
    from: ["ready_for_pickup"],
    to: "customer_picked_up",
    modes: ["office"],
    closesJob: true,
    paymentHold: true,
  },
];

/** Stages a job can be parked from. A parked job remembers where it came from. */
const PARKABLE: readonly Stage[] = [
  "received",
  "incoming",
  "on_floor",
  "awaiting_estimate",
  "needs_invoice",
  "ready_for_delivery",
  "ready_for_pickup",
];

export const SIDE_ACTIONS: readonly Action[] = [
  {
    key: "to_winter_storage",
    label: "Hold in winter storage",
    from: ["ready_for_delivery", "ready_for_pickup"],
    to: "winter_storage",
    modes: ["office"],
  },
  {
    key: "transfer",
    label: "Transfer to other shop",
    // Handled as a move to the other shop's board (see moveJob), at any point before the raft goes back out.
    from: ["scheduled_pickup", "picked_up", "received", "incoming", "on_floor", "needs_invoice", "ready_for_delivery", "ready_for_pickup"],
    to: "transferred",
    modes: ["office"],
  },
  {
    key: "send_outside",
    label: "Send for outside service",
    from: ["received", "incoming", "on_floor"],
    to: "outside_service",
    modes: ["office"],
  },
  {
    key: "flag_condemn",
    label: "Flag to be condemned",
    from: ["received", "incoming", "on_floor", "awaiting_estimate"],
    to: "to_be_condemned",
    modes: ["office", "technician"],
  },
  {
    key: "flag_do_not_service",
    label: "Do not service",
    from: PARKABLE,
    to: "do_not_service",
    modes: ["office"],
  },
];

export function isSideStage(stage: Stage): stage is SideStage {
  return (SIDE_STAGES as readonly string[]).includes(stage);
}

export interface JobState {
  stage: Stage;
  /** Where the job was before it was parked in a side stage. */
  stageBeforeSide?: Stage | null;
  estimateOpen?: boolean;
  paymentStatus?: "not_invoiced" | "unpaid" | "pending" | "paid";
  customerPaymentHoldExempt?: boolean;
  paymentHoldAcknowledged?: boolean;
}

export interface Person {
  role: "admin" | "user";
  mode: Mode;
}

/** The actions to show on the scan screen for this job and this person. */
export function availableActions(job: JobState, person: Person): Action[] {
  const all = [...ACTIONS, ...SIDE_ACTIONS];
  const offered = all.filter(
    (a) =>
      a.from.includes(job.stage) &&
      (person.role === "admin" || a.modes.includes(person.mode)) &&
      !(a.blockedByOpenEstimate && job.estimateOpen),
  );
  if (isSideStage(job.stage) && job.stageBeforeSide && canResumeFrom(job.stage)) {
    offered.push(resumeAction(job.stage, job.stageBeforeSide));
  }
  return offered;
}

function canResumeFrom(stage: SideStage): boolean {
  // A condemned raft does not come back; the others can.
  return stage !== "to_be_condemned";
}

function resumeAction(from: SideStage, to: Stage): Action {
  return {
    key: "resume",
    label: `Return to ${STAGE_LABELS[to]}`,
    from: [from],
    to,
    modes: ["office"],
  };
}

export type MoveResult =
  | { ok: true; to: Stage; closesJob: boolean; stageBeforeSide: Stage | null }
  | { ok: false; reason: "not_allowed" | "payment_hold" | "estimate_open" };

/** Checks a requested move. The server runs this before saving anything. */
export function checkMove(job: JobState, person: Person, actionKey: string): MoveResult {
  if (actionKey === "resume") {
    if (!isSideStage(job.stage) || !job.stageBeforeSide || !canResumeFrom(job.stage)) {
      return { ok: false, reason: "not_allowed" };
    }
    if (person.role !== "admin" && person.mode !== "office") {
      return { ok: false, reason: "not_allowed" };
    }
    return { ok: true, to: job.stageBeforeSide, closesJob: false, stageBeforeSide: null };
  }

  const action = [...ACTIONS, ...SIDE_ACTIONS].find((a) => a.key === actionKey);
  if (!action || !action.from.includes(job.stage)) {
    return { ok: false, reason: "not_allowed" };
  }
  if (person.role !== "admin" && !action.modes.includes(person.mode)) {
    return { ok: false, reason: "not_allowed" };
  }
  if (action.blockedByOpenEstimate && job.estimateOpen) {
    return { ok: false, reason: "estimate_open" };
  }
  if (action.paymentHold && paymentHoldApplies(job)) {
    return { ok: false, reason: "payment_hold" };
  }
  return {
    ok: true,
    to: action.to,
    closesJob: Boolean(action.closesJob),
    stageBeforeSide: isSideStage(action.to) ? job.stage : null,
  };
}

/** True when an unpaid invoice should stop the raft leaving. */
export function paymentHoldApplies(job: JobState): boolean {
  if (job.customerPaymentHoldExempt || job.paymentHoldAcknowledged) return false;
  return job.paymentStatus === "unpaid" || job.paymentStatus === "pending";
}
