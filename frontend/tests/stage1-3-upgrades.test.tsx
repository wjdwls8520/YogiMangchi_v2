import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import {
  latestTakeProfit,
  parseCancelAllOrdersResponse,
  parseCloseAllPositionsResponse,
  parsePortfolioVisibility,
  parseTakeProfit,
  takeProfitRequest,
} from "../src/features/trading/api/take-profit-contract";
import { takeProfitEstimate, takeProfitRoePreset } from "../src/features/trading/api/position-display";
import {
  parseLatestTradingEvents,
  parseTradingEvent,
  tradingEventNotice,
} from "../src/features/trading/api/trading-events";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError } from "../src/features/trading/api/client";
import { createMemberSession } from "../src/features/member/api/session";
import { ContentApiError } from "../src/features/member/api/client";
import { MemberProvider } from "../src/features/member/components/member-provider";
import {
  dispatchNotificationSseEvent,
  isNotificationStatusEventName,
} from "../src/features/member/notifications/notification-api";
import {
  formatNotificationDescription,
  formatNotificationTitle,
  getNotificationNavigationTarget,
  normalizeRawNotification,
  shouldSuppressToastOnPath,
} from "../src/features/member/notifications/notification-utils";
import { extractNewsConnectedLiveStatus } from "../src/features/member/components/news-feed";
import { parseNewsReaction, parsePublicMemberPortfolio } from "../src/features/member/api/community-news";
import { readPolicies } from "../src/features/member/api/policies";
import { PolicyContent } from "../src/features/member/components/policy-content";
import {
  mySupportInquiriesPath,
  parseAdminSupportInquiryPage,
  parseSupportInquiry,
  supportCategoryLabel,
} from "../src/features/member/api/support";
import { SupportCenter } from "../src/features/member/components/support-center";
import {
  fetchAdminReports,
  fetchContentOpsSummary,
  fetchTradingOpsSummary,
  parseContentOpsSummary,
  parseTradingHoldReleaseResult,
  parseTradingOpsSummary,
  releaseTradingRiskHold,
  restoreAdminCommunityPost,
  retryFailedS3Cleanup,
  suspendAdminMember,
  unsuspendAdminMember,
} from "../src/features/admin/api/admin-api";
import { AdminOpsView, resolveOpsHealthTone } from "../src/features/admin/components/admin-ops";

const epoch = Date.parse("2026-11-21T10:00:00Z");

test("Take Profit contract, version precedence, exact BigInt ROE preset & estimate, and batch parsers", () => {
  const noneTp = parseTakeProfit(
    {
      positionId: 10,
      tradingSymbolId: 1,
      side: "LONG",
      status: "NONE",
      takeProfitPrice: null,
      version: 0,
      updatedAt: null,
      triggeredAt: null,
      priceEventTime: null,
      triggerPrice: null,
      triggerOrderId: null,
      reason: null,
    },
    10,
    1,
    "LONG",
  );
  assert.equal(noneTp.status, "NONE");

  const activeTp = parseTakeProfit(
    {
      positionId: 10,
      tradingSymbolId: 1,
      side: "LONG",
      status: "ACTIVE",
      takeProfitPrice: "105000.5",
      version: 2,
      updatedAt: "2026-11-21T10:00:00Z",
      triggeredAt: null,
      priceEventTime: null,
      triggerPrice: null,
      triggerOrderId: null,
      reason: null,
    },
    10,
    1,
    "LONG",
  );
  assert.equal(latestTakeProfit(noneTp, activeTp)?.version, 2);
  assert.equal(latestTakeProfit(activeTp, noneTp)?.version, 2);

  const putReq = takeProfitRequest({
    positionId: 10,
    expectedVersion: 0,
    takeProfitPrice: "105000.5",
  });
  assert.equal(putReq.method, "PUT");
  assert.equal(putReq.path, "account/positions/10/take-profit");
  assert.deepEqual(putReq.body, { takeProfitPrice: "105000.5", expectedVersion: 0 });

  const delReq = takeProfitRequest({ positionId: 10, expectedVersion: 2 });
  assert.equal(delReq.method, "DELETE");
  assert.equal(delReq.path, "account/positions/10/take-profit?expectedVersion=2");

  // Exact BigInt TP ROE preset & estimate (no float drift)
  const longPos = { side: "LONG" as const, entryPrice: "100000", quantity: "0.1", margin: "1000" };
  assert.equal(takeProfitRoePreset(longPos, 50, 2), "105000");
  const longEst = takeProfitEstimate(longPos, "105000", "101000");
  assert.ok(longEst);
  assert.equal(longEst.grossPnl, "500");
  assert.equal(longEst.estimatedRoe, "50");
  assert.equal(longEst.warning, null);

  const longInvalidEst = takeProfitEstimate(longPos, "99000", "101000");
  assert.ok(longInvalidEst?.warning?.includes("LONG 익절가"));

  const shortPos = { side: "SHORT" as const, entryPrice: "100000", quantity: "0.1", margin: "1000" };
  assert.equal(takeProfitRoePreset(shortPos, 100, 2), "90000");
  const shortEst = takeProfitEstimate(shortPos, "90000", "99000");
  assert.ok(shortEst);
  assert.equal(shortEst.grossPnl, "1000");
  assert.equal(shortEst.estimatedRoe, "100");
  assert.equal(shortEst.warning, null);

  const cancelAll = parseCancelAllOrdersResponse({ canceledCount: 0, orders: [] });
  assert.equal(cancelAll.canceledCount, 0);
  const closeAll = parseCloseAllPositionsResponse({ closedCount: 0, orders: [] });
  assert.equal(closeAll.closedCount, 0);

  const visibility = parsePortfolioVisibility({
    memberId: 7,
    portfolioPublic: false,
    updatedAt: "2026-11-21T10:00:00Z",
  });
  assert.equal(visibility.memberId, 7);
  assert.equal(visibility.portfolioPublic, false);
});

