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
            <span className="max-w-[140px] truncate">{adminNickname}</span>
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

      {/* 모바일 전용 관리자 탭 바 */}
      <nav
        aria-label="모바일 관리자 메뉴"
        className="flex md:hidden items-center gap-1.5 overflow-x-auto border-t border-gray-100 px-4 py-2"
      >
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
              className={cn(
                "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-xs font-bold transition-colors",
                isActive
                  ? "bg-[#0058FF] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

export function AdminGuard({ children }: { children: ReactNode }) {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase ?? "logged-out";
  const isReady = phase === "ready";
  const isAdminSession = memberCtx?.snapshot.role === "ADMIN";

  if (phase === "loading") {
    return (
      <div data-admin-guard="loading" className="mx-auto flex min-h-[55vh] max-w-md items-center justify-center px-4 py-16">
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-2">
          <p className="text-sm font-black text-gray-900">관리자 권한 확인 중...</p>
          <p className="text-xs font-medium text-gray-500">세션 및 운영 콘솔 접근 권한을 검증하고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (!isReady || !isAdminSession) {
    return (
      <div data-admin-guard="blocked" className="mx-auto flex min-h-[55vh] max-w-lg items-center justify-center px-4 py-16">
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#0058FF]">
            <V1IconShield className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-black text-gray-900">관리자 전용 운영 콘솔입니다</h1>
            <p className="text-xs leading-relaxed font-medium text-gray-500">
              관리자(ADMIN) 권한이 부여된 계정으로 로그인해야 대회·회원·커뮤니티·신고 운영 기능에 접근할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            {!isReady ? (
              <Link
                href="/login"
                className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[#0058FF] px-5 text-xs font-black text-white transition-colors hover:bg-blue-700"
              >
                관리자 계정 로그인
              </Link>
            ) : null}
            <Link
              href="/"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              <span>서비스 홈으로 이동</span>
              <V1IconArrowRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-admin-guard="active">
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
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900">
      <AdminHeader activeSection={activeSection} />
      <AdminGuard>
        <main className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6 md:py-10">
          {children}
        </main>
      </AdminGuard>
    </div>
  );
}
