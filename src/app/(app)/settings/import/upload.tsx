"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; loaded: Record<string, number> }
  | { kind: "error"; message: string };

const LABELS: Record<string, string> = {
  customers: "Customers",
  vessels: "Vessels",
  assets: "Rafts and gear",
  assignments: "Ownership records",
  history: "Past services",
  part_codes: "Part scan codes",
  approval_numbers: "Approval numbers filled in",
  assets_corrected: "Rafts with dates corrected",
  ownership_replaced: "Rafts with ownership corrected",
};

export function ImportUpload() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    setState({ kind: "working" });
    try {
      const res = await fetch("/api/import", { method: "POST", body });
      const json = (await res.json()) as { loaded?: Record<string, number>; error?: string };
      if (!res.ok || !json.loaded) setState({ kind: "error", message: json.error ?? "Import failed." });
      else setState({ kind: "done", loaded: json.loaded });
    } catch {
      setState({ kind: "error", message: "The upload did not complete. Check the connection and try again." });
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="file" name="file" accept="application/json,.json" required className="text-sm" />
      <button
        type="submit"
        disabled={state.kind === "working"}
        className="w-fit rounded bg-[#FF5200] px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {state.kind === "working" ? "Loading… this can take a minute or two" : "Load this file"}
      </button>
      {state.kind === "error" ? (
        <p role="alert" className="text-red-700">
          {state.message}
        </p>
      ) : null}
      {state.kind === "done" ? (
        <div role="status">
          <p className="font-semibold">Loaded.</p>
          <ul className="mt-1 list-disc pl-6 text-sm">
            {Object.entries(state.loaded).map(([k, n]) => (
              <li key={k}>
                {LABELS[k] ?? k}: {n.toLocaleString("en-US")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
