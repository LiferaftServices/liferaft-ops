"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { reorderStops } from "./actions";

/** A list whose rows can be dragged by a handle, or nudged with arrows, to set the driving order. */
export function SortableStops({ items }: { items: { id: string; content: ReactNode }[] }) {
  const [order, setOrder] = useState(items.map((i) => i.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startSave] = useTransition();
  const latest = useRef(order);
  const els = useRef(new Map<string, HTMLLIElement>());
  const byId = new Map(items.map((i) => [i.id, i.content]));

  const apply = (next: string[]) => {
    latest.current = next;
    setOrder(next);
  };
  const save = () => startSave(async () => void (await reorderStops(latest.current)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= latest.current.length || from === to) return false;
    const next = [...latest.current];
    next.splice(to, 0, next.splice(from, 1)[0]);
    apply(next);
    return true;
  };
  const onMove = (y: number, id: string) => {
    if (dragging !== id) return;
    const from = latest.current.indexOf(id);
    let to = from;
    latest.current.forEach((other, i) => {
      if (i === from) return;
      const box = els.current.get(other)?.getBoundingClientRect();
      if (!box) return;
      const middle = box.top + box.height / 2;
      if (i < from && y < middle && i < to) to = i;
      if (i > from && y > middle && i > to) to = i;
    });
    move(from, to);
  };

  return (
    <ul>
      {order.map((id, i) => (
        <li
          key={id}
          ref={(el) => {
            if (el) els.current.set(id, el);
            else els.current.delete(id);
          }}
          className={"flex gap-2 border-b border-zinc-500/20 py-3 " + (dragging === id ? "bg-[#FF5200]/15" : "")}
        >
          {order.length > 1 ? (
            <span className="flex flex-col items-center gap-1 text-sm">
              <button
                type="button"
                aria-label="Drag to change the order"
                title="Drag to change the order"
                style={{ touchAction: "none" }}
                className="cursor-grab select-none rounded border border-zinc-500/60 px-2 py-1 text-base leading-none"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(id);
                }}
                onPointerMove={(e) => onMove(e.clientY, id)}
                onPointerUp={() => {
                  setDragging(null);
                  save();
                }}
                onPointerCancel={() => setDragging(null)}
              >
                ≡
              </button>
              <button type="button" aria-label="Move up" onClick={() => move(i, i - 1) && save()}>
                ▲
              </button>
              <button type="button" aria-label="Move down" onClick={() => move(i, i + 1) && save()}>
                ▼
              </button>
            </span>
          ) : null}
          <div className="min-w-0 flex-1">{byId.get(id)}</div>
        </li>
      ))}
    </ul>
  );
}
