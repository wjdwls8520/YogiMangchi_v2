"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  isTradingTerminalPath,
  shouldSuppressToastOnPath,
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
  const pathname = usePathname();
  const isTradingRoute = isTradingTerminalPath(pathname);
  const visibleToasts = toasts.filter(toast => !shouldSuppressToastOnPath(pathname, toast));

  if (visibleToasts.length === 0) {
    return null;
  }

  return (
    <div
      data-notification-toast-stack="true"
      data-toast-position={isTradingRoute ? "bottom-right" : "top-center"}
      className={cn(
        "pointer-events-none fixed z-[65] flex w-[calc(100vw-2rem)] max-w-[384px] flex-col gap-2.5",
        isTradingRoute
          ? "bottom-5 right-4 sm:right-6"
          : "left-1/2 top-[72px] -translate-x-1/2",
      )}
    >
      {visibleToasts.map(toast => {
        const toneStyles = getNotificationTradeToneStyles(toast.tradeTone);
        const showCommentIcon = isCommentNotification(toast);

        const bodyContent = (
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <p
                  className={cn(
                    "truncate text-xs font-extrabold",
                    isTradingRoute ? "text-gray-100" : "text-gray-900",
                  )}
                >
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
              <span
                className={cn(
                  "shrink-0 text-[11px] font-medium tabular-nums",
                  isTradingRoute ? "text-gray-400" : "text-gray-400",
                )}
              >
                {formatNotificationRelativeTime(toast.createdAt)}
              </span>
            </div>

            <p
              className={cn(
                "mt-1 text-left text-[13px] font-bold leading-5",
                isTradingRoute ? "text-gray-100" : "text-gray-900",
              )}
            >
              {toast.title}
            </p>

            {toast.description ? (
              <div
                className={cn(
                  "mt-1 flex items-start gap-1.5 text-left text-xs leading-5",
                  isTradingRoute ? "text-gray-400" : "text-gray-500",
                )}
              >
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
            className={cn(
              "pointer-events-auto relative overflow-hidden rounded-2xl border backdrop-blur-md",
              isTradingRoute
                ? "border-[#2B3139] bg-[#161A1E]/95 text-gray-100"
                : "border-gray-200 bg-white/95 text-gray-900",
            )}
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
                className={cn(
                  "shrink-0 rounded-full p-1.5 transition-colors cursor-pointer",
                  isTradingRoute
                    ? "text-gray-400 hover:bg-white/10 hover:text-gray-200"
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
                )}
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
