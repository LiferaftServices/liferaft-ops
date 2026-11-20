"use client";

import { useActionState } from "react";
import { disconnectQuickBooks, runCustomerSync, runItemSync, type ActionState } from "./actions";

const START: ActionState = { message: null, ok: true };

export function SyncButton() {
  const [state, action, pending] = useActionState(runCustomerSync, START);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Copying customers…" : "Copy customers from QuickBooks now"}
      </button>
      {pending ? <p className="text-sm">A full company can take a minute or two.</p> : null}
      {state.message ? (
        <p role="status" className={state.ok ? "text-sm" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function DisconnectButton() {
  const [state, action, pending] = useActionState(disconnectQuickBooks, START);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button type="submit" disabled={pending} className="w-fit text-sm font-semibold underline">
        {pending ? "Disconnecting…" : "Disconnect QuickBooks"}
      </button>
      {state.message ? (
        <p role="status" className={state.ok ? "text-sm" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ItemSyncButton() {
  const [state, action, pending] = useActionState(runItemSync, START);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Copying parts…" : "Copy parts and services from QuickBooks now"}
      </button>
      {state.message ? (
        <p role="status" className={state.ok ? "text-sm" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