test("Trading events support TAKE_PROFIT_CHANGED, TAKE_PROFIT fill notices, and newest-first latest=true lists", () => {
  const tpEvent = parseTradingEvent({
    eventId: "205",
    type: "TAKE_PROFIT_CHANGED",
    occurredAt: "2026-11-21T10:05:00Z",
    order: null,
    takeProfit: {
      positionId: 10,
      tradingSymbolId: 1,
      side: "LONG",
      status: "ACTIVE",
      takeProfitPrice: "105000",
      version: 1,
      updatedAt: "2026-11-21T10:05:00Z",
      triggeredAt: null,
      priceEventTime: null,
      triggerPrice: null,
      triggerOrderId: null,
      reason: null,
    },
  });
  assert.equal(tpEvent.type, "TAKE_PROFIT_CHANGED");
  assert.equal(tradingEventNotice(tpEvent), null);

  const tpFillEvent = parseTradingEvent({
    eventId: "206",
    type: "ORDER_FILLED",
    occurredAt: "2026-11-21T10:06:00Z",
    order: {
      orderId: 99,
      positionId: 10,
      tradingSymbolId: 1,
      side: "LONG",
      action: "CLOSE",
      type: "MARKET",
      status: "FILLED",
      quantity: "0.1",
      feeRate: "0.0005",
      reservedFee: "0",
      leverage: 10,
      requestedLeverage: 10,
      limitPrice: null,
      reservedMargin: "0",
      reservedCloseQuantity: "0",
      reason: "TAKE_PROFIT",
      createdAt: "2026-11-21T10:06:00Z",
      completedAt: "2026-11-21T10:06:00Z",
      fill: {
        fillId: 501,
        quantity: "0.1",
        price: "105000",
        priceEventTime: "2026-11-21T10:06:00Z",
        executedAt: "2026-11-21T10:06:00Z",
        realizedPnl: "500",
        fee: "5.25",
        settlementAdjustment: "0",
        marginMode: "ISOLATED",
      },
    },
  });
  const notice = tradingEventNotice(tpFillEvent);
  assert.equal(notice?.kind, "success");
  assert.match(notice?.title ?? "", /익절 주문이 체결되었습니다/);

  // parseLatestTradingEvents validates strictly descending order (newest-first)
  const latest = parseLatestTradingEvents([
    {
      eventId: "206",
      type: "TAKE_PROFIT_CHANGED",
      occurredAt: "2026-11-21T10:06:00Z",
      order: null,
      takeProfit: {
        positionId: 10,
        tradingSymbolId: 1,
        side: "LONG",
        status: "CANCELED",
        takeProfitPrice: "105000",
        version: 2,
        updatedAt: "2026-11-21T10:06:00Z",
        triggeredAt: null,
        priceEventTime: null,
        triggerPrice: null,
        triggerOrderId: null,
        reason: null,
      },
    },
    {
      eventId: "205",
      type: "TAKE_PROFIT_CHANGED",
      occurredAt: "2026-11-21T10:05:00Z",
      order: null,
      takeProfit: {
        positionId: 10,
        tradingSymbolId: 1,
        side: "LONG",
        status: "ACTIVE",
        takeProfitPrice: "105000",
        version: 1,
        updatedAt: "2026-11-21T10:05:00Z",
        triggeredAt: null,
        priceEventTime: null,
        triggerPrice: null,
        triggerOrderId: null,
        reason: null,
      },
    },
  ]);
  assert.equal(latest.length, 2);
  assert.equal(latest[0].eventId, "206");
  assert.equal(latest[1].eventId, "205");
  assert.throws(() => parseLatestTradingEvents([latest[1], latest[0]]));
});

