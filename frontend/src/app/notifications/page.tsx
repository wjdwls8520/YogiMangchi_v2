import type { Metadata } from "next";
import { NotificationsPageView } from "../../features/member/notifications/notifications-page-view";
import type { NotificationListTabValue } from "../../features/member/notifications/notification-types";

export const metadata: Metadata = {
  title: "알림 내역",
};

const VALID_TABS = new Set<NotificationListTabValue>([
  "ALL",
  "MOCK",
  "CONTEST",
  "COMMUNITY",
]);

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const rawTab = resolved?.tab as NotificationListTabValue | undefined;
  const initialTab: NotificationListTabValue =
    rawTab && VALID_TABS.has(rawTab) ? rawTab : "ALL";
  return <NotificationsPageView initialTab={initialTab} />;
}
