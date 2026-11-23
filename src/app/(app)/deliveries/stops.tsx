import Link from "next/link";
import { addItem, addStop as addStopAction, removeFromRun, toggleItem, toggleStop, updateStop } from "./actions";
import { inOrder, KIND_LABELS, stopDone, type Stop } from "./shared";
import { SortableStops } from "./sortable";

const INPUT = "block w-full rounded border border-zinc-500/60 bg-transparent px-2 py-1.5";

export interface StopListProps {
  stops: Stop[];
  /** Where to come back to after a change, e.g. /deliveries?week=2026-11-23 */
  returnTo: string;
  /** Days this stop could be moved to. */
  dayOptions: { value: string; label: string }[];
  /** Serial number to prefill when a raft is being added from its own page. */
  raftSerial?: string | null;
}

/** The stops of one delivery day (or the unscheduled ones), in driving order. */
export function StopList({ stops, returnTo, dayOptions, raftSerial }: StopListProps) {
  const hidden = <input type="hidden" name="return_to" value={returnTo} />;
  const ordered = inOrder(stops);
  return (
    <SortableStops
      key={ordered.map((s) => s.id).join(",")}
      items={ordered.map((s) => {
        const done = stopDone(s);
        return {
          id: s.id,
          content: (
            <div className={"text-sm " + (done ? "opacity-70" : "")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-56 flex-1">
                  <p className="text-base font-semibold">
                    {done ? (
                      <span className="mr-2 text-green-600" aria-label="Completed">
                        ✓
                      </span>
                    ) : null}
                    {s.title}
                  </p>
                  {s.address ? (
                    <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`}>
                      {s.address}
                    </a>
                  ) : (
                    <span className="text-[#FF5200]">No address yet</span>
                  )}
                  <p>
                    {s.contact_name ? `${s.contact_name} ` : ""}
                    {s.contact_phone ? (
                      <a className="font-semibold underline" href={`tel:${s.contact_phone.replace(/[^0-9+]/g, "")}`}>
                        {s.contact_phone}
                      </a>
                    ) : null}
                    {s.call_ahead ? <span className="ml-2 font-semibold text-[#FF5200]">{s.call_ahead}</span> : null}
                  </p>
                  {s.notes ? <p className="opacity-75">{s.notes}</p> : null}
                </div>
                <form action={toggleStop}>
                  {hidden}
                  <input type="hidden" name="stop_id" value={s.id} />
                  <input type="hidden" name="done" value={done ? "0" : "1"} />
                  <button type="submit" className={done ? "rounded border border-zinc-500/60 px-3 py-2" : "rounded bg-[#FF5200] px-4 py-2 font-semibold text-white"}>
                    {done ? "Reopen stop" : "Stop complete"}
                  </button>
                </form>
              </div>
              <ul className="mt-2">
                {s.stop_items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 py-1">
                    <form action={toggleItem}>
                      {hidden}
                      <input type="hidden" name="item_id" value={i.id} />
                      <input type="hidden" name="done" value={i.done_at ? "0" : "1"} />
                      <button
                        type="submit"
                        aria-label={i.done_at ? "Mark not done" : "Mark done"}
                        className={"h-9 w-9 rounded border-2 text-lg font-bold " + (i.done_at ? "border-green-600 text-green-600" : "border-zinc-500/60")}
                      >
                        {i.done_at ? "✓" : ""}
                      </button>
                    </form>
                    <span className={"flex-1 " + (i.done_at ? "line-through" : "")}>
                      <span className="font-semibold">{KIND_LABELS[i.kind] ?? i.kind}:</span> {i.description}
                    </span>
                    {i.asset_id ? (
                      <Link className="underline" href={`/rafts/${i.asset_id}`}>
                        Open raft
                      </Link>
                    ) : null}
                    <form action={removeFromRun}>
                      {hidden}
                      <input type="hidden" name="item_id" value={i.id} />
                      <button type="submit" className="underline opacity-75">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
                <details open={Boolean(raftSerial)}>
                  <summary className="cursor-pointer font-semibold underline">Add to this stop</summary>
                  <form action={addItem} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                    {hidden}
                    <input type="hidden" name="stop_id" value={s.id} />
                    <label>
                      What
                      <select name="kind" defaultValue="deliver" className={INPUT}>
                        {Object.entries(KIND_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Raft serial (if a raft)
                      <input name="serial" defaultValue={raftSerial ?? ""} autoComplete="off" className={INPUT} />
                    </label>
                    <label className="sm:col-span-2">
                      Description or note
                      <input name="description" placeholder="2 immersion suits, order 23511" className={INPUT} />
                    </label>
                    <button type="submit" className="w-fit rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white">
                      Add
                    </button>
                  </form>
                </details>
                <details>
                  <summary className="cursor-pointer underline">Change day or details</summary>
                  <form action={updateStop} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {hidden}
                    <input type="hidden" name="stop_id" value={s.id} />
                    <label className="sm:col-span-2">
                      Day
                      <select name="day" defaultValue={s.day_id ? `day:${s.day_id}` : ""} className={INPUT}>
                        <option value="">Not set</option>
                        {dayOptions.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Call ahead
                      <input name="call_ahead" defaultValue={s.call_ahead ?? ""} className={INPUT} />
                    </label>
                    <label className="sm:col-span-3">
                      Address
                      <input name="address" defaultValue={s.address ?? ""} className={INPUT} />
                    </label>
                    <label>
                      Contact
                      <input name="contact_name" defaultValue={s.contact_name ?? ""} className={INPUT} />
                    </label>
                    <label>
                      Phone
                      <input name="contact_phone" defaultValue={s.contact_phone ?? ""} className={INPUT} />
                    </label>
                    <label className="sm:col-span-3">
                      Notes
                      <input name="notes" defaultValue={s.notes ?? ""} className={INPUT} />
                    </label>
                    <button type="submit" className="w-fit rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                      Save
                    </button>
                  </form>
                  {s.stop_items.length === 0 ? (
                    <form action={removeFromRun} className="mt-2">
                      {hidden}
                      <input type="hidden" name="stop_id" value={s.id} />
                      <button type="submit" className="underline">
                        Remove this stop
                      </button>
                    </form>
                  ) : null}
                </details>
              </div>
            </div>
          ),
        };
      })}
    />
  );
}

/** The form for adding a stop. With fixedDay it adds straight to that day. */
export function AddStopForm({ direction, week, returnTo, dayOptions, fixedDay, open }: {
  direction: string; week: string; returnTo: string; dayOptions: { value: string; label: string }[]; fixedDay?: string; open?: boolean;
}) {
  return (
    <details className="mt-3 text-sm" open={open}>
      <summary className="cursor-pointer font-semibold underline">Add a stop</summary>
      <form action={addStopAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="week" value={week} />
        <input type="hidden" name="direction" value={direction} />
        {fixedDay ? (
          <input type="hidden" name="day" value={fixedDay} />
        ) : (
          <label>
            Day
            <select name="day" defaultValue="" className={INPUT}>
              <option value="">Not set yet</option>
              {dayOptions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="sm:col-span-2">
          Place (yard, dock, customer)
          <input name="title" required list="saved-places" autoComplete="off" className={INPUT} />
        </label>
        <label className="sm:col-span-3">
          Address (leave blank to use the one saved for this place)
          <input name="address" className={INPUT} />
        </label>
        <label>
          Contact
          <input name="contact_name" className={INPUT} />
        </label>
        <label>
          Phone
          <input name="contact_phone" inputMode="tel" className={INPUT} />
        </label>
        <label>
          Call ahead
          <input name="call_ahead" placeholder="Call 30 min out" className={INPUT} />
        </label>
        <label className="sm:col-span-3">
          Notes
          <input name="notes" className={INPUT} />
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" name="remember" defaultChecked /> Remember this place and address for next time
        </label>
        <button type="submit" className="w-fit rounded bg-[#FF5200] px-3 py-1.5 font-semibold text-white">
          Add stop
        </button>
      </form>
    </details>
  );
}
