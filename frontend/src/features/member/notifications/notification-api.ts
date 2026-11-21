import { ContentApiError, contentOrigin } from "../api/client";
import type { MemberSession } from "../api/session";
import { tradingOrigin } from "../../trading/api/client";
import { DEFAULT_TRADING_API_BASE_URL } from "../../contest/api/contest-client";
import type {
  NotificationItem,
  NotificationListTabValue,
  NotificationPageDto,
  NotificationSource,
  NotificationStatusDto,
  RawNotificationDto,
} from "./notification-types";
import {
  mergeNotificationsByUid,
  normalizeRawNotification,
} from "./notification-utils";

export interface DualCursorState {
  contentCursorId: number | null;
  contentHasNext: boolean;
  tradingCursorId: number | null;
  tradingHasNext: boolean;
}

export interface UnifiedNotificationPageResult {
  items: NotificationItem[];
  cursors: DualCursorState;
  hasNext: boolean;
}

function parseStatusDto(raw: unknown): NotificationStatusDto {
  if (!raw || typeof raw !== "object") {
    return { newCount: 0, hasNew: false, unreadCount: 0, hasUnread: false };
  }
  const r = raw as Record<string, unknown>;
  const newCount = typeof r.newCount === "number" && Number.isFinite(r.newCount) ? r.newCount : 0;
  const unreadCount =
    typeof r.unreadCount === "number" && Number.isFinite(r.unreadCount) ? r.unreadCount : 0;
  return {
    newCount,
    hasNew: Boolean(r.hasNew ?? newCount > 0),
    unreadCount,
    hasUnread: Boolean(r.hasUnread ?? unreadCount > 0),
  };
}

function parsePageDto(raw: unknown): NotificationPageDto {
  if (!raw || typeof raw !== "object") {
    return { content: [], nextCursorId: null, hasNext: false };
  }
  const r = raw as Record<string, unknown>;
  const content = Array.isArray(r.content)
    ? (r.content.filter(
        item =>
          item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).notificationId === "number",
      ) as RawNotificationDto[])
    : [];
  const nextCursorId =
    typeof r.nextCursorId === "number" && Number.isFinite(r.nextCursorId)
      ? r.nextCursorId
      : null;
  return {
    content,
    nextCursorId,
    hasNext: Boolean(r.hasNext && nextCursorId !== null),
  };
}

