"use client";

import { useEffect, useState } from "react";
import { useOptionalMember } from "../../member/components/member-provider";
import { supportCategoryLabel, type SupportInquiry, type SupportInquiryFilterStatus } from "../../member/api/support";
import {
  cn,
  V1IconAlert,
  V1IconCheck,
  V1IconRefresh,
  V1IconShield,
} from "../../member/components/v1-ui";
import {
  fetchAdminSupportInquiries,
  fetchContentOpsSummary,
  fetchTradingOpsSummary,
  formatAdminDateTime,
  releaseTradingRiskHold,
  replyAdminSupportInquiry,
  retryFailedS3Cleanup,
  type ContentOpsSummary,
  type OpsErrorEntry,
  type TradingOpsSummary,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

export type OpsHealthTone = "green" | "yellow" | "red";

export function resolveOpsHealthTone(statusRaw: string | boolean | null | undefined): OpsHealthTone {
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
    normalized === "HEALTHY"
  ) {
    return "green";
  }
  if (
    normalized === "DEGRADED" ||
    normalized === "RECOVERING" ||
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

export function AdminOpsView() {
  const memberCtx = useOptionalMember();
  const phase = memberCtx?.snapshot.phase;
  const role = memberCtx?.snapshot.role;
  const generation = memberCtx?.snapshot.generation;
  const session = memberCtx?.session;

  const [contentOps, setContentOps] = useState<ContentOpsSummary | null>(null);
  const [tradingOps, setTradingOps] = useState<TradingOpsSummary | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [tradingError, setTradingError] = useState<string | null>(null);

  const [inquiryFilter, setInquiryFilter] = useState<SupportInquiryFilterStatus>("OPEN");
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([]);
  const [openInquiryCount, setOpenInquiryCount] = useState(0);
  const [answeredInquiryCount, setAnsweredInquiryCount] = useState(0);
  const [inquiriesError, setInquiriesError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();

    void session
      .authorized(cred => fetchContentOpsSummary(cred.accessToken, { signal: controller.signal }), true)
      .then(summary => {
        setContentError(null);
        setContentOps(summary);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setContentError("Content 서버 운영 지표를 불러오지 못했습니다.");
      });

    void session
      .authorized(cred => fetchTradingOpsSummary(cred.accessToken, { signal: controller.signal }), true)
      .then(summary => {
        setTradingError(null);
        setTradingOps(summary);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTradingError("Trading 서버 운영 지표를 불러오지 못했습니다.");
      });

    return () => controller.abort();
  }, [phase, role, generation, session, reloadTick]);

  useEffect(() => {
    if (phase !== "ready" || role !== "ADMIN" || !session) return;
    const controller = new AbortController();
    void session
      .authorized(cred =>
        fetchAdminSupportInquiries(
          cred.accessToken,
          { status: inquiryFilter, size: 20 },
          { signal: controller.signal },
        ),
        true,
      )
      .then(res => {
        setInquiriesError(null);
        setInquiries(res.items);
        setOpenInquiryCount(res.openCount);
        setAnsweredInquiryCount(res.answeredCount);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setInquiriesError("1:1 고객문의 목록을 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [phase, role, generation, session, inquiryFilter, reloadTick]);

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
          result.failedChecks.length > 0 ? result.failedChecks.join(", ") : result.reconciliationStatus;
        setActionBanner({
          kind: "error",
          text: `계정 #${accountId} Risk Hold 해제 차단 (${result.reconciliationStatus}): ${checks}`,
        });
      }
      setReloadTick(t => t + 1);
    } catch {
      setActionBanner({
        kind: "error",
        text: `계정 #${accountId} Risk Hold 해제 요청 중 오류가 발생했습니다.`,
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
        text: `실패한 S3 정리 작업 ${res.retriedCount}건을 PENDING 상태로 재예약했습니다.`,
      });
      setReloadTick(t => t + 1);
    } catch {
      setActionBanner({
        kind: "error",
        text: "S3 정리 재시도 요청에 실패했습니다.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReplyInquiry(inquiry: SupportInquiry) {
    if (!session || busyAction !== null) return;
    const replyText = (replyDrafts[inquiry.id] ?? "").trim();
    if (!replyText) {
      setActionBanner({ kind: "error", text: "답변 내용을 입력해 주세요." });
      return;
    }
    setBusyAction(`reply:${inquiry.id}`);
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
    } catch {
      setActionBanner({
        kind: "error",
        text: `문의 #${inquiry.id} 답변 등록에 실패했습니다.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  const combinedErrors: Array<OpsErrorEntry & { server: "CONTENT" | "TRADING" }> = [
    ...(contentOps?.recentErrors ?? []).map(item => ({ ...item, server: "CONTENT" as const })),
    ...(tradingOps?.recentErrors ?? []).map(item => ({ ...item, server: "TRADING" as const })),
  ]
    .sort((a, b) => {
      const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
      const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
      return tb - ta;
    })
    .slice(0, 50);

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
      detail: "원장 PostgreSQL",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.db) : "yellow",
      badge: tradingOps?.dependencies.db ?? "LOADING",
    },
    {
      title: "Redis 시세·캐시",
      detail: "실시간 시세 브릿지",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.redis) : "yellow",
      badge: tradingOps?.dependencies.redis ?? "LOADING",
    },
    {
      title: "Binance Mark WS",
      detail: "실시간 마크가격 스트림",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.binanceMarkWs) : "yellow",
      badge: tradingOps?.dependencies.binanceMarkWs ?? "LOADING",
    },
    {
      title: "Binance OrderBook WS",
      detail: "실시간 호가 스트림",
      tone: tradingOps ? resolveOpsHealthTone(tradingOps.dependencies.binanceOrderBookWs) : "yellow",
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
  ];

  return (
    <AdminShell activeSection="ops">
      <div data-admin-ops="true" className="space-y-8">
        {/* 상단 헤더 */}
        <header className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-blue-50 px-2.5 text-[11px] font-black text-[#0058FF]">
                <V1IconShield className="h-3.5 w-3.5" />
                <span>SYSTEM OPS &amp; SUPPORT</span>
              </span>
              <span className="text-xs font-semibold text-gray-500">
                실시간 헬스체크 · Risk Hold · Outbox · 1:1 고객문의 통합 관제
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
          <button
            type="button"
            onClick={() => setReloadTick(t => t + 1)}
            className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <V1IconRefresh className="h-4 w-4" />
            <span>전체 새로고침</span>
          </button>
        </header>

        {/* 배너 */}
        {actionBanner ? (
          <div
            role={actionBanner.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 text-xs font-bold",
              actionBanner.kind === "error"
                ? "border-rose-200 bg-rose-50 text-[#F6465D]"
                : "border-emerald-200 bg-emerald-50 text-emerald-800",
            )}
          >
            <div className="flex items-center gap-2">
              {actionBanner.kind === "error" ? (
                <V1IconAlert className="h-4 w-4 shrink-0" />
              ) : (
                <V1IconCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{actionBanner.text}</span>
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
            <div className="space-y-0.5">
              {contentError && <p>{contentError}</p>}
              {tradingError && <p>{tradingError}</p>}
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

        {/* 1. 서비스 헬스체크 7종 */}
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

        {/* 2. 실시간 연결(WS/SSE) + DurableRiskWorker 메트릭 + Outbox 백로그 */}
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
                <dt className="text-[11px] font-bold text-gray-400">News SSE</dt>
                <dd className="mt-1 text-lg font-black text-[#0058FF]">
                  {contentOps?.activeSse.newsSse ?? 0}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F9FAFB] p-3">
                <dt className="text-[11px] font-bold text-gray-400">Community / Notif SSE</dt>
                <dd className="mt-1 text-lg font-black text-[#0058FF]">
                  {contentOps?.activeSse.communitySse ?? 0} /{" "}
                  {contentOps?.activeSse.notificationSse ?? 0}
                </dd>
              </div>
            </dl>
          </div>

          {/* DurableRiskWorker 텔레메트리 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-gray-900">DurableRiskWorker 지표</h2>
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
                  <dt className="text-[10px] font-bold text-gray-400">Committed / Failed</dt>
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
                  <dt className="text-[10px] font-bold text-gray-400">Max Commit / Delay</dt>
                  <dd className="mt-0.5 font-black text-gray-900">
                    {tradingOps.workerMeasurements.maxReceiveCommitMs}ms /{" "}
                    {tradingOps.workerMeasurements.maxWorkDelayMs}ms
                  </dd>
                </div>
                <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                  <dt className="text-[10px] font-bold text-gray-400">Lock Timeouts / Deferrals</dt>
                  <dd className="mt-0.5 font-black text-gray-900">
                    {tradingOps.workerMeasurements.lockTimeouts} /{" "}
                    {tradingOps.workerMeasurements.admissionDeferrals}
                  </dd>
                </div>
                <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                  <dt className="text-[10px] font-bold text-gray-400">Pending / Held Work</dt>
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
          </div>

          {/* Content Outbox & S3 Cleanup */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-gray-900">Outbox &amp; S3 정리 큐</h2>
              <button
                type="button"
                disabled={busyAction !== null || (contentOps?.outbox.failedS3Cleanup ?? 0) === 0}
                onClick={() => void handleRetryS3Cleanup()}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-black text-[#0058FF] transition-colors hover:bg-blue-100 disabled:opacity-40"
              >
                {busyAction === "s3-retry" ? "재시도 중…" : "S3 실패 재시도"}
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                <dt className="text-[10px] font-bold text-gray-400">탈퇴 Outbox (대기/지연)</dt>
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
              <div className="rounded-xl bg-[#F9FAFB] p-2.5">
                <dt className="text-[10px] font-bold text-gray-400">미답변 1:1 문의</dt>
                <dd className="mt-0.5 font-black text-amber-600">
                  {contentOps?.openSupportInquiries ?? openInquiryCount}건
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 3. Trading Risk Holds 대기열 (검증 후 1클릭 해제) */}
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
                          className="inline-flex h-8 items-center rounded-lg bg-[#0058FF] px-3 text-[11px] font-black text-white hover:bg-blue-700 disabled:opacity-50"
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

        {/* 4. 1:1 고객문의 답변 큐 */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-base font-black text-gray-900">
                1:1 고객문의 관리 (미답변 {openInquiryCount} · 답변완료 {answeredInquiryCount})
              </h2>
              <p className="text-xs text-gray-500">
                답변 등록 시 해당 회원에게 실시간 알림(SUPPORT_INQUIRY_ANSWERED)이 즉시 발송됩니다.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
              {(
                [
                  { key: "OPEN", label: `미답변 (${openInquiryCount})` },
                  { key: "ANSWERED", label: `답변완료 (${answeredInquiryCount})` },
                  { key: "ALL", label: "전체" },
                ] as const
              ).map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setInquiryFilter(tab.key)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 transition-colors",
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

          {inquiriesError ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-[#F6465D]">
              {inquiriesError}
            </p>
          ) : inquiries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-10 text-center text-xs font-bold text-gray-400">
              표시할 1:1 문의가 없습니다.
            </div>
          ) : (
            <ul className="space-y-4">
              {inquiries.map(inquiry => (
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
                            : "bg-amber-50 text-amber-700",
                        )}
                      >
                        {inquiry.status === "ANSWERED" ? "ANSWERED" : "OPEN"}
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
                      <p className="mt-1 whitespace-pre-wrap text-gray-700">{inquiry.adminReply}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end">
                    <textarea
                      rows={2}
                      maxLength={3000}
                      value={replyDrafts[inquiry.id] ?? ""}
                      onChange={e =>
                        setReplyDrafts(prev => ({ ...prev, [inquiry.id]: e.target.value }))
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
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#0058FF] px-4 text-xs font-black text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busyAction === `reply:${inquiry.id}` ? "전송 중…" : "답변 등록"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 5. 최근 API 오류 링버퍼 (최대 50건) */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-gray-900">
              최근 API 오류 로그 ({combinedErrors.length}건)
            </h2>
            <span className="text-xs font-medium text-gray-400">
              Content + Trading 5xx/409/503 인메모리 링버퍼
            </span>
          </div>

          {combinedErrors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
              최근 기록된 5xx / 409 / 503 API 오류가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="border-b border-gray-200 bg-[#F9FAFB] text-gray-500">
                  <tr>
                    <th className="px-3 py-3 font-bold">시각</th>
                    <th className="px-3 py-3 font-bold">서버</th>
                    <th className="px-3 py-3 font-bold">상태 / 코드</th>
                    <th className="px-3 py-3 font-bold">요청 경로</th>
                    <th className="px-3 py-3 font-bold">Request ID</th>
                    <th className="px-3 py-3 font-bold">원인 요약</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {combinedErrors.map((err, idx) => (
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
                      <td className="max-w-[260px] truncate px-3 py-2.5 font-mono text-[11px] text-gray-800">
                        {err.method ?? ""} {err.uri ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-gray-500">
                        {err.requestId ?? "-"}
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-2.5 text-gray-600">
                        {err.rootCause ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
