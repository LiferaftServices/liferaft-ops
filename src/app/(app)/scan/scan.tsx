"use client";

import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Reads a raft label with the camera and opens that raft. A code can also be typed. */
export function RaftScanner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

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
        const text = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data.trim();
        if (text) {
          stopped = true;
          navigator.vibrate?.(60);
          router.push(`/r/${encodeURIComponent(text)}`);
          return;
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
        setProblem("The camera could not be opened. Allow camera access for this site, or type the code instead.");
        setScanning(false);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, router]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!scanning && !navigator.mediaDevices) {
              setProblem("This browser cannot open the camera here. Type the code instead.");
              return;
            }
            setProblem(null);
            setScanning((s) => !s);
          }}
          className="rounded bg-[#FF5200] px-4 py-2 font-semibold text-white"
        >
          {scanning ? "Stop scanning" : "Scan a raft label"}
        </button>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) router.push(`/r/${encodeURIComponent(typed.trim())}`);
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Or type a Label ID or serial number"
            aria-label="Label ID or serial number"
            autoComplete="off"
            className="w-full min-w-40 rounded border border-zinc-500/60 bg-transparent px-3 py-2"
          />
          <button type="submit" className="rounded border border-zinc-500/60 px-3 py-2">
            Open
          </button>
        </form>
      </div>
      {scanning ? <video ref={video} muted playsInline className="max-h-80 w-full max-w-md rounded border border-zinc-500/40 bg-black" /> : null}
      {problem ? (
        <p role="alert" className="text-red-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
