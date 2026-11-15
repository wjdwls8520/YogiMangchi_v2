import type {
  NotificationCategory,
  NotificationDetailField,
  NotificationItem,
  NotificationListTabValue,
  NotificationNavigationTarget,
  NotificationPayload,
  NotificationSource,
  NotificationTradeTone,
  RawNotificationDto,
} from "./notification-types";

const CATEGORY_LABELS: Record<string, string> = {
  MOCK: "모의투자",
  CONTEST: "대회",
  COMMUNITY: "커뮤니티",
  FOLLOW: "팔로우",
  REPORT: "신고",
};

const SIDE_LABELS: Record<string, string> = {
  BUY: "매수",
  SELL: "매도",
  LONG: "Long",
  SHORT: "Short",
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  MARKET: "시장가",
  LIMIT: "지정가",
  STOP_MARKET: "손절",
  STOP_LOSS: "손절",
};

const TYPE_LABELS: Record<string, string> = {
  ORDER_COMPLETED: "주문 체결",
  ORDER_CANCELED: "주문 취소",
  LIQUIDATION_COMPLETED: "강제청산",
  CONTEST_APPLICATION_APPROVED: "대회 신청 승인",
  CONTEST_APPLICATION_REJECTED: "대회 신청 반려",
  CONTEST_SEASON_SETTLED: "대회 정산 완료",
  POST_COMMENT_CREATED: "게시글 댓글",
  REPLY_COMMENT_CREATED: "답글·멘션",
  POST_LIKED: "게시글 좋아요",
  REPLY_LIKED: "댓글 좋아요",
  FOLLOW_CREATED: "팔로우",
};

export function makeNotificationUid(source: NotificationSource, notificationId: number): string {
  return `${source}:${notificationId}`;
}

export function normalizeRawNotification(
  source: NotificationSource,
  raw: RawNotificationDto,
): NotificationItem {
  return {
    uid: makeNotificationUid(source, raw.notificationId),
    source,
    notificationId: raw.notificationId,
    actorMemberId: raw.actorMemberId ?? null,
    category: raw.category,
    type: raw.type,
    isRead: Boolean(raw.isRead),
    createdAt: raw.createdAt,
    lastEventAt: raw.lastEventAt ?? null,
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : null,
  };
}

export function formatNotificationCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  return count > 99 ? "99+" : String(Math.floor(count));
}

export function formatNotificationNumber(
  value: number | string | null | undefined,
  maxDecimals = 4,
): string {
  if (value === null || value === undefined || value === "") return "-";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  const abs = Math.abs(num);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? Math.min(maxDecimals, 4) : Math.min(maxDecimals, 6);
  return num.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatSignedNotificationNumber(
  value: number | string | null | undefined,
  maxDecimals = 2,
): string {
  if (value === null || value === undefined || value === "") return "-";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  const formatted = formatNotificationNumber(num, maxDecimals);
  return num > 0 ? `+${formatted}` : formatted;
}

function getPayloadRecord(payload?: NotificationPayload | null): NotificationPayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload;
}

