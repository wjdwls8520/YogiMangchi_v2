"use client";

import Link from "next/link";
import {
  cn,
  V1IconBell,
  V1IconClose,
  V1IconCornerDownRight,
} from "../components/v1-ui";
import type { NotificationToastItem } from "./notification-types";
import {
  formatNotificationRelativeTime,
  getNotificationTradeToneStyles,
  isCommentNotification,
} from "./notification-utils";

export interface NotificationToastStackProps {
  toasts: NotificationToastItem[];
  onDismiss: (toastId: string) => void;
  onSelectToast?: (toast: NotificationToastItem) => void;
}

export function NotificationToastStack({
  toasts,
  onDismiss,
  onSelectToast,
}: NotificationToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      data-notification-toast-stack="true"
      className="pointer-events-none fixed right-4 top-[72px] z-[65] flex w-[calc(100vw-2rem)] max-w-[368px] flex-col gap-2.5"
    >
      {toasts.map(toast => {
        const toneStyles = getNotificationTradeToneStyles(toast.tradeTone);
        const showCommentIcon = isCommentNotification(toast);

        const bodyContent = (
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-xs font-extrabold text-gray-900">
                  새 알림
                </p>
                {toast.tradeSideLabel ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide",
                      toneStyles.badge,
                    )}
                  >
                    {toast.tradeSideLabel}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] font-medium tabular-nums text-gray-400">
                {formatNotificationRelativeTime(toast.createdAt)}
              </span>
            </div>

            <p className="mt-1 text-left text-[13px] font-bold leading-5 text-gray-900">
              {toast.title}
            </p>

            {toast.description ? (
              <div className="mt-1 flex items-start gap-1.5 text-left text-xs leading-5 text-gray-500">
                {showCommentIcon ? (
                  <V1IconCornerDownRight className="mt-[3px] h-3.5 w-3.5 shrink-0" />
                ) : null}
                <span className="min-w-0 break-words">{toast.description}</span>
              </div>
            ) : null}
          </div>
        );

        return (
          <div
            key={toast.id}
            data-notification-toast={toast.type}
            className="pointer-events-auto relative overflow-hidden rounded-2xl border border-gray-200 bg-white/95 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur-md"
            role="status"
            aria-live="polite"
          >
            <div className={cn("absolute inset-y-0 left-0 w-1", toneStyles.accent)} />
            <div className="flex items-start gap-3 p-4 pl-4.5">
              <div
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  toneStyles.icon,
                )}
              >
                <V1IconBell className="h-4 w-4" />
              </div>

              {toast.href ? (
                <Link
                  href={toast.href}
                  onClick={() => {
                    onSelectToast?.(toast);
                    onDismiss(toast.id);
                  }}
                  className="min-w-0 flex-1 rounded-lg transition-opacity hover:opacity-85"
                >
                  {bodyContent}
                </Link>
              ) : (
                bodyContent
              )}

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="shrink-0 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
                aria-label="알림 토스트 닫기"
              >
                <V1IconClose className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
