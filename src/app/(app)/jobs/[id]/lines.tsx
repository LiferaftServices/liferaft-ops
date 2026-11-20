"use client";

import { useRef, useState, useTransition } from "react";
import { addSubtotal, removeSubtotal, saveOrder, setQuantity } from "./actions";

export interface ListRow {
  id: string;
  kind: "line" | "subtotal";
  partNumber?: string;
  description?: string | null;
  quantity?: number;
  unitPrice?: number;
  tag?: string | null;
  waiting?: boolean;
  /** On a QuickBooks invoice already, so it cannot be changed. */
  locked?: boolean;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const amount = (r: ListRow) => (r.kind === "line" ? (r.quantity ?? 0) * (r.unitPrice ?? 0) : 0);

/**
 * The parts list. During invoice review, rows can be dragged by their handle
 * (or moved with the arrows) into any order, and subtotal rows can be added between them.
 * A subtotal adds up the rows above it, back to the previous subtotal.
 */
export function LinesList({ jobId, rows: initial, canEdit, canArrange }: { jobId: string; rows: ListRow[]; canEdit: boolean; canArrange: boolean }) {
  const [rows, setRows] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLLIElement>());
  const latest = useRef(rows);

  const apply = (next: ListRow[]) => {
    latest.current = next;
    setRows(next);
  };
  const save = () =>
    startSave(async () => {
      const result = await saveOrder(jobId, latest.current.map((r) => r.id));
      setProblem(result.ok ? null : result.message);
    });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= latest.current.length || from === to) return false;
    const next = [...latest.current];
    next.splice(to, 0, next.splice(from, 1)[0]);
    apply(next);
    return true;
  };

  const onMove = (e: React.PointerEvent, id: string) => {
    if (dragging !== id) return;
    const from = latest.current.findIndex((r) => r.id === id);
    for (let i = 0; i < latest.current.length; i++) {
      if (i === from) continue;
      const box = els.current.get(latest.current[i].id)?.getBoundingClientRect();
      if (!box) continue;
      const middle = box.top + box.height / 2;
      if ((i < from && e.clientY < middle) || (i > from && e.clientY > middle)) {
        if (i < from) {
          move(from, i);
          return;
        }
        // moving down: keep going to the furthest row the pointer has passed
        let to = i;
        for (let k = i + 1; k < latest.current.length; k++) {
          const b = els.current.get(latest.current[k].id)?.getBoundingClientRect();
          if (b && e.clientY > b.top + b.height / 2) to = k;
        }
        move(from, to);
        return;
      }
    }
  };

  // For each subtotal row: the sum of the rows above it, back to the previous subtotal.
  const sections = rows.reduce<{ run: number; at: number[] }>(
    (acc, r) => (r.kind === "subtotal" ? { run: 0, at: [...acc.at, acc.run] } : { run: acc.run + amount(r), at: [...acc.at, 0] }),
    { run: 0, at: [] },
  ).at;
  const total = rows.reduce((sum, r) => sum + amount(r), 0);
  const hasSubtotal = rows.some((r) => r.kind === "subtotal");

  return (
    <div className="mt-2 text-sm">
      <div className="flex items-center gap-3 border-b border-zinc-500/40 py-2 font-semibold">
        {canArrange ? <span className="w-16" /> : null}
        <span className="flex-1">Part</span>
        <span className="w-32">Qty</span>
        <span className="w-20 text-right">Each</span>
        <span className="w-24 text-right">Total</span>
      </div>
      <ul>
        {rows.map((r, i) => {
          const section = sections[i];
          return (
            <li
              key={r.id}
              ref={(el) => {
                if (el) els.current.set(r.id, el);
                else els.current.delete(r.id);
              }}
              className={
                "flex items-start gap-3 border-b border-zinc-500/20 py-2 " +
                (dragging === r.id ? "bg-[#FF5200]/15 " : "") +
                (r.kind === "subtotal" ? "bg-zinc-500/10 font-semibold" : "")
              }
            >
              {canArrange ? (
                <span className="flex w-16 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Drag to move ${r.partNumber ?? "subtotal"}`}
                    title="Drag to move"
                    style={{ touchAction: "none" }}
                    className="cursor-grab select-none rounded border border-zinc-500/60 px-2 py-1 text-base leading-none"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDragging(r.id);
                    }}
                    onPointerMove={(e) => onMove(e, r.id)}
                    onPointerUp={() => {
                      setDragging(null);
                      save();
                    }}
                    onPointerCancel={() => setDragging(null)}
                  >
                    ≡
                  </button>
                  <span className="flex flex-col leading-none">
                    <button type="button" aria-label="Move up" className="px-1" onClick={() => move(i, i - 1) && save()}>
                      ▲
                    </button>
                    <button type="button" aria-label="Move down" className="px-1" onClick={() => move(i, i + 1) && save()}>
                      ▼
                    </button>
                  </span>
                </span>
              ) : null}
              {r.kind === "subtotal" ? (
                <>
                  <span className="flex-1 text-right">Subtotal</span>
                  <span className="w-32">
                    {canArrange ? (
                      <form action={removeSubtotal}>
                        <input type="hidden" name="job_id" value={jobId} />
                        <input type="hidden" name="marker_id" value={r.id} />
                        <button type="submit" className="font-normal underline">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </span>
                  <span className="w-20" />
                  <span className="w-24 text-right tabular-nums">{money(section)}</span>
                </>
              ) : (
                <>
                  <span className="flex-1">
                    <span className="font-semibold">{r.partNumber}</span>
                    {r.tag ? <span className="ml-2 text-xs opacity-75">{r.tag}</span> : null}
                    {r.waiting ? <span className="ml-2 text-xs font-semibold text-[#FF5200]">not invoiced yet</span> : null}
                    {r.description ? <span className="block opacity-75">{r.description}</span> : null}
                  </span>
                  <span className="w-32">
                    {canEdit && !r.locked ? (
                      <form action={setQuantity} className="flex items-center gap-2">
                        <input type="hidden" name="job_id" value={jobId} />
                        <input type="hidden" name="line_id" value={r.id} />
                        <input
                          name="quantity"
                          inputMode="decimal"
                          defaultValue={r.quantity}
                          aria-label={`Quantity of ${r.partNumber}`}
                          className="w-16 rounded border border-zinc-500/60 bg-transparent px-2 py-1"
                        />
                        <button type="submit" className="underline">
                          Save
                        </button>
                      </form>
                    ) : (
                      r.quantity
                    )}
                  </span>
                  <span className="w-20 text-right tabular-nums">{money(r.unitPrice ?? 0)}</span>
                  <span className="w-24 text-right tabular-nums">{money(amount(r))}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 py-2 font-semibold">
        <span className="flex-1 text-right">Parts total, before tax</span>
        <span className="w-24 text-right tabular-nums">{money(total)}</span>
      </div>
      {canArrange ? (
        <div className="flex flex-wrap items-center gap-3">
          <form action={addSubtotal}>
            <input type="hidden" name="job_id" value={jobId} />
            <button type="submit" className="rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
              Add a subtotal row
            </button>
          </form>
          <span className="opacity-75">
            Drag ≡ or use the arrows to reorder.
            {hasSubtotal ? " A subtotal adds up the rows above it, back to the previous subtotal. Subtotals stay here and are not sent to QuickBooks." : ""}
            {saving ? " Saving…" : ""}
          </span>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-1 font-semibold text-red-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
