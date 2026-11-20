"use client";

import Link from "next/link";
import { useActionState } from "react";
import { addCustomer, type NewCustomerState } from "./actions";

const START: NewCustomerState = { error: null, matches: [], needsConfirm: false };
const INPUT = "w-full rounded border border-zinc-500/60 bg-transparent px-3 py-2";

export function NewCustomerForm() {
  const [state, action, pending] = useActionState(addCustomer, START);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <label>
        First name
        <input name="first" autoComplete="off" className={INPUT} />
      </label>
      <label>
        Last name
        <input name="last" autoComplete="off" className={INPUT} />
      </label>
      <label className="sm:col-span-2">
        Company (leave blank for a person)
        <input name="company" autoComplete="off" className={INPUT} />
      </label>
      <label>
        Phone
        <input name="phone" inputMode="tel" autoComplete="off" className={INPUT} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="off" className={INPUT} />
      </label>
      <label className="sm:col-span-2">
        Billing address
        <input name="address" autoComplete="off" className={INPUT} />
      </label>
      <label>
        City
        <input name="city" autoComplete="off" className={INPUT} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          State
          <input name="state" maxLength={2} autoComplete="off" className={INPUT} />
        </label>
        <label>
          ZIP
          <input name="zip" autoComplete="off" className={INPUT} />
        </label>
      </div>

      {state.needsConfirm ? (
        <div role="alert" className="rounded border border-[#FF5200] p-3 sm:col-span-2">
          <p className="font-semibold">This customer may already be in QuickBooks:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {state.matches.map((m) => (
              <li key={m.qbo_id}>
                <Link className="font-semibold underline" href={`/intake/${m.qbo_id}`}>
                  {m.fully_qualified_name}
                </Link>{" "}
                <span className="opacity-75">
                  {[m.phone, m.email].filter(Boolean).join(" · ")} ({m.why})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2">Click a name to use that record instead.</p>
          <label className="mt-3 flex items-center gap-2 font-semibold">
            <input type="checkbox" name="confirm" /> None of these is the same customer. Create a new one.
          </label>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-red-700 sm:col-span-2">
          {state.error}
        </p>
      ) : null}

      <p className="sm:col-span-2">
        Saving creates this customer in QuickBooks straight away.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Checking…" : "Add customer to QuickBooks"}
      </button>
    </form>
  );
}
