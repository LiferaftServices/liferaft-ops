// Customer messages a person can send from a job. Each is prepared for review and sent by
// hand; nothing here goes out on its own.

export interface MessageContext {
  firstName: string | null;
  vesselName: string | null;
  raft: string; // e.g. "Revere 6-person liferaft"
  serialNumber: string | null;
  shopName: string; // "York" or "Belfast"
  invoiceNumber: string | null;
  balance: number | null;
  nextDue: string | null; // already formatted
  turnaround: string | null; // e.g. "about 2 weeks"
}

export interface MessageTemplate {
  key: string;
  label: string;
  /** Stages at which this message is the natural one to send. */
  stages: string[];
  subject: (c: MessageContext) => string;
  body: (c: MessageContext) => string;
}

export const SHOP_PHONE = "207-363-0220";
const hello = (c: MessageContext) => `Hi ${c.firstName?.trim() || "there"},`;
const forVessel = (c: MessageContext) => (c.vesselName ? ` for ${c.vesselName}` : "");
const theRaft = (c: MessageContext) => `your ${c.raft}${c.serialNumber ? ` (serial ${c.serialNumber})` : ""}`;
const signoff = (c: MessageContext) => `Thanks,\nLiferaft Services, ${c.shopName}\n${SHOP_PHONE}`;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const MESSAGES: MessageTemplate[] = [
  {
    key: "received",
    label: "Raft received",
    stages: ["received", "incoming"],
    subject: (c) => `We have your liferaft${forVessel(c)}`,
    body: (c) =>
      `${hello(c)}\n\nJust letting you know ${theRaft(c)} has arrived at our ${c.shopName} shop and is in line for service.` +
      (c.turnaround ? ` Right now we're turning rafts around in ${c.turnaround}, and we'll be in touch as soon as it's done.` : ` We'll be in touch as soon as it's done.`) +
      `\n\nIf anything has changed with the boat or you need it back by a certain date, give us a call or reply to this email.\n\n${signoff(c)}`,
  },
  {
    key: "estimate_ready",
    label: "Estimate ready",
    stages: ["awaiting_estimate"],
    subject: (c) => `Estimate for your liferaft service${forVessel(c)}`,
    body: (c) =>
      `${hello(c)}\n\nWe've opened up ${theRaft(c)} and put together an estimate for this service. Take a look when you get a chance and let us know if you'd like us to go ahead, since we hold off on the work until we hear from you.\n\nHappy to walk through any of it over the phone.\n\n${signoff(c)}`,
  },
  {
    key: "service_complete",
    label: "Service complete",
    stages: ["needs_invoice", "ready_for_delivery", "ready_for_pickup"],
    subject: (c) => `Your liferaft service is complete${forVessel(c)}`,
    body: (c) =>
      `${hello(c)}\n\nGood news: ${theRaft(c)} is serviced, repacked and ready to go back aboard.` +
      (c.nextDue ? ` Its next service is due ${c.nextDue}.` : "") +
      (c.invoiceNumber ? `\n\nInvoice ${c.invoiceNumber} is on its way to you separately.` : "") +
      `\n\nWe'll follow up about getting it back to you, or call us any time to set that up.\n\n${signoff(c)}`,
  },
  {
    key: "ready_for_pickup",
    label: "Ready for pickup",
    stages: ["ready_for_pickup"],
    subject: (c) => `Your liferaft is ready for pickup in ${c.shopName}`,
    body: (c) =>
      `${hello(c)}\n\n${theRaft(c).replace(/^y/, "Y")} is ready and waiting for you at our ${c.shopName} shop. Give us a quick call before you head over so we can have it at the door for you.\n\n${signoff(c)}`,
  },
  {
    key: "out_for_delivery",
    label: "Out for delivery",
    stages: ["ready_for_delivery", "loaded"],
    subject: (c) => `Your liferaft is on its way${forVessel(c)}`,
    body: (c) =>
      `${hello(c)}\n\n${theRaft(c).replace(/^y/, "Y")} is on our truck and headed your way. If there's anything our driver should know about where to leave it or who to find at the dock, reply here or call the shop.\n\n${signoff(c)}`,
  },
  {
    key: "payment_reminder",
    label: "Payment reminder",
    stages: ["ready_for_delivery", "ready_for_pickup", "loaded"],
    subject: (c) => `Invoice${c.invoiceNumber ? ` ${c.invoiceNumber}` : ""} for your liferaft service`,
    body: (c) =>
      `${hello(c)}\n\nA quick note that invoice${c.invoiceNumber ? ` ${c.invoiceNumber}` : ""} for the service on ${theRaft(c)}${c.balance ? ` shows ${money(c.balance)} still open` : " is still open"}. We release rafts once the invoice is settled, so taking care of it now means we can get yours back to you without any holdup.\n\nYou can pay from the link on the invoice or by calling us. If you've already sent payment, thank you, and please ignore this.\n\n${signoff(c)}`,
  },
];

/** Training and test records never produce customer messages. */
export function isTraining(...names: (string | null | undefined)[]): boolean {
  return names.some((n) => /^\s*training\b/i.test(n ?? ""));
}

/** The first usable address in a QuickBooks email field, which may hold several. */
export function firstEmail(field: string | null | undefined): string | null {
  const found = (field ?? "").split(/[,;\s]+/).find((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return found ?? null;
}
