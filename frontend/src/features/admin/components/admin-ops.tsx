"use client";

import { useEffect, useState } from "react";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import {
  SUPPORT_INQUIRY_CATEGORIES,
  supportCategoryLabel,
  type SupportInquiry,
  type SupportInquiryFilterStatus,
} from "../../member/api/support";
import {
  cn,
  V1IconAlert,
  V1IconCheck,
  V1IconRefresh,
  V1IconShield,
} from "../../member/components/v1-ui";
import { RequestIdChip } from "../../../components/request-id-copy";
import { getErrorRequestId, isUnexpectedApiError } from "../../../lib/request-id";
import {
  fetchAdminSupportInquiries,
  fetchAdminTradingSymbols,
  fetchContentAdminAuditLogs,
  fetchContentOpsSummary,
  fetchTradingAdminAuditLogs,
  fetchTradingOpsSummary,
  formatAdminDateTime,
  reconcileTradingLedgerNow,
  releaseTradingRiskHold,
  replyAdminSupportInquiry,
  retryAdminContentOutbox,
  retryFailedS3Cleanup,
  sendContentTestAlert,
  sendTradingTestAlert,
  updateAdminTradingSymbolStatus,
  type AdminTradingSymbolDto,
  type ContentAdminAuditLogDto,
  type ContentOpsSummary,
  type OpsErrorEntry,
  type TradingAdminAuditLogDto,
  type TradingOpsSummary,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

export type OpsHealthTone = "green" | "yellow" | "red";

export function resolveOpsHealthTone(
  statusRaw: string | boolean | null | undefined,
): OpsHealthTone {
  if (typeof statusRaw === "boolean") {
    return statusRaw ? "green" : "red";
  }
  const normalized = String(statusRaw ?? "").trim().toUpperCase();
  if (
    normalized === "UP" ||
    normalized === "OPEN" ||
    normalized === "ACTIVE" ||
    normalized === "CONNECTED" ||
    normalized === "FRESH" ||
    normalized === "OK" ||
    normalized === "HEALTHY" ||
    normalized === "READY" ||
    normalized === "LIVE"
  ) {
    return "green";
  }
  if (
    normalized === "DEGRADED" ||
    normalized === "RECOVERING" ||
    normalized === "STARTING" ||
    normalized === "CONNECTING" ||
    normalized === "RECONNECTING" ||
    normalized === "STALE" ||
    normalized === "DISABLED" ||
    normalized === "PAUSED" ||
    normalized === "WARN" ||
    normalized === "UNKNOWN" ||
    normalized === ""
  ) {
    return "yellow";
  }
  return "red";
}

function formatUptimeKorean(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}일 ${hours}시간 ${mins}분`;
  if (hours > 0) return `${hours}시간 ${mins}분`;
  return `${mins}분`;
}

function formatSupportStatusLabel(status: SupportInquiry["status"]): string {
  if (status === "ANSWERED") return "답변완료";
  if (status === "CLOSED") return "종료됨";
  return "미답변";
}

function HealthBadge({ tone, label }: { tone: OpsHealthTone; label: string }) {
  const styles =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "yellow"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-[#F6465D]";
  const dot =
    tone === "green"
      ? "bg-[#0ECB81]"
      : tone === "yellow"
        ? "bg-amber-500"
        : "bg-[#F6465D]";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-black",
        styles,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function dedupeOpsErrors(
  items: Array<OpsErrorEntry & { server: "CONTENT" | "TRADING" }>,
): Array<OpsErrorEntry & { server: "CONTENT" | "TRADING" }> {
  const seen = new Set<string>();
  const out: Array<OpsErrorEntry & { server: "CONTENT" | "TRADING" }> = [];
  for (const item of items) {
    const key = `${item.server}:${item.requestId ?? ""}:${item.occurredAt ?? ""}:${item.status}:${item.uri ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out
    .sort((a, b) => {
      const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
      const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
      return tb - ta;
    })
    .slice(0, 60);
}

export function AdminOpsView() {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const role = memberCtx?.snapshot.role;
  const generation = memberCtx?.snapshot.generation;
  const session = memberCtx?.session;

  const [contentOps, setContentOps] = useState<ContentOpsSummary | null>(null);
  const [tradingOps, setTradingOps] = useState<TradingOpsSummary | null>(null);
  const [tradingSymbols, setTradingSymbols] = useState<AdminTradingSymbolDto[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [symbolsError, setSymbolsError] = useState<{ text: string; requestId?: string } | null>(
    null,
  );
  const [symbolToggleTarget, setSymbolToggleTarget] = useState<{
    symbol: AdminTradingSymbolDto;
    nextStatus: "ACTIVE" | "HALTED";
  } | null>(null);
  const [symbolModalError, setSymbolModalError] = useState<{
    text: string;
    requestId?: string;
  } | null>(null);
  const [contentError, setContentError] = useState<{ text: string; requestId?: string } | null>(
    null,
  );
  const [tradingError, setTradingError] = useState<{ text: string; requestId?: string } | null>(
    null,
  );

  // 1:1 Support Queue State
  const [inquiryFilter, setInquiryFilter] = useState<SupportInquiryFilterStatus>("OPEN");
  const [inquiryCategoryFilter, setInquiryCategoryFilter] = useState<string>("ALL");
  const [inquiryKeywordInput, setInquiryKeywordInput] = useState("");
  const [inquiryKeyword, setInquiryKeyword] = useState("");
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([]);
  const [settledInquiriesKey, setSettledInquiriesKey] = useState<string | null>(null);
  const [loadingMoreInquiries, setLoadingMoreInquiries] = useState(false);
  const [inquiriesNextCursor, setInquiriesNextCursor] = useState<number | null>(null);
  const [inquiriesHasNext, setInquiriesHasNext] = useState(false);
  const [openInquiryCount, setOpenInquiryCount] = useState(0);
  const [answeredInquiryCount, setAnsweredInquiryCount] = useState(0);
  const [closedInquiryCount, setClosedInquiryCount] = useState(0);
  const [inquiriesError, setInquiriesError] = useState<{ text: string; requestId?: string } | null>(
    null,
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [inquiryActionErrors, setInquiryActionErrors] = useState<
    Record<number, { text: string; requestId?: string }>
  >({});

  // Error Table Filter State
  const [errorTab, setErrorTab] = useState<"CRITICAL" | "RECENT">("RECENT");
  const [errorTextFilter, setErrorTextFilter] = useState("");
  const [errorRequestIdFilter, setErrorRequestIdFilter] = useState("");

  // Audit Logs State
  const [auditTab, setAuditTab] = useState<"CONTENT" | "TRADING">("CONTENT");
  const [auditActionFilterInput, setAuditActionFilterInput] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [contentAuditLogs, setContentAuditLogs] = useState<ContentAdminAuditLogDto[]>([]);
  const [contentAuditCursor, setContentAuditCursor] = useState<number | null>(null);
  const [contentAuditHasNext, setContentAuditHasNext] = useState(false);
  const [tradingAuditLogs, setTradingAuditLogs] = useState<TradingAdminAuditLogDto[]>([]);
  const [tradingAuditCursor, setTradingAuditCursor] = useState<number | null>(null);
  const [tradingAuditHasNext, setTradingAuditHasNext] = useState(false);
  const [settledAuditKey, setSettledAuditKey] = useState<string | null>(null);
  const [loadingMoreAudit, setLoadingMoreAudit] = useState(false);
  const [auditError, setAuditError] = useState<{ text: string; requestId?: string } | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    kind: "success" | "error";
    text: string;
    requestId?: string;
  } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const inquiriesQueryKey = `${generation ?? 0}:${inquiryFilter}:${inquiryCategoryFilter}:${inquiryKeyword}:${reloadTick}`;
  const loadingInquiries =
    phase === "ready" && role === "ADMIN" && settledInquiriesKey !== inquiriesQueryKey;

  const auditQueryKey = `${generation ?? 0}:${auditTab}:${auditTab === "CONTENT" ? auditActionFilter : ""}:${reloadTick}`;
  const loadingAudit =
    phase === "ready" && role === "ADMIN" && settledAuditKey !== auditQueryKey;

  useEffect(() => {
    if (!autoRefresh || typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setReloadTick(t => t + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();

    void session
      .authorized(
        cred => fetchContentOpsSummary(cred.accessToken, { signal: controller.signal }),
        true,
      )
      .then(summary => {
        setContentError(null);
        setContentOps(summary);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setContentError({
          text: "Content 서버 운영 지표를 불러오지 못했습니다.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });

    void session
      .authorized(
        cred => fetchTradingOpsSummary(cred.accessToken, { signal: controller.signal }),
        true,
      )
      .then(summary => {
        setTradingError(null);
        setTradingOps(summary);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setTradingError({
          text: "Trading 서버 운영 지표를 불러오지 못했습니다.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });

    void session
      .authorized(
        cred => fetchAdminTradingSymbols(cred.accessToken, { signal: controller.signal }),
        true,
      )
      .then(symbols => {
        setSymbolsError(null);
        setTradingSymbols(symbols);
        setLoadingSymbols(false);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setLoadingSymbols(false);
        setSymbolsError({
          text: "거래 종목 목록을 불러오지 못했습니다.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });

    return () => controller.abort();
  }, [phase, role, generation, session, reloadTick]);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();
    void session
      .authorized(
        cred =>
          fetchAdminSupportInquiries(
            cred.accessToken,
            {
              status: inquiryFilter,
              category: inquiryCategoryFilter !== "ALL" ? inquiryCategoryFilter : undefined,
              keyword: inquiryKeyword || undefined,
              size: 20,
            },
            { signal: controller.signal },
          ),
        true,
      )
      .then(res => {
        setInquiriesError(null);
        setInquiries(res.items);
        setOpenInquiryCount(res.openCount);
        setAnsweredInquiryCount(res.answeredCount);
        setClosedInquiryCount(res.closedCount);
        setInquiriesNextCursor(res.nextCursorId);
        setInquiriesHasNext(res.hasNext);
        setSettledInquiriesKey(inquiriesQueryKey);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setSettledInquiriesKey(inquiriesQueryKey);
        setInquiriesError({
          text: "1:1 고객문의 목록을 불러오지 못했습니다.",
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        });
      });
    return () => controller.abort();
  }, [phase, role, generation, session, inquiryFilter, inquiryCategoryFilter, inquiryKeyword, reloadTick, inquiriesQueryKey]);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();
    if (auditTab === "CONTENT") {
      void session
        .authorized(
          cred =>
            fetchContentAdminAuditLogs(
              cred.accessToken,
              {
                size: 20,
                action: auditActionFilter || undefined,
              },
              { signal: controller.signal },
            ),
          true,
        )
        .then(page => {
          setAuditError(null);
          setContentAuditLogs(page.items);
          setContentAuditCursor(page.nextCursorId);
          setContentAuditHasNext(page.hasNext);
          setSettledAuditKey(auditQueryKey);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          setSettledAuditKey(auditQueryKey);
          setAuditError({
            text: "Content 관리자 감사 로그를 불러오지 못했습니다.",
            requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
          });
        });
    } else {
      void session
        .authorized(
          cred =>
            fetchTradingAdminAuditLogs(
              cred.accessToken,
              { size: 20 },
              { signal: controller.signal },
            ),
          true,
        )
        .then(page => {
          setAuditError(null);
          setTradingAuditLogs(page.items);
          setTradingAuditCursor(page.nextCursorId);
          setTradingAuditHasNext(page.hasNext);
          setSettledAuditKey(auditQueryKey);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          setSettledAuditKey(auditQueryKey);
          setAuditError({
            text: "Trading 관리자 감사 로그를 불러오지 못했습니다.",
            requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
          });
        });
    }
    return () => controller.abort();
  }, [phase, role, generation, session, auditTab, auditActionFilter, reloadTick, auditQueryKey]);

  async function handleLoadMoreInquiries() {
    if (!session || !inquiriesHasNext || inquiriesNextCursor == null || loadingMoreInquiries) return;
    setLoadingMoreInquiries(true);
    try {
      const res = await session.authorized(
        cred =>
          fetchAdminSupportInquiries(cred.accessToken, {
            status: inquiryFilter,
            category: inquiryCategoryFilter !== "ALL" ? inquiryCategoryFilter : undefined,
            keyword: inquiryKeyword || undefined,
            cursorId: inquiriesNextCursor,
            size: 20,
          }),
        true,
      );
      setInquiries(prev => {
        const seen = new Set(prev.map(item => item.id));
        return [...prev, ...res.items.filter(item => !seen.has(item.id))];
      });
      setInquiriesNextCursor(res.nextCursorId);
      setInquiriesHasNext(res.hasNext);
    } catch (error) {
      setInquiriesError({
        text: "추가 1:1 문의를 불러오지 못했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setLoadingMoreInquiries(false);
    }
  }

  async function handleLoadMoreAuditLogs() {
    if (!session || loadingMoreAudit) return;
    setLoadingMoreAudit(true);
    try {
      if (auditTab === "CONTENT") {
        if (!contentAuditHasNext || contentAuditCursor == null) return;
        const page = await session.authorized(
          cred =>
            fetchContentAdminAuditLogs(cred.accessToken, {
              cursorId: contentAuditCursor,
              size: 20,
              action: auditActionFilter || undefined,
            }),
          true,
        );
        setContentAuditLogs(prev => {
          const seen = new Set(prev.map(i => i.id));
          return [...prev, ...page.items.filter(i => !seen.has(i.id))];
        });
        setContentAuditCursor(page.nextCursorId);
        setContentAuditHasNext(page.hasNext);
      } else {
        if (!tradingAuditHasNext || tradingAuditCursor == null) return;
        const page = await session.authorized(
          cred =>
            fetchTradingAdminAuditLogs(cred.accessToken, {
              cursorId: tradingAuditCursor,
              size: 20,
            }),
          true,
        );
        setTradingAuditLogs(prev => {
          const seen = new Set(prev.map(i => i.id));
          return [...prev, ...page.items.filter(i => !seen.has(i.id))];
        });
        setTradingAuditCursor(page.nextCursorId);
        setTradingAuditHasNext(page.hasNext);
      }
    } catch (error) {
      setAuditError({
        text: "추가 감사 로그를 불러오지 못했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setLoadingMoreAudit(false);
    }
  }

  async function handleSendTestAlerts() {
    if (!session || busyAction !== null) return;
    setBusyAction("test-alert");
    try {
      const [contentRes, tradingRes] = await Promise.allSettled([
        session.authorized(cred => sendContentTestAlert(cred.accessToken)),
        session.authorized(cred => sendTradingTestAlert(cred.accessToken)),
      ]);
      const parts: string[] = [];
      let anyError = false;
      if (contentRes.status === "fulfilled") {
        const r = contentRes.value;
        parts.push(
          `Content: ${r.status}${r.httpStatus ? ` (${r.httpStatus})` : ""}${r.targetType ? ` · ${r.targetType}` : ""}`,
        );
      } else {
        anyError = true;
        parts.push("Content: 발송 실패");
      }
      if (tradingRes.status === "fulfilled") {
        const r = tradingRes.value;
        parts.push(
          `Trading: ${r.status}${r.httpStatus ? ` (${r.httpStatus})` : ""}${r.targetType ? ` · ${r.targetType}` : ""}`,
        );
      } else {
        anyError = true;
        parts.push("Trading: 발송 실패");
      }
      setActionBanner({
        kind: anyError ? "error" : "success",
        text: `테스트 알림 발송 결과 — ${parts.join(" / ")}`,
      });
      setReloadTick(t => t + 1);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReconcileNow() {
    if (!session || busyAction !== null) return;
    setBusyAction("reconcile-now");
    try {
      const res = await session.authorized(cred => reconcileTradingLedgerNow(cred.accessToken));
      setActionBanner({
        kind: res.mismatchCount > 0 ? "error" : "success",
        text: `원장 즉시 대사 완료 — 점검 ${res.checkedCount}계정 · 일치 ${res.matchedCount} · 불일치 ${res.mismatchCount} · 미검증 ${res.unverifiedCount} · 보류 ${res.deferredCount}`,
      });
      setReloadTick(t => t + 1);
    } catch (error) {
      setActionBanner({
        kind: "error",
        text: "원장 즉시 대사 실행에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryOutboxAll() {
    if (!session || busyAction !== null) return;
    setBusyAction("outbox-retry");
    try {
      const res = await session.authorized(cred => retryAdminContentOutbox(cred.accessToken));
      setActionBanner({
        kind: "success",
        text: `아웃박스 재시도 완료 — 총 ${res.totalRearmed}건 재예약 (탈퇴 ${res.rearmedWithdrawals} · 계좌개설 ${res.rearmedProvisions} · 정지전파 ${res.rearmedSuspensions} · S3정리 ${res.rearmedS3Tasks})`,
      });
      setReloadTick(t => t + 1);
    } catch (error) {
      setActionBanner({
        kind: "error",
        text: "아웃박스 전체 재시도 요청에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyDiagnosticsJson() {
    try {
      const payload = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          contentOps,
          tradingOps,
        },
        null,
        2,
      );
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setActionBanner({
          kind: "success",
          text: "운영 진단 JSON 스냅샷을 클립보드에 복사했습니다.",
        });
      } else {
        setActionBanner({
          kind: "error",
          text: "브라우저 클립보드 복사를 사용할 수 없습니다.",
        });
      }
    } catch {
      setActionBanner({
        kind: "error",
        text: "진단 JSON 클립보드 복사에 실패했습니다.",
      });
    }
  }

  async function handleConfirmSymbolStatus() {
    if (!session || !symbolToggleTarget || busyAction !== null) return;
    const { symbol, nextStatus } = symbolToggleTarget;
    setBusyAction(`symbol:${symbol.id}`);
    setSymbolModalError(null);
    try {
      const updated = await session.authorized(cred =>
        updateAdminTradingSymbolStatus(cred.accessToken, symbol.id, nextStatus),
      );
      setTradingSymbols(prev => prev.map(item => (item.id === updated.id ? updated : item)));
      setSymbolToggleTarget(null);
      setActionBanner({
        kind: "success",
        text:
          updated.status === "HALTED"
            ? `${updated.displaySymbol} 종목 거래를 비상 정지(HALTED)했습니다. 신규 진입·수정이 즉시 차단되며 청산·취소·강제청산은 안전하게 유지됩니다.`
            : `${updated.displaySymbol} 종목 거래를 정상 재개(ACTIVE)했습니다.`,
      });
      setReloadTick(t => t + 1);
    } catch (error) {
      setSymbolModalError({
        text: `${symbol.displaySymbol} 종목 상태 변경에 실패했습니다.`,
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReleaseHold(accountId: number) {
    if (!session || busyAction !== null) return;
    setBusyAction(`hold:${accountId}`);
    try {
      const result = await session.authorized(cred =>
        releaseTradingRiskHold(cred.accessToken, accountId, "ADMIN_OPS_UI"),
      );
      if (result.released) {
        setActionBanner({
          kind: "success",
          text: `계정 #${accountId} 정합성 검증 통과(MATCHED) — Risk Hold ${result.releasedCount}건을 안전하게 해제했습니다.`,
        });
      } else {
        const checks =
          result.failedChecks.length > 0
            ? result.failedChecks.join(", ")
            : result.reconciliationStatus;
        setActionBanner({
          kind: "error",
          text: `계정 #${accountId} Risk Hold 해제 차단 (${result.reconciliationStatus}): ${checks}`,
        });
      }
      setReloadTick(t => t + 1);
    } catch (error) {
      setActionBanner({
        kind: "error",
        text: `계정 #${accountId} Risk Hold 해제 요청 중 오류가 발생했습니다.`,
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryS3Cleanup() {
    if (!session || busyAction !== null) return;
    setBusyAction("s3-retry");
    try {
      const res = await session.authorized(cred => retryFailedS3Cleanup(cred.accessToken));
      setActionBanner({
        kind: "success",
        text: `실패한 S3 정리 작업 ${res.retriedCount}건을 대기 상태로 재예약했습니다.`,
      });
      setReloadTick(t => t + 1);
    } catch (error) {
      setActionBanner({
        kind: "error",
        text: "S3 정리 재시도 요청에 실패했습니다.",
        requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReplyInquiry(inquiry: SupportInquiry) {
    if (!session || busyAction !== null) return;
    const replyText = (replyDrafts[inquiry.id] ?? "").trim();
    if (!replyText) {
      setInquiryActionErrors(prev => ({
        ...prev,
        [inquiry.id]: { text: "답변 내용을 입력해 주세요." },
      }));
      return;
    }
    setBusyAction(`reply:${inquiry.id}`);
    setInquiryActionErrors(prev => {
      const next = { ...prev };
      delete next[inquiry.id];
      return next;
    });
    try {
      await session.authorized(cred =>
        replyAdminSupportInquiry(cred.accessToken, inquiry.id, replyText),
      );
      setReplyDrafts(prev => {
        const next = { ...prev };
        delete next[inquiry.id];
        return next;
      });
      setActionBanner({
        kind: "success",
        text: `문의 #${inquiry.id} (${inquiry.memberNickname})에 답변을 등록하고 회원에게 알림을 전송했습니다.`,
      });
      setReloadTick(t => t + 1);
    } catch (error) {
      setInquiryActionErrors(prev => ({
        ...prev,
        [inquiry.id]: {
          text: `문의 #${inquiry.id} 답변 등록에 실패했습니다.`,
          requestId: isUnexpectedApiError(error) ? getErrorRequestId(error) : undefined,
        },
      }));
    } finally {
      setBusyAction(null);
    }
  }

  // Merge & Filter Errors
  const combinedRecentErrors = dedupeOpsErrors([
    ...(contentOps?.errorMetrics?.recentErrors ?? contentOps?.recentErrors ?? []).map(item => ({
      ...item,
      server: "CONTENT" as const,
    })),
    ...(tradingOps?.errorMetrics?.recentErrors ?? tradingOps?.recentErrors ?? []).map(item => ({
      ...item,
      server: "TRADING" as const,
    })),
  ]);

  const combinedCriticalErrors = dedupeOpsErrors([
    ...(contentOps?.errorMetrics?.criticalErrors ?? []).map(item => ({
      ...item,
      server: "CONTENT" as const,
    })),
    ...(tradingOps?.errorMetrics?.criticalErrors ?? tradingOps?.criticalErrors ?? []).map(item => ({
      ...item,
      server: "TRADING" as const,
    })),
  ]);

  const activeErrorSource =
    errorTab === "CRITICAL" ? combinedCriticalErrors : combinedRecentErrors;
  const filteredErrors = activeErrorSource.filter(err => {
    const q = errorTextFilter.trim().toLowerCase();
    const reqQ = errorRequestIdFilter.trim().toLowerCase();
    if (reqQ && !(err.requestId ?? "").toLowerCase().includes(reqQ)) return false;
    if (!q) return true;
    const hay =
      `${err.status} ${err.code ?? ""} ${err.method ?? ""} ${err.uri ?? ""} ${err.rootCause ?? ""} ${err.topAppFrame ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

  const combined5m5xx =
    (contentOps?.errorMetrics?.last5m5xx ?? 0) + (tradingOps?.errorMetrics?.last5m5xx ?? 0);
  const combined1h5xx =
    (contentOps?.errorMetrics?.last1h5xx ?? 0) + (tradingOps?.errorMetrics?.last1h5xx ?? 0);
  const combinedTotal5xx =
    (contentOps?.errorMetrics?.total5xx ?? 0) + (tradingOps?.errorMetrics?.total5xx ?? 0);
  const combinedTotal429 =
    (contentOps?.errorMetrics?.total429 ?? 0) + (tradingOps?.errorMetrics?.total429 ?? 0);
  const combinedTotal409 =
    (contentOps?.errorMetrics?.total409 ?? 0) + (tradingOps?.errorMetrics?.total409 ?? 0);

  const healthCards: Array<{
    title: string;
    detail: string;
    tone: OpsHealthTone;
    badge: string;
  }> = [
    {
      title: "Content DB",
      detail: contentOps ? `지연 ${contentOps.db.latencyMs}ms` : "조회 대기",
      tone: contentOps ? resolveOpsHealthTone(contentOps.db.up) : "yellow",
      badge: contentOps ? (contentOps.db.up ? "UP" : "DOWN") : "LOADING",
    },
    {
      title: "Trading DB",
      detail: tradingOps
        ? `원장 PostgreSQL${tradingOps.dbLatencyMs != null ? ` · 지연 ${tradingOps.dbLatencyMs}ms` : ""}`
        : "조회 대기",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.db) : "yellow",
      badge: tradingOps?.dependencies.db ?? "LOADING",
    },
    {
      title: "Redis 시세·캐시",
      detail: tradingOps?.redis
        ? `지연 ${tradingOps.redis.latencyMs ?? "-"}ms · 갭 ${tradingOps.redis.gapSequence ?? 0}`
        : "실시간 시세 브릿지",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.redis) : "yellow",
      badge: tradingOps?.dependencies.redis ?? "LOADING",
    },
    {
      title: "Binance Mark WS",
      detail: tradingOps?.binance
        ? `재연결 ${tradingOps.binance.markReconnectCount}회 · 틱 경과 ${tradingOps.binance.markLastTickAgeMs ?? "-"}ms`
        : "실시간 마크가격 스트림",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.binanceMarkWs) : "yellow",
      badge: tradingOps?.binance?.markState ?? tradingOps?.dependencies.binanceMarkWs ?? "LOADING",
    },
    {
      title: "Binance OrderBook WS",
      detail: tradingOps?.binance
        ? `재연결 ${tradingOps.binance.orderBookReconnectCount}회${tradingOps.binance.orderBookLastDisconnectReason ? ` · ${tradingOps.binance.orderBookLastDisconnectReason}` : ""}`
        : "실시간 호가 스트림",
      tone: tradingOps
        ? resolveOpsHealthTone(tradingOps.dependencies.binanceOrderBookWs)
        : "yellow",
      badge: tradingOps?.dependencies.binanceOrderBookWs ?? "LOADING",
    },
    {
      title: "Trading Engine",
      detail: tradingOps
        ? `시세 시계 ${tradingOps.status.marketClockStatus}${tradingOps.status.clockSkewMs != null ? ` (${tradingOps.status.clockSkewMs}ms)` : ""}`
        : "엔진 상태 확인 중",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.status.engineStatus) : "yellow",
      badge: tradingOps?.status.engineStatus ?? "LOADING",
    },
    {
      title: "RSS 뉴스 수집기",
      detail: contentOps
        ? `연속 실패 ${contentOps.newsIngestion.consecutiveFailures}회 · 최근 ${formatAdminDateTime(contentOps.newsIngestion.lastCollectedAt)}`
        : "수집 상태 확인 중",
      tone: contentOps
        ? !contentOps.newsIngestion.collectorEnabled
          ? "yellow"
          : contentOps.newsIngestion.live && contentOps.newsIngestion.consecutiveFailures === 0
            ? "green"
            : contentOps.newsIngestion.consecutiveFailures >= 3
              ? "red"
              : "yellow"
        : "yellow",
      badge: contentOps
        ? !contentOps.newsIngestion.collectorEnabled
          ? "DISABLED"
          : contentOps.newsIngestion.live
            ? "LIVE"
            : "DEGRADED"
        : "LOADING",
    },
    {
      title: "마켓 개요 집계",
      detail: tradingOps?.marketOverview
        ? tradingOps.marketOverview.lastError
          ? `지연 그룹 ${tradingOps.marketOverview.staleGroupCount} · ${tradingOps.marketOverview.lastError}`
          : `지연 그룹 ${tradingOps.marketOverview.staleGroupCount}건`
        : "시세 그룹 상태 확인 중",
      tone: tradingOps?.marketOverview
        ? tradingOps.marketOverview.healthy && tradingOps.marketOverview.staleGroupCount === 0
          ? "green"
          : tradingOps.marketOverview.healthy
            ? "yellow"
            : "red"
        : "yellow",
      badge: tradingOps?.marketOverview
        ? tradingOps.marketOverview.healthy
          ? "HEALTHY"
          : "DEGRADED"
        : "LOADING",
    },
  ];

  const recentAlerts = [
    ...(contentOps?.alerts?.recentDispatches ?? []).map(item => ({
      ...item,
      server: "CONTENT" as const,
    })),
    ...(tradingOps?.alerts?.recentDispatches ?? []).map(item => ({
      ...item,
      server: "TRADING" as const,
    })),
  ]
    .sort((a, b) => {
      const ta = a.dispatchedAt ? Date.parse(a.dispatchedAt) : 0;
      const tb = b.dispatchedAt ? Date.parse(b.dispatchedAt) : 0;
      return tb - ta;
    })
    .slice(0, 6);

  return (
    <AdminShell activeSection="ops">
      <div data-admin-ops="true" className="space-y-8">
        {/* 상단 헤더 */}
        <header className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-blue-50 px-2.5 text-[11px] font-black text-[#0058FF]">
                  <V1IconShield className="h-3.5 w-3.5" />
                  <span>SYSTEM OPS &amp; SUPPORT</span>
                </span>
                <span className="text-xs font-semibold text-gray-500">
                  실시간 헬스체크 · JVM · Hikari · Risk Hold · Outbox · 감사 로그 · 1:1 고객문의 통합 관제
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-gray-900">
                시스템 운영 진단 대시보드
              </h1>
              <p className="mt-1 text-xs text-gray-500">
                Content({formatAdminDateTime(contentOps?.generatedAt)}) · Trading(
                {formatAdminDateTime(tradingOps?.capturedAt)}) 실시간 서버 진단 지표입니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <label className="inline-flex h-10 cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-xl border border-gray-200 bg-[#F9FAFB] px-3.5 text-xs font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.checked)}
                  className="m-0 h-4 w-4 shrink-0 accent-[#0058FF]"
                />
                <span>30초 자동 새로고침</span>
              </label>
              <button
                type="button"
                onClick={() => setReloadTick(t => t + 1)}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 cursor-pointer"
              >
                <V1IconRefresh className="h-4 w-4" />
                <span>전체 새로고침</span>
              </button>
            </div>
          </div>

          {/* 운영 원클릭 제어 바 */}
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              data-admin-ops-action="test-alert"
              disabled={busyAction !== null}
              onClick={() => void handleSendTestAlerts()}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-blue-200 bg-blue-50 px-3.5 text-xs font-black text-[#0058FF] transition-colors hover:bg-blue-100 disabled:opacity-40 cursor-pointer"
            >
              {busyAction === "test-alert" ? "알림 발송 중…" : "테스트 알림 발송"}
            </button>
            <button
              type="button"
              data-admin-ops-action="reconcile-now"
              disabled={busyAction !== null}
              onClick={() => void handleReconcileNow()}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-black text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40 cursor-pointer"
            >
              {busyAction === "reconcile-now" ? "원장 대사 실행 중…" : "원장 즉시 대사"}
            </button>
            <button
              type="button"
              data-admin-ops-action="outbox-retry"
              disabled={busyAction !== null}
              onClick={() => void handleRetryOutboxAll()}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-amber-200 bg-amber-50 px-3.5 text-xs font-black text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-40 cursor-pointer"
            >
              {busyAction === "outbox-retry" ? "아웃박스 재시도 중…" : "전체 아웃박스 재시도"}
            </button>
            <button
              type="button"
              data-admin-ops-action="copy-json"
              onClick={() => void handleCopyDiagnosticsJson()}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-[#F9FAFB] px-3.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-100 cursor-pointer"
            >
              진단 JSON 복사
            </button>
          </div>
        </header>

        {/* 배너 */}
        {actionBanner ? (
          <div
            role={actionBanner.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 text-xs font-bold",
              actionBanner.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-emerald-200 bg-emerald-50 text-emerald-800",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {actionBanner.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{actionBanner.text}</span>
              {actionBanner.requestId ? (
                <RequestIdChip requestId={actionBanner.requestId} />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setActionBanner(null)}
              className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold hover:bg-black/5"
            >
              닫기
            </button>
          </div>
        ) : null}

        {(contentError || tradingError) && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-xs font-bold text-[#F6465D]"
          >
            <div className="space-y-1">
              {contentError && (
                <div className="flex flex-wrap items-center gap-2">
                  <p>{contentError.text}</p>
                  {contentError.requestId ? (
                    <RequestIdChip requestId={contentError.requestId} />
                  ) : null}
                </div>
              )}
              {tradingError && (
                <div className="flex flex-wrap items-center gap-2">
                  <p>{tradingError.text}</p>
                  {tradingError.requestId ? (
                    <RequestIdChip requestId={tradingError.requestId} />
                  ) : null}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setReloadTick(t => t + 1)}
              className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-bold text-[#F6465D] hover:bg-rose-100"
            >
              다시 조회
            </button>
          </div>
        )}

        {/* 1. 서비스 헬스체크 8종 */}
        <section aria-label="핵심 서비스 헬스 상태" className="space-y-3">
          <h2 className="text-base font-black text-gray-900">핵심 인프라 &amp; 엔진 상태</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {healthCards.map(card => (
              <div
                key={card.title}
                className="flex flex-col justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-gray-900">{card.title}</span>
                  <HealthBadge tone={card.tone} label={card.badge} />
                </div>
                <p className="text-[11px] font-medium text-gray-500">{card.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 2. JVM 런타임 · HikariCP · 알림 채널 */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* JVM 런타임 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-black text-gray-900">JVM 런타임 &amp; 메모리</h2>
            <div className="space-y-3 text-xs tabular-nums">
              <div className="rounded-xl bg-[#F9FAFB] p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-black text-gray-800">Content JVM</span>
                  <span className="font-bold text-gray-600">
                    {contentOps?.runtime
                      ? `${contentOps.runtime.heapUsedMb} / ${contentOps.runtime.heapMaxMb} MB (${contentOps.runtime.heapUsagePct}%)`
                      : "-"}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      (contentOps?.runtime?.heapUsagePct ?? 0) >= 85
                        ? "bg-[#F6465D]"
                        : "bg-[#0058FF]",
                    )}
                    style={{
                      width: `${Math.min(100, Math.max(0, contentOps?.runtime?.heapUsagePct ?? 0))}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-gray-500">
                  업타임 {formatUptimeKorean(contentOps?.runtime?.uptimeSeconds)} · 프로필{" "}
                  {contentOps?.runtime?.activeProfiles.join(", ") || "-"}
                </p>
              </div>

              <div className="rounded-xl bg-[#F9FAFB] p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-black text-gray-800">Trading JVM</span>
                  <span className="font-bold text-gray-600">
                    {tradingOps?.runtime
                      ? `${tradingOps.runtime.heapUsedMb} / ${tradingOps.runtime.heapMaxMb} MB (${tradingOps.runtime.heapUsagePercent}%)`
                      : "-"}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      (tradingOps?.runtime?.heapUsagePercent ?? 0) >= 85
                        ? "bg-[#F6465D]"
                        : "bg-[#0ECB81]",
                    )}
                    style={{
                      width: `${Math.min(100, Math.max(0, tradingOps?.runtime?.heapUsagePercent ?? 0))}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-gray-500">
                  업타임 {formatUptimeKorean(tradingOps?.runtime?.uptimeSeconds)} · 스레드{" "}
                  {tradingOps?.runtime?.activeThreads ?? "-"}
                  {tradingOps?.runtime?.buildVersion
                    ? ` · v${tradingOps.runtime.buildVersion}`
                    : ""}
                </p>
              </div>
            </div>
          </div>

          {/* HikariCP 커넥션 풀 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-black text-gray-900">HikariCP DB 커넥션 풀</h2>
            <dl className="grid grid-cols-1 gap-3 text-xs tabular-nums">
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="flex items-center justify-between text-[11px] font-black text-gray-700">
                  <span>Content Pool</span>
                  <span className="text-gray-400">
                    최대 {contentOps?.hikari?.maxPoolSize ?? "-"}
                  </span>
                </dt>
                <dd className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-gray-900">
                  <span>활성 {contentOps?.hikari?.active ?? "-"}</span>
                  <span>유휴 {contentOps?.hikari?.idle ?? "-"}</span>
                  <span>전체 {contentOps?.hikari?.total ?? "-"}</span>
                  <span
                    className={
                      (contentOps?.hikari?.threadsAwaiting ?? 0) > 0 ? "text-[#F6465D]" : ""
                    }
                  >
                    대기 {contentOps?.hikari?.threadsAwaiting ?? 0}
                  </span>
                </dd>
              </div>

              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="flex items-center justify-between text-[11px] font-black text-gray-700">
                  <span>Trading Pool</span>
                  <span className="text-gray-400">최대 {tradingOps?.hikari?.max ?? "-"}</span>
                </dt>
                <dd className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-gray-900">
                  <span>활성 {tradingOps?.hikari?.active ?? "-"}</span>
                  <span>유휴 {tradingOps?.hikari?.idle ?? "-"}</span>
                  <span>전체 {tradingOps?.hikari?.total ?? "-"}</span>
                  <span
                    className={(tradingOps?.hikari?.pending ?? 0) > 0 ? "text-[#F6465D]" : ""}
                  >
                    대기 {tradingOps?.hikari?.pending ?? 0}
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          {/* 운영 경보 알림 현황 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-gray-900">운영 경보 알림 채널</h2>
              <HealthBadge
                tone={
                  contentOps?.alerts?.configured || tradingOps?.alerts?.configured
                    ? "green"
                    : "yellow"
                }
                label={
                  contentOps?.alerts?.configured || tradingOps?.alerts?.configured
                    ? "연동됨"
                    : "미설정"
                }
              />
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold text-gray-600">
              <span className="rounded-lg bg-[#F9FAFB] px-2.5 py-1">
                Content: {contentOps?.alerts?.configured ? contentOps.alerts.targetType ?? "WEBHOOK" : "비활성"}
              </span>
              <span className="rounded-lg bg-[#F9FAFB] px-2.5 py-1">
                Trading: {tradingOps?.alerts?.configured ? tradingOps.alerts.targetType ?? "WEBHOOK" : "비활성"}
              </span>
            </div>
            {recentAlerts.length === 0 ? (
              <p className="rounded-xl bg-[#F9FAFB] p-3 text-[11px] font-medium text-gray-500">
                최근 발송된 운영 알림 이력이 없습니다. 상단 &quot;테스트 알림 발송&quot;으로 웹훅 연결을 점검할 수 있습니다.
              </p>
            ) : (
              <ul className="max-h-32 space-y-1.5 overflow-y-auto pr-1 text-[11px]">
                {recentAlerts.map((item, idx) => (
                  <li
                    key={`${item.server}-${item.dispatchedAt ?? idx}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-[#F9FAFB] px-2.5 py-1.5"
                  >
                    <span className="truncate font-bold text-gray-800">
                      [{item.server}] {item.title ?? item.key ?? "알림"}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-gray-500">
                      {item.status ?? "-"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 3. 실시간 연결(WS/SSE) + DurableRiskWorker 메트릭 + Outbox 백로그 */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* 실시간 스트림 연결 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-black text-gray-900">실시간 연결 (WS / SSE)</h2>
            <dl className="grid grid-cols-2 gap-3 text-xs tabular-nums">
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[11px] font-bold text-gray-400">Market WS</dt>
                <dd className="mt-1 text-lg font-black text-gray-900">
                  {tradingOps?.activeWebSockets.market ?? 0}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[11px] font-bold text-gray-400">Trading WS</dt>
                <dd className="mt-1 text-lg font-black text-gray-900">
                  {tradingOps?.activeWebSockets.trading ?? 0}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[11px] font-bold text-gray-400">News / Comm SSE</dt>
                <dd className="mt-1 text-lg font-black text-[#0058FF]">
                  {contentOps?.activeSse.newsSse ?? 0} /{" "}
                  {contentOps?.activeSse.communitySse ?? 0}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[11px] font-bold text-gray-400">Notif / Trading SSE</dt>
                <dd className="mt-1 text-lg font-black text-[#0058FF]">
                  {contentOps?.activeSse.notificationSse ?? 0} /{" "}
                  {tradingOps?.sse?.tradingNotificationSseCount ?? 0}
                </dd>
              </div>
            </dl>
          </div>

          {/* DurableRiskWorker 텔레메트리 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-gray-900">DurableRiskWorker &amp; 원장 대사</h2>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-black",
                  (tradingOps?.ledgerMismatches ?? 0) > 0
                    ? "bg-rose-50 text-[#F6465D]"
                    : "bg-emerald-50 text-[#0ECB81]",
                )}
              >
                원장 불일치 {tradingOps?.ledgerMismatches ?? 0}건
              </span>
            </div>
            {tradingOps?.workerMeasurements ? (
              <dl className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
                <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                  <dt className="text-[10px] font-bold text-gray-400">완료 / 실패 작업</dt>
                  <dd className="mt-0.5 font-black text-gray-900">
                    {tradingOps.workerMeasurements.committedWork} /{" "}
                    <span
                      className={
                        tradingOps.workerMeasurements.failedWork > 0 ? "text-[#F6465D]" : ""
                      }
                    >
                      {tradingOps.workerMeasurements.failedWork}
                    </span>
                  </dd>
                </div>
                <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                  <dt className="text-[10px] font-bold text-gray-400">최대 커밋 / 지연</dt>
                  <dd className="mt-0.5 font-black text-gray-900">
                    {tradingOps.workerMeasurements.maxReceiveCommitMs}ms /{" "}
                    {tradingOps.workerMeasurements.maxWorkDelayMs}ms
                  </dd>
                </div>
                <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                  <dt className="text-[10px] font-bold text-gray-400">잠금 타임아웃 / 유예</dt>
                  <dd className="mt-0.5 font-black text-gray-900">
                    {tradingOps.workerMeasurements.lockTimeouts} /{" "}
                    {tradingOps.workerMeasurements.admissionDeferrals}
                  </dd>
                </div>
                <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                  <dt className="text-[10px] font-bold text-gray-400">대기 / 보류 작업</dt>
                  <dd className="mt-0.5 font-black text-gray-900">
                    {tradingOps.pendingRiskWork.pendingCount} /{" "}
                    {tradingOps.pendingRiskWork.heldCount}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="rounded-xl bg-[#F9FAFB] p-4 text-xs font-medium text-gray-500">
                워커 측정 데이터가 아직 수집되지 않았습니다.
              </p>
            )}
            <p className="text-[11px] font-medium text-gray-500 tabular-nums">
              최근 원장 대사: {formatAdminDateTime(tradingOps?.lastReconciliationAt)}
            </p>
          </div>

          {/* Content Outbox & S3 Cleanup */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-gray-900">Outbox &amp; S3 정리 큐</h2>
              <button
                type="button"
                disabled={busyAction !== null || (contentOps?.outbox.failedS3Cleanup ?? 0) === 0}
                onClick={() => void handleRetryS3Cleanup()}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-black text-[#0058FF] transition-colors hover:bg-blue-100 disabled:opacity-40 cursor-pointer"
              >
                {busyAction === "s3-retry" ? "재시도 중…" : "S3 실패 재시도"}
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                <dt className="text-[10px] font-bold text-gray-400">탈퇴 전파 (대기/지연)</dt>
                <dd className="mt-0.5 font-black text-gray-900">
                  {contentOps?.outbox.pendingWithdrawals ?? 0} /{" "}
                  <span
                    className={
                      (contentOps?.outbox.stuckWithdrawals ?? 0) > 0 ? "text-[#F6465D]" : ""
                    }
                  >
                    {contentOps?.outbox.stuckWithdrawals ?? 0}
                  </span>
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                <dt className="text-[10px] font-bold text-gray-400">계좌개설 (대기/지연)</dt>
                <dd className="mt-0.5 font-black text-gray-900">
                  {contentOps?.outbox.pendingProvisions ?? 0} /{" "}
                  <span
                    className={
                      (contentOps?.outbox.stuckProvisions ?? 0) > 0 ? "text-[#F6465D]" : ""
                    }
                  >
                    {contentOps?.outbox.stuckProvisions ?? 0}
                  </span>
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                <dt className="text-[10px] font-bold text-gray-400">정지전파 (대기/지연)</dt>
                <dd className="mt-0.5 font-black text-gray-900">
                  {contentOps?.outbox.pendingSuspensions ?? 0} /{" "}
                  <span
                    className={
                      (contentOps?.outbox.stuckSuspensions ?? 0) > 0 ? "text-[#F6465D]" : ""
                    }
                  >
                    {contentOps?.outbox.stuckSuspensions ?? 0}
                  </span>
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                <dt className="text-[10px] font-bold text-gray-400">S3 정리 (대기/실패)</dt>
                <dd className="mt-0.5 font-black text-gray-900">
                  {contentOps?.outbox.pendingS3Cleanup ?? 0} /{" "}
                  <span
                    className={
                      (contentOps?.outbox.failedS3Cleanup ?? 0) > 0 ? "text-[#F6465D]" : ""
                    }
                  >
                    {contentOps?.outbox.failedS3Cleanup ?? 0}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 원장 불일치 상세 또는 Outbox 지연 항목이 있을 때만 자동 노출 */}
        {((tradingOps?.ledgerMismatchDetails.length ?? 0) > 0 ||
          (contentOps?.outbox.stuckDetails.length ?? 0) > 0) && (
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {(tradingOps?.ledgerMismatchDetails.length ?? 0) > 0 ? (
              <div className="rounded-2xl border border-rose-200 bg-white p-5 space-y-3">
                <h2 className="text-sm font-black text-[#F6465D]">
                  원장 불일치 상세 ({tradingOps!.ledgerMismatchDetails.length}건)
                </h2>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-bold">계정 ID</th>
                        <th className="px-3 py-2 font-bold">실패 점검 항목</th>
                        <th className="px-3 py-2 font-bold">점검 시각</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tradingOps!.ledgerMismatchDetails.map((item, idx) => (
                        <tr key={`${item.accountId}-${idx}`}>
                          <td className="px-3 py-2 font-black tabular-nums">#{item.accountId}</td>
                          <td className="px-3 py-2 text-[#F6465D] font-bold">
                            {item.failedChecks.join(", ") || "-"}
                          </td>
                          <td className="px-3 py-2 text-gray-500 tabular-nums">
                            {formatAdminDateTime(item.checkedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {(contentOps?.outbox.stuckDetails.length ?? 0) > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-white p-5 space-y-3">
                <h2 className="text-sm font-black text-amber-800">
                  Outbox 지연 상세 ({contentOps!.outbox.stuckDetails.length}건)
                </h2>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-bold">유형</th>
                        <th className="px-3 py-2 font-bold">대상</th>
                        <th className="px-3 py-2 font-bold">시도</th>
                        <th className="px-3 py-2 font-bold">최근 오류</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {contentOps!.outbox.stuckDetails.map((item, idx) => (
                        <tr key={`${item.kind}-${item.id}-${idx}`}>
                          <td className="px-3 py-2 font-bold text-gray-800">{item.kind}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">{item.target}</td>
                          <td className="px-3 py-2 tabular-nums">{item.attemptCount}</td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-[#F6465D]">
                            {item.lastError ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* 4. RSS 피드 소스별 현황 & S3 미디어 저장소 진단 */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-gray-900">
                RSS 뉴스 피드 소스별 상태 ({contentOps?.rssSources.length ?? 0}개)
              </h2>
            </div>
            {(contentOps?.rssSources.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-6 text-center text-xs font-bold text-gray-400">
                수집 중인 RSS 소스 상태 정보가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                    <tr>
                      <th className="px-3 py-2.5 font-bold">피드명</th>
                      <th className="px-3 py-2.5 font-bold">카테고리</th>
                      <th className="px-3 py-2.5 font-bold text-center">상태</th>
                      <th className="px-3 py-2.5 font-bold text-right">연속실패 / 수집건</th>
                      <th className="px-3 py-2.5 font-bold">최근 성공 / 오류</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {contentOps!.rssSources.map(src => (
                      <tr key={src.name} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 font-bold text-gray-900">{src.name}</td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {src.section ?? "-"}
                          {src.subCategory ? ` / ${src.subCategory}` : ""}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <HealthBadge
                            tone={src.healthy ? "green" : src.consecutiveFailures >= 3 ? "red" : "yellow"}
                            label={src.healthy ? "정상" : "점검 필요"}
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          <span className={src.consecutiveFailures > 0 ? "font-black text-[#F6465D]" : ""}>
                            {src.consecutiveFailures}회
                          </span>{" "}
                          / {src.lastIngestedCount}건
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 text-[11px] text-gray-500">
                          {src.lastError ? (
                            <span className="font-bold text-[#F6465D]">{src.lastError}</span>
                          ) : (
                            formatAdminDateTime(src.lastSuccessAt)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-gray-900">미디어 스토리지 상태</h2>
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-black text-gray-700">
                {contentOps?.s3Storage?.mode ?? "-"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[10px] font-bold text-gray-400">삭제 대기</dt>
                <dd className="mt-1 text-base font-black text-gray-900">
                  {contentOps?.s3Storage?.pendingCleanupCount ??
                    contentOps?.outbox.pendingS3Cleanup ??
                    0}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[10px] font-bold text-gray-400">삭제 실패</dt>
                <dd
                  className={cn(
                    "mt-1 text-base font-black",
                    (contentOps?.s3Storage?.failedCleanupCount ??
                      contentOps?.outbox.failedS3Cleanup ??
                      0) > 0
                      ? "text-[#F6465D]"
                      : "text-gray-900",
                  )}
                >
                  {contentOps?.s3Storage?.failedCleanupCount ??
                    contentOps?.outbox.failedS3Cleanup ??
                    0}
                </dd>
              </div>
            </dl>
            {(contentOps?.s3Storage?.recentFailedTasks.length ?? 0) > 0 ? (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto text-[11px]">
                {contentOps!.s3Storage!.recentFailedTasks.map(task => (
                  <li
                    key={task.id}
                    className="rounded-lg border border-rose-100 bg-rose-50/50 p-2 space-y-0.5"
                  >
                    <p className="truncate font-mono font-bold text-gray-800">
                      #{task.id} {task.objectKey}
                    </p>
                    <p className="truncate text-[#F6465D]">
                      시도 {task.attemptCount}회 · {task.lastError ?? "실패"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-[#F9FAFB] p-3 text-[11px] font-medium text-gray-500">
                실패한 미디어 삭제 작업이 없습니다.
              </p>
            )}
          </div>
        </section>

        {/* 5. Trading Risk Holds 대기열 (검증 후 1클릭 해제) */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-black text-gray-900">
                미해결 Trading Risk Holds ({tradingOps?.riskHolds.unresolvedCount ?? 0}건)
              </h2>
              <p className="text-xs text-gray-500">
                해제 버튼 클릭 시 서버에서 즉시 원장 정합성(LedgerReconciler)을 재검증하며, 불일치(409) 시 해제를 차단하고 실패 항목을 표시합니다.
              </p>
            </div>
          </div>

          {!tradingOps || tradingOps.riskHolds.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
              현재 미해결 Risk Hold 계정이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-bold">Hold ID</th>
                    <th className="px-4 py-3 font-bold">계정 ID</th>
                    <th className="px-4 py-3 font-bold">종목 / 이벤트</th>
                    <th className="px-4 py-3 font-bold">사유</th>
                    <th className="px-4 py-3 font-bold">보류 시각</th>
                    <th className="px-4 py-3 font-bold text-right">조치</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {tradingOps.riskHolds.items.map(hold => (
                    <tr key={hold.holdId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-black tabular-nums text-gray-900">
                        #{hold.holdId}
                      </td>
                      <td className="px-4 py-3 font-bold tabular-nums text-gray-800">
                        계정 #{hold.accountId}
                      </td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">
                        심볼 {hold.tradingSymbolId ?? "-"} · 이벤트 {hold.eventId ?? "-"}
                      </td>
                      <td className="px-4 py-3 font-medium text-amber-800">
                        {hold.reason ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 tabular-nums">
                        {formatAdminDateTime(hold.heldAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => void handleReleaseHold(hold.accountId)}
                          className="inline-flex h-8 items-center rounded-lg bg-[#0058FF] px-3 text-[11px] font-black text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                        >
                          {busyAction === `hold:${hold.accountId}` ? "검증 중…" : "정합성 검증 후 해제"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 6. 거래 종목 비상 제어 (ACTIVE <-> HALTED) */}
        <section
          aria-label="거래 종목 비상 제어"
          data-admin-symbol-control="true"
          className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-black text-gray-900">
                거래 종목 비상 제어 ({tradingSymbols.length}개 종목)
              </h2>
              <p className="text-xs text-gray-500">
                종목을 비상 정지(HALTED)하면 신규 진입·주문 수정·견적·레버리지 변경·SL/TP 설정이 즉시 차단되며, 기존 포지션 청산·취소·강제청산은 안전하게 유지됩니다.
              </p>
            </div>
          </div>

          {symbolsError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-[#F6465D]"
            >
              <span>{symbolsError.text}</span>
              {symbolsError.requestId ? <RequestIdChip requestId={symbolsError.requestId} /> : null}
            </div>
          ) : loadingSymbols && tradingSymbols.length === 0 ? (
            <div aria-hidden="true" className="animate-pulse space-y-2 rounded-xl border border-gray-200 p-4">
              <div className="h-4 w-full rounded bg-gray-100" />
              <div className="h-4 w-5/6 rounded bg-gray-100" />
              <div className="h-4 w-4/6 rounded bg-gray-100" />
            </div>
          ) : tradingSymbols.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
              표시할 거래 종목 정보가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-bold">종목 ID</th>
                    <th className="px-4 py-3 font-bold">표시 심볼 / 종목명</th>
                    <th className="px-4 py-3 font-bold">공급자 심볼</th>
                    <th className="px-4 py-3 font-bold text-center">상태</th>
                    <th className="px-4 py-3 font-bold text-right">비상 제어</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {tradingSymbols.map(sym => {
                    const isActive = sym.status === "ACTIVE";
                    const isHalted = sym.status === "HALTED";
                    const canToggle = isActive || isHalted;
                    const nextStatus: "ACTIVE" | "HALTED" = isActive ? "HALTED" : "ACTIVE";
                    return (
                      <tr key={sym.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-black tabular-nums text-gray-500">
                          #{sym.id}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-black text-gray-900">{sym.displaySymbol}</span>
                          <span className="ml-2 text-gray-500">{sym.name}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-600">
                          {sym.provider} · {sym.providerSymbol}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <HealthBadge
                            tone={isActive ? "green" : isHalted ? "red" : "yellow"}
                            label={sym.status}
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canToggle ? (
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() => {
                                setSymbolModalError(null);
                                setSymbolToggleTarget({ symbol: sym, nextStatus });
                              }}
                              className={cn(
                                "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border px-3 text-[11px] font-black transition-colors disabled:opacity-50 cursor-pointer",
                                isActive
                                  ? "border-rose-200 bg-rose-50 text-[#F6465D] hover:bg-rose-100"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                              )}
                            >
                              {busyAction === `symbol:${sym.id}`
                                ? "처리 중…"
                                : isActive
                                  ? "비상 정지 (HALT)"
                                  : "거래 재개 (ACTIVE)"}
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-gray-400">
                              비활성 종목
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 7. 1:1 고객문의 답변 큐 (CLOSED · 카테고리 · 검색 · 커서 페이지네이션) */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
          <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-black text-gray-900">
                1:1 고객문의 관리 (미답변 {openInquiryCount} · 답변완료 {answeredInquiryCount} · 종료 {closedInquiryCount})
              </h2>
              <p className="text-xs text-gray-500">
                답변 등록 시 해당 회원에게 실시간 알림이 즉시 발송됩니다.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="1:1 문의 상태 필터"
              className="flex flex-wrap items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold"
            >
              {(
                [
                  { key: "OPEN", label: `미답변 (${openInquiryCount})` },
                  { key: "ANSWERED", label: `답변완료 (${answeredInquiryCount})` },
                  { key: "CLOSED", label: `종료됨 (${closedInquiryCount})` },
                  { key: "ALL", label: "전체" },
                ] as const
              ).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={inquiryFilter === tab.key}
                  onClick={() => setInquiryFilter(tab.key)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 transition-colors cursor-pointer",
                    inquiryFilter === tab.key
                      ? "bg-white text-gray-900"
                      : "text-gray-500 hover:text-gray-800",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 카테고리 + 키워드 검색 바 */}
          <form
            onSubmit={e => {
              e.preventDefault();
              setInquiryKeyword(inquiryKeywordInput.trim());
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <select
              aria-label="문의 카테고리 필터"
              value={inquiryCategoryFilter}
              onChange={e => setInquiryCategoryFilter(e.target.value)}
              className="h-9 rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-700 focus:border-[#0058FF] focus:outline-none"
            >
              <option value="ALL">전체 카테고리</option>
              {SUPPORT_INQUIRY_CATEGORIES.map(cat => (
                <option key={cat.code} value={cat.code}>
                  {cat.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={inquiryKeywordInput}
              onChange={e => setInquiryKeywordInput(e.target.value)}
              placeholder="제목·내용·닉네임 검색"
              className="h-9 min-w-[200px] flex-1 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex h-9 shrink-0 items-center rounded-xl bg-gray-900 px-3.5 text-xs font-bold text-white hover:bg-gray-800 cursor-pointer"
            >
              검색
            </button>
            {inquiryKeyword ? (
              <button
                type="button"
                onClick={() => {
                  setInquiryKeywordInput("");
                  setInquiryKeyword("");
                }}
                className="inline-flex h-9 shrink-0 items-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer"
              >
                초기화
              </button>
            ) : null}
          </form>

          {inquiriesError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-[#F6465D]"
            >
              <span>{inquiriesError.text}</span>
              {inquiriesError.requestId ? (
                <RequestIdChip requestId={inquiriesError.requestId} />
              ) : null}
            </div>
          ) : loadingInquiries && inquiries.length === 0 ? (
            <div aria-hidden="true" className="animate-pulse space-y-3">
              <div className="h-24 rounded-2xl bg-gray-100" />
              <div className="h-24 rounded-2xl bg-gray-100" />
            </div>
          ) : inquiries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-10 text-center text-xs font-bold text-gray-400">
              표시할 1:1 문의가 없습니다.
            </div>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-4">
                {inquiries.map(inquiry => {
                  const rowError = inquiryActionErrors[inquiry.id];
                  return (
                    <li
                      key={inquiry.id}
                      className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[11px] font-black",
                              inquiry.status === "ANSWERED"
                                ? "bg-emerald-50 text-[#0ECB81]"
                                : inquiry.status === "CLOSED"
                                  ? "bg-gray-200 text-gray-700"
                                  : "bg-amber-50 text-amber-700",
                            )}
                          >
                            {formatSupportStatusLabel(inquiry.status)}
                          </span>
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[#0058FF]">
                            {supportCategoryLabel(inquiry.category)}
                          </span>
                          <span className="font-bold text-gray-800">
                            {inquiry.memberNickname} (#{inquiry.memberId})
                          </span>
                        </div>
                        <span className="text-gray-400 tabular-nums">
                          #{inquiry.id} · {formatAdminDateTime(inquiry.createdAt)}
                          {inquiry.closedAt
                            ? ` · 종료 ${formatAdminDateTime(inquiry.closedAt)}`
                            : ""}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-sm font-black text-gray-900">{inquiry.title}</h3>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                          {inquiry.content}
                        </p>
                      </div>

                      {inquiry.adminReply ? (
                        <div className="rounded-xl border border-blue-100 bg-white p-3.5 text-xs">
                          <p className="font-black text-[#0058FF]">
                            등록된 답변 · {formatAdminDateTime(inquiry.repliedAt)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-gray-700">
                            {inquiry.adminReply}
                          </p>
                        </div>
                      ) : null}

                      {rowError ? (
                        <div
                          role="alert"
                          className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-[#F6465D]"
                        >
                          <span>{rowError.text}</span>
                          {rowError.requestId ? (
                            <RequestIdChip requestId={rowError.requestId} />
                          ) : null}
                        </div>
                      ) : null}

                      {inquiry.status === "CLOSED" ? (
                        <p className="text-[11px] font-semibold text-gray-400">
                          회원이 종료한 문의입니다.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end">
                          <textarea
                            rows={2}
                            maxLength={3000}
                            value={replyDrafts[inquiry.id] ?? ""}
                            onChange={e =>
                              setReplyDrafts(prev => ({
                                ...prev,
                                [inquiry.id]: e.target.value,
                              }))
                            }
                            placeholder={
                              inquiry.adminReply
                                ? "추가 또는 수정 답변을 입력해 주세요…"
                                : "회원에게 전달할 답변을 입력해 주세요…"
                            }
                            className="flex-1 rounded-xl border border-gray-300 bg-white p-3 text-xs text-gray-900 focus:border-[#0058FF] focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => void handleReplyInquiry(inquiry)}
                            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#0058FF] px-4 text-xs font-black text-white transition-colors hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                          >
                            {busyAction === `reply:${inquiry.id}` ? "전송 중…" : "답변 등록"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {inquiriesHasNext ? (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={loadingMoreInquiries}
                    onClick={() => void handleLoadMoreInquiries()}
                    className="inline-flex h-9 items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                  >
                    {loadingMoreInquiries ? "불러오는 중…" : "문의 더 보기"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* 8. API 오류 링버퍼 + 롤링 지표 + RequestId 검색 + 클라이언트 런타임 오류 */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-black text-gray-900">
                API 오류 진단 로그 ({filteredErrors.length}건)
              </h2>
              <p className="text-xs text-gray-500">
                Content + Trading 치명 오류 및 최근 5xx/409/429/503 링버퍼
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black tabular-nums">
              <span
                className={cn(
                  "rounded-lg px-2.5 py-1",
                  combined5m5xx > 0 ? "bg-rose-50 text-[#F6465D]" : "bg-gray-100 text-gray-700",
                )}
              >
                5분 5xx: {combined5m5xx}
              </span>
              <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-gray-700">
                1시간 5xx: {combined1h5xx}
              </span>
              <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-gray-700">
                누적 5xx: {combinedTotal5xx}
              </span>
              <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-800">
                429 제한: {combinedTotal429}
              </span>
              <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[#0058FF]">
                409 충돌: {combinedTotal409}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="오류 로그 분류"
              className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold"
            >
              <button
                type="button"
                role="tab"
                aria-selected={errorTab === "RECENT"}
                onClick={() => setErrorTab("RECENT")}
                className={cn(
                  "rounded-lg px-3 py-1.5 cursor-pointer",
                  errorTab === "RECENT" ? "bg-white text-gray-900" : "text-gray-500",
                )}
              >
                최근 전체 오류 ({combinedRecentErrors.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={errorTab === "CRITICAL"}
                onClick={() => setErrorTab("CRITICAL")}
                className={cn(
                  "rounded-lg px-3 py-1.5 cursor-pointer",
                  errorTab === "CRITICAL" ? "bg-white text-[#F6465D]" : "text-gray-500",
                )}
              >
                치명 오류 ({combinedCriticalErrors.length})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={errorRequestIdFilter}
                onChange={e => setErrorRequestIdFilter(e.target.value)}
                placeholder="Request ID 검색"
                className="h-9 w-44 rounded-xl border border-gray-200 bg-white px-3 font-mono text-xs text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
              />
              <input
                type="search"
                value={errorTextFilter}
                onChange={e => setErrorTextFilter(e.target.value)}
                placeholder="상태·경로·원인 필터"
                className="h-9 w-48 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
              />
            </div>
          </div>

          {filteredErrors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
              조건에 해당하는 API 오류가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="px-3 py-3 font-bold">시각</th>
                    <th className="px-3 py-3 font-bold">서버</th>
                    <th className="px-3 py-3 font-bold">상태 / 코드</th>
                    <th className="px-3 py-3 font-bold">요청 경로</th>
                    <th className="px-3 py-3 font-bold">Request ID</th>
                    <th className="px-3 py-3 font-bold">원인 요약 / 스택</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredErrors.map((err, idx) => (
                    <tr key={`${err.server}-${err.requestId ?? idx}-${err.occurredAt ?? idx}`}>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-500">
                        {formatAdminDateTime(err.occurredAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[10px] font-black",
                            err.server === "TRADING"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-blue-50 text-[#0058FF]",
                          )}
                        >
                          {err.server}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-black text-[#F6465D] tabular-nums">
                        {err.status} {err.code ? `· ${err.code}` : ""}
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-2.5 font-mono text-[11px] text-gray-800">
                        {err.method ?? ""} {err.uri ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-gray-500">
                        {err.requestId ? <RequestIdChip requestId={err.requestId} compact /> : "-"}
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5 text-gray-600">
                        <p className="truncate">{err.rootCause ?? "-"}</p>
                        {err.topAppFrame ? (
                          <p className="truncate font-mono text-[10px] text-gray-400">
                            {err.topAppFrame}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 클라이언트 런타임 오류 (Frontend Error Boundary Beacons) */}
          <div className="border-t border-gray-100 pt-5 space-y-3">
            <h3 className="text-sm font-black text-gray-900">
              클라이언트 런타임 오류 ({contentOps?.clientErrors.length ?? 0}건)
            </h3>
            {(contentOps?.clientErrors.length ?? 0) === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-5 text-center text-xs font-bold text-gray-400">
                최근 수집된 브라우저 런타임 오류가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[780px] text-left text-xs">
                  <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                    <tr>
                      <th className="px-3 py-2.5 font-bold">시각</th>
                      <th className="px-3 py-2.5 font-bold">라우트</th>
                      <th className="px-3 py-2.5 font-bold">오류 메시지</th>
                      <th className="px-3 py-2.5 font-bold">Digest / Request ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {contentOps!.clientErrors.map((ce, idx) => (
                      <tr key={`${ce.requestId ?? idx}-${ce.occurredAt ?? idx}`}>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-500">
                          {formatAdminDateTime(ce.occurredAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] font-bold text-gray-800">
                          {ce.route ?? "-"}
                        </td>
                        <td className="max-w-[340px] truncate px-3 py-2.5 text-[#F6465D] font-medium">
                          {ce.message}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-gray-500">
                          {ce.requestId ? (
                            <RequestIdChip requestId={ce.requestId} compact />
                          ) : (
                            ce.digest ?? "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* 9. 관리자 감사 로그 (Content + Trading) */}
        <section
          aria-label="관리자 감사 로그"
          data-admin-audit-logs="true"
          className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4"
        >
          <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-black text-gray-900">관리자 감사 로그</h2>
              <p className="text-xs text-gray-500">
                회원 제재·OAuth 차단 해제·대회 운영·종목 제어·Risk Hold 해제 등 주요 관리자 조치 이력입니다.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="감사 로그 서버 전환"
              className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold"
            >
              <button
                type="button"
                role="tab"
                aria-selected={auditTab === "CONTENT"}
                onClick={() => setAuditTab("CONTENT")}
                className={cn(
                  "rounded-lg px-3 py-1.5 cursor-pointer",
                  auditTab === "CONTENT" ? "bg-white text-gray-900" : "text-gray-500",
                )}
              >
                Content 감사 로그
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={auditTab === "TRADING"}
                onClick={() => setAuditTab("TRADING")}
                className={cn(
                  "rounded-lg px-3 py-1.5 cursor-pointer",
                  auditTab === "TRADING" ? "bg-white text-gray-900" : "text-gray-500",
                )}
              >
                Trading 감사 로그
              </button>
            </div>
          </div>

          {auditTab === "CONTENT" ? (
            <form
              onSubmit={e => {
                e.preventDefault();
                setAuditActionFilter(auditActionFilterInput.trim());
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="search"
                value={auditActionFilterInput}
                onChange={e => setAuditActionFilterInput(e.target.value)}
                placeholder="액션 코드 필터 (예: MEMBER_SUSPEND)"
                className="h-9 w-64 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-xl bg-gray-900 px-3.5 text-xs font-bold text-white hover:bg-gray-800 cursor-pointer"
              >
                필터 적용
              </button>
              {auditActionFilter ? (
                <button
                  type="button"
                  onClick={() => {
                    setAuditActionFilterInput("");
                    setAuditActionFilter("");
                  }}
                  className="inline-flex h-9 items-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer"
                >
                  초기화
                </button>
              ) : null}
            </form>
          ) : null}

          {auditError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-[#F6465D]"
            >
              <span>{auditError.text}</span>
              {auditError.requestId ? <RequestIdChip requestId={auditError.requestId} /> : null}
            </div>
          ) : loadingAudit ? (
            <div aria-hidden="true" className="animate-pulse space-y-2 rounded-xl border border-gray-200 p-4">
              <div className="h-4 w-full rounded bg-gray-100" />
              <div className="h-4 w-5/6 rounded bg-gray-100" />
              <div className="h-4 w-4/6 rounded bg-gray-100" />
            </div>
          ) : auditTab === "CONTENT" ? (
            contentAuditLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
                표시할 Content 감사 로그가 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[840px] text-left text-xs">
                    <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                      <tr>
                        <th className="px-3 py-2.5 font-bold">시각</th>
                        <th className="px-3 py-2.5 font-bold">관리자</th>
                        <th className="px-3 py-2.5 font-bold">액션</th>
                        <th className="px-3 py-2.5 font-bold">대상</th>
                        <th className="px-3 py-2.5 font-bold">요약</th>
                        <th className="px-3 py-2.5 font-bold">Request ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {contentAuditLogs.map(log => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-500">
                            {formatAdminDateTime(log.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-bold text-gray-800">
                            {log.adminNickname
                              ? `${log.adminNickname} (#${log.adminMemberId})`
                              : `#${log.adminMemberId}`}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] font-black text-[#0058FF]">
                            {log.action}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-gray-600 tabular-nums">
                            {log.targetType ?? "-"} {log.targetId ? `#${log.targetId}` : ""}
                          </td>
                          <td className="max-w-[280px] truncate px-3 py-2.5 text-gray-700">
                            {log.summary ?? log.detailJson ?? "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            {log.requestId ? (
                              <RequestIdChip requestId={log.requestId} compact />
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {contentAuditHasNext ? (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      disabled={loadingMoreAudit}
                      onClick={() => void handleLoadMoreAuditLogs()}
                      className="inline-flex h-9 items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                    >
                      {loadingMoreAudit ? "불러오는 중…" : "Content 감사 로그 더 보기"}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          ) : tradingAuditLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
              표시할 Trading 감사 로그가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                    <tr>
                      <th className="px-3 py-2.5 font-bold">시각</th>
                      <th className="px-3 py-2.5 font-bold">관리자 ID</th>
                      <th className="px-3 py-2.5 font-bold">액션</th>
                      <th className="px-3 py-2.5 font-bold">대상</th>
                      <th className="px-3 py-2.5 font-bold">상세 내용</th>
                      <th className="px-3 py-2.5 font-bold">Request ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {tradingAuditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-gray-500">
                          {formatAdminDateTime(log.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-bold text-gray-800 tabular-nums">
                          관리자 #{log.adminMemberId}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] font-black text-amber-800">
                          {log.action}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-gray-600 tabular-nums">
                          {log.targetType ?? "-"} {log.targetId ? `#${log.targetId}` : ""}
                        </td>
                        <td className="max-w-[300px] truncate px-3 py-2.5 text-gray-700">
                          {log.detail ?? "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {log.requestId ? (
                            <RequestIdChip requestId={log.requestId} compact />
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tradingAuditHasNext ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={loadingMoreAudit}
                    onClick={() => void handleLoadMoreAuditLogs()}
                    className="inline-flex h-9 items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                  >
                    {loadingMoreAudit ? "불러오는 중…" : "Trading 감사 로그 더 보기"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* 종목 비상 정지 / 재개 확인 모달 */}
        <DimModal
          open={symbolToggleTarget !== null}
          onClose={() => {
            if (busyAction === null) {
              setSymbolModalError(null);
              setSymbolToggleTarget(null);
            }
          }}
          title={
            symbolToggleTarget?.nextStatus === "HALTED"
              ? "거래 종목 비상 정지 (HALTED) 확인"
              : "거래 종목 정상 재개 (ACTIVE) 확인"
          }
          subtitle={
            symbolToggleTarget
              ? `${symbolToggleTarget.symbol.displaySymbol} (${symbolToggleTarget.symbol.providerSymbol})`
              : undefined
          }
        >
          {symbolToggleTarget ? (
            <div className="space-y-4">
              {symbolToggleTarget.nextStatus === "HALTED" ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed font-bold text-rose-800">
                  {symbolToggleTarget.symbol.displaySymbol} 종목을 비상 정지(HALTED)하시겠습니까?
                  신규 진입 주문, 지정가 수정, 견적, 레버리지 변경, SL/TP 설정이 즉시 차단되며 공개 종목 목록에서 숨겨집니다. 기존 포지션 청산·취소 및 리스크 청산 엔진은 안전하게 유지됩니다.
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-relaxed font-bold text-emerald-800">
                  {symbolToggleTarget.symbol.displaySymbol} 종목을 정상 거래(ACTIVE) 상태로 복구하시겠습니까? 복구 즉시 공개 종목 목록 및 신규 주문이 재개됩니다.
                </div>
              )}
              {symbolModalError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-[#F6465D]"
                >
                  <V1IconAlert className="h-4 w-4 shrink-0" />
                  <span>{symbolModalError.text}</span>
                  {symbolModalError.requestId ? (
                    <RequestIdChip requestId={symbolModalError.requestId} />
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => {
                    setSymbolModalError(null);
                    setSymbolToggleTarget(null);
                  }}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleConfirmSymbolStatus()}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl px-4 text-xs font-black text-white disabled:opacity-50 cursor-pointer",
                    symbolToggleTarget.nextStatus === "HALTED"
                      ? "bg-[#F6465D] hover:bg-rose-700"
                      : "bg-[#0058FF] hover:bg-blue-700",
                  )}
                >
                  {busyAction !== null
                    ? "처리 중…"
                    : symbolToggleTarget.nextStatus === "HALTED"
                      ? "비상 정지 실행"
                      : "거래 재개 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>
      </div>
    </AdminShell>
  );
}
