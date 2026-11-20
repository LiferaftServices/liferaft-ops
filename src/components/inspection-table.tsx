"use client";

import { useState } from "react";
import { saveField } from "@/lib/inspection-actions";
import { SECTIONS, STATE_OPTIONS, YESNO_OPTIONS, type Field, type Values } from "@/lib/inspection-form";

export interface InspectionColumn {
  jobId: string;
  /** Owner and vessel, shown above every column so readings go against the right raft. */
  title: string;
  subtitle: string;
  values: Values;
  locked?: boolean;
}

const box = "w-full min-w-24 rounded border border-zinc-500/60 bg-transparent px-2 py-1.5";

/**
 * One section of the inspection form as a table: a row per field, a column per raft.
 * With one raft it is that raft's form; with several it is the batch grid. Every cell
 * saves by itself as soon as it is changed.
 */
export function InspectionTable({ sectionKey, columns }: { sectionKey: string; columns: InspectionColumn[] }) {
  const section = SECTIONS.find((s) => s.key === sectionKey)!;
  const [values, setValues] = useState<Record<string, Values>>(() => Object.fromEntries(columns.map((c) => [c.jobId, c.values])));
  // What the server holds for each cell, so a cell is only sent when it really changed.
  const [stored, setStored] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});

  const commit = async (c: InspectionColumn, field: Field, raw: string) => {
    const cell = `${c.jobId}:${field.key}`;
    const before = stored[cell] ?? c.values[field.key] ?? "";
    if (raw.trim() === before) return;
    setStatus((s) => ({ ...s, [cell]: "saving" }));
    const result = await saveField(c.jobId, field.key, raw);
    if (result.ok) setStored((s) => ({ ...s, [cell]: raw.trim() }));
    setStatus((s) => ({ ...s, [cell]: result.ok ? "saved" : result.message }));
  };
  const set = (jobId: string, key: string, raw: string) => setValues((v) => ({ ...v, [jobId]: { ...v[jobId], [key]: raw } }));

  const input = (c: InspectionColumn, field: Field) => {
    const current = values[c.jobId]?.[field.key] ?? "";
    const label = `${field.label}, ${c.title}`;
    if (c.locked) return <span>{current || "–"}</span>;
    if (field.type === "state" || field.type === "yesno" || field.type === "choice") {
      const options = field.type === "state" ? STATE_OPTIONS : field.type === "yesno" ? YESNO_OPTIONS : (field.options ?? []);
      return (
        <select
          aria-label={label}
          value={current}
          onChange={(e) => {
            set(c.jobId, field.key, e.target.value);
            void commit(c, field, e.target.value);
          }}
          className={box}
        >
          <option value=""></option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        aria-label={label}
        type={field.type === "num" || field.type === "text" ? "text" : field.type}
        inputMode={field.type === "num" ? "decimal" : undefined}
        value={current}
        onChange={(e) => set(c.jobId, field.key, e.target.value)}
        onBlur={(e) => void commit(c, field, e.target.value)}
        className={box}
      />
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-2 border-[#FF5200] align-bottom">
            <th className="sticky left-0 z-10 min-w-44 bg-[var(--background)] py-2 pr-3 font-semibold">{section.title}</th>
            {columns.map((c) => (
              <th key={c.jobId} className="min-w-36 px-2 py-2 font-semibold">
                <span className="block">{c.title}</span>
                <span className="block font-normal opacity-75">{c.subtitle}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.fields.map((field) => (
            <tr key={field.key} className="border-b border-zinc-500/20 align-top">
              <th scope="row" className="sticky left-0 z-10 bg-[var(--background)] py-2 pr-3 font-normal">
                {field.label}
                {field.unit ? <span className="opacity-75"> ({field.unit})</span> : null}
              </th>
              {columns.map((c) => {
                const st = status[`${c.jobId}:${field.key}`];
                return (
                  <td key={c.jobId} className="px-2 py-1.5">
                    {input(c, field)}
                    {st === "saving" ? <span className="block text-xs opacity-75">Saving…</span> : null}
                    {st === "saved" ? <span className="block text-xs opacity-75">Saved</span> : null}
                    {st && st !== "saving" && st !== "saved" ? (
                      <span role="alert" className="block text-xs font-semibold text-red-700">
                        Not saved: {st}
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
          {(section.computed ?? []).map((calc) => (
            <tr key={calc.label} className="border-b border-zinc-500/20">
              <th scope="row" className="sticky left-0 z-10 bg-[var(--background)] py-2 pr-3 font-semibold">
                {calc.label}
              </th>
              {columns.map((c) => {
                const out = calc.value(values[c.jobId] ?? {});
                return (
                  <td key={c.jobId} className={"px-2 py-2 font-semibold " + (out?.warn ? "text-red-700" : "")}>
                    {out?.text ?? "–"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
