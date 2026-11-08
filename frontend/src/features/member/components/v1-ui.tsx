"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { useDimScrollLock } from "./dim-modal";
import { useOptionalMember } from "./member-provider";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const DEFAULT_PROFILE_IMAGES = [
  "/images/profile/defaultProfile-blue.png",
  "/images/profile/defaultProfile-gray.png",
  "/images/profile/defaultProfile-green.png",
] as const;

export function resolveV1AvatarUrl(options: {
  profileImgUrl?: string | null;
  memberId?: number | null;
  withdrawn?: boolean;
  isAdmin?: boolean;
}): string {
  if (options.withdrawn) {
    return "/images/profile/widthdrawn_profile.png";
  }
  if (options.profileImgUrl && options.profileImgUrl.trim().length > 0) {
    return options.profileImgUrl;
  }
  if (options.isAdmin) {
    return "/images/profile/defaultProfile-admin.png";
  }
  if (typeof options.memberId === "number" && Number.isFinite(options.memberId)) {
    const index = Math.abs(options.memberId) % DEFAULT_PROFILE_IMAGES.length;
    return DEFAULT_PROFILE_IMAGES[index] ?? "/user_default.png";
  }
  return "/user_default.png";
}

export function V1UserAvatar({
  src,
  memberId,
  nickname,
  withdrawn = false,
  isAdmin = false,
  size = "md",
  className = "",
}: {
  src?: string | null;
  memberId?: number | null;
  nickname?: string;
  withdrawn?: boolean;
  isAdmin?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizeClass =
    size === "sm"
      ? "h-8 w-8"
      : size === "lg"
        ? "h-12 w-12"
        : size === "xl"
          ? "h-24 w-24 border-4 border-gray-50"
          : "h-10 w-10";
  const resolved = resolveV1AvatarUrl({
    profileImgUrl: src,
    memberId,
    withdrawn,
    isAdmin,
  });

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-gray-100 flex items-center justify-center text-gray-400 border border-gray-200",
        sizeClass,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={withdrawn ? "탈퇴한회원 프로필" : `${nickname || "회원"} 프로필`}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export interface V1ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "blue" | "gray" | "white" | "red" | "sky" | "yellow" | "ghost" | "dark";
  size?: "xs" | "sm" | "md" | "lg";
  fullWidth?: boolean;
  isLoading?: boolean;
}

export function V1Button({
  className,
  variant = "blue",
  size = "md",
  fullWidth = false,
  isLoading = false,
  children,
  disabled,
  type = "button",
  ...props
}: V1ButtonProps) {
  const variantClass =
    variant === "blue"
      ? "bg-[#0058FF] text-white hover:bg-blue-700"
      : variant === "gray"
        ? "bg-gray-100 text-gray-900 hover:bg-gray-200"
        : variant === "white"
          ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400"
          : variant === "red"
            ? "bg-red-500 text-white hover:bg-red-600"
            : variant === "sky"
              ? "bg-blue-100 text-[#0058FF] hover:bg-blue-200"
              : variant === "yellow"
                ? "bg-[#FEE500] text-[#000000] hover:bg-[#E6CF00]"
                : variant === "dark"
                  ? "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/10"
                  : "bg-transparent text-gray-700 hover:bg-gray-100";

  const sizeClass =
    size === "xs"
      ? "h-9 px-4 text-xs min-w-[48px]"
      : size === "sm"
        ? "h-9 px-4 text-xs min-w-[72px]"
        : size === "lg"
          ? "h-14 px-8 text-base min-w-[120px]"
          : "h-11 px-6 text-sm min-w-[100px]";

  return (
    <button
      type={type}
      disabled={isLoading || disabled}
      className={cn(
        "inline-flex shrink-0 whitespace-nowrap items-center justify-center rounded-xl font-bold transition-colors cursor-pointer focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        variantClass,
        sizeClass,
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function V1Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-[#0058FF] focus:outline-none focus:ring-1 focus:ring-[#0058FF] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500",
        className,
      )}
      {...props}
    />
  );
}

export interface V1TabOption {
  label: ReactNode;
  value: string;
  activeColor?: string;
}

export function V1Tabs({
  tabs,
  activeTab,
  onChange,
  className = "",
  tabClassName = "",
  fullWidth = false,
  activeColor,
  size = "md",
  variant = "underline",
  mode = "light",
}: {
  tabs: V1TabOption[];
  activeTab: string;
  onChange: (value: string) => void;
  className?: string;
  tabClassName?: string;
  fullWidth?: boolean;
  activeColor?: string;
  size?: "sm" | "md";
  variant?: "underline" | "plain";
  mode?: "light" | "dark";
}) {
  const isDark = mode === "dark";
  const defaultActiveColor = isDark
    ? "text-white border-white"
    : "text-gray-900 border-gray-900";
  const finalActiveColor = activeColor || defaultActiveColor;

  return (
    <div
      className={cn(
        "flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
        variant === "underline" && cn("border-b", isDark ? "border-white/10" : "border-gray-200"),
        className,
      )}
    >
      {tabs.map(tab => {
        const isActive = activeTab === tab.value;
        const currentTabColor = tab.activeColor || activeColor;

        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative transition-colors shrink-0",
              size === "sm"
                ? "pt-1.5 pb-1.5 text-[12px]"
                : "pt-2.5 pb-2.5 sm:pt-3 sm:pb-3 text-[13px] sm:text-base",
              fullWidth
                ? "flex-1 text-center"
                : size === "sm"
                  ? "min-w-[56px] whitespace-nowrap text-center px-2"
                  : "min-w-[72px] sm:min-w-[112px] whitespace-nowrap text-center px-3 sm:px-4",
              isActive
                ? cn(
                    "font-black",
                    variant === "underline" && (size === "sm" ? "border-b-2" : "border-b-[3px]"),
                    currentTabColor || finalActiveColor,
                  )
                : cn(
                    "font-bold",
                    isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600",
                    variant === "underline" &&
                      (size === "sm" ? "border-b-2 border-transparent" : "border-b-[3px] border-transparent"),
                  ),
              tabClassName,
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export interface V1FolderTab {
  id: string;
  label: string;
  content?: ReactNode;
}

export function V1FolderTabs({
  tabs,
  defaultActiveId,
  activeId,
  onChange,
  children,
}: {
  tabs: V1FolderTab[];
  defaultActiveId?: string;
  activeId?: string;
  onChange?: (id: string) => void;
  children?: ReactNode;
}) {
  const [internalActiveId, setInternalActiveId] = useState(defaultActiveId || tabs[0]?.id || "");
  const currentActiveId = activeId ?? internalActiveId;

  const handleChange = (id: string) => {
    if (activeId === undefined) {
      setInternalActiveId(id);
    }
    onChange?.(id);
  };

  return (
    <div className="w-full">
      <div className="flex items-end gap-0.5 min-h-[48px] rounded-t-md bg-gray-900 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {tabs.map(tab => {
          const isActive = currentActiveId === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleChange(tab.id)}
              className={cn(
                "relative flex items-center justify-center px-3 sm:px-6 transition-colors rounded-t-lg text-xs sm:text-sm whitespace-nowrap shrink-0",
                isActive
                  ? "z-20 h-11 text-gray-900 font-bold bg-white border border-gray-200 border-b-white -mb-[2px]"
                  : "z-0 h-10 text-gray-400 bg-gray-800 border border-gray-800 border-b-transparent hover:bg-gray-700 hover:text-gray-200",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="relative z-10 w-full min-h-[260px] p-4 sm:p-8 bg-white border border-gray-200 rounded-xl rounded-tl-none rounded-tr-none">
        {children ?? tabs.find(tab => tab.id === currentActiveId)?.content}
      </div>
    </div>
  );
}

export interface V1SegmentTabOption {
  label: string;
  value: string;
}

export function V1SegmentTabs({
  tabs,
  activeTab,
  onChange,
  className = "",
  fullWidth = true,
  size = "md",
  radius = "md",
}: {
  tabs: V1SegmentTabOption[];
  activeTab: string;
  onChange: (value: string) => void;
  className?: string;
  fullWidth?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  radius?: "none" | "md" | "lg" | "xl" | "full";
}) {
  const sizeClass =
    size === "sm"
      ? "py-1.5 text-xxs px-3"
      : size === "lg"
        ? "py-2.5 text-sm px-5"
        : size === "xl"
          ? "py-3 text-sm px-6"
          : "py-2 text-xs px-4";
  const radiusClass =
    radius === "none"
      ? ""
      : radius === "lg"
        ? "rounded-md"
        : radius === "xl"
          ? "rounded-lg"
          : radius === "full"
            ? "rounded-full"
            : "rounded";

  return (
    <div className={cn("flex gap-1", className)}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "border font-black transition-colors",
              sizeClass,
              radiusClass,
              fullWidth ? "flex-1" : "flex-none",
              isActive
                ? "border-gray-800 bg-gray-800 text-white"
                : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export type V1AssetSummary = {
  title: string;
  cashBalance: string;
  totalAsset: string;
  totalBuyAmount: string;
  totalCoinValue: string;
  totalProfit: string;
  totalRoi: string;
  isPositive?: boolean;
  isNegative?: boolean;
  unit?: string;
};

export function V1AssetSummaryCard({
  summary,
  className,
  footerSlot,
}: {
  summary: V1AssetSummary;
  className?: string;
  footerSlot?: ReactNode;
}) {
  const valueColorClass = summary.isPositive
    ? "text-red-400"
    : summary.isNegative
      ? "text-blue-400"
      : "text-white";

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl bg-[#0F172A] border border-gray-800 p-6 sm:p-8 text-white",
        className,
      )}
    >
      <div className="relative z-10 mb-6 flex items-center justify-between gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs sm:text-sm font-bold text-gray-200">
          {summary.title}
        </span>
        <span className="text-xs font-bold text-gray-400">
          단위: {summary.unit ?? "USDT"}
        </span>
      </div>

      <div className="relative z-10 space-y-5">
        <div>
          <p className="mb-1 text-sm font-medium text-gray-400">총 보유 자산 (총 자산 추산)</p>
          <h3 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            {summary.totalAsset}
          </h3>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-gray-400">가용 잔고 (보유 현금)</p>
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-200">
            {summary.cashBalance}
          </h3>
        </div>
      </div>

      <div className="relative z-10 mt-6 grid grid-cols-2 gap-y-4 border-t border-white/10 pt-5">
        <div className="text-left">
          <p className="mb-1 text-xs font-medium text-gray-400">사용 증거금 (총 매수금액)</p>
          <p className="text-sm font-bold text-white">{summary.totalBuyAmount}</p>
        </div>
        <div className="text-right">
          <p className="mb-1 text-xs font-medium text-gray-400">포지션 평가금액</p>
          <p className="text-sm font-bold text-white">{summary.totalCoinValue}</p>
        </div>
        <div className="text-left">
          <p className="mb-1 text-xs font-medium text-gray-400">평가손익 (미실현/실현)</p>
          <p className={cn("text-sm font-bold", valueColorClass)}>{summary.totalProfit}</p>
        </div>
        <div className="text-right">
          <p className="mb-1 text-xs font-medium text-gray-400">수익률 (ROE)</p>
          <p className={cn("text-sm font-bold", valueColorClass)}>{summary.totalRoi}</p>
        </div>
      </div>

      {footerSlot ? (
        <div className="relative z-10 mt-6 border-t border-white/10 pt-5">{footerSlot}</div>
      ) : null}
    </section>
  );
}

export interface V1ProfileSidebarData {
  memberId?: number | null;
  nickname: string;
  profileMsg?: string | null;
  profileImgUrl?: string | null;
  role?: "USER" | "ADMIN";
  followerCount: number;
  followingCount: number;
  withdrawn?: boolean;
}

export function V1ProfileSidebar({
  profile,
  actionArea,
  relationArea,
  onClickFollowers,
  onClickFollowings,
}: {
  profile: V1ProfileSidebarData;
  actionArea?: ReactNode;
  relationArea?: ReactNode;
  onClickFollowers?: () => void;
  onClickFollowings?: () => void;
}) {
  const roleLabel = profile.role === "ADMIN" ? "관리자" : "일반회원";
  const roleBadgeClass =
    profile.role === "ADMIN" ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-600";

  return (
    <section className="card rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex flex-col items-center">
        <div className="mb-3">
          <V1UserAvatar
            src={profile.profileImgUrl}
            memberId={profile.memberId}
            nickname={profile.nickname}
            withdrawn={profile.withdrawn}
            isAdmin={profile.role === "ADMIN"}
            size="xl"
          />
        </div>

        <span className={cn("inline-flex rounded-full mb-2 px-3 py-1 text-xs font-bold", roleBadgeClass)}>
          {roleLabel}
        </span>

        <h2 className="text-2xl font-black text-gray-900">{profile.nickname}</h2>

        <p className="text-sm text-gray-400 mt-1 font-medium text-center">
          {profile.profileMsg || "소개글이 없습니다."}
        </p>

        {relationArea ? <div className="mt-3 w-full">{relationArea}</div> : null}
        {actionArea ? <div className="mt-6 w-full">{actionArea}</div> : null}

        <div className="mt-6 grid grid-cols-2 w-full border-t border-gray-100 pt-4">
          {onClickFollowers ? (
            <button
              type="button"
              onClick={onClickFollowers}
              className="text-center rounded-2xl px-2 py-1 transition-colors hover:bg-gray-50"
            >
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Followers
              </p>
              <p className="text-lg font-black text-gray-900 transition-colors hover:text-[#0058FF]">
                {profile.followerCount}
              </p>
            </button>
          ) : (
            <div className="text-center px-2 py-1">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Followers
              </p>
              <p className="text-lg font-black text-gray-900">{profile.followerCount}</p>
            </div>
          )}

          {onClickFollowings ? (
            <button
              type="button"
              onClick={onClickFollowings}
              className="border-l border-gray-100 text-center rounded-2xl px-2 py-1 transition-colors hover:bg-gray-50"
            >
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Following
              </p>
              <p className="text-lg font-black text-gray-900 transition-colors hover:text-[#0058FF]">
                {profile.followingCount}
              </p>
            </button>
          ) : (
            <div className="border-l border-gray-100 text-center px-2 py-1">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Following
              </p>
              <p className="text-lg font-black text-gray-900">{profile.followingCount}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function V1Header({
  theme = "light",
  rightExtra,
}: {
  theme?: "light" | "dark";
  rightExtra?: ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAlarmOpen, setIsAlarmOpen] = useState(false);
  const [darkPreview, setDarkPreview] = useState(false);
  const memberCtx = useOptionalMember();
  const isLoggedIn = memberCtx?.snapshot.phase === "ready";
  const isDark = theme === "dark";

  useDimScrollLock(isMenuOpen);

  const headerPillClass = cn(
    "inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors",
    isDark
      ? "bg-white text-gray-900 hover:bg-gray-200"
      : "bg-gray-900 text-white hover:bg-gray-800",
  );

  return (
    <>
      <header
        className={cn(
          isDark
            ? "trading-brand-header sticky left-0 top-0 z-50 w-full border-b border-white/10 bg-[#0B0E11]/95 text-white backdrop-blur-md transition-colors duration-200"
            : "ym-gnb-header sticky left-0 top-0 z-50 w-full border-b border-gray-100 bg-white/80 text-gray-900 backdrop-blur-md transition-colors duration-200",
        )}
      >
        <div className="ym-gnb-inner relative m-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
          {/* 1. 왼쪽 로고 */}
          <div className="ym-gnb-left flex shrink-0 items-center gap-4">
            <Link href="/" className="member-logo flex items-center gap-2 text-lg font-bold tracking-tight">
              {isDark ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/logo_dark.png"
                    alt="요기망치 YOGIMANGCHI"
                    width={100}
                    height={35}
                    className="ym-brand-logo-img h-[35px] w-auto object-contain"
                  />
                  <span className="sr-only">
                    요기망치 <span className="trading-brand-latin">YOGIMANGCHI</span> 선물 모의투자
                  </span>
                </>
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/images/logo.webp"
                    alt="요기망치 YOGIMANGCHI"
                    width={100}
                    height={35}
                    className="ym-brand-logo-img h-[35px] w-auto object-contain"
                  />
                  <span className="sr-only">요기망치 YOGIMANGCHI</span>
                </>
              )}
            </Link>
          </div>

          {/* 2. 중앙 네비게이션 (PC 전용) */}
          <div className="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <nav aria-label="서비스 메뉴" className="ym-gnb-nav flex items-center gap-6 text-sm font-bold">
              <Link
                href="/trading"
                className={cn(
                  "py-2 transition-colors",
                  isDark ? "text-gray-200 hover:text-white" : "text-gray-700 hover:text-[#0058FF]",
                )}
              >
                모의투자
              </Link>
              <Link
                href="/contest"
                className={cn(
                  "py-2 transition-colors",
                  isDark ? "text-gray-200 hover:text-white" : "text-gray-700 hover:text-[#0058FF]",
                )}
              >
                대회
              </Link>
              <Link
                href="/community"
                className={cn(
                  "py-2 transition-colors",
                  isDark ? "text-gray-200 hover:text-white" : "text-gray-700 hover:text-[#0058FF]",
                )}
              >
                커뮤니티
              </Link>
              <Link
                href="/news"
                className={cn(
                  "py-2 transition-colors",
                  isDark ? "text-gray-200 hover:text-white" : "text-gray-700 hover:text-[#0058FF]",
                )}
              >
                실시간 뉴스
              </Link>
            </nav>
          </div>

          {/* 3. 오른쪽 V1 유틸리티 영역: 게스트 배지(있을 경우) + 테마 아이콘 + 알림 벨 + 구분선 + 마이페이지/로그인 알약 버튼 */}
          <div className="ym-gnb-right flex items-center gap-2.5 text-sm">
            {rightExtra ? <div className="flex items-center gap-2">{rightExtra}</div> : null}

            <button
              type="button"
              onClick={() => setDarkPreview(prev => !prev)}
              className={cn(
                "rounded-full p-2 transition-colors",
                isDark
                  ? "text-gray-400 hover:bg-white/10 hover:text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
              )}
              aria-label="테마 전환"
            >
              {isDark || darkPreview ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setIsAlarmOpen(prev => !prev)}
                className={cn(
                  "flex items-center justify-center rounded-full p-2 transition-colors",
                  isDark
                    ? "text-gray-400 hover:bg-white/10 hover:text-white"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
                )}
                aria-label="알림 열기"
                aria-expanded={isAlarmOpen}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </button>

              {isAlarmOpen ? (
                <div className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-gray-200 bg-white p-4 text-left text-xs text-gray-700">
                  <div className="mb-2 flex items-center justify-between border-b border-gray-100 pb-2">
                    <strong className="text-sm font-black text-gray-900">알림</strong>
                    <button
                      type="button"
                      onClick={() => setIsAlarmOpen(false)}
                      className="text-gray-400 hover:text-gray-700"
                    >
                      닫기
                    </button>
                  </div>
                  <p className="py-4 text-center font-medium text-gray-400">
                    {isLoggedIn
                      ? "새로운 알림이 없습니다."
                      : "로그인 후 실시간 체결·커뮤니티 알림을 확인할 수 있습니다."}
                  </p>
                </div>
              ) : null}
            </div>

            <div
              className={cn(
                "mx-1 hidden h-4 w-[1px] sm:block",
                isDark ? "bg-white/15" : "bg-gray-200",
              )}
            />

            {isLoggedIn ? (
              <div className="flex items-center gap-2">
                <Link href="/me" className={headerPillClass}>
                  마이페이지
                </Link>
                <Link
                  href="/me"
                  aria-label="내 프로필 아바타"
                  className={cn(
                    "hidden h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-1 transition-transform hover:scale-105 sm:flex",
                    isDark ? "bg-zinc-800 ring-zinc-700" : "bg-gray-50 ring-gray-200",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveV1AvatarUrl({ memberId: memberCtx?.snapshot.memberId })}
                    alt="프로필"
                    className="h-full w-full object-cover"
                  />
                </Link>
              </div>
            ) : (
              <Link href="/login" className={headerPillClass}>
                로그인
              </Link>
            )}

            {/* 모바일 햄버거 버튼 */}
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className={cn(
                "ml-1 block md:hidden focus:outline-none p-2 rounded-lg",
                isDark ? "text-gray-200 hover:bg-white/10" : "text-gray-700 hover:bg-gray-100",
              )}
              aria-label="메뉴 열기"
              aria-expanded={isMenuOpen}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* V1 모바일 사이드 드로어 (MenuLayer + Dim) */}
      {isMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" data-dim-modal="open">
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMenuOpen(false)}
          />
          <aside className="fixed right-0 top-0 z-50 h-screen w-64 bg-white p-6 text-gray-900 border-l border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="요기망치" className="h-7 w-auto object-contain" />
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                aria-label="메뉴 닫기"
              >
                ✕
              </button>
            </div>
            <nav aria-label="모바일 전체 메뉴" className="mt-6 flex flex-col gap-3 text-sm font-bold">
              <Link href="/" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                홈 · 메인 대시보드
              </Link>
              <Link href="/trading" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                모의투자 · 선물 터미널
              </Link>
              <Link href="/contest" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                대회 · 시즌 랭킹 (준비중)
              </Link>
              <Link href="/community" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                커뮤니티 · 전체/인기/최신글
              </Link>
              <Link href="/news" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                실시간 뉴스 · 시황/속보
              </Link>
              <Link href="/me" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                마이페이지 · 자산/포트폴리오
              </Link>
              <Link href="/me/settings" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                회원정보 수정
              </Link>
            </nav>
            <div className="mt-6 flex flex-col gap-2 border-t border-gray-100 pt-4">
              {isLoggedIn ? (
                <Link
                  href="/me"
                  className="inline-flex h-9 w-full items-center justify-center rounded-full bg-gray-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
                  onClick={() => setIsMenuOpen(false)}
                >
                  마이페이지
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex h-9 w-full items-center justify-center rounded-full bg-gray-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
                  onClick={() => setIsMenuOpen(false)}
                >
                  로그인
                </Link>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
