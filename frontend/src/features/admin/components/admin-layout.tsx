"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { useOptionalMember } from "../../member/components/member-provider";
import {
  cn,
  V1IconArrowRight,
  V1IconExternal,
  V1IconShield,
} from "../../member/components/v1-ui";

export type AdminSectionKey = "contest" | "users" | "community" | "reports";

interface AdminNavTabItem {
  key: AdminSectionKey;
  label: string;
  href: string;
  ready: boolean;
}

const ADMIN_NAV_TABS: AdminNavTabItem[] = [
  { key: "contest", label: "대회 관리", href: "/admin/contest", ready: true },
  { key: "users", label: "회원 관리", href: "/admin/users", ready: true },
  { key: "community", label: "커뮤니티 관리", href: "/admin/community", ready: true },
  { key: "reports", label: "신고 관리", href: "/admin/reports", ready: true },
];

export function AdminHeader({
  activeSection = "contest",
}: {
  activeSection?: AdminSectionKey;
}) {
  const pathname = usePathname();
  const memberCtx = useOptionalMember();
  const adminNickname =
    memberCtx?.snapshot.phase === "ready" && memberCtx.snapshot.nickname
      ? memberCtx.snapshot.nickname
      : "총괄관리자";

  return (
    <header
      data-admin-header="true"
      className="sticky top-0 z-50 w-full border-b border-gray-200 bg-white font-sans text-sm leading-none tracking-normal text-gray-900 antialiased [word-break:keep-all]"
    >
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6">
        {/* 좌측: 요기망치 ADMIN 로고 배지 */}
        <div className="flex items-center gap-8 min-w-0">
          <Link
            href="/admin/contest"
            className="flex shrink-0 items-center gap-2"
            aria-label="요기망치 관리자 홈"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.webp"
              alt="YogiMangchi"
              width={110}
              height={32}
              className="block h-[32px] w-[110px] object-contain object-left"
            />
            <span className="inline-flex h-5 items-center rounded bg-gray-900 px-2 text-[10px] font-black tracking-wider text-white">
              ADMIN
            </span>
          </Link>

          {/* 중앙: 확장형 관리자 GNB 탭 */}
          <nav aria-label="관리자 메뉴" className="hidden md:flex items-center gap-2">
            {ADMIN_NAV_TABS.map(tab => {
              const isActive =
                tab.key === activeSection ||
                (tab.key === "contest" && pathname?.startsWith("/admin/contest")) ||
                (tab.key === "users" && pathname?.startsWith("/admin/users")) ||
                (tab.key === "community" && pathname?.startsWith("/admin/community")) ||
                (tab.key === "reports" && pathname?.startsWith("/admin/reports"));

              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  data-admin-nav-tab={tab.key}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-[#0058FF] text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                  )}
                >
                  <span>{tab.label}</span>
                  {!tab.ready ? (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-400">
                      확장슬롯
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* 우측: 관리자 계정 배지 + 서비스 홈으로 이동 버튼 */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="hidden sm:inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-gray-200 bg-[#F9FAFB] px-3.5 text-xs font-bold text-gray-800">
            <V1IconShield className="h-3.5 w-3.5 shrink-0 text-[#0058FF]" />
            <span>{adminNickname}</span>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-[#0058FF]">
              관리자
            </span>
          </div>

          <Link
            href="/"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-gray-800 transition-colors hover:bg-gray-50"
          >
            <span>서비스 홈으로</span>
            <V1IconExternal className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function AdminGuard({ children }: { children: ReactNode }) {
  const memberCtx = useOptionalMember();
  const isReady = memberCtx?.snapshot.phase === "ready";
  const isAdminSession = memberCtx?.snapshot.role === "ADMIN";

  return (
    <div data-admin-guard="active" className="min-h-screen bg-[#F9FAFB] text-gray-900">
      {!isReady || !isAdminSession ? (
        <div className="border-b border-blue-100 bg-blue-50/70 px-4 py-2 text-xs text-gray-700">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-gray-800">
              관리자 전용 운영 콘솔입니다. 실제 운영 환경에서는 관리자 권한 계정만 접근 및 실행할 수 있습니다.
            </p>
            <Link
              href="/contest"
              className="inline-flex items-center gap-1 font-black text-[#0058FF] hover:underline"
            >
              <span>사용자 대회 허브 보기</span>
              <V1IconArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function AdminShell({
  activeSection = "contest",
  children,
}: {
  activeSection?: AdminSectionKey;
  children: ReactNode;
}) {
  return (
    <AdminGuard>
      <AdminHeader activeSection={activeSection} />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 md:py-10">
        {children}
      </main>
    </AdminGuard>
  );
}
