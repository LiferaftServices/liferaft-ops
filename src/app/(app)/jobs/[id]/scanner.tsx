"use client";

import jsQR from "jsqr";
import { useActionState, useEffect, useRef, useState } from "react";
import { addByCode, type PartState } from "./actions";

const START: PartState = { ok: true, message: null, unknownCode: null };
const REPEAT_GAP_MS = 2500; // the same label must leave view, or wait, before it counts again
const LINEAR_EVERY_MS = 120; // ordinary barcodes are slower to read than QR codes, so not every frame

// Built into Chrome on Android and recent Safari; reads QR codes and barcodes together.
interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
const NATIVE_FORMATS = ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar"];

async function nativeDetector(): Promise<NativeDetector | null> {
  const Ctor = (globalThis as unknown as {
    BarcodeDetector?: { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> };
  }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = await Ctor.getSupportedFormats();
    if (!supported.includes("qr_code") || !supported.includes("code_128")) return null;
    return new Ctor({ formats: NATIVE_FORMATS.filter((f) => supported.includes(f)) });
  } catch {
    return null;
  }
}

/** Camera scanning for part labels (QR codes and ordinary barcodes), plus a box for typing a code or part number. */
export function PartScanner({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(addByCode, START);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const intentInput = useRef<HTMLInputElement>(null);
  const showing = useRef(""); // the label currently shown for confirmation
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);

  useEffect(() => {
    busy.current = pending;
  }, [pending]);
  useEffect(() => {
    showing.current = state.candidate?.code ?? state.unknownCode ?? "";
  }, [state]);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    let native: NativeDetector | null = null;
    let decodeLinear: typeof import("@/lib/barcode").decodeLinear | null = null;
    let lastLinearAt = 0;
    let linearSeen = ""; // a barcode must read the same twice running, to rule out misreads
    let working = false;
    void nativeDetector().then((d) => {
      native = d;
      if (!d) void import("@/lib/barcode").then((m) => (decodeLinear = m.decodeLinear));
    });

    const accept = (text: string | undefined | null) => {
      const now = Date.now();
      // A label already on screen waiting for an answer is not read again while it stays in view.
      if (text && text === showing.current) return;
      if (text && !busy.current && (text !== last.current.code || now - last.current.at > REPEAT_GAP_MS)) {
        last.current = { code: text, at: now };
        if (codeInput.current && form.current && intentInput.current) {
          intentInput.current.value = "scan";
          codeInput.current.value = text;
          navigator.vibrate?.(60);
          form.current.requestSubmit();
        }
      }
    };

    const tick = () => {
      if (stopped) return;
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth && !working) {
        if (native) {
          working = true;
          native
            .detect(v)
            .then((found) => accept(found[0]?.rawValue.trim()))
            .catch(() => (native = null))
            .finally(() => (working = false));
        } else {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data.trim();
          if (qr) {
            accept(qr);
          } else if (decodeLinear && Date.now() - lastLinearAt > LINEAR_EVERY_MS) {
            lastLinearAt = Date.now();
            const bar = decodeLinear(image.data, image.width, image.height);
            if (bar && bar === linearSeen) accept(bar);
            linearSeen = bar ?? "";
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
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
          <input ref={intentInput} type="hidden" name="intent" defaultValue="typed" />
          <input
            ref={codeInput}
            name="code"
            placeholder="Or type a part number or label code"
            aria-label="Part number or label code"
            autoComplete="off"
            className="w-full min-w-40 rounded border border-zinc-500/60 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={pending}
            onClick={() => {
              if (intentInput.current) intentInput.current.value = "typed";
            }}
            className="rounded border border-zinc-500/60 px-3 py-2"
          >
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
      {state.candidate ? (
        <form action={action} className="rounded border-2 border-[#FF5200] p-3">
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="intent" value="confirm" />
          <input type="hidden" name="item_id" value={state.candidate.itemId} />
          <input type="hidden" name="item_name" value={state.candidate.name} />
          <p className="opacity-75">Scanned label {state.candidate.code}</p>
          <p className="text-lg font-semibold">{state.candidate.name}</p>
          {state.candidate.description ? <p>{state.candidate.description}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              Qty
              <input
                name="quantity"
                inputMode="decimal"
                defaultValue={1}
                className="w-16 rounded border border-zinc-500/60 bg-transparent px-2 py-1.5"
              />
            </label>
            <button type="submit" disabled={pending} className="rounded bg-[#FF5200] px-5 py-2 font-semibold text-white">
              Add this part
            </button>
            <button
              type="submit"
              name="intent"
              value="dismiss"
              formNoValidate
              disabled={pending}
              className="rounded border border-zinc-500/60 px-4 py-2"
            >
              Not this one
            </button>
          </div>
        </form>
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
