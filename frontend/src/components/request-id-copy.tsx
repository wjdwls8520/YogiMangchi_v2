"use client";

import { useState } from "react";

export function RequestIdChip({
  requestId,
  label = "요청 ID",
  compact = false,
  dark = false,
}: {
  requestId: string | null | undefined;
  label?: string;
  compact?: boolean;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (!requestId) return null;

  async function handleCopy() {
    if (!requestId) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(requestId);
      }
      setCopied(true);
      if (typeof window !== "undefined") {
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard API unavailable in restricted context
    }
  }

  return (
    <span
      data-request-id={requestId}
      className={
        compact
          ? dark
            ? "inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-300"
            : "inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-600"
          : dark
            ? "inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-gray-300"
            : "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1 text-[11px] text-gray-600"
      }
    >
      {!compact && <span className="font-sans font-semibold text-gray-400">{label}:</span>}
      <code className="font-mono font-bold select-all">{requestId}</code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={`${label} ${requestId} 복사`}
        className={
          dark
            ? "rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-sans text-[10px] font-bold text-gray-200 transition-colors hover:bg-white/20 cursor-pointer"
            : "rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-sans text-[10px] font-bold text-gray-700 transition-colors hover:bg-gray-100 cursor-pointer"
        }
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </span>
  );
}
