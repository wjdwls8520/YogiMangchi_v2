export type NotificationSource = "CONTENT" | "TRADING";

export type NotificationCategory =
  | "MOCK"
  | "CONTEST"
  | "COMMUNITY"
  | "FOLLOW"
  | "REPORT"
  | "SUPPORT"
  | (string & {});

export type NotificationTradeTone =
  | "buy"
  | "sell"
  | "long"
  | "short"
  | "warning"
  | "info"
  | null;

export type NotificationPayload = Record<string, unknown>;

export interface RawNotificationDto {
  notificationId: number;
  actorMemberId: number | null;
  category: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  lastEventAt: string | null;
  payload: NotificationPayload | null;
}

export interface NotificationItem {
  uid: string;
  source: NotificationSource;
  notificationId: number;
  actorMemberId: number | null;
  category: NotificationCategory;
  type: string;
  isRead: boolean;
  createdAt: string;
  lastEventAt: string | null;
  payload: NotificationPayload | null;
}

export interface NotificationPageDto {
  content: RawNotificationDto[];
  nextCursorId: number | null;
  hasNext: boolean;
}

export interface NotificationStatusDto {
  newCount: number;
  hasNew: boolean;
  unreadCount: number;
  hasUnread: boolean;
}

export interface NotificationDetailField {
  label: string;
  value: string;
  align: "left" | "center" | "right";
}

export interface NotificationNavigationTarget {
  href: string;
  label: string;
}

export type NotificationListTabValue = "ALL" | "MOCK" | "CONTEST" | "COMMUNITY";

export interface NotificationToastItem {
  id: string;
  uid: string;
  source: NotificationSource;
  notificationId: number;
  type: string;
  category: NotificationCategory;
  title: string;
  description: string;
  createdAt: string;
  tradeTone: NotificationTradeTone;
  tradeSideLabel: string | null;
  href: string | null;
}