function getPayloadString(
  payload: NotificationPayload | null | undefined,
  ...keys: string[]
): string | null {
  const record = getPayloadRecord(payload);
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getPayloadBoolean(
  payload: NotificationPayload | null | undefined,
  ...keys: string[]
): boolean {
  const record = getPayloadRecord(payload);
  for (const key of keys) {
    const value = record?.[key];
    if (value === true || value === "true") return true;
  }
  return false;
}

function getPayloadNumericValue(
  payload: NotificationPayload | null | undefined,
  ...keys: string[]
): number | null {
  const record = getPayloadRecord(payload);
  for (const key of keys) {
    const raw = record?.[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function getPayloadStringListFirst(
  payload: NotificationPayload | null | undefined,
  ...keys: string[]
): string | null {
  const record = getPayloadRecord(payload);
  for (const key of keys) {
    const value = record?.[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        for (const field of ["nickname", "nickName", "memberNickname", "name"]) {
          if (typeof obj[field] === "string" && (obj[field] as string).trim()) {
            return (obj[field] as string).trim();
          }
        }
      }
    }
  }
  return null;
}

function normalizeText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function summarizeText(value: string | null, maxLength = 24): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function getDisplayTarget(notification: NotificationItem): string | null {
  return (
    getPayloadString(notification.payload, "displayNameKr", "baseSymbol", "symbol") ?? null
  );
}

function getActorName(notification: NotificationItem): string {
  return (
    getPayloadString(
      notification.payload,
      "actorNickname",
      "latestActorNickname",
      "recentActorNickname",
      "firstActorNickname",
      "senderNickname",
      "likerNickname",
      "nickname",
      "memberNickname",
      "writerNickname",
      "actorName",
    ) ??
    getPayloadStringListFirst(
      notification.payload,
      "actorsPreview",
      "actorNicknames",
      "memberNicknames",
      "likerNicknames",
      "actors",
    ) ??
    "다른 회원"
  );
}

function getPostTitle(notification: NotificationItem): string | null {
  return getPayloadString(
    notification.payload,
    "postTitle",
    "targetPostTitle",
    "title",
    "communityTitle",
  );
}

function getRawContent(notification: NotificationItem): string | null {
  return normalizeText(
    getPayloadString(
      notification.payload,
      "replyContentPreview",
      "content",
      "replyContent",
      "commentContent",
      "message",
    ),
  );
}

function getGroupedLikeCount(notification: NotificationItem): number | null {
  if (notification.type !== "POST_LIKED" && notification.type !== "REPLY_LIKED") {
    return null;
  }
  return getPayloadNumericValue(
    notification.payload,
    "groupCount",
    "totalActorCount",
    "likeGroupCount",
    "aggregatedCount",
    "actorCount",
    "likeCount",
    "count",
  );
}

function getOrderTypeLabel(notification: NotificationItem): string | null {
  const rawOrderType = getPayloadString(notification.payload, "orderType", "type");
  if (!rawOrderType) return null;
  return ORDER_TYPE_LABELS[rawOrderType] ?? rawOrderType;
}

function getOrderSideLabel(notification: NotificationItem): string | null {
  const rawSide = getPayloadString(notification.payload, "positionSide", "side");
  if (!rawSide) return null;
  const sideLabel = SIDE_LABELS[rawSide] ?? rawSide;
  const action = getPayloadString(notification.payload, "positionAction", "positionStatus", "action");
  if (action === "OPEN") return `${sideLabel} / Open`;
  if (action === "CLOSE") return `${sideLabel} / Close`;
  return sideLabel;
}

function getOrderSideTone(notification: NotificationItem): NotificationTradeTone {
  const type = notification.type;
  if (type.includes("LIQUIDATION_COMPLETED")) return "warning";
  if (type === "CONTEST_SEASON_SETTLED") return "info";
  const rawSide = getPayloadString(notification.payload, "positionSide", "side");
  if (rawSide === "LONG") return "long";
  if (rawSide === "SHORT") return "short";
  if (rawSide === "BUY") return "buy";
  if (rawSide === "SELL") return "sell";
  return null;
}

export function getNotificationCategoryLabel(category: NotificationCategory): string {
  return CATEGORY_LABELS[category] ?? "알림";
}

export function getNotificationTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "일반 알림";
}

export function getNotificationActivityValue(notification: NotificationItem): string {
  return notification.lastEventAt ?? notification.createdAt;
}

export function getNotificationActivityTime(notification: NotificationItem): number {
  const ms = new Date(getNotificationActivityValue(notification)).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function sortNotificationsByNewestActivity(
  notifications: NotificationItem[],
): NotificationItem[] {
  return [...notifications].sort((a, b) => {
    const diff = getNotificationActivityTime(b) - getNotificationActivityTime(a);
    if (diff !== 0) return diff;
    return b.notificationId - a.notificationId;
  });
}

export function mergeNotificationsByUid(
  ...groups: NotificationItem[][]
): NotificationItem[] {
  const merged = new Map<string, NotificationItem>();
  for (const group of groups) {
    for (const item of group) {
      merged.set(item.uid, item);
    }
  }
  return sortNotificationsByNewestActivity(Array.from(merged.values()));
}

export function isTradeNotification(notification: Pick<NotificationItem, "type">): boolean {
  const t = notification.type;
  return (
    t.includes("ORDER_COMPLETED") ||
    t.includes("ORDER_CANCELED") ||
    t.includes("LIQUIDATION_COMPLETED") ||
    t === "CONTEST_SEASON_SETTLED"
  );
}

export function isCommentNotification(notification: Pick<NotificationItem, "type">): boolean {
  return (
    notification.type === "POST_COMMENT_CREATED" ||
    notification.type === "REPLY_COMMENT_CREATED"
  );
}

export function getNotificationTradeMeta(notification: NotificationItem): {
  sideLabel: string | null;
  tone: NotificationTradeTone;
} {
  if (!isTradeNotification(notification)) {
    return { sideLabel: null, tone: null };
  }
  if (notification.type.includes("LIQUIDATION_COMPLETED")) {
    const rawSide = getPayloadString(notification.payload, "positionSide", "side");
    const sideText = rawSide ? (SIDE_LABELS[rawSide] ?? rawSide) : null;
    return {
      sideLabel: sideText ? `${sideText} · 강제청산` : "강제청산",
      tone: "warning",
    };
  }
  if (notification.type === "CONTEST_SEASON_SETTLED") {
    const rank = getPayloadNumericValue(notification.payload, "finalRank", "rank");
    return {
      sideLabel: rank !== null ? `최종 ${rank}위` : "정산 완료",
      tone: "info",
    };
  }
  const baseSide = getOrderSideLabel(notification);
  const orderTypeLabel = getOrderTypeLabel(notification);
  return {
    sideLabel:
      baseSide && orderTypeLabel ? `${baseSide} · ${orderTypeLabel}` : (baseSide ?? orderTypeLabel),
    tone: getOrderSideTone(notification),
  };
}

export function getNotificationTradeToneStyles(tone: NotificationTradeTone) {
  switch (tone) {
    case "buy":
      return {
        accent: "bg-[#E12343]",
        dot: "bg-[#E12343]",
        unreadSurface: "bg-[#E12343]/[0.03]",
        highlightSurface: "bg-[#E12343]/[0.08]",
        badge: "bg-[#E12343]/10 text-[#E12343]",
        icon: "bg-[#E12343]/10 text-[#E12343]",
      } as const;
    case "sell":
      return {
        accent: "bg-[#1763B6]",
        dot: "bg-[#1763B6]",
        unreadSurface: "bg-[#1763B6]/[0.03]",
        highlightSurface: "bg-[#1763B6]/[0.08]",
        badge: "bg-[#1763B6]/10 text-[#1763B6]",
        icon: "bg-[#1763B6]/10 text-[#1763B6]",
      } as const;
    case "long":
      return {
        accent: "bg-[#2EBD85]",
        dot: "bg-[#2EBD85]",
        unreadSurface: "bg-[#2EBD85]/[0.03]",
        highlightSurface: "bg-[#2EBD85]/[0.08]",
        badge: "bg-[#2EBD85]/10 text-[#2EBD85]",
        icon: "bg-[#2EBD85]/10 text-[#2EBD85]",
      } as const;
    case "short":
      return {
        accent: "bg-[#F6465D]",
        dot: "bg-[#F6465D]",
        unreadSurface: "bg-[#F6465D]/[0.03]",
        highlightSurface: "bg-[#F6465D]/[0.08]",
        badge: "bg-[#F6465D]/10 text-[#F6465D]",
        icon: "bg-[#F6465D]/10 text-[#F6465D]",
      } as const;
    case "warning":
      return {
        accent: "bg-[#F0B90B]",
        dot: "bg-[#F0B90B]",
        unreadSurface: "bg-[#F0B90B]/[0.04]",
        highlightSurface: "bg-[#F0B90B]/[0.1]",
        badge: "bg-[#F0B90B]/15 text-[#B45309] font-bold",
        icon: "bg-[#F0B90B]/15 text-[#D97706]",
      } as const;
    case "info":
      return {
        accent: "bg-[#0058FF]",
        dot: "bg-[#0058FF]",
        unreadSurface: "bg-[#0058FF]/[0.03]",
        highlightSurface: "bg-[#0058FF]/[0.08]",
        badge: "bg-[#0058FF]/10 text-[#0058FF] font-bold",
        icon: "bg-[#0058FF]/10 text-[#0058FF]",
      } as const;
    default:
      return {
        accent: "bg-[#0058FF]",
        dot: "bg-[#0058FF]",
        unreadSurface: "bg-blue-50/40",
        highlightSurface: "bg-blue-50/80",
        badge: "bg-gray-100 text-gray-600",
        icon: "bg-blue-50 text-[#0058FF]",
      } as const;
  }
}

export function formatNotificationTitle(notification: NotificationItem): string {
  const target = getDisplayTarget(notification);
  const actorName = getActorName(notification);
  const contentSummary = summarizeText(getRawContent(notification));
  const postTitleSummary = summarizeText(getPostTitle(notification));
  const groupedCount = getGroupedLikeCount(notification);
  const extraLikes = groupedCount !== null && groupedCount > 1 ? groupedCount - 1 : 0;
  const groupedActorLabel =
    actorName === "다른 회원"
      ? `회원 ${formatNotificationCount(extraLikes + 1)}명`
      : `${actorName}님 외 ${extraLikes}명`;

  const type = notification.type;

  if (type.includes("ORDER_COMPLETED")) {
    const orderTypeLabel = getOrderTypeLabel(notification);
    const suffix = orderTypeLabel
      ? `${orderTypeLabel} 주문 체결되었습니다.`
      : "주문 체결되었습니다.";
    return [target, suffix].filter(Boolean).join(" ");
  }

  if (type.includes("ORDER_CANCELED")) {
    return [target, "주문 취소되었습니다."].filter(Boolean).join(" ");
  }

  if (type.includes("LIQUIDATION_COMPLETED")) {
    return `[청산 알림] ${target ?? "선물"} 포지션이 강제 청산되었습니다.`;
  }

  switch (type) {
    case "CONTEST_SEASON_SETTLED": {
      const seasonTitle = getPayloadString(notification.payload, "seasonTitle", "title") ?? "대회";
      const rank = getPayloadNumericValue(notification.payload, "finalRank", "rank");
      return rank !== null
        ? `[${seasonTitle}] 대회가 종료되었습니다! (최종 ${rank}위)`
        : `[${seasonTitle}] 대회가 종료되었습니다!`;
    }
    case "CONTEST_APPLICATION_APPROVED":
    case "CONTEST_APPROVED":
    case "NOTIFICATION_CONTEST_APPLICATION_APPROVED": {
      const seasonTitle = getPayloadString(notification.payload, "seasonTitle", "title") ?? "대회";
      return `[${seasonTitle}] 신청이 승인되었습니다!`;
    }
    case "CONTEST_APPLICATION_REJECTED":
    case "CONTEST_REJECTED":
    case "NOTIFICATION_CONTEST_APPLICATION_REJECTED": {
      const seasonTitle = getPayloadString(notification.payload, "seasonTitle", "title") ?? "대회";
      return `[${seasonTitle}] 신청이 반려되었습니다.`;
    }
    case "POST_COMMENT_CREATED": {
      if (postTitleSummary) {
        return `${actorName}님이 내 글 "${postTitleSummary}"에 댓글을 남겼습니다.`;
      }
      return contentSummary
        ? `${actorName}님이 내 글에 댓글을 남겼습니다: "${contentSummary}"`
        : `${actorName}님이 내 글에 댓글을 남겼습니다.`;
    }
    case "REPLY_COMMENT_CREATED": {
      const mentioned = getPayloadBoolean(notification.payload, "mentioned");
      if (mentioned) {
        return postTitleSummary
          ? `${actorName}님이 글 "${postTitleSummary}"의 댓글에서 회원님을 @멘션했습니다.`
          : `${actorName}님이 댓글에서 회원님을 @멘션했습니다.`;
      }
      if (postTitleSummary) {
        return `${actorName}님이 내 글 "${postTitleSummary}"에 답글을 남겼습니다.`;
      }
      return contentSummary
        ? `${actorName}님이 내 댓글에 답글을 남겼습니다: "${contentSummary}"`
        : `${actorName}님이 내 댓글에 답글을 남겼습니다.`;
    }
    case "POST_LIKED": {
      if (postTitleSummary) {
        return extraLikes > 0
          ? `${groupedActorLabel}이 내 글 "${postTitleSummary}"을 좋아합니다.`
          : `${actorName}님이 내 글 "${postTitleSummary}"을 좋아합니다.`;
      }
      return extraLikes > 0
        ? `${groupedActorLabel}이 내 게시글을 좋아합니다.`
        : `${actorName}님이 내 게시글을 좋아합니다.`;
    }
    case "REPLY_LIKED": {
      if (postTitleSummary) {
        return extraLikes > 0
          ? `${groupedActorLabel}이 글 "${postTitleSummary}"의 내 댓글을 좋아합니다.`
          : `${actorName}님이 글 "${postTitleSummary}"의 내 댓글을 좋아합니다.`;
      }
      return extraLikes > 0
        ? `${groupedActorLabel}이 내 댓글을 좋아합니다.`
        : `${actorName}님이 내 댓글을 좋아합니다.`;
    }
    case "FOLLOW_CREATED":
      return `${actorName}님이 나를 팔로우했습니다.`;
    default:
      return "새 알림이 도착했습니다.";
  }
}

export function formatNotificationDescription(notification: NotificationItem): string {
  const type = notification.type;

  if (type.includes("ORDER_COMPLETED") || type.includes("ORDER_CANCELED")) {
    const qty = getPayloadNumericValue(
      notification.payload,
      "quantity",
      "filledQuantity",
      "orderQuantity",
    );
    const amount = getPayloadNumericValue(
      notification.payload,
      "executedAmount",
      "settlementAmount",
      "totalAmount",
      "orderAmount",
    );
    const action = getPayloadString(notification.payload, "positionAction", "action");
    const pnl =
      action === "CLOSE"
        ? getPayloadNumericValue(notification.payload, "realizedPnl", "pnl")
        : null;
    return [
      qty !== null ? `수량 ${formatNotificationNumber(qty, 6)}` : null,
      amount !== null ? `금액 ${formatNotificationNumber(amount, 2)} USDT` : null,
      pnl !== null ? `실현손익 ${formatSignedNotificationNumber(pnl, 2)} USDT` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (type.includes("LIQUIDATION_COMPLETED")) {
    const liqPrice = getPayloadNumericValue(notification.payload, "liquidationPrice", "price");
    const pnl = getPayloadNumericValue(notification.payload, "realizedPnl", "pnl");
    const parts = [
      liqPrice !== null ? `청산가 ${formatNotificationNumber(liqPrice, 2)} USDT` : null,
      pnl !== null ? `실현 손익 ${formatSignedNotificationNumber(pnl, 2)} USDT` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "담보 부족으로 인한 강제 청산";
  }

  if (type === "CONTEST_SEASON_SETTLED") {
    const total = getPayloadNumericValue(notification.payload, "totalParticipants");
    const rank = getPayloadNumericValue(notification.payload, "finalRank", "rank");
    const roi = getPayloadNumericValue(notification.payload, "finalRoiPct", "roiPct");
    const balance = getPayloadNumericValue(notification.payload, "finalBalance", "balance");
    return [
      rank !== null && total !== null ? `${total}명 중 ${rank}위` : null,
      roi !== null ? `수익률 ${formatSignedNotificationNumber(roi, 2)}%` : null,
      balance !== null ? `정산 자산 ${formatNotificationNumber(balance, 2)} USDT` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (type === "POST_COMMENT_CREATED" || type === "REPLY_COMMENT_CREATED") {
    const summary = summarizeText(getRawContent(notification), 42);
    return summary ? `"${summary}"` : "";
  }

  if (
    type === "CONTEST_APPLICATION_APPROVED" ||
    type === "CONTEST_APPROVED" ||
    type === "NOTIFICATION_CONTEST_APPLICATION_APPROVED"
  ) {
    return "대회 참여가 가능합니다. 지금 바로 확인해보세요!";
  }

  if (
    type === "CONTEST_APPLICATION_REJECTED" ||
    type === "CONTEST_REJECTED" ||
    type === "NOTIFICATION_CONTEST_APPLICATION_REJECTED"
  ) {
    const reason = getPayloadString(notification.payload, "rejectReason", "reason", "message");
    return reason ? `사유: ${reason}` : "신청 정보를 다시 확인해주세요.";
  }

  return "";
}

function createDetailField(
  label: string,
  value: string | null,
  align: NotificationDetailField["align"] = "left",
): NotificationDetailField | null {
  if (!value) return null;
  return { label, value, align };
}

export function getNotificationDetailFields(
  notification: NotificationItem,
): NotificationDetailField[] {
  const target = getDisplayTarget(notification);
  const sideLabel = getOrderSideLabel(notification);
  const orderTypeLabel = getOrderTypeLabel(notification);
  const actorName = getActorName(notification);
  const postTitle = getPostTitle(notification);
  const rawContent = getRawContent(notification);
  const groupedCount = getGroupedLikeCount(notification);
  const type = notification.type;

  if (type.includes("ORDER_COMPLETED") || type.includes("ORDER_CANCELED")) {
    const price = getPayloadNumericValue(notification.payload, "price", "fillPrice");
    const qty = getPayloadNumericValue(notification.payload, "quantity", "filledQuantity");
    const amount = getPayloadNumericValue(notification.payload, "executedAmount", "totalAmount");
    const pnl = getPayloadNumericValue(notification.payload, "realizedPnl", "pnl");
    const seasonTitle = getPayloadString(notification.payload, "seasonTitle");
    return [
      createDetailField("대회명", seasonTitle),
      createDetailField("종목", target),
      createDetailField("주문 유형", orderTypeLabel, "center"),
      createDetailField("주문 방향", sideLabel, "center"),
      createDetailField("체결가", price !== null ? `${formatNotificationNumber(price, 4)} USDT` : null, "right"),
      createDetailField("수량", qty !== null ? formatNotificationNumber(qty, 6) : null, "right"),
      createDetailField("체결 금액", amount !== null ? `${formatNotificationNumber(amount, 2)} USDT` : null, "right"),
      createDetailField("실현 손익", pnl !== null ? `${formatSignedNotificationNumber(pnl, 2)} USDT` : null, "right"),
    ].filter((f): f is NotificationDetailField => f !== null);
  }

  if (type.includes("LIQUIDATION_COMPLETED")) {
    const liqPrice = getPayloadNumericValue(notification.payload, "liquidationPrice", "price");
    const qty = getPayloadNumericValue(notification.payload, "closeQuantity", "quantity");
    const pnl = getPayloadNumericValue(notification.payload, "realizedPnl", "pnl");
    const seasonTitle = getPayloadString(notification.payload, "seasonTitle");
    return [
      createDetailField("대회명", seasonTitle),
      createDetailField("종목", target),
      createDetailField("청산 가격", liqPrice !== null ? `${formatNotificationNumber(liqPrice, 4)} USDT` : null, "right"),
      createDetailField("청산 수량", qty !== null ? formatNotificationNumber(qty, 6) : null, "right"),
      createDetailField("실현 손익", pnl !== null ? `${formatSignedNotificationNumber(pnl, 2)} USDT` : null, "right"),
    ].filter((f): f is NotificationDetailField => f !== null);
  }

  switch (type) {
    case "CONTEST_SEASON_SETTLED": {
      const seasonTitle = getPayloadString(notification.payload, "seasonTitle", "title");
      const rank = getPayloadNumericValue(notification.payload, "finalRank", "rank");
      const total = getPayloadNumericValue(notification.payload, "totalParticipants");
      const roi = getPayloadNumericValue(notification.payload, "finalRoiPct", "roiPct");
      const balance = getPayloadNumericValue(notification.payload, "finalBalance", "balance");
      const pnl = getPayloadNumericValue(notification.payload, "finalRealizedPnl", "realizedPnl");
      return [
        createDetailField("대회명", seasonTitle),
        createDetailField(
          "최종 순위",
          rank !== null ? (total !== null ? `${rank}위 / ${total}명` : `${rank}위`) : null,
          "center",
        ),
        createDetailField("최종 수익률", roi !== null ? `${formatSignedNotificationNumber(roi, 2)}%` : null, "right"),
        createDetailField("정산 자산", balance !== null ? `${formatNotificationNumber(balance, 2)} USDT` : null, "right"),
        createDetailField("실현 손익", pnl !== null ? `${formatSignedNotificationNumber(pnl, 2)} USDT` : null, "right"),
      ].filter((f): f is NotificationDetailField => f !== null);
    }
    case "POST_COMMENT_CREATED":
    case "REPLY_COMMENT_CREATED":
      return [
        createDetailField("글 제목", postTitle),
        createDetailField("작성자", actorName),
        createDetailField("내용", rawContent),
      ].filter((f): f is NotificationDetailField => f !== null);
    case "POST_LIKED":
    case "REPLY_LIKED":
      return [
        createDetailField("사용자", actorName),
        createDetailField(
          "반응 수",
          groupedCount !== null ? `${formatNotificationCount(groupedCount)}명` : null,
          "center",
        ),
        createDetailField("글 제목", postTitle),
        createDetailField("내용", rawContent),
      ].filter((f): f is NotificationDetailField => f !== null);
    case "FOLLOW_CREATED":
      return [createDetailField("사용자", actorName)].filter(
        (f): f is NotificationDetailField => f !== null,
      );
    case "CONTEST_APPLICATION_APPROVED":
    case "CONTEST_APPROVED":
    case "NOTIFICATION_CONTEST_APPLICATION_APPROVED": {
      const seasonTitle = getPayloadString(notification.payload, "seasonTitle", "title");
      return [
        createDetailField("대회명", seasonTitle),
        createDetailField("상태", "승인 완료"),
      ].filter((f): f is NotificationDetailField => f !== null);
    }
    case "CONTEST_APPLICATION_REJECTED":
    case "CONTEST_REJECTED":
    case "NOTIFICATION_CONTEST_APPLICATION_REJECTED": {
      const seasonTitle = getPayloadString(notification.payload, "seasonTitle", "title");
      const reason = getPayloadString(notification.payload, "rejectReason", "reason", "message");
      return [
        createDetailField("대회명", seasonTitle),
        createDetailField("상태", "반려됨"),
        createDetailField("반려 사유", reason),
      ].filter((f): f is NotificationDetailField => f !== null);
    }
    default:
      return [createDetailField("내용", rawContent)].filter(
        (f): f is NotificationDetailField => f !== null,
      );
  }
}

export function formatNotificationRelativeTime(
  value?: string | null,
  nowMs: number = Date.now(),
): string {
  if (!value) return "";
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return "";
  const seconds = Math.floor((nowMs - target.getTime()) / 1000);
  if (seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(target);
}

export function getNotificationListTabValue(
  category: NotificationCategory,
): NotificationListTabValue {
  if (category === "MOCK") return "MOCK";
  if (category === "CONTEST") return "CONTEST";
  return "COMMUNITY";
}

export function getNotificationNavigationTarget(
  notification: NotificationItem,
): NotificationNavigationTarget | null {
  const type = notification.type;

  if (type.includes("ORDER_COMPLETED") || type.includes("LIQUIDATION_COMPLETED")) {
    if (notification.category === "CONTEST") {
      return {
        href: "/me?tab=contest-assets",
        label: "대회 자산·내역으로 이동",
      };
    }
    return {
      href: "/me?tab=mock-assets&detailTab=trades",
      label: "체결·거래내역으로 이동",
    };
  }

  if (type === "CONTEST_SEASON_SETTLED") {
    return {
      href: "/me?tab=contest-assets&contestSubTab=finished",
      label: "최종 순위·정산 확인",
    };
  }

  if (
    type === "CONTEST_APPLICATION_APPROVED" ||
    type === "CONTEST_APPLICATION_REJECTED" ||
    type === "CONTEST_APPROVED" ||
    type === "CONTEST_REJECTED"
  ) {
    return {
      href: "/contest",
      label: "대회 페이지로 이동",
    };
  }

  if (
    type === "POST_COMMENT_CREATED" ||
    type === "REPLY_COMMENT_CREATED" ||
    type === "POST_LIKED" ||
    type === "REPLY_LIKED"
  ) {
    const postId = getPayloadNumericValue(notification.payload, "postId", "targetPostId");
    if (postId === null) return null;
    const replyId =
      type === "POST_LIKED"
        ? null
        : getPayloadNumericValue(
            notification.payload,
            "replyId",
            "targetReplyId",
            "commentId",
          );
    const href = `/community/all/${Math.trunc(postId)}${
      replyId !== null ? `#comment-${Math.trunc(replyId)}` : ""
    }`;
    return {
      href,
      label: replyId !== null ? "댓글로 이동" : "게시글로 이동",
    };
  }

  if (type === "FOLLOW_CREATED") {
    const memberId =
      notification.actorMemberId ??
      getPayloadNumericValue(notification.payload, "actorMemberId", "memberId");
    if (memberId === null) return null;
    return {
      href: `/members/${Math.trunc(memberId)}`,
      label: "프로필로 이동",
    };
  }

  return null;
}
