"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SVGProps,
} from "react";
import { useDimScrollLock } from "./dim-modal";
import { useOptionalMember } from "./member-provider";
import type { MemberRole } from "../api/contracts";
import {
  writeHeaderAuthHint,
  type HeaderAuthHint,
} from "../api/session";

export interface V1FlatIconProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

function BaseFlatIcon({
  iconName,
  className,
  children,
  ...props
}: V1FlatIconProps & { iconName: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-flat-icon={iconName}
      className={cn("shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function V1IconPen(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="pen" {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </BaseFlatIcon>
  );
}

export function V1IconHeart(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="heart" {...props}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </BaseFlatIcon>
  );
}

export function V1IconComment(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="comment" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </BaseFlatIcon>
  );
}

export function V1IconChartBar(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="chart-bar" {...props}>
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </BaseFlatIcon>
  );
}

export function V1IconTrendUp(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="trend-up" {...props}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </BaseFlatIcon>
  );
}

export function V1IconTrendDown(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="trend-down" {...props}>
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </BaseFlatIcon>
  );
}

export function V1IconBolt(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="bolt" {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </BaseFlatIcon>
  );
}

export function V1IconNews(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="news" {...props}>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </BaseFlatIcon>
  );
}

export function V1IconSend(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="send" {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </BaseFlatIcon>
  );
}

export function V1IconStar(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="star" {...props}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </BaseFlatIcon>
  );
}

export function V1IconMic(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="mic" {...props}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </BaseFlatIcon>
  );
}

export function V1IconCalendar(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="calendar" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </BaseFlatIcon>
  );
}

export function V1IconSparkle(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="sparkle" {...props}>
      <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" />
    </BaseFlatIcon>
  );
}

export function V1IconCheck(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="check" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </BaseFlatIcon>
  );
}

export function V1IconClose(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="close" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </BaseFlatIcon>
  );
}

export function V1IconSwap(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="swap" {...props}>
      <polyline points="7 3 7 21" />
      <polyline points="3 7 7 3 11 7" />
      <polyline points="17 21 17 3" />
      <polyline points="13 17 17 21 21 17" />
    </BaseFlatIcon>
  );
}

export function V1IconCornerDownRight(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="corner-down-right" {...props}>
      <polyline points="15 10 20 15 15 20" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </BaseFlatIcon>
  );
}

export function V1IconArrowUp(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="arrow-up" {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </BaseFlatIcon>
  );
}

export function V1IconArrowLeft(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="arrow-left" {...props}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </BaseFlatIcon>
  );
}

export function V1IconArrowRight(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="arrow-right" {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </BaseFlatIcon>
  );
}

export function V1IconExternal(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="external" {...props}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </BaseFlatIcon>
  );
}

export function V1IconShield(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="shield" {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </BaseFlatIcon>
  );
}

export function V1IconWallet(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="wallet" {...props}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </BaseFlatIcon>
  );
}

export function V1IconTrophy(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="trophy" {...props}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </BaseFlatIcon>
  );
}

export function V1IconMedal(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="medal" {...props}>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </BaseFlatIcon>
  );
}

export function V1IconUsers(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="users" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </BaseFlatIcon>
  );
}

export function V1IconChevronDown(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="chevron-down" {...props}>
      <polyline points="6 9 12 15 18 9" />
    </BaseFlatIcon>
  );
}

export function V1IconChevronLeft(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="chevron-left" {...props}>
      <polyline points="15 18 9 12 15 6" />
    </BaseFlatIcon>
  );
}

export function V1IconChevronRight(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="chevron-right" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </BaseFlatIcon>
  );
}

export function V1IconAlert(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="alert" {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </BaseFlatIcon>
  );
}

export function V1IconRefresh(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="refresh" {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </BaseFlatIcon>
  );
}

export function V1IconPlus(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="plus" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </BaseFlatIcon>
  );
}

export function V1IconClock(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="clock" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </BaseFlatIcon>
  );
}