test("GuestSession supports writeTakeProfit, cancelAllOrders, closeAllPositions, and account/events?latest=true", async () => {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (url.endsWith("/accounts/guest") && method === "POST") {
      return Response.json({
        accountId: 50,
        tokenType: "Bearer",
        quoteAsset: "USDT",
        status: "ACTIVE",
        initialBalance: "10000",
        accessToken: `guest_${"a".repeat(43)}`,
        expiresAt: new Date(epoch + 86_400_000).toISOString(),
      });
    }
    if (url.includes("/take-profit") && method === "PUT") {
      return Response.json({
        positionId: 10,
        tradingSymbolId: 1,
        side: "LONG",
        status: "ACTIVE",
        takeProfitPrice: "105000",
        version: 1,
        updatedAt: "2026-11-21T10:00:00Z",
        triggeredAt: null,
        priceEventTime: null,
        triggerPrice: null,
        triggerOrderId: null,
        reason: null,
      });
    }
    if (url.endsWith("/account/orders/cancel-all") && method === "POST") {
      return Response.json({ canceledCount: 2, orders: [] });
    }
    if (url.endsWith("/account/positions/close-all") && method === "POST") {
      return Response.json({ closedCount: 1, orders: [] });
    }
    if (url.includes("account/events?afterId=0&limit=50&latest=true")) {
      return Response.json([]);
    }
    return Response.json({}, { status: 404 });
  };

  const memStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStore.set(k, v);
    },
    removeItem: (k: string) => {
      memStore.delete(k);
    },
  };

  const session = createGuestSession(
    "http://localhost:8081",
    () => mockStorage,
    transport,
    () => epoch,
  );
  await session.createGuest();
  const snap = session.getSnapshot();
  assert.equal(snap.phase, "ready");

  const tp = await session.writeTakeProfit(
    { positionId: 10, expectedVersion: 0, takeProfitPrice: "105000" },
    snap,
    "tp-key-12345678",
  );
  assert.equal(tp.status, "ACTIVE");

  const cancelRes = await session.cancelAllOrders(snap);
  assert.equal(cancelRes.canceledCount, 2);

  const closeRes = await session.closeAllPositions(snap);
  assert.equal(closeRes.closedCount, 1);

  const latestEvents = await session.read("account/events?afterId=0&limit=50&latest=true", snap, new AbortController().signal);
  assert.deepEqual(latestEvents, []);

  assert.equal(calls.some(c => c.method === "PUT" && c.url.endsWith("/account/positions/10/take-profit")), true);
  assert.equal(calls.some(c => c.method === "POST" && c.url.endsWith("/account/orders/cancel-all")), true);
  assert.equal(calls.some(c => c.method === "POST" && c.url.endsWith("/account/positions/close-all")), true);
});

