import React from "react";

/**
 * 경량 상단 GNB 플레이스홀더 (라우트 전환 loading.tsx용; V1Header 높이 64px 동일 유지)
 */
function SkeletonHeaderBar() {
  return (
    <header
      aria-hidden="true"
      className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur"
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <div className="h-7 w-24 rounded-lg ym-skeleton" />
          <div className="hidden items-center gap-4 md:flex">
            <div className="h-4 w-12 rounded ym-skeleton" />
            <div className="h-4 w-16 rounded ym-skeleton" />
            <div className="h-4 w-14 rounded ym-skeleton" />
            <div className="h-4 w-12 rounded ym-skeleton" />
            <div className="h-4 w-16 rounded ym-skeleton" />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full ym-skeleton" />
          <div className="h-9 w-24 rounded-full ym-skeleton" />
        </div>
      </div>
    </header>
  );
}

/**
 * 메인 포털(`/`) 라우트 전환용 전체 스켈레톤
 */
export function MainPortalPageSkeleton() {
  return (
    <div
      className="min-h-screen bg-[#F9FAFB] text-[#1D1D1F]"
      role="status"
      aria-busy="true"
      aria-label="메인 페이지를 불러오는 중입니다"
      data-page-skeleton="main"
    >
      <span className="sr-only">메인 페이지를 불러오는 중입니다…</span>
      <SkeletonHeaderBar />

      {/* 2단 히어로: 좌측 헤드라인 / 우측 글로벌 마켓 4종 차트 스켈레톤 */}
      <div className="border-b border-gray-200 bg-white py-10 md:py-14">
        <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-8 px-4 md:px-6 lg:grid-cols-12 lg:gap-10">
          <div className="space-y-4 lg:col-span-5">
            <div className="h-10 w-4/5 rounded-xl ym-skeleton" />
            <div className="h-10 w-2/5 rounded-xl ym-skeleton" />
            <div className="h-4 w-full rounded ym-skeleton" />
            <div className="h-4 w-5/6 rounded ym-skeleton" />
            <div className="flex gap-3 pt-2">
              <div className="h-12 w-40 rounded-xl ym-skeleton" />
              <div className="h-12 w-32 rounded-xl ym-skeleton" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:col-span-7">
            {[0, 1, 2, 3].map(idx => (
              <div key={idx} className="h-[156px] rounded-2xl border border-gray-200 bg-[#F9FAFB] p-4 space-y-3">
                <div className="h-4 w-24 rounded ym-skeleton" />
                <div className="h-16 w-full rounded-xl ym-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1280px] space-y-8 px-4 py-8 sm:px-6">
        {/* 상단 히어로 12컬럼: 좌측 환율+인기코인 / 우측 퀵 시뮬레이터 */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded ym-skeleton" />
                  <div className="h-8 w-48 rounded-lg ym-skeleton" />
                </div>
                <div className="h-7 w-20 rounded-full ym-skeleton" />
              </div>
              <div className="h-36 w-full rounded-2xl ym-skeleton" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="h-12 rounded-xl ym-skeleton" />
                <div className="h-12 rounded-xl ym-skeleton" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[0, 1, 2].map(idx => (
                <div
                  key={idx}
                  className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-20 rounded ym-skeleton" />
                    <div className="h-6 w-14 rounded-lg ym-skeleton" />
                  </div>
                  <div className="h-7 w-32 rounded ym-skeleton" />
                  <div className="h-4 w-24 rounded ym-skeleton" />
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="h-full rounded-3xl border border-gray-200 bg-white p-6 space-y-5">
              <div className="space-y-2">
                <div className="h-5 w-44 rounded ym-skeleton" />
                <div className="h-3.5 w-64 rounded ym-skeleton" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="h-10 rounded-xl ym-skeleton" />
                <div className="h-10 rounded-xl ym-skeleton" />
              </div>
              <div className="h-12 w-full rounded-xl ym-skeleton" />
              <div className="h-12 w-full rounded-xl ym-skeleton" />
              <div className="h-28 w-full rounded-2xl ym-skeleton" />
              <div className="h-12 w-full rounded-xl ym-skeleton" />
            </div>
          </div>
        </section>

        {/* 하단: 인기 커뮤니티 + 실시간 속보 */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div className="h-6 w-40 rounded ym-skeleton" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map(idx => (
                <div
                  key={idx}
                  className="h-44 rounded-2xl border border-gray-200 bg-white p-5 space-y-3"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full ym-skeleton" />
                    <div className="h-4 w-24 rounded ym-skeleton" />
                  </div>
                  <div className="h-4 w-4/5 rounded ym-skeleton" />
                  <div className="h-3.5 w-full rounded ym-skeleton" />
                  <div className="h-3.5 w-2/3 rounded ym-skeleton" />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-5">
            <div className="h-6 w-32 rounded ym-skeleton" />
            <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
              {[0, 1, 2, 3].map(idx => (
                <div
                  key={idx}
                  className="h-24 rounded-xl border border-gray-100 bg-[#F9FAFB] p-4 space-y-2.5"
                >
                  <div className="h-3 w-28 rounded ym-skeleton" />
                  <div className="h-4 w-full rounded ym-skeleton" />
                  <div className="h-3.5 w-3/4 rounded ym-skeleton" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * 커뮤니티(`/community/**`) 라우트 전환용 전체 스켈레톤
 */
export function CommunityPageSkeleton() {
  return (
    <div
      className="min-h-screen bg-[#F9FAFB] text-[#1D1D1F]"
      role="status"
      aria-busy="true"
      aria-label="커뮤니티 페이지를 불러오는 중입니다"
      data-page-skeleton="community"
    >
      <span className="sr-only">커뮤니티 페이지를 불러오는 중입니다…</span>
      <SkeletonHeaderBar />

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
        {/* 상단 타이틀 + 탭 + 글쓰기 버튼 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-7 w-36 rounded-lg ym-skeleton" />
            <div className="h-4 w-72 rounded ym-skeleton" />
          </div>
          <div className="h-10 w-28 rounded-xl ym-skeleton" />
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3">
          {[0, 1, 2, 3].map(idx => (
            <div key={idx} className="h-9 w-20 rounded-xl ym-skeleton" />
          ))}
        </div>

        {/* 본문 12컬럼: 좌측 게시글 피드 + 우측 대회 TOP5 사이드바 */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-3">
              <div className="h-9 rounded-lg ym-skeleton" />
              <div className="h-9 rounded-lg ym-skeleton" />
              <div className="h-9 rounded-lg ym-skeleton" />
            </div>

            {[0, 1, 2, 3].map(idx => (
              <div
                key={idx}
                className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full ym-skeleton" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-28 rounded ym-skeleton" />
                      <div className="h-3 w-20 rounded ym-skeleton" />
                    </div>
                  </div>
                  <div className="h-6 w-16 rounded-full ym-skeleton" />
                </div>
                <div className="h-5 w-3/4 rounded ym-skeleton" />
                <div className="h-3.5 w-full rounded ym-skeleton" />
                <div className="h-3.5 w-5/6 rounded ym-skeleton" />
                <div className="flex items-center gap-4 pt-1">
                  <div className="h-4 w-12 rounded ym-skeleton" />
                  <div className="h-4 w-12 rounded ym-skeleton" />
                </div>
              </div>
            ))}
          </div>

          <aside className="space-y-4 lg:col-span-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-5 w-36 rounded ym-skeleton" />
                <div className="h-5 w-14 rounded-full ym-skeleton" />
              </div>
              <div className="h-10 w-full rounded-xl ym-skeleton" />
              <div className="space-y-2.5">
                {[1, 2, 3, 4, 5].map(rank => (
                  <div
                    key={rank}
                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-[#F9FAFB] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-6 w-6 rounded-full ym-skeleton" />
                      <div className="h-7 w-7 rounded-full ym-skeleton" />
                      <div className="h-3.5 w-20 rounded ym-skeleton" />
                    </div>
                    <div className="h-3.5 w-14 rounded ym-skeleton" />
                  </div>
                ))}
              </div>
              <div className="h-10 w-full rounded-xl ym-skeleton" />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

/**
 * 마이페이지(`/me`) 라우트 전환용 전체 스켈레톤
 */
export function MyPageSkeleton() {
  return (
    <div
      className="min-h-screen bg-[#F9FAFB] text-[#1D1D1F]"
      role="status"
      aria-busy="true"
      aria-label="마이페이지를 불러오는 중입니다"
      data-page-skeleton="mypage"
    >
      <span className="sr-only">마이페이지를 불러오는 중입니다…</span>
      <SkeletonHeaderBar />

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* 좌측 프로필 + 자산 요약 카드 */}
          <div className="space-y-6 lg:col-span-4">
            <section className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="flex flex-col items-center space-y-3">
                <div className="h-20 w-20 rounded-full ym-skeleton" />
                <div className="h-5 w-16 rounded-full ym-skeleton" />
                <div className="h-7 w-32 rounded-lg ym-skeleton" />
                <div className="h-4 w-48 rounded ym-skeleton" />
                <div className="grid w-full grid-cols-2 gap-3 pt-2">
                  <div className="h-14 rounded-xl ym-skeleton" />
                  <div className="h-14 rounded-xl ym-skeleton" />
                </div>
                <div className="h-10 w-full rounded-xl ym-skeleton" />
                <div className="h-9 w-full rounded-xl ym-skeleton" />
              </div>
            </section>

            <section className="rounded-3xl border border-gray-800 bg-[#0F172A] p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div className="h-7 w-36 rounded-full ym-skeleton-dark" />
                <div className="h-4 w-16 rounded ym-skeleton-dark" />
              </div>
              <div className="space-y-2">
                <div className="h-3.5 w-32 rounded ym-skeleton-dark" />
                <div className="h-9 w-48 rounded-lg ym-skeleton-dark" />
              </div>
              <div className="space-y-2">
                <div className="h-3.5 w-28 rounded ym-skeleton-dark" />
                <div className="h-7 w-40 rounded-lg ym-skeleton-dark" />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
                {[0, 1, 2, 3].map(idx => (
                  <div key={idx} className="space-y-2">
                    <div className="h-3 w-24 rounded ym-skeleton-dark" />
                    <div className="h-5 w-28 rounded ym-skeleton-dark" />
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* 우측 북마크 탭 + 자산 구성 + 테이블 */}
          <div className="space-y-6 lg:col-span-8">
            <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
              {[0, 1, 2, 3].map(idx => (
                <div key={idx} className="h-10 w-28 rounded-xl ym-skeleton" />
              ))}
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-6">
              <div className="space-y-2">
                <div className="h-6 w-52 rounded ym-skeleton" />
                <div className="h-3.5 w-80 rounded ym-skeleton" />
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex items-center gap-5 rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                  <div className="h-32 w-32 shrink-0 rounded-full ym-skeleton" />
                  <div className="flex-1 space-y-2.5">
                    <div className="h-4 w-full rounded ym-skeleton" />
                    <div className="h-4 w-4/5 rounded ym-skeleton" />
                    <div className="h-4 w-3/5 rounded ym-skeleton" />
                  </div>
                </div>
                <div className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5 space-y-4">
                  <div className="space-y-2">
                    <div className="h-4 w-32 rounded ym-skeleton" />
                    <div className="h-3.5 w-52 rounded ym-skeleton" />
                  </div>
                  <div className="h-4 w-full rounded-full ym-skeleton" />
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="h-8 rounded ym-skeleton" />
                    <div className="h-8 rounded ym-skeleton" />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3, 4].map(idx => (
                  <div key={idx} className="h-9 w-20 rounded-xl ym-skeleton" />
                ))}
              </div>
              <div className="space-y-3 pt-2">
                {[0, 1, 2, 3].map(idx => (
                  <div key={idx} className="h-12 w-full rounded-xl ym-skeleton" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * 테이블 <tbody> 내부 스켈레톤 행 (마이페이지 원장/포지션/주문/체결 테이블용)
 */
export function TableRowsSkeleton({
  colSpan,
  rows = 3,
  label,
}: {
  colSpan: number;
  rows?: number;
  label: string;
}) {
  return (
    <>
      <tr className="sr-only" aria-live="polite">
        <td colSpan={colSpan}>{label}</td>
      </tr>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} aria-hidden="true" data-table-skeleton-row="true">
          <td colSpan={colSpan} className="px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="h-4 w-28 rounded ym-skeleton shrink-0" />
                <div className="h-5 w-14 rounded-md ym-skeleton shrink-0" />
              </div>
              <div className="hidden sm:block h-4 w-20 rounded ym-skeleton shrink-0" />
              <div className="h-4 w-24 rounded ym-skeleton shrink-0" />
              <div className="h-4 w-20 rounded ym-skeleton shrink-0" />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * 카드 리스트 로딩 스켈레톤 (마이페이지 커뮤니티 활동·대회 시즌 카드용)
 */
export function CardListSkeleton({
  count = 3,
  label,
  gridClassName,
}: {
  count?: number;
  label: string;
  gridClassName?: string;
}) {
  return (
    <div
      className={gridClassName ?? "space-y-3"}
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-card-list-skeleton="true"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          aria-hidden="true"
          className="rounded-xl border border-gray-200 bg-white p-4 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-3.5 w-24 rounded ym-skeleton" />
            <div className="h-3 w-20 rounded ym-skeleton" />
          </div>
          <div className="h-4 w-3/4 rounded ym-skeleton" />
          <div className="h-3.5 w-1/2 rounded ym-skeleton" />
        </div>
      ))}
    </div>
  );
}
