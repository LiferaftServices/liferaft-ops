"use client";

import { useRef, useState, useTransition } from "react";
import { addPhoto, removePhoto } from "@/lib/photo-actions";
import { PHOTO_KINDS, REQUIRED_PHOTOS, type JobPhoto, type PhotoKind } from "@/lib/photos";

const LONGEST_SIDE = 1600;

/** Shrinks a camera photo in the browser so it uploads quickly on shop wifi or a phone signal. */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.82));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // a format the browser cannot redraw: send it as it is
  }
}

export function JobPhotos({ jobId, photos, kinds, canRemove }: { jobId: string; photos: JobPhoto[]; kinds: PhotoKind[]; canRemove: boolean }) {
  const [busy, startUpload] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState<PhotoKind | null>(null);
  const inputs = useRef(new Map<PhotoKind, HTMLInputElement>());
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const send = (kind: PhotoKind, file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setUploading(kind);
    startUpload(async () => {
      const form = new FormData();
      form.set("job_id", jobId);
      form.set("kind", kind);
      form.set("photo", await shrink(file));
      const result = await addPhoto(form);
      if (!result.ok) setProblem(result.message);
      setUploading(null);
      const input = inputs.current.get(kind);
      if (input) input.value = "";
    });
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      {kinds.map((kind) => {
        const mine = photos.filter((p) => p.kind === kind);
        const needed = REQUIRED_PHOTOS.includes(kind) && mine.length === 0;
        return (
          <div key={kind} className="border-b border-zinc-500/20 pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{PHOTO_KINDS[kind]}</span>
              {needed ? <span className="font-semibold text-[#FF5200]">needed</span> : null}
              <label className="cursor-pointer rounded border border-zinc-500/60 px-3 py-1.5 font-semibold">
                {busy && uploading === kind ? "Saving…" : mine.length ? "Add another" : "Take or choose photo"}
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(kind, el);
                    else inputs.current.delete(kind);
                  }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={busy}
                  className="sr-only"
                  onChange={(e) => send(kind, e.target.files?.[0])}
                />
              </label>
            </div>
            {mine.length ? (
              <ul className="mt-2 flex flex-wrap gap-3">
                {mine.map((p) => (
                  <li key={p.id} className="w-36">
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={PHOTO_KINDS[p.kind]} className="h-28 w-36 rounded border border-zinc-500/40 object-cover" />
                    </a>
                    <span className="block text-xs opacity-75">
                      {stamp(p.when)}
                      {p.who ? ` · ${p.who}` : ""}
                    </span>
                    {canRemove ? (
                      <form action={removePhoto}>
                        <input type="hidden" name="photo_id" value={p.id} />
                        <button type="submit" className="text-xs underline">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {problem ? (
        <p role="alert" className="font-semibold text-red-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