test("MemberSession auto-refreshes JWT on TradingApiError 401, expires >60s stale pending marker, unblocks anonymous 403 CSRF_INVALID, and supports logoutAll", async () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  const now = epoch;
  let refreshCount = 0;
  let logoutAllCalls = 0;
  let csrfMode: "ok" | "403" = "403";

  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/csrf")) {
      return Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf-tok" });
    }
    if (url.endsWith("/auth/refresh")) {
      refreshCount += 1;
      if (csrfMode === "403") {
        return Response.json({ code: "CSRF_INVALID" }, { status: 403 });
      }
      return Response.json({
        memberId: 7,
        nickname: "트레이더7",
        tokenType: "Bearer",
        accessToken: `header.payload.tok${refreshCount}`,
        expiresIn: 900,
        expiresAt: new Date(now + 900_000).toISOString(),
      });
    }
    if (url.endsWith("/auth/logout-all") && init?.method === "POST") {
      logoutAllCalls += 1;
      return new Response(null, { status: 204 });
    }
    return Response.json({ ok: true });
  };

  // 1. Cold anonymous 403 CSRF_INVALID cleanly settles as anonymous (unblocking Guest trading)
  const coldSession = createMemberSession(
    "http://localhost:8080",
    transport,
    () => now,
    fn => fn(),
    () => true,
    () => storage,
  );
  await assert.rejects(coldSession.restore(), err => err instanceof ContentApiError && err.status === 403);
  assert.equal(coldSession.getSnapshot().phase, "anonymous");
  assert.equal(coldSession.getSnapshot().recovery, undefined);
  assert.equal(store.size, 0);

  // 2. Stale (>60s) refresh-pending marker auto-expires instead of locking session forever
  csrfMode = "ok";
  store.set(
    "yogimangchi:content-refresh-pending:http://localhost:8080",
    JSON.stringify({ status: "pending", at: now - 65_000 }),
  );
  await coldSession.restore();
  assert.equal(coldSession.getSnapshot().phase, "ready");
  assert.equal(store.size, 0);

  // 3. authorized() refreshes JWT and retries on BOTH TradingApiError(401) and ContentApiError(401)
  let tradingAttempts = 0;
  const tradingResult = await coldSession.authorized(async cred => {
    tradingAttempts += 1;
    if (tradingAttempts === 1) throw new TradingApiError(401);
    return cred.accessToken;
  }, true);
  assert.equal(tradingAttempts, 2);
  assert.equal(tradingResult, `header.payload.tok${refreshCount}`);

  let contentAttempts = 0;
  const contentResult = await coldSession.authorized(async cred => {
    contentAttempts += 1;
    if (contentAttempts === 1) throw new ContentApiError(401);
    return cred.accessToken;
  }, true);
  assert.equal(contentAttempts, 2);
  assert.equal(contentResult, `header.payload.tok${refreshCount}`);

  // 4. logoutAll calls POST /auth/logout-all and clears session
  await coldSession.logoutAll();
  assert.equal(logoutAllCalls, 1);
  assert.equal(coldSession.getSnapshot().phase, "anonymous");
});

