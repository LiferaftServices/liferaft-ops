"use client";

import jsQR from "jsqr";
import { useActionState, useEffect, useRef, useState } from "react";
import { addByCode, type PartState } from "./actions";

const START: PartState = { ok: true, message: null, unknownCode: null };
const REPEAT_GAP_MS = 2500; // the same label must leave view, or wait, before it counts again

/** Camera scanning for part labels, plus a box for typing a code or part number. */
export function PartScanner({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(addByCode, START);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);

  useEffect(() => {
    busy.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = () => {
      if (stopped) return;
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        const text = found?.data.trim();
        const now = Date.now();
        if (text && !busy.current && (text !== last.current.code || now - last.current.at > REPEAT_GAP_MS)) {
          last.current = { code: text, at: now };
          if (codeInput.current && form.current) {
            codeInput.current.value = text;
            navigator.vibrate?.(60);
            form.current.requestSubmit();
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        setCameraError("The camera could not be opened. Allow camera access for this site, or type the code instead.");
        setScanning(false);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!scanning && !navigator.mediaDevices) {
              setCameraError("This browser cannot open the camera here. Type the code instead.");
              return;
            }
            setCameraError(null);
            setScanning((s) => !s);
          }}
          className="rounded bg-[#FF5200] px-4 py-2 font-semibold text-white"
        >
          {scanning ? "Stop scanning" : "Scan part labels"}
        </button>
        <form ref={form} action={action} className="flex flex-1 gap-2">
          <input type="hidden" name="job_id" value={jobId} />
          <input
            ref={codeInput}
            name="code"
            placeholder="Or type a part number or label code"
            aria-label="Part number or label code"
            autoComplete="off"
            className="w-full min-w-40 rounded border border-zinc-500/60 bg-transparent px-3 py-2"
          />
          <button type="submit" disabled={pending} className="rounded border border-zinc-500/60 px-3 py-2">
            Add
          </button>
        </form>
      </div>
      {scanning ? (
        <video ref={video} muted playsInline className="max-h-72 w-full max-w-md rounded border border-zinc-500/40 bg-black" />
      ) : null}
      {cameraError ? (
        <p role="alert" className="text-red-700">
          {cameraError}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className={state.ok ? "text-base font-semibold" : "text-base font-semibold text-red-700"}>
          {state.message}
        </p>
      ) : null}
      {state.unknownCode ? <input type="hidden" form="part-search" name="learn" value={state.unknownCode} /> : null}
    </div>
  );
}
