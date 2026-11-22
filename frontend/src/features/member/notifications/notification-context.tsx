"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { DEFAULT_TRADING_API_BASE_URL } from "../../contest/api/contest-client";
import { resolveContentOrigin } from "../../../lib/api-origins";
import { useFocusTrap } from "../../../lib/use-focus-trap";
import { registerOverlayEscape, useDimScrollLock } from "../components/dim-modal";
import { useOptionalMember } from "../components/member-provider";
import {
  checkUnifiedNotifications,
  deleteReadUnifiedNotifications,
  deleteSelectedUnifiedNotifications,
  fetchUnifiedNotifications,
  fetchUnifiedNotificationStatus,
  markAllUnifiedNotificationsRead,
  markSelectedUnifiedNotificationsRead,
  markUnifiedNotificationRead,
  startNotificationSseSubscription,
  type DualCursorState,
} from "./notification-api";
import { NotificationDrawer } from "./notification-drawer";
import { NotificationToastStack } from "./notification-toast-stack";
import type {
  NotificationItem,
  NotificationSource,
  NotificationStatusDto,
  NotificationToastItem,
} from "./notification-types";
import {
  formatNotificationDescription,
  formatNotificationTitle,
  getNotificationActivityValue,
  getNotificationNavigationTarget,
  getNotificationTradeMeta,
  isTradingTerminalPath,
  mergeNotificationsByUid,
} from "./notification-utils";

const DRAWER_PAGE_SIZE = 20;
const TOAST_TTL_MS = 4500;
const MAX_VISIBLE_TOASTS = 4;