async function tradingNotificationRequest(
  session: MemberSession,
  path: string,
  options: {
    baseUrl?: string;
    method?: "GET" | "PUT" | "DELETE";
    body?: object;
    signal?: AbortSignal;
    transport?: typeof fetch;
  } = {},
): Promise<unknown> {
  const origin = tradingOrigin(options.baseUrl ?? DEFAULT_TRADING_API_BASE_URL);
  const transport = options.transport ?? fetch;
  const method = options.method ?? "GET";
  return session.authorized(async current => {
    const response = await transport(`${origin}/api/v1/trading/notifications${path}`, {
      method,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(options.signal ? [options.signal] : []),
      ]),
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (response.status === 401) {
      throw new ContentApiError(401, "INVALID_ACCESS_TOKEN");
    }
    if (!response.ok) {
      throw new Error(`Trading notification HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }, method === "GET");
}

export async function fetchUnifiedNotificationStatus(
  session: MemberSession,
  options: {
    tradingBaseUrl?: string;
    signal?: AbortSignal;
    transport?: typeof fetch;
  } = {},
): Promise<{
  total: NotificationStatusDto;
  content: NotificationStatusDto;
  trading: NotificationStatusDto;
}> {
  const [contentRes, tradingRes] = await Promise.allSettled([
    session.request("/notifications/status", { signal: options.signal }),
    tradingNotificationRequest(session, "/status", {
      baseUrl: options.tradingBaseUrl,
      signal: options.signal,
      transport: options.transport,
    }),
  ]);

  const content =
    contentRes.status === "fulfilled"
      ? parseStatusDto(contentRes.value)
      : { newCount: 0, hasNew: false, unreadCount: 0, hasUnread: false };
  const trading =
    tradingRes.status === "fulfilled"
      ? parseStatusDto(tradingRes.value)
      : { newCount: 0, hasNew: false, unreadCount: 0, hasUnread: false };

  const newCount = content.newCount + trading.newCount;
  const unreadCount = content.unreadCount + trading.unreadCount;
  return {
    total: {
      newCount,
      hasNew: newCount > 0,
      unreadCount,
      hasUnread: unreadCount > 0,
    },
    content,
    trading,
  };
}

export async function fetchUnifiedNotifications(
  session: MemberSession,
  options: {
    tab?: NotificationListTabValue;
    size?: number;
    read?: boolean;
    cursors?: Partial<DualCursorState>;
    tradingBaseUrl?: string;
    signal?: AbortSignal;
    transport?: typeof fetch;
  } = {},
): Promise<UnifiedNotificationPageResult> {
  const tab = options.tab ?? "ALL";
  const size = options.size ?? 20;

  const shouldFetchContent =
    (tab === "ALL" || tab === "COMMUNITY") &&
    (options.cursors?.contentHasNext !== false);
  const shouldFetchTrading =
    (tab === "ALL" || tab === "MOCK" || tab === "CONTEST") &&
    (options.cursors?.tradingHasNext !== false);

  const contentParams = new URLSearchParams({ size: String(size) });
  if (options.cursors?.contentCursorId) {
    contentParams.set("cursorId", String(options.cursors.contentCursorId));
  }
  if (typeof options.read === "boolean") {
    contentParams.set("read", String(options.read));
  }

  const tradingParams = new URLSearchParams({ size: String(size) });
  if (options.cursors?.tradingCursorId) {
    tradingParams.set("cursorId", String(options.cursors.tradingCursorId));
  }
  if (tab === "MOCK" || tab === "CONTEST") {
    tradingParams.set("category", tab);
  }
  if (typeof options.read === "boolean") {
    tradingParams.set("read", String(options.read));
  }

  const [contentRes, tradingRes] = await Promise.allSettled([
    shouldFetchContent
      ? session.request(`/notifications?${contentParams.toString()}`, {
          signal: options.signal,
        })
      : Promise.resolve(null),
    shouldFetchTrading
      ? tradingNotificationRequest(session, `?${tradingParams.toString()}`, {
          baseUrl: options.tradingBaseUrl,
          signal: options.signal,
          transport: options.transport,
        })
      : Promise.resolve(null),
  ]);

  const contentPage =
    shouldFetchContent && contentRes.status === "fulfilled" && contentRes.value
      ? parsePageDto(contentRes.value)
      : { content: [], nextCursorId: null, hasNext: false };
  const tradingPage =
    shouldFetchTrading && tradingRes.status === "fulfilled" && tradingRes.value
      ? parsePageDto(tradingRes.value)
      : { content: [], nextCursorId: null, hasNext: false };

  const contentItems = contentPage.content.map(item =>
    normalizeRawNotification("CONTENT", item),
  );
  const tradingItems = tradingPage.content.map(item =>
    normalizeRawNotification("TRADING", item),
  );

  const cursors: DualCursorState = {
    contentCursorId: contentPage.nextCursorId,
    contentHasNext: contentPage.hasNext,
    tradingCursorId: tradingPage.nextCursorId,
    tradingHasNext: tradingPage.hasNext,
  };

  return {
    items: mergeNotificationsByUid(contentItems, tradingItems),
    cursors,
    hasNext: cursors.contentHasNext || cursors.tradingHasNext,
  };
}

export async function checkUnifiedNotifications(
  session: MemberSession,
  options: { tradingBaseUrl?: string; transport?: typeof fetch } = {},
): Promise<void> {
  await Promise.allSettled([
    session.request("/notifications/check", { method: "PUT" }),
    tradingNotificationRequest(session, "/check", {
      baseUrl: options.tradingBaseUrl,
      method: "PUT",
      transport: options.transport,
    }),
  ]);
}

export async function markUnifiedNotificationRead(
  session: MemberSession,
  item: Pick<NotificationItem, "source" | "notificationId">,
  options: { tradingBaseUrl?: string; transport?: typeof fetch } = {},
): Promise<void> {
  if (item.source === "CONTENT") {
    await session.request(`/notifications/${item.notificationId}/read`, { method: "PUT" });
    return;
  }
  await tradingNotificationRequest(session, `/${item.notificationId}/read`, {
    baseUrl: options.tradingBaseUrl,
    method: "PUT",
    transport: options.transport,
  });
}

export async function markSelectedUnifiedNotificationsRead(
  session: MemberSession,
  items: Array<Pick<NotificationItem, "source" | "notificationId">>,
  options: { tradingBaseUrl?: string; transport?: typeof fetch } = {},
): Promise<void> {
  const contentIds = items
    .filter(i => i.source === "CONTENT")
    .map(i => i.notificationId);
  const tradingIds = items
    .filter(i => i.source === "TRADING")
    .map(i => i.notificationId);

  await Promise.allSettled([
    contentIds.length > 0
      ? session.request("/notifications/read", {
          method: "PUT",
          body: { notificationIds: contentIds },
        })
      : Promise.resolve(null),
    tradingIds.length > 0
      ? tradingNotificationRequest(session, "/read", {
          baseUrl: options.tradingBaseUrl,
          method: "PUT",
          body: { notificationIds: tradingIds },
          transport: options.transport,
        })
      : Promise.resolve(null),
  ]);
}

export async function markAllUnifiedNotificationsRead(
  session: MemberSession,
  options: { tradingBaseUrl?: string; transport?: typeof fetch } = {},
): Promise<void> {
  await Promise.allSettled([
    session.request("/notifications/read-all", { method: "PUT" }),
    tradingNotificationRequest(session, "/read-all", {
      baseUrl: options.tradingBaseUrl,
      method: "PUT",
      transport: options.transport,
    }),
  ]);
}

export async function deleteReadUnifiedNotifications(
  session: MemberSession,
  options: { tradingBaseUrl?: string; transport?: typeof fetch } = {},
): Promise<void> {
  await Promise.allSettled([
    session.request("/notifications/read", { method: "DELETE" }),
    tradingNotificationRequest(session, "/read", {
      baseUrl: options.tradingBaseUrl,
      method: "DELETE",
      transport: options.transport,
    }),
  ]);
}

export async function deleteSelectedUnifiedNotifications(
  session: MemberSession,
  items: Array<Pick<NotificationItem, "source" | "notificationId">>,
  options: { tradingBaseUrl?: string; transport?: typeof fetch } = {},
): Promise<void> {
  const contentIds = items
    .filter(i => i.source === "CONTENT")
    .map(i => i.notificationId);
  const tradingIds = items
    .filter(i => i.source === "TRADING")
    .map(i => i.notificationId);

  await Promise.allSettled([
    contentIds.length > 0
      ? session.request("/notifications", {
          method: "DELETE",
          body: { notificationIds: contentIds },
        })
      : Promise.resolve(null),
    tradingIds.length > 0
      ? tradingNotificationRequest(session, "", {
          baseUrl: options.tradingBaseUrl,
          method: "DELETE",
          body: { notificationIds: tradingIds },
          transport: options.transport,
        })
      : Promise.resolve(null),
  ]);
}

export interface NotificationSseCallbacks {
  onNotification: (item: NotificationItem) => void;
  onStatus: (source: NotificationSource, status: NotificationStatusDto) => void;
}

export function isNotificationStatusEventName(eventName: string): boolean {
  return eventName === "STATUS" || eventName === "NOTIFICATION_STATUS";
}

export function dispatchNotificationSseEvent(
  source: NotificationSource,
  eventName: string,
  rawData: string,
  callbacks: NotificationSseCallbacks,
): void {
  if (!rawData || eventName === "CONNECTED" || eventName === "HEARTBEAT") {
    return;
  }
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (isNotificationStatusEventName(eventName)) {
      callbacks.onStatus(source, parseStatusDto(parsed));
      return;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).notificationId === "number"
    ) {
      callbacks.onNotification(
        normalizeRawNotification(source, parsed as RawNotificationDto),
      );
    }
  } catch {
    // Ignore malformed keepalive frames
  }
}

export function startNotificationSseSubscription(
  source: NotificationSource,
  session: MemberSession,
  baseUrl: string,
  callbacks: NotificationSseCallbacks,
  transport: typeof fetch = fetch,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  let stopped = false;
  let activeController: AbortController | null = null;
  let reconnectTimer: number | null = null;
  let lastEventId: string | null = null;
  let attempt = 0;

  const subscribeUrl =
    source === "CONTENT"
      ? `${contentOrigin(baseUrl)}/api/v1/notifications/subscribe`
      : `${tradingOrigin(baseUrl)}/api/v1/trading/notifications/subscribe`;

  const scheduleReconnect = () => {
    if (stopped) return;
    const delayMs = Math.min(15_000, 1500 * Math.pow(2, Math.min(attempt, 3)));
    attempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void runLoop();
    }, delayMs);
  };

  const handleParsedEvent = (eventName: string, eventId: string, rawData: string) => {
    if (eventId) {
      lastEventId = eventId;
    }
    dispatchNotificationSseEvent(source, eventName, rawData, callbacks);
  };

  const runLoop = async () => {
    if (stopped) return;
    const controller = new AbortController();
    activeController = controller;

    try {
      const response = await session.authorized(async current => {
        const res = await transport(subscribeUrl, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${current.accessToken}`,
            ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
          },
        });
        if (res.status === 401) {
          throw new ContentApiError(401, "INVALID_ACCESS_TOKEN");
        }
        return res;
      }, true);

      if (!response.ok || !response.body) {
        scheduleReconnect();
        return;
      }

      attempt = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let currentEvent = "message";
      let currentId = "";
      let dataLines: string[] = [];

      const flushFrame = () => {
        if (dataLines.length > 0) {
          handleParsedEvent(currentEvent, currentId, dataLines.join("\n"));
        }
        currentEvent = "message";
        currentId = "";
        dataLines = [];
      };

      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          if (rawLine === "") {
            flushFrame();
          } else if (!rawLine.startsWith(":")) {
            const colonIndex = rawLine.indexOf(":");
            const field = colonIndex >= 0 ? rawLine.slice(0, colonIndex) : rawLine;
            const rawVal =
              colonIndex >= 0
                ? rawLine.slice(colonIndex + 1).replace(/^ /, "")
                : "";
            if (field === "event") {
              currentEvent = rawVal || "message";
            } else if (field === "id") {
              currentId = rawVal;
            } else if (field === "data") {
              dataLines.push(rawVal);
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }

      if (!stopped) {
        scheduleReconnect();
      }
    } catch {
      if (!stopped) {
        scheduleReconnect();
      }
    }
  };

  void runLoop();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    activeController?.abort();
    activeController = null;
  };
}
