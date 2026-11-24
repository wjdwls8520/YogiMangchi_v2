"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  cn,
  V1IconBell,
  V1IconChevronRight,
  V1IconClose,
  V1IconCornerDownRight,
  V1IconRefresh,
} from "../components/v1-ui";
import type { NotificationItem } from "./notification-types";
import {
  formatNotificationCount,
  formatNotificationDescription,
  formatNotificationRelativeTime,
  formatNotificationTitle,
  getNotificationActivityTime,
  getNotificationActivityValue,
  getNotificationCategoryLabel,
  getNotificationNavigationTarget,
  getNotificationTradeMeta,
  getNotificationTradeToneStyles,
  isCommentNotification,
  mergeNotificationsByUid,
} from "./notification-utils";

export interface NotificationDrawerProps {
  notifications: NotificationItem[];
  isLoading: boolean;
  isReadingAll: boolean;
  isLoadingMore: boolean;
  hasNext: boolean;
  isDark?: boolean;
  onClose: () => void;
  onSelectNotification: (notification: NotificationItem) => void;
  onAcknowledgeNewNotifications: () => void;
  onReadAll: () => void;
  onLoadMore: () => void;
}

export function NotificationDrawer({
  notifications,
  isLoading,
  isReadingAll,
  isLoadingMore,
  hasNext,
  isDark = false,
  onClose,
  onSelectNotification,
  onAcknowledgeNewNotifications,
  onReadAll,
  onLoadMore,
}: NotificationDrawerProps) {
  const hasUnreadNotifications = notifications.some(item => !item.isRead);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const revealHighlightTimeoutRef = useRef<number | null>(null);
  const hasStartedBufferingRef = useRef(false);
  const [pendingNotifications, setPendingNotifications] = useState<NotificationItem[]>([]);
  const [highlightedUids, setHighlightedUids] = useState<string[]>([]);
  const pendingRef = useRef<NotificationItem[]>([]);
  const previousRef = useRef<NotificationItem[]>([]);

  const visibleNotifications = notifications.filter(
    item => !pendingNotifications.some(pending => pending.uid === item.uid),
  );

  useEffect(() => {
    pendingRef.current = pendingNotifications;
  }, [pendingNotifications]);

  useEffect(() => {
    if (isLoading) return;
    if (!hasStartedBufferingRef.current) {
      hasStartedBufferingRef.current = true;
      previousRef.current = notifications;
      return;
    }

    const prevMap = new Map(previousRef.current.map(item => [item.uid, item]));
    const pendMap = new Map(pendingRef.current.map(item => [item.uid, item]));
    const leading: NotificationItem[] = [];

    for (const item of notifications) {
      const prev = prevMap.get(item.uid);
      const pend = pendMap.get(item.uid);
      const knownTime = Math.max(
        prev ? getNotificationActivityTime(prev) : Number.NEGATIVE_INFINITY,
        pend ? getNotificationActivityTime(pend) : Number.NEGATIVE_INFINITY,
      );
      if (knownTime >= getNotificationActivityTime(item)) {
        break;
      }
      leading.push(item);
    }

    previousRef.current = notifications;
    if (leading.length > 0) {
      setPendingNotifications(mergeNotificationsByUid(pendingRef.current, leading));
    }
  }, [isLoading, notifications]);

  useEffect(() => {
    return () => {
      if (revealHighlightTimeoutRef.current !== null) {
        window.clearTimeout(revealHighlightTimeoutRef.current);
      }
    };
  }, []);

  const handleRevealPending = () => {
    if (pendingNotifications.length === 0) return;
    const uids = pendingNotifications.map(item => item.uid);
    setPendingNotifications([]);
    setHighlightedUids(uids);
    onAcknowledgeNewNotifications();
    if (revealHighlightTimeoutRef.current !== null) {
      window.clearTimeout(revealHighlightTimeoutRef.current);
    }
    revealHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedUids([]);
      revealHighlightTimeoutRef.current = null;
    }, 2000);
    window.requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  return (
    <aside
      data-notification-drawer="true"
      data-drawer-theme={isDark ? "dark" : "light"}
      aria-label="실시간 알림 패널"
      className={cn(
        "flex h-full flex-col overflow-hidden",
        isDark ? "bg-[#161A1E] text-gray-100" : "bg-white text-gray-900",
      )}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2
            className={cn(
              "text-left text-[17px] font-extrabold tracking-tight",
              isDark ? "text-gray-100" : "text-gray-900",
            )}
          >
            알림
          </h2>

          {pendingNotifications.length > 0 ? (
            <button
              type="button"
              onClick={handleRevealPending}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold transition-colors cursor-pointer",
                isDark
                  ? "bg-[#F0B90B]/15 text-[#F0B90B] hover:bg-[#F0B90B]/25"
                  : "bg-[#0058FF]/10 text-[#0058FF] hover:bg-[#0058FF]/15",
              )}
            >
              <span>
                새로운 알림 {formatNotificationCount(pendingNotifications.length)}건
              </span>
              <V1IconRefresh className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer",
            isDark
              ? "text-gray-400 hover:bg-white/10 hover:text-gray-100"
              : "text-gray-400 hover:bg-gray-100 hover:text-gray-600",
          )}
          aria-label="알림 패널 닫기"
        >
          <V1IconClose className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div
        className={cn(
          "flex items-center justify-between border-b px-5 pb-3",
          isDark ? "border-[#2B3139]" : "border-gray-100",
        )}
      >
        <Link
          href="/notifications"
          onClick={onClose}
          className={cn(
            "inline-flex items-center gap-1 text-[12px] font-bold transition-colors",
            isDark
              ? "text-gray-400 hover:text-[#F0B90B]"
              : "text-gray-500 hover:text-[#0058FF]",
          )}
        >
          <span>전체보기</span>
          <V1IconChevronRight className="h-3.5 w-3.5" />
        </Link>

        <button
          type="button"
          onClick={onReadAll}
          disabled={!hasUnreadNotifications || isReadingAll}
          className={cn(
            "text-[12px] font-bold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40",
            isDark
              ? "text-gray-400 hover:text-gray-100"
              : "text-gray-500 hover:text-gray-800",
          )}
        >
          {isReadingAll ? "처리 중..." : "모두 읽음"}
        </button>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {isLoading ? <NotificationDrawerSkeleton isDark={isDark} /> : null}

        {!isLoading &&
        visibleNotifications.length === 0 &&
        pendingNotifications.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-6 text-center">
            <div
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl",
                isDark ? "bg-white/5" : "bg-gray-50",
              )}
            >
              <V1IconBell
                className={cn("h-6 w-6", isDark ? "text-gray-500" : "text-gray-300")}
              />
            </div>
            <p
              className={cn(
                "mt-4 text-[13px] font-bold",
                isDark ? "text-gray-300" : "text-gray-500",
              )}
            >
              최근 도착한 알림이 없습니다
            </p>
            <p className="mt-1 text-xs text-gray-400">
              주문 체결·강제청산·대회·커뮤니티 활동 시 즉시 알려드립니다.
            </p>
          </div>
        ) : null}

        {!isLoading && visibleNotifications.length > 0 ? (
          <ul>
            {visibleNotifications.map(item => (
              <NotificationDrawerRow
                key={item.uid}
                notification={item}
                isHighlighted={highlightedUids.includes(item.uid)}
                isDark={isDark}
                onSelect={onSelectNotification}
              />
            ))}
          </ul>
        ) : null}
      </div>

      {hasNext ? (
        <div
          className={cn(
            "border-t px-4 py-3",
            isDark ? "border-[#2B3139]" : "border-gray-100",
          )}
        >
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className={cn(
              "flex h-9 w-full items-center justify-center rounded-xl text-[12px] font-bold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50",
              isDark
                ? "text-gray-300 hover:bg-white/5"
                : "text-gray-600 hover:bg-gray-50",
            )}
          >
            {isLoadingMore ? "불러오는 중..." : "이전 알림 더 보기"}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function NotificationDrawerRow({
  notification,
  isHighlighted,
  isDark,
  onSelect,
}: {
  notification: NotificationItem;
  isHighlighted: boolean;
  isDark: boolean;
  onSelect: (notification: NotificationItem) => void;
}) {
  const title = formatNotificationTitle(notification);
  const description = formatNotificationDescription(notification);
  const categoryLabel = getNotificationCategoryLabel(notification.category);
  const timeLabel = formatNotificationRelativeTime(
    getNotificationActivityValue(notification),
  );
  const { sideLabel, tone } = getNotificationTradeMeta(notification);
  const toneStyles = getNotificationTradeToneStyles(tone);
  const showCommentIcon = isCommentNotification(notification);
  const target = getNotificationNavigationTarget(notification);
  const isUnread = !notification.isRead;

  const innerContent = (
    <>
      <div className="mt-[7px] flex shrink-0">
        <div
          className={cn(
            "h-[7px] w-[7px] rounded-full transition-colors",
            isUnread ? toneStyles.dot : "bg-transparent",
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide",
                isDark
                  ? isUnread
                    ? "bg-white/10 text-gray-200"
                    : "bg-white/5 text-gray-500"
                  : isUnread
                    ? "bg-gray-100 text-gray-700"
                    : "bg-gray-50 text-gray-400",
              )}
            >
              {categoryLabel}
            </span>

            {sideLabel ? (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide",
                  toneStyles.badge,
                )}
              >
                {sideLabel}
              </span>
            ) : null}
          </div>

          {timeLabel ? (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-400">
              {timeLabel}
            </span>
          ) : null}
        </div>

        <p
          className={cn(
            "mt-2 text-left text-[13px] leading-[20px]",
            isDark
              ? isUnread
                ? "font-bold text-gray-100"
                : "font-medium text-gray-400"
              : isUnread
                ? "font-bold text-gray-900"
                : "font-medium text-gray-500",
          )}
        >
          {title}
        </p>

        {description ? (
          <div
            className={cn(
              "mt-1 flex items-start gap-1.5 text-left text-[12px] leading-[18px]",
              isDark ? "text-gray-400" : "text-gray-500",
            )}
          >
            {showCommentIcon ? (
              <V1IconCornerDownRight className="mt-[2px] h-3.5 w-3.5 shrink-0" />
            ) : null}
            <span className="min-w-0 break-words">{description}</span>
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <li
      data-notification-row={notification.uid}
      className={cn(
        "relative border-b last:border-b-0 transition-colors duration-200",
        isDark ? "border-[#232830]" : "border-gray-50",
        isHighlighted
          ? toneStyles.highlightSurface
          : isUnread && toneStyles.unreadSurface,
      )}
    >
      {target ? (
        <Link
          href={target.href}
          onClick={() => onSelect(notification)}
          className={cn(
            "flex w-full items-start gap-3 px-5 py-4 text-left transition-colors",
            isDark ? "hover:bg-white/5" : "hover:bg-gray-50/80",
          )}
          aria-label={`${title} 알림으로 이동`}
        >
          {innerContent}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(notification)}
          className={cn(
            "flex w-full items-start gap-3 px-5 py-4 text-left transition-colors cursor-pointer",
            isDark ? "hover:bg-white/5" : "hover:bg-gray-50/80",
          )}
          aria-label={`${title} 알림 읽음 처리`}
        >
          {innerContent}
        </button>
      )}
    </li>
  );
}

function NotificationDrawerSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="space-y-1">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 rounded-xl py-3">
            <div
              className={cn(
                "mt-[7px] h-[7px] w-[7px] shrink-0 animate-pulse rounded-full",
                isDark ? "bg-white/15" : "bg-gray-200",
              )}
            />
            <div className="flex-1 space-y-2">
              <div
                className={cn(
                  "h-[18px] w-16 animate-pulse rounded-md",
                  isDark ? "bg-white/10" : "bg-gray-100",
                )}
              />
              <div
                className={cn(
                  "h-4 w-full animate-pulse rounded-md",
                  isDark ? "bg-white/10" : "bg-gray-100",
                )}
              />
              <div
                className={cn(
                  "h-3 w-2/3 animate-pulse rounded-md",
                  isDark ? "bg-white/5" : "bg-gray-50",
                )}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