test("Notification SSE accepts both STATUS & NOTIFICATION_STATUS, new notification types format cleanly, and trading terminal suppresses duplicate trade toasts", () => {
  assert.equal(isNotificationStatusEventName("STATUS"), true);
  assert.equal(isNotificationStatusEventName("NOTIFICATION_STATUS"), true);
  assert.equal(isNotificationStatusEventName("HEARTBEAT"), false);

  const statuses: Array<{ source: string; unread: number; newCount: number }> = [];
  for (const eventName of ["STATUS", "NOTIFICATION_STATUS"]) {
    dispatchNotificationSseEvent(
      "TRADING",
      eventName,
      JSON.stringify({ unreadCount: 5, newCount: 2 }),
      {
        onNotification: () => {},
        onStatus: (source, s) => statuses.push({ source, unread: s.unreadCount, newCount: s.newCount }),
      },
    );
  }
  assert.equal(statuses.length, 2);
  assert.deepEqual(statuses[0], { source: "TRADING", unread: 5, newCount: 2 });
  assert.deepEqual(statuses[1], { source: "TRADING", unread: 5, newCount: 2 });

  const nowIso = new Date(epoch).toISOString();
  const tpFill = normalizeRawNotification("TRADING", {
    notificationId: 501,
    actorMemberId: null,
    category: "MOCK",
    type: "ORDER_COMPLETED",
    isRead: false,
    createdAt: nowIso,
    lastEventAt: nowIso,
    payload: {
      displayNameKr: "비트코인",
      orderType: "TAKE_PROFIT_MARKET",
      positionSide: "LONG",
      positionAction: "CLOSE",
      quantity: "0.2",
      realizedPnl: "420",
    },
  });
  assert.equal(formatNotificationTitle(tpFill), "비트코인 익절 주문 체결되었습니다.");
  assert.equal(shouldSuppressToastOnPath("/trading", tpFill), true);
  assert.equal(shouldSuppressToastOnPath("/contest/3/trading", tpFill), true);
  assert.equal(shouldSuppressToastOnPath("/community", tpFill), false);

  const canceledSeason = normalizeRawNotification("TRADING", {
    notificationId: 502,
    actorMemberId: null,
    category: "CONTEST",
    type: "CONTEST_SEASON_CANCELED",
    isRead: false,
    createdAt: nowIso,
    lastEventAt: nowIso,
    payload: { seasonId: 9, seasonTitle: "제9회 시즌", reason: "운영 점검" },
  });
  assert.match(formatNotificationTitle(canceledSeason), /취소되었습니다/);
  assert.equal(getNotificationNavigationTarget(canceledSeason)?.href, "/me?tab=contest-assets&seasonId=9");

  const supportAnswered = normalizeRawNotification("CONTENT", {
    notificationId: 503,
    actorMemberId: null,
    category: "SUPPORT",
    type: "SUPPORT_INQUIRY_ANSWERED",
    isRead: false,
    createdAt: nowIso,
    lastEventAt: nowIso,
    payload: { title: "입출금 테스트 문의", replyPreview: "안내드린 내용을 확인해 주세요." },
  });
  assert.match(formatNotificationTitle(supportAnswered), /답변이 등록되었습니다/);
  assert.equal(formatNotificationDescription(supportAnswered), '답변: "안내드린 내용을 확인해 주세요."');
  assert.equal(getNotificationNavigationTarget(supportAnswered)?.href, "/support");
  assert.equal(shouldSuppressToastOnPath("/trading", supportAnswered), false);

  const reportResolved = normalizeRawNotification("CONTENT", {
    notificationId: 504,
    actorMemberId: null,
    category: "COMMUNITY",
    type: "REPORT_RESOLVED",
    isRead: false,
    createdAt: nowIso,
    lastEventAt: nowIso,
    payload: { postId: 88, title: "광고 게시글", resolutionNote: "규정 위반으로 삭제" },
  });
  assert.match(formatNotificationTitle(reportResolved), /검토 완료 처리되었습니다/);
  assert.equal(getNotificationNavigationTarget(reportResolved)?.href, "/community/all/88");
});

test("News SSE CONNECTED extracts nested liveStatus, reaction supports idempotent toggle-off, and public portfolio parses portfolioPublic", () => {
  assert.deepEqual(
    extractNewsConnectedLiveStatus({
      liveStatus: { live: true, collectorEnabled: true, retentionHours: 6, lastCollectedAt: null },
    }),
    { live: true, collectorEnabled: true, retentionHours: 6, lastCollectedAt: null },
  );
  assert.deepEqual(
    extractNewsConnectedLiveStatus({ live: false, collectorEnabled: false, retentionHours: 12 }),
    { live: false, collectorEnabled: false, retentionHours: 12, lastCollectedAt: null },
  );
  assert.equal(extractNewsConnectedLiveStatus({ ok: true }), null);

  const toggledOff = parseNewsReaction({
    newsId: 12,
    reaction: null,
    userReaction: null,
    bullCount: 10,
    bearCount: 4,
    bullPct: 71,
    bearPct: 29,
  });
  assert.equal(toggledOff.userReaction, null);
  assert.equal(toggledOff.reaction, null);

  const privatePortfolio = parsePublicMemberPortfolio({
    memberId: 11,
    accountExists: true,
    portfolioPublic: false,
    roundNumber: null,
    initialSeed: "0",
    valuedAt: null,
    wallet: null,
    allocation: null,
    closedTradeSummary: null,
    positions: [],
    symbolPerformances: [],
  });
  assert.equal(privatePortfolio.portfolioPublic, false);
});

