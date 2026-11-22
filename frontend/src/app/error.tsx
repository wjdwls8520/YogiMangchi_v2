"use client";

import Link from "next/link";
import { useEffect } from "react";
import { V1Header, V1IconAlert, V1IconRefresh } from "@/features/member/components/v1-ui";
import { RequestIdChip } from "@/components/request-id-copy";
import { getErrorRequestId } from "@/lib/request-id";
import { sendClientErrorBeacon } from "@/lib/client-error-beacon";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string; requestId?: string };
  reset: () => void;
}) {
  const requestId = getErrorRequestId(error);

  useEffect(() => {
    // Log only sanitized error identifier without leaking credentials
    if (error.digest || requestId) {
      console.error("[YogiMangchi] Route error:", { digest: error.digest, requestId });
    }
    sendClientErrorBeacon(error);
  }, [error, error.digest, requestId]);

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900">
      <V1Header theme="light" />
      <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-[#F6465D]">
            <V1IconAlert className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-black tracking-tight text-gray-900">
            일시적인 화면 오류가 발생했습니다
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            요청을 처리하는 중 예기치 못한 문제가 발생했습니다. 잠시 후 다시 시도하거나 홈으로 이동해 주세요.
          </p>
          {(requestId || error.digest) ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {requestId ? <RequestIdChip requestId={requestId} label="요청 ID" /> : null}
              {error.digest ? <RequestIdChip requestId={error.digest} label="오류 코드" /> : null}
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0058FF] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0046CC] cursor-pointer"
            >
              <V1IconRefresh className="h-4 w-4" />
              <span>다시 시도</span>
            </button>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              홈으로 이동
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
