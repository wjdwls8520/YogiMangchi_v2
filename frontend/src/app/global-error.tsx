"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#F9FAFB] font-sans text-gray-900 antialiased">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
          <div className="w-full rounded-2xl border border-gray-200 bg-white p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-[#F6465D]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7"
                aria-hidden="true"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 className="mt-5 text-xl font-black tracking-tight text-gray-900">
              서비스를 불러오지 못했습니다
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              페이지를 표시하는 중 심각한 오류가 발생했습니다. 아래 버튼으로 화면을 다시 불러오거나 잠시 후 접속해 주세요.
            </p>
            {error.digest ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                <span className="font-semibold text-gray-400">오류 코드</span>
                <code className="font-mono font-bold text-gray-800">{error.digest}</code>
              </div>
            ) : null}
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0046CC] cursor-pointer"
              >
                화면 다시 불러오기
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
              >
                홈으로 이동
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