test("Policies accept PUBLISHED documentStatus and PolicyContent renders published legal copy without draft brackets", async () => {
  const termsText = "제1조 (목적) 요기망치 이용약관입니다.";
  const privacyText = "제1조 (개인정보 처리 목적) 요기망치 개인정보처리방침입니다.";
  const sha256Hex = async (text: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))))
      .map(v => v.toString(16).padStart(2, "0"))
      .join("");
  const termsHash = await sha256Hex(termsText);
  const privacyHash = await sha256Hex(privacyText);

  const bundle = await readPolicies("http://localhost:8080", new AbortController().signal, async url => {
    const target = String(url);
    if (target.endsWith("/policies/current")) {
      return Response.json({
        reconsentRequired: false,
        policies: [
          {
            type: "TERMS",
            version: "ym-terms-v2",
            required: true,
            accepted: true,
            lastAcceptedVersion: "ym-terms-v2",
            lastAcceptedAt: "2026-11-21T00:00:00Z",
            documentUrl: "/api/v1/policies/TERMS/ym-terms-v2",
          },
          {
            type: "PRIVACY",
            version: "ym-privacy-v2",
            required: true,
            accepted: true,
            lastAcceptedVersion: "ym-privacy-v2",
            lastAcceptedAt: "2026-11-21T00:00:00Z",
            documentUrl: "/api/v1/policies/PRIVACY/ym-privacy-v2",
          },
        ],
      });
    }
    if (target.endsWith("/policies/TERMS/ym-terms-v2")) {
      return Response.json({
        type: "TERMS",
        version: "ym-terms-v2",
        documentStatus: "PUBLISHED",
        sha256: termsHash,
        text: termsText,
      });
    }
    return Response.json({
      type: "PRIVACY",
      version: "ym-privacy-v2",
      documentStatus: "PUBLISHED",
      sha256: privacyHash,
      text: privacyText,
    });
  });

  assert.equal(bundle.documents.TERMS.documentStatus, "PUBLISHED");
  assert.equal(bundle.documents.PRIVACY.documentStatus, "PUBLISHED");

  const html = renderToStaticMarkup(
    <PolicyContent type="TERMS" document={bundle.documents.TERMS} />,
  );
  assert.match(html, /시행 중인 공식 이용약관/);
  assert.match(html, /<h2>이용약관 전문<\/h2>/);
  assert.match(html, /제1조 \(목적\) 요기망치 이용약관입니다\./);
  assert.equal(html.includes("ym-terms-"), false);
  assert.equal(html.includes("[추후"), false);
});

