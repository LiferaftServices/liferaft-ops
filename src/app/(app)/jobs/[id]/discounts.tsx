"use client";

import { useState } from "react";

export interface DiscountItem {
  qbo_id: string;
  name: string;
  description: string | null;
}

interface Row {
  key: number;
  item: string;
  percent: string;
  amount: string;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const field = "rounded border border-zinc-500/60 bg-transparent px-2 py-1.5";

/**
 * Discount lines for an invoice. Each is its own QuickBooks discount item with a dollar
 * amount; typing a percent works the amount out from the subtotal, and the amount can
 * then be changed by hand.
 */
export function DiscountRows({ items, subtotal, formId }: { items: DiscountItem[]; subtotal: number; formId?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState(1);
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) > 0 ? Number(r.amount) : 0), 0);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  if (!items.length) {
    return <p>No discount items were found. Copy parts and services from QuickBooks on the QuickBooks settings page.</p>;
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">Discounts</legend>
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-end gap-2">
          <label>
            Discount item
            <select
              name="discount_item"
              form={formId}
              value={r.item}
              onChange={(e) => update(r.key, { item: e.target.value })}
              required
              className={`block ${field}`}
            >
              <option value="">Choose</option>
              {items.map((i) => (
                <option key={i.qbo_id} value={i.qbo_id}>
                  {i.name}
                  {i.description && i.description.toLowerCase() !== i.name.toLowerCase() ? ` (${i.description})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Percent
            <input
              inputMode="decimal"
              value={r.percent}
              onChange={(e) => {
                const p = Number(e.target.value);
                update(r.key, {
                  percent: e.target.value,
                  amount: p > 0 && p <= 100 ? cents((subtotal * p) / 100).toFixed(2) : r.amount,
                });
              }}
              className={`block w-20 ${field}`}
            />
          </label>
          <label>
            Amount, $
            <input
              name="discount_amount"
              form={formId}
              inputMode="decimal"
              value={r.amount}
              onChange={(e) => update(r.key, { amount: e.target.value, percent: "" })}
              required
              className={`block w-28 ${field}`}
            />
          </label>
          <button
            type="button"
            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            className="rounded border border-zinc-500/60 px-3 py-1.5"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows((rs) => [...rs, { key: next, item: "", percent: "", amount: "" }]);
          setNext((n) => n + 1);
        }}
        className="w-fit rounded border border-zinc-500/60 px-3 py-1.5 font-semibold"
      >
        Add a discount
      </button>
      {rows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => (
          <div key={r.key} className="flex items-center gap-3 border-t border-zinc-500/20 py-1.5">
            <span className="flex-1 text-right">{items.find((i) => i.qbo_id === r.item)?.name ?? "Discount"}</span>
            <span className="w-24 text-right tabular-nums">−{money(Number(r.amount))}</span>
          </div>
        ))}
      <div className="flex items-center gap-3 border-t-2 border-[#FF5200] py-2 text-base font-semibold">
        <span className="flex-1 text-right">Invoice total, before tax</span>
        <span className="w-24 text-right tabular-nums">{money(cents(subtotal - total))}</span>
      </div>
      {rows.length ? (
        <p className="opacity-75">
          A percent is worked out on the full subtotal. For a discount on only some of the items, type the dollar
          amount instead.
        </p>
      ) : null}
    </fieldset>
  );
}
