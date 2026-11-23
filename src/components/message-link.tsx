"use client";

import { recordMessage } from "@/lib/message-actions";

/** Opens a prepared message in the email program and notes on the job that it was prepared. */
export function MessageLink({ jobId, kind, recipient, href, children }: { jobId: string; kind: string; recipient: string; href: string; children: React.ReactNode }) {
  return (
    <a href={href} onClick={() => void recordMessage(jobId, kind, recipient)} className="rounded bg-[#FF5200] px-4 py-2 font-semibold text-white">
      {children}
    </a>
  );
}