test("Support Center parsers, SSR views, and Admin Ops + Moderation contracts work end-to-end", async () => {
  const inquiry = parseSupportInquiry({
    id: 1,
    memberId: 7,
    memberNickname: "트레이더7",
    category: "TRADING",
    title: "익절 주문 관련 문의",
    content: "TP 설정 기준이 궁금합니다.",
    status: "ANSWERED",
    adminReply: "Mark Price 기준으로 발동됩니다.",
    repliedByMemberId: 1,
    repliedAt: "2026-11-21T10:30:00Z",
    createdAt: "2026-11-21T10:00:00Z",
  });
  assert.equal(inquiry.status, "ANSWERED");
  assert.equal(supportCategoryLabel("TRADING"), "선물 모의투자");
  assert.equal(mySupportInquiriesPath({ status: "OPEN", size: 10 }), "/support/inquiries/me?status=OPEN&size=10");

  const adminInquiries = parseAdminSupportInquiryPage({
    items: [inquiry],
    hasNext: false,
    nextCursorId: null,
    openCount: 3,
    answeredCount: 12,
  });
  assert.equal(adminInquiries.openCount, 3);
  assert.equal(adminInquiries.answeredCount, 12);

  // Ops summary parsers & health tone helper
  const contentOps = parseContentOpsSummary({
    generatedAt: "2026-11-21T10:00:00Z",
    db: { up: true, latencyMs: 4 },
    newsIngestion: { live: true, collectorEnabled: true, lastCollectedAt: "2026-11-21T09:59:00Z", consecutiveFailures: 0 },
    outbox: {
      pendingWithdrawals: 0,
      stuckWithdrawals: 0,
      pendingProvisions: 1,
      stuckProvisions: 0,
      pendingS3Cleanup: 2,
      failedS3Cleanup: 1,
    },
    openSupportInquiries: 3,
    activeSse: { newsSse: 10, communitySse: 5, notificationSse: 8 },
    recentErrors: [],
  });
  assert.equal(contentOps.db.up, true);
  assert.equal(contentOps.outbox.failedS3Cleanup, 1);

  const tradingOps = parseTradingOpsSummary({
    status: { engineStatus: "OPEN", marketClockStatus: "OK", clockSkewMs: 12 },
    dependencies: { db: "UP", redis: "UP", binanceMarkWs: "CONNECTED", binanceOrderBookWs: "CONNECTED" },
    workerMeasurements: {
      committedWork: 100,
      maxReceiveCommitMs: 42,
      maxWorkDelayMs: 18,
      failedWork: 0,
      lockTimeouts: 0,
      readyQueries: 50,
      readyQueryNanos: 1000,
      maxReadyQueryNanos: 200,
      selectedWork: 100,
      admissionDeferrals: 0,
    },
    riskHolds: {
      unresolvedCount: 1,
      items: [{ holdId: 4, accountId: 22, tradingSymbolId: 1, eventId: 99, reason: "LEDGER_MISMATCH", heldAt: "2026-11-21T09:00:00Z" }],
    },
    pendingRiskWork: { pendingCount: 0, heldCount: 1 },
    ledgerMismatches: 1,
    activeWebSockets: { market: 6, trading: 3 },
    recentErrors: [],
    capturedAt: "2026-11-21T10:00:00Z",
  });
  assert.equal(tradingOps.riskHolds.unresolvedCount, 1);
  assert.equal(resolveOpsHealthTone("OPEN"), "green");
  assert.equal(resolveOpsHealthTone("DEGRADED"), "yellow");
  assert.equal(resolveOpsHealthTone("DOWN"), "red");

  const matchedRelease = parseTradingHoldReleaseResult({
    accountId: 22,
    reconciliationStatus: "MATCHED",
    failedChecks: [],
    releasedCount: 1,
    resolutionReference: "OPS-1",
    checkedAt: "2026-11-21T10:10:00Z",
  });
  assert.equal(matchedRelease.released, true);

  // Verify admin API network contracts (suspend, unsuspend, restore post, reports with status, ops summary, 409 mismatch hold release)
  const adminCalls: Array<{ url: string; method: string; body: string }> = [];
  const adminTransport: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    adminCalls.push({ url, method, body });
    if (url.includes("/suspend") && method === "POST") {
      return Response.json({
        memberId: 9,
        nickname: "위반유저",
        role: "USER",
        status: "SUSPENDED",
        suspendedAt: "2026-11-21T10:00:00Z",
        suspendedReason: "스팸 도배",
      });
    }
    if (url.includes("/unsuspend") && method === "POST") {
      return Response.json({
        memberId: 9,
        nickname: "위반유저",
        role: "USER",
        status: "ACTIVE",
        suspendedAt: null,
        suspendedReason: null,
      });
    }
    if (url.includes("/restore") && method === "POST") {
      return Response.json({ ok: true });
    }
    if (url.includes("/admin/community/reports?")) {
      return Response.json({
        content: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
        hasNext: false,
        postReportCount: 0,
        commentReportCount: 0,
        activeTargetReportCount: 0,
        pendingReportCount: 0,
      });
    }
    if (url.endsWith("/api/v1/admin/ops/summary")) {
      return Response.json({ db: { up: true, latencyMs: 3 }, outbox: {}, activeSse: {}, recentErrors: [] });
    }
    if (url.endsWith("/api/v1/admin/ops/s3-cleanup/retry-failed")) {
      return Response.json({ retriedCount: 4 });
    }
    if (url.endsWith("/api/v1/trading/admin/ops/summary")) {
      return Response.json({ status: { engineStatus: "OPEN" }, dependencies: {}, riskHolds: { unresolvedCount: 0, items: [] }, pendingRiskWork: {}, activeWebSockets: {}, recentErrors: [] });
    }
    if (url.includes("/admin/ops/holds/22/release")) {
      return Response.json(
        {
          accountId: 22,
          reconciliationStatus: "MISMATCH",
          failedChecks: ["BALANCE_DELTA"],
          releasedCount: 0,
          resolutionReference: "OPS-2",
          checkedAt: "2026-11-21T10:15:00Z",
        },
        { status: 409 },
      );
    }
    return Response.json({});
  };

  await suspendAdminMember("admin-jwt", 9, "스팸 도배", {
    origin: "http://localhost:8080",
    transport: adminTransport,
  });
  await unsuspendAdminMember("admin-jwt", 9, {
    origin: "http://localhost:8080",
    transport: adminTransport,
  });
  await restoreAdminCommunityPost("admin-jwt", 55, {
    origin: "http://localhost:8080",
    transport: adminTransport,
  });
  const reportsPage = await fetchAdminReports(
    "admin-jwt",
    { reportStatus: "PENDING", reasonType: "YOUTH_HARMFUL" },
    { origin: "http://localhost:8080", transport: adminTransport },
  );
  assert.equal(reportsPage.pendingReportCount, 0);
  const cOps = await fetchContentOpsSummary("admin-jwt", {
    origin: "http://localhost:8080",
    transport: adminTransport,
  });
  assert.equal(cOps.db.up, true);
  const retryRes = await retryFailedS3Cleanup("admin-jwt", {
    origin: "http://localhost:8080",
    transport: adminTransport,
  });
  assert.equal(retryRes.retriedCount, 4);
  const tOps = await fetchTradingOpsSummary("admin-jwt", {
    origin: "http://localhost:8081",
    transport: adminTransport,
  });
  assert.equal(tOps.status.engineStatus, "OPEN");

  // 409 MISMATCH returns structured result instead of throwing generic error
  const mismatchRelease = await releaseTradingRiskHold("admin-jwt", 22, "OPS-2", {
    origin: "http://localhost:8081",
    transport: adminTransport,
  });
  assert.equal(mismatchRelease.released, false);
  assert.equal(mismatchRelease.reconciliationStatus, "MISMATCH");
  assert.deepEqual(mismatchRelease.failedChecks, ["BALANCE_DELTA"]);

  assert.equal(adminCalls.some(c => c.method === "POST" && c.url.endsWith("/api/v1/admin/members/9/suspend")), true);
  assert.equal(adminCalls.some(c => c.method === "POST" && c.url.endsWith("/api/v1/admin/members/9/unsuspend")), true);
  assert.equal(adminCalls.some(c => c.method === "POST" && c.url.endsWith("/api/v1/admin/community/posts/55/restore")), true);
  assert.equal(adminCalls.some(c => c.url.includes("reportStatus=PENDING") && c.url.includes("reasonType=YOUTH_HARMFUL")), true);

  // SSR render smoke tests for /support and /admin/ops
  const client = new QueryClient();
  const adminJwtToken = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "1", roles: ["ROLE_ADMIN"] })).toString("base64url")}.sig`;
  const adminSession = createMemberSession(
    "http://localhost:8080",
    async url =>
      String(url).endsWith("csrf")
        ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
        : Response.json({
            memberId: 1,
            nickname: "관리자",
            accessToken: adminJwtToken,
            tokenType: "Bearer",
            expiresIn: 900,
            expiresAt: new Date(epoch + 900_000).toISOString(),
          }),
    () => epoch,
    fn => fn(),
    () => true,
    () => null,
  );
  await adminSession.restore();

  try {
    const supportAnonHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <SupportCenter />
      </MemberProvider>,
    );
    assert.match(supportAnonHtml, /고객센터 · 1:1 문의/);
    assert.match(supportAnonHtml, /로그인 후 1:1 문의를 이용할 수 있습니다/);
    assert.match(supportAnonHtml, /flex flex-wrap justify-center gap-2\.5 pt-2/);
    assert.match(supportAnonHtml, /whitespace-nowrap[^>]*>로그인하러 가기<\/a>/);
    assert.match(supportAnonHtml, /whitespace-nowrap[^>]*>홈으로 돌아가기<\/a>/);

    const supportLoggedInHtml = renderToStaticMarkup(
      <MemberProvider session={adminSession} client={client}>
        <SupportCenter />
      </MemberProvider>,
    );
    assert.match(supportLoggedInHtml, /새 1:1 문의 작성/);
    assert.match(supportLoggedInHtml, /내 문의 내역/);

    const adminOpsHtml = renderToStaticMarkup(
      <MemberProvider session={adminSession} client={client}>
        <AdminOpsView />
      </MemberProvider>,
    );
    assert.match(adminOpsHtml, /시스템 운영 진단 대시보드/);
    assert.match(adminOpsHtml, /핵심 인프라 &amp; 엔진 상태/);
    assert.match(adminOpsHtml, /Trading Engine/);
    assert.match(adminOpsHtml, /Content DB/);
  } finally {
    client.clear();
  }
});