export interface NotificationCenterValue {
  items: NotificationItem[];
  newCount: number;
  unreadCount: number;
  isLoading: boolean;
  isReadingAll: boolean;
  isLoadingMore: boolean;
  hasNext: boolean;
  isDrawerOpen: boolean;
  toasts: NotificationToastItem[];
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  dismissToast: (toastId: string) => void;
  acknowledgeNew: () => Promise<void>;
  refreshLatest: () => Promise<void>;
  loadMoreDrawer: () => Promise<void>;
  markOneAsRead: (item: NotificationItem) => Promise<void>;
  markManyAsRead: (items: NotificationItem[]) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteRead: () => Promise<void>;
  deleteMany: (items: NotificationItem[]) => Promise<void>;
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(
  null,
);

export interface NotificationCenterInitialState {
  items?: NotificationItem[];
  newCount?: number;
  unreadCount?: number;
  isDrawerOpen?: boolean;
  toasts?: NotificationToastItem[];
}

export function NotificationCenterProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: NotificationCenterInitialState;
}) {
  const pathname = usePathname();
  const isDarkDrawer = isTradingTerminalPath(pathname);
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const isSuspended = memberCtx?.snapshot.accountStatus === "SUSPENDED";
  const memberId = memberCtx?.snapshot.memberId ?? null;
  const generation = memberCtx?.snapshot.generation ?? 0;
  const session = memberCtx?.session ?? null;
  const contentBaseUrl = memberCtx?.origin ?? resolveContentOrigin();
  const tradingBaseUrl = DEFAULT_TRADING_API_BASE_URL;

  const [items, setItems] = useState<NotificationItem[]>(
    () => initialState?.items ?? [],
  );
  const [sourceStatus, setSourceStatus] = useState<{
    CONTENT: NotificationStatusDto;
    TRADING: NotificationStatusDto;
  }>(() => ({
    CONTENT: {
      newCount: initialState?.newCount ?? 0,
      hasNew: Boolean((initialState?.newCount ?? 0) > 0),
      unreadCount: initialState?.unreadCount ?? 0,
      hasUnread: Boolean((initialState?.unreadCount ?? 0) > 0),
    },
    TRADING: {
      newCount: 0,
      hasNew: false,
      unreadCount: 0,
      hasUnread: false,
    },
  }));
  const [cursors, setCursors] = useState<DualCursorState>({
    contentCursorId: null,
    contentHasNext: false,
    tradingCursorId: null,
    tradingHasNext: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingAll, setIsReadingAll] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(
    () => initialState?.isDrawerOpen ?? false,
  );
  const [toasts, setToasts] = useState<NotificationToastItem[]>(
    () => initialState?.toasts ?? [],
  );

  const isDrawerOpenRef = useRef(isDrawerOpen);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const seenEventKeysRef = useRef<Set<string>>(new Set());
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    isDrawerOpenRef.current = isDrawerOpen;
  }, [isDrawerOpen]);

  useDimScrollLock(isDrawerOpen);

  const clearAllToasts = useCallback(() => {
    toastTimersRef.current.forEach(timerId => {
      if (typeof window !== "undefined") {
        window.clearTimeout(timerId);
      }
    });
    toastTimersRef.current.clear();
    setToasts([]);
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    const timer = toastTimersRef.current.get(toastId);
    if (timer !== undefined && typeof window !== "undefined") {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(toastId);
    }
    setToasts(prev => prev.filter(t => t.id !== toastId));
  }, []);

  const pushToastForNotification = useCallback(
    (item: NotificationItem) => {
      if (typeof window === "undefined" || isDrawerOpenRef.current || item.isRead) {
        return;
      }
      const activityStamp = getNotificationActivityValue(item);
      const dedupeKey = `${item.uid}:${activityStamp}`;
      if (seenEventKeysRef.current.has(dedupeKey)) {
        return;
      }
      seenEventKeysRef.current.add(dedupeKey);

      const toastId = `toast:${dedupeKey}`;
      const { sideLabel, tone } = getNotificationTradeMeta(item);
      const target = getNotificationNavigationTarget(item);
      const nextToast: NotificationToastItem = {
        id: toastId,
        uid: item.uid,
        source: item.source,
        notificationId: item.notificationId,
        type: item.type,
        category: item.category,
        title: formatNotificationTitle(item),
        description: formatNotificationDescription(item),
        createdAt: activityStamp,
        tradeTone: tone,
        tradeSideLabel: sideLabel,
        href: target?.href ?? "/notifications",
      };

      setToasts(prev => [nextToast, ...prev.filter(t => t.uid !== item.uid)].slice(0, MAX_VISIBLE_TOASTS));

      const existingTimer = toastTimersRef.current.get(toastId);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      const timerId = window.setTimeout(() => {
        toastTimersRef.current.delete(toastId);
        setToasts(prev => prev.filter(t => t.id !== toastId));
      }, TOAST_TTL_MS);
      toastTimersRef.current.set(toastId, timerId);
    },
    [],
  );

  const isSessionActive = Boolean(
    initialState || (phase === "ready" && memberId !== null),
  );

  // Hydrate initial status & page + open dual SSE streams on login
  useEffect(() => {
    if (phase !== "ready" || !session || memberId === null || typeof window === "undefined") {
      return;
    }

    const abortController = new AbortController();
    const activeTimers = toastTimersRef.current;
    const seenKeys = seenEventKeysRef.current;

    void (async () => {
      await Promise.resolve();
      if (abortController.signal.aborted) return;
      setIsLoading(true);
      try {
        const [statusResult, pageResult] = await Promise.all([
          fetchUnifiedNotificationStatus(session, {
            tradingBaseUrl,
            skipTrading: isSuspended,
            signal: abortController.signal,
          }),
          fetchUnifiedNotifications(session, {
            tab: "ALL",
            size: DRAWER_PAGE_SIZE,
            tradingBaseUrl,
            skipTrading: isSuspended,
            signal: abortController.signal,
          }),
        ]);
        if (abortController.signal.aborted) return;
        setSourceStatus({
          CONTENT: statusResult.content,
          TRADING: statusResult.trading,
        });
        pageResult.items.forEach(item => {
          seenKeys.add(
            `${item.uid}:${getNotificationActivityValue(item)}`,
          );
        });
        setItems(pageResult.items);
        setCursors(pageResult.cursors);
      } catch {
        // Silent fallback if backend is unreachable
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();

    const handleSseNotification = (incoming: NotificationItem) => {
      setItems(prev => mergeNotificationsByUid([incoming], prev));
      pushToastForNotification(incoming);
    };

    const handleSseStatus = (
      source: NotificationSource,
      status: NotificationStatusDto,
    ) => {
      setSourceStatus(prev => ({
        ...prev,
        [source]: status,
      }));
    };

    const stopContentSse = startNotificationSseSubscription(
      "CONTENT",
      session,
      contentBaseUrl,
      {
        onNotification: handleSseNotification,
        onStatus: handleSseStatus,
      },
    );
    const stopTradingSse = isSuspended
      ? () => {}
      : startNotificationSseSubscription(
          "TRADING",
          session,
          tradingBaseUrl,
          {
            onNotification: handleSseNotification,
            onStatus: handleSseStatus,
          },
        );

    return () => {
      abortController.abort();
      stopContentSse();
      stopTradingSse();
      activeTimers.forEach(timerId => {
        window.clearTimeout(timerId);
      });
      activeTimers.clear();
      seenKeys.clear();
    };
  }, [
    phase,
    isSuspended,
    session,
    memberId,
    generation,
    contentBaseUrl,
    tradingBaseUrl,
    pushToastForNotification,
  ]);

  const drawerEscapeId = useId();
  const effectiveDrawerOpen = isSessionActive && isDrawerOpen;
  useFocusTrap(effectiveDrawerOpen, drawerPanelRef);

  // Escape key closes ONLY the topmost active overlay (shared stack with DimModal & Mobile Drawer)
  useEffect(() => {
    if (!effectiveDrawerOpen || typeof window === "undefined") return;
    return registerOverlayEscape(drawerEscapeId, () => setIsDrawerOpen(false));
  }, [effectiveDrawerOpen, drawerEscapeId]);

  const effectiveItems = useMemo(
    () => (isSessionActive ? items : []),
    [isSessionActive, items],
  );
  const effectiveToasts = useMemo(
    () => (isSessionActive ? toasts : []),
    [isSessionActive, toasts],
  );
  const newCount = isSessionActive
    ? sourceStatus.CONTENT.newCount + sourceStatus.TRADING.newCount
    : 0;
  const unreadCount = isSessionActive
    ? sourceStatus.CONTENT.unreadCount + sourceStatus.TRADING.unreadCount
    : 0;
  const hasNext =
    isSessionActive && (cursors.contentHasNext || cursors.tradingHasNext);

  const acknowledgeNew = useCallback(async () => {
    setSourceStatus(prev => ({
      CONTENT: { ...prev.CONTENT, newCount: 0, hasNew: false },
      TRADING: { ...prev.TRADING, newCount: 0, hasNew: false },
    }));
    if (!session) return;
    try {
      await checkUnifiedNotifications(session, { tradingBaseUrl, skipTrading: isSuspended });
    } catch {
      // Non-blocking badge acknowledgement
    }
  }, [session, tradingBaseUrl, isSuspended]);

  const refreshLatest = useCallback(async () => {
    if (!session || phase !== "ready") return;
    setIsLoading(true);
    try {
      const [statusResult, pageResult] = await Promise.all([
        fetchUnifiedNotificationStatus(session, { tradingBaseUrl, skipTrading: isSuspended }),
        fetchUnifiedNotifications(session, {
          tab: "ALL",
          size: DRAWER_PAGE_SIZE,
          tradingBaseUrl,
          skipTrading: isSuspended,
        }),
      ]);
      setSourceStatus({
        CONTENT: statusResult.content,
        TRADING: statusResult.trading,
      });
      setItems(pageResult.items);
      setCursors(pageResult.cursors);
    } finally {
      setIsLoading(false);
    }
  }, [session, phase, tradingBaseUrl, isSuspended]);

  const loadMoreDrawer = useCallback(async () => {
    if (!session || !hasNext || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const pageResult = await fetchUnifiedNotifications(session, {
        tab: "ALL",
        size: DRAWER_PAGE_SIZE,
        cursors,
        tradingBaseUrl,
        skipTrading: isSuspended,
      });
      setItems(prev => mergeNotificationsByUid(prev, pageResult.items));
      setCursors(pageResult.cursors);
    } finally {
      setIsLoadingMore(false);
    }
  }, [session, hasNext, isLoadingMore, cursors, tradingBaseUrl, isSuspended]);

  const markOneAsRead = useCallback(
    async (item: NotificationItem) => {
      if (item.isRead) return;
      const prevItems = items;
      const prevStatus = sourceStatus;
      setItems(prev =>
        prev.map(existing =>
          existing.uid === item.uid ? { ...existing, isRead: true } : existing,
        ),
      );
      setSourceStatus(prev => ({
        ...prev,
        [item.source]: {
          ...prev[item.source],
          unreadCount: Math.max(0, prev[item.source].unreadCount - 1),
          hasUnread: Math.max(0, prev[item.source].unreadCount - 1) > 0,
        },
      }));
      if (!session) return;
      try {
        await markUnifiedNotificationRead(session, item, { tradingBaseUrl });
      } catch (err) {
        setItems(prevItems);
        setSourceStatus(prevStatus);
        throw err;
      }
    },
    [items, sourceStatus, session, tradingBaseUrl],
  );

  const markManyAsRead = useCallback(
    async (targets: NotificationItem[]) => {
      const unreadTargets = targets.filter(t => !t.isRead);
      if (unreadTargets.length === 0) return;
      const prevItems = items;
      const prevStatus = sourceStatus;
      const uidSet = new Set(unreadTargets.map(t => t.uid));
      const contentDelta = unreadTargets.filter(t => t.source === "CONTENT").length;
      const tradingDelta = unreadTargets.filter(t => t.source === "TRADING").length;

      setItems(prev =>
        prev.map(existing =>
          uidSet.has(existing.uid) ? { ...existing, isRead: true } : existing,
        ),
      );
      setSourceStatus(prev => ({
        CONTENT: {
          ...prev.CONTENT,
          unreadCount: Math.max(0, prev.CONTENT.unreadCount - contentDelta),
          hasUnread: Math.max(0, prev.CONTENT.unreadCount - contentDelta) > 0,
        },
        TRADING: {
          ...prev.TRADING,
          unreadCount: Math.max(0, prev.TRADING.unreadCount - tradingDelta),
          hasUnread: Math.max(0, prev.TRADING.unreadCount - tradingDelta) > 0,
        },
      }));
      if (!session) return;
      try {
        await markSelectedUnifiedNotificationsRead(session, unreadTargets, {
          tradingBaseUrl,
        });
      } catch (err) {
        setItems(prevItems);
        setSourceStatus(prevStatus);
        throw err;
      }
    },
    [items, sourceStatus, session, tradingBaseUrl],
  );

  const markAllAsRead = useCallback(async () => {
    const prevItems = items;
    const prevStatus = sourceStatus;
    setIsReadingAll(true);
    setItems(prev => prev.map(existing => ({ ...existing, isRead: true })));
    setSourceStatus({
      CONTENT: { newCount: 0, hasNew: false, unreadCount: 0, hasUnread: false },
      TRADING: { newCount: 0, hasNew: false, unreadCount: 0, hasUnread: false },
    });
    try {
      if (session) {
        await Promise.all([
          checkUnifiedNotifications(session, { tradingBaseUrl, skipTrading: isSuspended }),
          markAllUnifiedNotificationsRead(session, { tradingBaseUrl, skipTrading: isSuspended }),
        ]);
      }
    } catch (err) {
      setItems(prevItems);
      setSourceStatus(prevStatus);
      throw err;
    } finally {
      setIsReadingAll(false);
    }
  }, [items, sourceStatus, session, tradingBaseUrl, isSuspended]);

  const deleteRead = useCallback(async () => {
    const prevItems = items;
    setItems(prev => prev.filter(existing => !existing.isRead));
    if (!session) return;
    try {
      await checkUnifiedNotifications(session, { tradingBaseUrl, skipTrading: isSuspended });
      await deleteReadUnifiedNotifications(session, { tradingBaseUrl, skipTrading: isSuspended });
    } catch (err) {
      setItems(prevItems);
      throw err;
    }
  }, [items, session, tradingBaseUrl, isSuspended]);

  const deleteMany = useCallback(
    async (targets: NotificationItem[]) => {
      if (targets.length === 0) return;
      const prevItems = items;
      const prevStatus = sourceStatus;
      const uidSet = new Set(targets.map(t => t.uid));
      const unreadContentDelta = targets.filter(
        t => !t.isRead && t.source === "CONTENT",
      ).length;
      const unreadTradingDelta = targets.filter(
        t => !t.isRead && t.source === "TRADING",
      ).length;

      setItems(prev => prev.filter(existing => !uidSet.has(existing.uid)));
      setSourceStatus(prev => ({
        CONTENT: {
          ...prev.CONTENT,
          unreadCount: Math.max(0, prev.CONTENT.unreadCount - unreadContentDelta),
          hasUnread: Math.max(0, prev.CONTENT.unreadCount - unreadContentDelta) > 0,
        },
        TRADING: {
          ...prev.TRADING,
          unreadCount: Math.max(0, prev.TRADING.unreadCount - unreadTradingDelta),
          hasUnread: Math.max(0, prev.TRADING.unreadCount - unreadTradingDelta) > 0,
        },
      }));
      if (!session) return;
      try {
        await deleteSelectedUnifiedNotifications(session, targets, {
          tradingBaseUrl,
        });
      } catch (err) {
        setItems(prevItems);
        setSourceStatus(prevStatus);
        throw err;
      }
    },
    [items, sourceStatus, session, tradingBaseUrl],
  );

  const openDrawer = useCallback(() => {
    clearAllToasts();
    setIsDrawerOpen(true);
    void acknowledgeNew();
  }, [acknowledgeNew, clearAllToasts]);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const toggleDrawer = useCallback(() => {
    if (isDrawerOpenRef.current) {
      setIsDrawerOpen(false);
      return;
    }
    openDrawer();
  }, [openDrawer]);

  const handleSelectDrawerNotification = useCallback(
    (notification: NotificationItem) => {
      void markOneAsRead(notification).catch(() => {});
      setIsDrawerOpen(false);
    },
    [markOneAsRead],
  );

  const handleSelectToast = useCallback(
    (toast: NotificationToastItem) => {
      const matched = items.find(i => i.uid === toast.uid);
      if (matched) {
        void markOneAsRead(matched).catch(() => {});
      } else if (session) {
        void markUnifiedNotificationRead(
          session,
          { source: toast.source, notificationId: toast.notificationId },
          { tradingBaseUrl },
        ).catch(() => {});
      }
    },
    [items, markOneAsRead, session, tradingBaseUrl],
  );

  const value = useMemo<NotificationCenterValue>(
    () => ({
      items: effectiveItems,
      newCount,
      unreadCount,
      isLoading,
      isReadingAll,
      isLoadingMore,
      hasNext,
      isDrawerOpen: effectiveDrawerOpen,
      toasts: effectiveToasts,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      dismissToast,
      acknowledgeNew,
      refreshLatest,
      loadMoreDrawer,
      markOneAsRead,
      markManyAsRead,
      markAllAsRead,
      deleteRead,
      deleteMany,
    }),
    [
      effectiveItems,
      newCount,
      unreadCount,
      isLoading,
      isReadingAll,
      isLoadingMore,
      hasNext,
      effectiveDrawerOpen,
      effectiveToasts,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      dismissToast,
      acknowledgeNew,
      refreshLatest,
      loadMoreDrawer,
      markOneAsRead,
      markManyAsRead,
      markAllAsRead,
      deleteRead,
      deleteMany,
    ],
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}

      <NotificationToastStack
        toasts={effectiveToasts}
        onDismiss={dismissToast}
        onSelectToast={handleSelectToast}
      />

      {effectiveDrawerOpen
        ? (() => {
            const drawerNode = (
              <div className="fixed inset-0 z-[80]" data-dim-modal="open">
                <div
                  className="fixed inset-0 z-[80] bg-black/35 backdrop-blur-[1px] transition-opacity cursor-pointer"
                  onClick={closeDrawer}
                />
                <div
                  ref={drawerPanelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="실시간 알림 패널"
                  className={
                    isDarkDrawer
                      ? "fixed bottom-0 right-0 top-0 z-[81] h-dvh w-full max-w-sm border-l border-[#2B3139] bg-[#161A1E]"
                      : "fixed bottom-0 right-0 top-0 z-[81] h-dvh w-full max-w-sm border-l border-gray-200 bg-white"
                  }
                >
                  <NotificationDrawer
                    notifications={effectiveItems}
                    isLoading={isLoading}
                    isReadingAll={isReadingAll}
                    isLoadingMore={isLoadingMore}
                    hasNext={hasNext}
                    isDark={isDarkDrawer}
                    onClose={closeDrawer}
                    onSelectNotification={handleSelectDrawerNotification}
                    onAcknowledgeNewNotifications={() => void acknowledgeNew()}
                    onReadAll={() => void markAllAsRead().catch(() => {})}
                    onLoadMore={() => void loadMoreDrawer().catch(() => {})}
                  />
                </div>
              </div>
            );
            if (typeof document !== "undefined" && document.body) {
              return createPortal(drawerNode, document.body);
            }
            return drawerNode;
          })()
        : null}
    </NotificationCenterContext.Provider>
  );
}

export function useOptionalNotificationCenter(): NotificationCenterValue | null {
  return useContext(NotificationCenterContext);
}

export function useNotificationCenter(): NotificationCenterValue {
  const ctx = useContext(NotificationCenterContext);
  if (!ctx) {
    throw new Error("NotificationCenterProvider required");
  }
  return ctx;
}
