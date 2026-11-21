"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TRADING_API_BASE_URL } from "../../contest/api/contest-client";
import { useOptionalMember } from "../components/member-provider";
import {
  cn,
  V1Button,
  V1Header,
  V1IconBell,
  V1IconCheck,
  V1IconChevronDown,
  V1IconChevronRight,
  V1IconCornerDownRight,
  V1IconRefresh,
  V1IconTrash,
  V1Tabs,
} from "../components/v1-ui";
import {
  fetchUnifiedNotifications,
  type DualCursorState,
} from "./notification-api";
import { useOptionalNotificationCenter } from "./notification-context";
import type {
  NotificationItem,
  NotificationListTabValue,
} from "./notification-types";
import {
  formatNotificationCount,
  formatNotificationDescription,
  formatNotificationRelativeTime,
  formatNotificationTitle,
  getNotificationActivityValue,
  getNotificationCategoryLabel,
  getNotificationDetailFields,
  getNotificationListTabValue,
  getNotificationNavigationTarget,
  getNotificationTradeMeta,
  getNotificationTradeToneStyles,
  isCommentNotification,
  mergeNotificationsByUid,
} from "./notification-utils";

const PAGE_SIZE = 30;

const TABS: Array<{ label: string; value: NotificationListTabValue }> = [
  { label: "전체", value: "ALL" },
  { label: "모의투자", value: "MOCK" },
  { label: "대회", value: "CONTEST" },
  { label: "커뮤니티", value: "COMMUNITY" },
];

function filterByTab(
  items: NotificationItem[],
  tab: NotificationListTabValue,
): NotificationItem[] {
  if (tab === "ALL") return items;
  return items.filter(item => getNotificationListTabValue(item.category) === tab);
}