export function V1IconInfo(props: V1FlatIconProps) {
  return (
    <BaseFlatIcon iconName="info" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </BaseFlatIcon>
  );
}

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
        "inline-flex shrink-0 whitespace-nowrap items-center justify-center rounded-xl font-bold transition-colors cursor-pointer focus:outline-none disabled:cursor-default disabled:opacity-50",
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
        "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-[#0058FF] focus:outline-none focus:ring-1 focus:ring-[#0058FF] disabled:cursor-default disabled:bg-gray-100 disabled:text-gray-500",
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
  variant?: "underline" | "plain" | "bookmark";
  mode?: "light" | "dark";
}) {
  const isDark = mode === "dark";
  const defaultActiveColor = isDark
    ? "text-white border-white"
    : "text-gray-900 border-gray-900";
  const finalActiveColor = activeColor || defaultActiveColor;
  const resolvedSize = size;

  if (variant === "bookmark") {
    return (
      <div
        role="tablist"
        data-tab-variant="bookmark"
        className={cn(
          "flex items-end gap-1.5 border-b border-gray-200 px-1 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          className,
        )}
      >
        {tabs.map(tab => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.value)}
              className={cn(
                "relative inline-flex h-10 shrink-0 items-center justify-center rounded-t-xl border border-b-0 px-3 sm:px-5 text-xs sm:text-sm whitespace-nowrap select-none cursor-pointer focus:outline-none",
                fullWidth && "flex-1",
                isActive
                  ? "border-[#0058FF] bg-[#0058FF] font-black text-white"
                  : "border-gray-200/80 bg-[#EEF1F6] font-bold text-gray-500 hover:bg-gray-200/70 hover:text-gray-800",
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
              "relative transition-colors shrink-0 whitespace-nowrap",
              resolvedSize === "sm"
                ? "pt-1.5 pb-1.5 text-[12px]"
                : "pt-2.5 pb-2.5 sm:pt-3 sm:pb-3 text-[13px] sm:text-base",
              fullWidth
                ? "flex-1 text-center"
                : resolvedSize === "sm"
                  ? "min-w-[56px] whitespace-nowrap text-center px-2"
                  : "min-w-[72px] sm:min-w-[112px] whitespace-nowrap text-center px-3 sm:px-4",
              isActive
                ? cn(
                    "font-black",
                    variant === "underline" && (resolvedSize === "sm" ? "border-b-2" : "border-b-[3px]"),
                    currentTabColor || finalActiveColor,
                  )
                : cn(
                    "font-bold",
                    isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600",
                    variant === "underline" &&
                      (resolvedSize === "sm" ? "border-b-2 border-transparent" : "border-b-[3px] border-transparent"),
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
              "border font-black transition-colors whitespace-nowrap shrink-0",
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
  role,
}: {
  theme?: "light" | "dark";
  role?: "MEMBER" | "USER" | "ADMIN";
  rightExtra?: ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [verifiedRole, setVerifiedRole] = useState<{
    key: string;
    role: MemberRole;
  } | null>(null);
  const pathname = usePathname();
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const isInitialAuthLoading = role === undefined && phase === "loading";
  const isLoggedIn = phase === "ready";
  const isDarkTrading = Boolean(
    pathname?.startsWith("/trading") ||
      (pathname?.startsWith("/contest/") && pathname?.endsWith("/trading")),
  );
  const isDark = theme === "dark" || isDarkTrading;
  const sessionKey =
    phase === "ready" && memberCtx?.snapshot.memberId
      ? `${memberCtx.snapshot.memberId}:${memberCtx.snapshot.generation}`
      : null;

  useEffect(() => {
    if (phase !== "ready" || !memberCtx || !sessionKey || role) {
      return;
    }
    const controller = new AbortController();
    const memberId = memberCtx.snapshot.memberId!;
    const generation = memberCtx.snapshot.generation;
    void memberCtx.session
      .request("/members/me", { signal: controller.signal })
      .then(data => {
        if (data && typeof data === "object") {
          const rawRole = (data as { role?: unknown }).role;
          const resolved: MemberRole =
            rawRole === "ADMIN" || rawRole === "ROLE_ADMIN" ? "ADMIN" : "MEMBER";
          setVerifiedRole({ key: sessionKey, role: resolved });
          const nextHint: HeaderAuthHint = { loggedIn: true, role: resolved };
          writeHeaderAuthHint(nextHint);
          memberCtx.session.setRole(resolved, memberId, generation);
        }
      })
      .catch(() => {
        // Ignore unverified role lookup errors in header
      });
    return () => controller.abort();
  }, [phase, memberCtx, role, sessionKey]);

  const verifiedSessionRole =
    sessionKey !== null && verifiedRole?.key === sessionKey
      ? verifiedRole.role
      : null;

  const isAdmin =
    role !== undefined
      ? role === "ADMIN"
      : phase === "ready"
        ? (verifiedSessionRole ?? memberCtx?.snapshot.role ?? "MEMBER") === "ADMIN"
        : false;

  useDimScrollLock(isMenuOpen);

  function rememberCurrentPageForLogin() {
    if (typeof window === "undefined") return;
    const currentPath = `${window.location.pathname || "/"}${window.location.search || ""}`;
    if (/^\/(login|signup|auth\/callback|account)(\/|$|\?|#)/i.test(currentPath)) return;
    try {
      window.sessionStorage?.setItem("yogimangchi:login-return-to:v1", currentPath);
    } catch {
      try {
        window.localStorage?.setItem("yogimangchi:login-return-to:v1", currentPath);
      } catch {
        // Ignore storage errors
      }
    }
  }

  return (
    <>
      <header
        className={cn(
          "ym-gnb-header trading-brand-header sticky top-0 z-50 w-full border-b font-sans text-sm leading-none tracking-normal antialiased [word-break:keep-all] transition-colors",
          isDark
            ? "border-white/10 bg-[#0B0E11] text-white"
            : "border-gray-200 bg-white text-gray-900",
        )}
      >
        <div className="ym-gnb-inner mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-4 sm:px-6 relative">
          {/* 1. 왼쪽 로고 */}
          <Link
            href="/"
            className="member-logo ym-brand-logo-link flex h-9 w-[124px] shrink-0 items-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={isDark ? "/logo_dark.png" : "/images/logo.webp"}
              alt="YogiMangchi"
              width={120}
              height={34}
              className="ym-brand-logo-img block h-[34px] w-[120px] object-contain object-left"
            />
            <span className="sr-only">
              요기망치 <span className="trading-brand-latin">YOGIMANGCHI</span> 선물 모의투자
            </span>
          </Link>

          {/* 2. 중앙 네비게이션 (PC 전용) */}
          <nav
            aria-label="서비스 메뉴"
            className="ym-gnb-nav hidden md:flex md:absolute md:left-1/2 md:-translate-x-1/2 items-center gap-7"
          >
            {[
              { href: "/news", label: "실시간 뉴스" },
              { href: "/trading", label: "모의투자" },
              { href: "/contest", label: "대회" },
              { href: "/community", label: "커뮤니티" },
            ].map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-9 items-center px-2 text-[15px] font-bold leading-none whitespace-nowrap transition-colors",
                  isDark
                    ? "text-gray-200 hover:text-white"
                    : "text-gray-700 hover:text-gray-950",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* 3. 오른쪽 액션 영역 (관리자 배지 + 마이페이지 또는 로그인 버튼) */}
          <div className="ym-gnb-right flex min-h-[38px] md:min-w-[196px] shrink-0 items-center justify-end gap-2">
            {isInitialAuthLoading ? (
              <div className="ym-gnb-auth-loading flex items-center justify-end gap-2">
                <Link
                  href="/admin/contest"
                  className={cn(
                    "ym-auth-slot-admin h-9 shrink-0 items-center justify-center rounded-full border px-3.5 text-[13px] font-bold leading-none whitespace-nowrap transition-colors",
                    isDark
                      ? "border-blue-400/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
                      : "border-blue-200 bg-blue-50 text-[#0058FF] hover:bg-blue-100",
                  )}
                >
                  관리자
                </Link>
                <Link
                  href="/me"
                  className={cn(
                    "ym-auth-slot-member h-9 min-w-[96px] shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-bold leading-none whitespace-nowrap transition-colors",
                    isDark
                      ? "bg-white text-gray-900 hover:bg-gray-200"
                      : "bg-gray-900 text-white hover:bg-gray-800",
                  )}
                >
                  마이페이지
                </Link>
                <Link
                  href="/login"
                  onClick={rememberCurrentPageForLogin}
                  className={cn(
                    "ym-auth-slot-anon h-9 min-w-[96px] shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-bold leading-none whitespace-nowrap transition-colors",
                    isDark
                      ? "bg-white text-gray-900 hover:bg-gray-200"
                      : "bg-gray-900 text-white hover:bg-gray-800",
                  )}
                >
                  로그인
                </Link>
              </div>
            ) : (
              <>
                {isAdmin ? (
                  <Link
                    href="/admin/contest"
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center justify-center rounded-full border px-3.5 text-[13px] font-bold leading-none whitespace-nowrap transition-colors",
                      isDark
                        ? "border-blue-400/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
                        : "border-blue-200 bg-blue-50 text-[#0058FF] hover:bg-blue-100",
                    )}
                  >
                    관리자
                  </Link>
                ) : null}

                <Link
                  href={isLoggedIn ? "/me" : "/login"}
                  onClick={() => {
                    if (!isLoggedIn) rememberCurrentPageForLogin();
                  }}
                  className={cn(
                    "inline-flex h-9 min-w-[96px] shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-bold leading-none whitespace-nowrap transition-colors",
                    isDark
                      ? "bg-white text-gray-900 hover:bg-gray-200"
                      : "bg-gray-900 text-white hover:bg-gray-800",
                  )}
                >
                  {isLoggedIn ? "마이페이지" : "로그인"}
                </Link>
              </>
            )}

            {/* 모바일 햄버거 버튼 */}
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg md:hidden focus:outline-none",
                isDark ? "text-gray-200 hover:bg-white/10" : "text-gray-700 hover:bg-gray-100",
              )}
              aria-label="메뉴 열기"
              aria-expanded={isMenuOpen}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <aside className="fixed right-0 top-0 z-50 h-screen w-[min(18rem,85vw)] overflow-y-auto bg-white p-6 text-gray-900 border-l border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/logo.webp" alt="YogiMangchi" className="h-7 w-auto object-contain" />
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                aria-label="메뉴 닫기"
              >
                <V1IconClose className="h-4 w-4" />
              </button>
            </div>
            <nav aria-label="모바일 전체 메뉴" className="mt-6 flex flex-col gap-3 text-sm font-bold">
              <Link href="/" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                홈 · 메인 대시보드
              </Link>
              <Link href="/news" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                실시간 뉴스 · 시황/속보
              </Link>
              <Link href="/trading" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                모의투자 하러가기
              </Link>
              <Link href="/contest" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                대회 · 시즌 랭킹
              </Link>
              <Link href="/community" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                커뮤니티 · 전체/인기/최신글
              </Link>
              <Link href="/me" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                마이페이지 · 자산/포트폴리오
              </Link>
              <Link href="/me/settings" className="rounded-xl px-3 py-2.5 hover:bg-gray-50" onClick={() => setIsMenuOpen(false)}>
                회원정보 수정
              </Link>
              {isLoggedIn && isAdmin ? (
                <Link
                  href="/admin/contest"
                  className="rounded-xl bg-blue-50 px-3 py-2.5 text-[#0058FF] hover:bg-blue-100"
                  onClick={() => setIsMenuOpen(false)}
                >
                  관리자 · 대회 운영
                </Link>
              ) : null}
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
                  onClick={() => {
                    rememberCurrentPageForLogin();
                    setIsMenuOpen(false);
                  }}
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