export function NotificationsPageView({
  initialTab = "ALL",
}: {
  initialTab?: NotificationListTabValue;
}) {
  const memberCtx = useOptionalMember();
  const notifCenter = useOptionalNotificationCenter();
  const phase = memberCtx?.snapshot.phase ?? "anonymous";
  const session = memberCtx?.session ?? null;

  const [activeTab, setActiveTab] = useState<NotificationListTabValue>(initialTab);
  const [extraItems, setExtraItems] = useState<NotificationItem[]>([]);
  const [cursors, setCursors] = useState<DualCursorState>({
    contentCursorId: null,
    contentHasNext: false,
    tradingCursorId: null,
    tradingHasNext: false,
  });
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [expandedUids, setExpandedUids] = useState<string[]>([]);

  const centerItems = useMemo(() => notifCenter?.items ?? [], [notifCenter?.items]);
  const mergedAllItems = useMemo(
    () => mergeNotificationsByUid(centerItems, extraItems),
    [centerItems, extraItems],
  );
  const filteredItems = useMemo(
    () => filterByTab(mergedAllItems, activeTab),
    [mergedAllItems, activeTab],
  );

  const tabUnreadCounts = useMemo(() => {
    const counts: Record<NotificationListTabValue, number> = {
      ALL: 0,
      MOCK: 0,
      CONTEST: 0,
      COMMUNITY: 0,
    };
    for (const item of mergedAllItems) {
      if (!item.isRead) {
        counts.ALL += 1;
        counts[getNotificationListTabValue(item.category)] += 1;
      }
    }
    return counts;
  }, [mergedAllItems]);

  const acknowledgeNewRef = useRef(notifCenter?.acknowledgeNew);
  useEffect(() => {
    acknowledgeNewRef.current = notifCenter?.acknowledgeNew;
  }, [notifCenter?.acknowledgeNew]);

  // Acknowledge badge & load fuller page when entering /notifications
  useEffect(() => {
    if (phase !== "ready" || !session || typeof window === "undefined") {
      return;
    }
    void acknowledgeNewRef.current?.();
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setIsPageLoading(true);
      try {
        const result = await fetchUnifiedNotifications(session, {
          tab: "ALL",
          size: PAGE_SIZE,
          tradingBaseUrl: DEFAULT_TRADING_API_BASE_URL,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setExtraItems(result.items);
        setCursors(result.cursors);
      } catch {
        // Fallback to items already in context
      } finally {
        if (!controller.signal.aborted) {
          setIsPageLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [phase, session]);

  const handleLoadMore = async () => {
    if (!session || isLoadingMore) return;
    const hasMore = cursors.contentHasNext || cursors.tradingHasNext;
    if (!hasMore) return;
    setIsLoadingMore(true);
    try {
      const next = await fetchUnifiedNotifications(session, {
        tab: "ALL",
        size: PAGE_SIZE,
        cursors,
        tradingBaseUrl: DEFAULT_TRADING_API_BASE_URL,
      });
      setExtraItems(prev => mergeNotificationsByUid(prev, next.items));
      setCursors(next.cursors);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleRefresh = async () => {
    if (!session || phase !== "ready") return;
    setIsPageLoading(true);
    try {
      await notifCenter?.refreshLatest();
      const fresh = await fetchUnifiedNotifications(session, {
        tab: "ALL",
        size: PAGE_SIZE,
        tradingBaseUrl: DEFAULT_TRADING_API_BASE_URL,
      });
      setExtraItems(fresh.items);
      setCursors(fresh.cursors);
    } finally {
      setIsPageLoading(false);
    }
  };

  const visibleUidSet = useMemo(
    () => new Set(filteredItems.map(i => i.uid)),
    [filteredItems],
  );
  const activeSelectedUids = useMemo(
    () => selectedUids.filter(uid => visibleUidSet.has(uid)),
    [selectedUids, visibleUidSet],
  );
  const allVisibleSelected =
    filteredItems.length > 0 && activeSelectedUids.length === filteredItems.length;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedUids(prev => prev.filter(uid => !visibleUidSet.has(uid)));
    } else {
      setSelectedUids(prev =>
        Array.from(new Set([...prev, ...filteredItems.map(i => i.uid)])),
      );
    }
  };

  const toggleSelectOne = (uid: string) => {
    setSelectedUids(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid],
    );
  };

  const toggleExpandOne = (uid: string) => {
    setExpandedUids(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid],
    );
  };

  const handleMarkSelectedRead = async () => {
    const targets = filteredItems.filter(i => activeSelectedUids.includes(i.uid));
    if (targets.length === 0) return;
    setExtraItems(prev =>
      prev.map(i => (activeSelectedUids.includes(i.uid) ? { ...i, isRead: true } : i)),
    );
    await notifCenter?.markManyAsRead(targets);
    setSelectedUids([]);
  };

  const handleMarkAllRead = async () => {
    setExtraItems(prev => prev.map(i => ({ ...i, isRead: true })));
    await notifCenter?.markAllAsRead();
    setSelectedUids([]);
  };

  const handleDeleteSelected = async () => {
    const targets = filteredItems.filter(i => activeSelectedUids.includes(i.uid));
    if (targets.length === 0) return;
    const removeSet = new Set(targets.map(t => t.uid));
    setExtraItems(prev => prev.filter(i => !removeSet.has(i.uid)));
    await notifCenter?.deleteMany(targets);
    setSelectedUids([]);
  };

  const handleDeleteRead = async () => {
    setExtraItems(prev => prev.filter(i => !i.isRead));
    await notifCenter?.deleteRead();
    setSelectedUids([]);
  };

  const handleMarkOneRead = (item: NotificationItem) => {
    if (item.isRead) return;
    setExtraItems(prev =>
      prev.map(existing =>
        existing.uid === item.uid ? { ...existing, isRead: true } : existing,
      ),
    );
    void notifCenter?.markOneAsRead(item);
  };

  const hasAnyUnread = mergedAllItems.some(i => !i.isRead);
  const hasAnyRead = mergedAllItems.some(i => i.isRead);
  const hasMore = cursors.contentHasNext || cursors.tradingHasNext;

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-gray-900">
      <V1Header theme="light" />

      <main
        data-notifications-page="true"
        className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-black tracking-tight text-gray-900">
                알림 내역
              </h1>
              {tabUnreadCounts.ALL > 0 ? (
                <span className="inline-flex h-6 items-center rounded-full bg-[#0058FF] px-2.5 text-xs font-extrabold text-white">
                  안 읽음 {formatNotificationCount(tabUnreadCounts.ALL)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              시장가·지정가·손절 체결, 강제청산, 대회 승인·반려·최종 순위 정산 및 커뮤니티 댓글·@멘션·좋아요 알림을 한곳에서 확인합니다.
            </p>
          </div>

          {phase === "ready" ? (
            <V1Button
              variant="white"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={isPageLoading}
              className="gap-1.5"
            >
              <V1IconRefresh className="h-3.5 w-3.5" />
              <span>새로고침</span>
            </V1Button>
          ) : null}
        </div>

        {phase === "anonymous" ? (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-xs">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-[#0058FF]">
              <V1IconBell className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-gray-900">
              로그인 후 실시간 알림을 확인하세요
            </h2>
            <p className="mt-1.5 text-sm text-gray-500">
              모의투자 체결·강제청산, 대회 결과 및 커뮤니티 댓글·@멘션 알림이 실시간으로 제공됩니다.
            </p>
            <div className="mt-6 flex justify-center">
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-sm font-bold text-white transition-colors hover:bg-blue-700"
              >
                로그인하러 가기
              </Link>
            </div>
          </section>
        ) : (
          <section className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="px-4 pt-2 sm:px-6">
              <V1Tabs
                tabs={TABS.map(tab => ({
                  value: tab.value,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{tab.label}</span>
                      {tabUnreadCounts[tab.value] > 0 ? (
                        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-extrabold text-white">
                          {formatNotificationCount(tabUnreadCounts[tab.value])}
                        </span>
                      ) : null}
                    </span>
                  ),
                }))}
                activeTab={activeTab}
                onChange={next => {
                  setActiveTab(next as NotificationListTabValue);
                  setSelectedUids([]);
                }}
                activeColor="text-[#0058FF] border-[#0058FF]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-3 sm:px-6">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={filteredItems.length === 0}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 shrink-0 rounded border-gray-300 accent-[#0058FF] cursor-pointer disabled:cursor-default"
                />
                <span>
                  전체 선택
                  {activeSelectedUids.length > 0
                    ? ` (${activeSelectedUids.length}건)`
                    : ""}
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={activeSelectedUids.length === 0}
                  onClick={() => void handleMarkSelectedRead()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 cursor-pointer disabled:cursor-default disabled:opacity-40"
                >
                  <V1IconCheck className="h-3.5 w-3.5" />
                  <span>선택 읽음</span>
                </button>

                <button
                  type="button"
                  disabled={!hasAnyUnread}
                  onClick={() => void handleMarkAllRead()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 cursor-pointer disabled:cursor-default disabled:opacity-40"
                >
                  <span>모두 읽음</span>
                </button>

                <button
                  type="button"
                  disabled={activeSelectedUids.length === 0}
                  onClick={() => void handleDeleteSelected()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 cursor-pointer disabled:cursor-default disabled:opacity-40"
                >
                  <V1IconTrash className="h-3.5 w-3.5" />
                  <span>선택 삭제</span>
                </button>

                <button
                  type="button"
                  disabled={!hasAnyRead}
                  onClick={() => void handleDeleteRead()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-50 cursor-pointer disabled:cursor-default disabled:opacity-40"
                >
                  <span>읽은 알림 삭제</span>
                </button>
              </div>
            </div>

            {isPageLoading && filteredItems.length === 0 ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-20 animate-pulse rounded-xl bg-gray-100"
                  />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50">
                  <V1IconBell className="h-6 w-6 text-gray-300" />
                </div>
                <p className="mt-4 text-sm font-bold text-gray-600">
                  표시할 알림 내역이 없습니다
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  새로운 체결·대회·커뮤니티 활동이 발생하면 실시간으로 표시됩니다.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredItems.map(item => {
                  const title = formatNotificationTitle(item);
                  const description = formatNotificationDescription(item);
                  const categoryLabel = getNotificationCategoryLabel(item.category);
                  const timeLabel = formatNotificationRelativeTime(
                    getNotificationActivityValue(item),
                  );
                  const { sideLabel, tone } = getNotificationTradeMeta(item);
                  const toneStyles = getNotificationTradeToneStyles(tone);
                  const details = getNotificationDetailFields(item);
                  const target = getNotificationNavigationTarget(item);
                  const isUnread = !item.isRead;
                  const isSelected = activeSelectedUids.includes(item.uid);
                  const isExpanded = expandedUids.includes(item.uid);
                  const showCommentIcon = isCommentNotification(item);

                  return (
                    <li
                      key={item.uid}
                      id={`notification-${item.notificationId}`}
                      data-notification-page-item={item.uid}
                      className={cn(
                        "transition-colors",
                        isUnread ? toneStyles.unreadSurface : "bg-white",
                      )}
                    >
                      <div className="flex items-start gap-3 px-4 py-4 sm:px-6">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(item.uid)}
                          aria-label={`${title} 선택`}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 accent-[#0058FF] cursor-pointer"
                        />

                        <div className="mt-2 flex shrink-0">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              isUnread ? toneStyles.dot : "bg-transparent",
                            )}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-2 py-0.5 text-[11px] font-bold",
                                isUnread
                                  ? "bg-gray-100 text-gray-800"
                                  : "bg-gray-50 text-gray-400",
                              )}
                            >
                              {categoryLabel}
                            </span>

                            {sideLabel ? (
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-[11px] font-bold",
                                  toneStyles.badge,
                                )}
                              >
                                {sideLabel}
                              </span>
                            ) : null}

                            <span className="ml-auto text-xs tabular-nums text-gray-400">
                              {timeLabel}
                            </span>
                          </div>

                          <p
                            className={cn(
                              "mt-1.5 text-sm leading-5",
                              isUnread
                                ? "font-extrabold text-gray-900"
                                : "font-medium text-gray-600",
                            )}
                          >
                            {title}
                          </p>

                          {description ? (
                            <div className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-gray-500">
                              {showCommentIcon ? (
                                <V1IconCornerDownRight className="mt-[3px] h-3.5 w-3.5 shrink-0" />
                              ) : null}
                              <span className="break-words">{description}</span>
                            </div>
                          ) : null}

                          <div className="mt-2.5 flex flex-wrap items-center gap-3">
                            {details.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  toggleExpandOne(item.uid);
                                  handleMarkOneRead(item);
                                }}
                                className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 transition-colors hover:text-gray-800 cursor-pointer"
                              >
                                <span>{isExpanded ? "상세 접기" : "상세 보기"}</span>
                                <V1IconChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 transition-transform",
                                    isExpanded && "rotate-180",
                                  )}
                                />
                              </button>
                            ) : null}

                            {isUnread ? (
                              <button
                                type="button"
                                onClick={() => handleMarkOneRead(item)}
                                className="text-xs font-bold text-gray-400 transition-colors hover:text-gray-700 cursor-pointer"
                              >
                                읽음 처리
                              </button>
                            ) : null}

                            {target ? (
                              <Link
                                href={target.href}
                                onClick={() => handleMarkOneRead(item)}
                                className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-[#0058FF] transition-colors hover:text-blue-700"
                              >
                                <span>{target.label}</span>
                                <V1IconChevronRight className="h-3.5 w-3.5" />
                              </Link>
                            ) : null}
                          </div>

                          {isExpanded && details.length > 0 ? (
                            <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {details.map(field => (
                                  <div
                                    key={field.label}
                                    className="flex items-baseline justify-between gap-3 text-xs"
                                  >
                                    <dt className="shrink-0 font-bold text-gray-500">
                                      {field.label}
                                    </dt>
                                    <dd className="min-w-0 truncate font-semibold text-gray-900">
                                      {field.value}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {hasMore ? (
              <div className="border-t border-gray-100 p-4 text-center">
                <V1Button
                  variant="white"
                  size="sm"
                  onClick={() => void handleLoadMore()}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "불러오는 중..." : "이전 알림 더 보기"}
                </V1Button>
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
