import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import {
  parsePolicyMarkdownBlocks,
  PolicyContent,
  PolicyMarkdownBody,
} from "../src/features/member/components/policy-content";
import { computeNextFocusTarget } from "../src/lib/use-focus-trap";
import {
  lockBodyScroll,
  resetScrollLockForTest,
  unlockBodyScroll,
} from "../src/features/member/components/dim-modal";
import {
  formatEngineStatusKr,
  formatInquiryCategoryKr,
  formatNewsCategoryKr,
  formatOrderStatusKr,
  formatOrderTypeKr,
  formatPositionStatusKr,
} from "../src/lib/labels";
import { buildClientErrorPayload } from "../src/lib/client-error-beacon";
import { createMemberSession } from "../src/features/member/api/session";
import { ContentApiError, contentMessage } from "../src/features/member/api/client";
import {
  formatNotificationDescription,
  getNotificationDetailFields,
  getNotificationListTabValue,
  getNotificationNavigationTarget,
} from "../src/features/member/notifications/notification-utils";
import type { NotificationItem } from "../src/features/member/notifications/notification-types";
import { resolveNewsServerFilter } from "../src/features/member/components/news-feed";
import { communityPostsPath, newsPath } from "../src/features/member/api/community-news";
import {
  mutationMessage,
  mutationRequest,
} from "../src/features/trading/api/mutation-request";
import { canonicalJournalCommand } from "../src/features/trading/api/command-journal";
import { TradingApiError } from "../src/features/trading/api/client";
import { parsePosition } from "../src/features/trading/api/account";
import { parseTradingSearchParams } from "../src/features/trading/components/trading-page-client";
import { PositionTakeProfit } from "../src/features/trading/components/position-take-profit";
import { PositionStopLoss } from "../src/features/trading/components/position-stop-loss";
import { TradingDataProvider } from "../src/features/trading/components/trading-data-provider";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import {
  parseAdminBannedOAuthPage,
  parseContentAdminAuditLogs,
  parseContentOpsSummary,
  parseTradingAdminAuditLogs,
  parseTradingOpsSummary,
} from "../src/features/admin/api/admin-api";
import { parseAdminSupportInquiryPage } from "../src/features/member/api/support";

test("Wave4: Policy markdown renderer parses headings, bullets, bold, single-newline breaks, and removes self-links", () => {
  const sample = [
    "# 요기망치 이용약관 (ym-terms-v4)",
    "시행일: 2026-11-22 · 문서 상태: 확정(PUBLISHED)",
    "## 제1조 목적",
    "- 첫 번째 항목 **중요**",
    "- 두 번째 항목",
    "일반 문단 첫 줄",
    "단일 개행 둘째 줄",
  ].join("\n");

  const blocks = parsePolicyMarkdownBlocks(sample);
  assert.equal(blocks[0]?.type, "heading");
  assert.equal(blocks.some(b => b.type === "ul" && b.items.length === 2), true);

  const bodyHtml = renderToStaticMarkup(<PolicyMarkdownBody text={sample} />);
  assert.equal(bodyHtml.includes("# "), false);
  assert.equal(bodyHtml.includes("## "), false);
  assert.equal(bodyHtml.includes("- 첫 번째"), false);
  assert.equal(bodyHtml.includes("ym-terms-v4"), false);
  assert.match(bodyHtml, /<strong>중요<\/strong>/);
  assert.match(bodyHtml, /<br\/>/);

  const termsHtml = renderToStaticMarkup(
    <PolicyContent
      type="TERMS"
      document={{
        type: "TERMS",
        version: "ym-terms-v4",
        documentStatus: "PUBLISHED",
        sha256: "a".repeat(64),
        text: sample,
      }}
    />,
  );
  assert.equal(termsHtml.includes('href="/terms"'), false);
  assert.equal(termsHtml.includes('href="/support"'), true);

  const privacyHtml = renderToStaticMarkup(
    <PolicyContent
      type="PRIVACY"
      document={{
        type: "PRIVACY",
        version: "ym-privacy-v4",
        documentStatus: "PUBLISHED",
        sha256: "b".repeat(64),
        text: sample,
      }}
    />,
  );
  assert.equal(privacyHtml.includes('href="/privacy"'), false);
  assert.equal(privacyHtml.includes('href="/support"'), true);
});

test("Wave4: Focus trap wraps Tab/Shift+Tab and scroll-lock skips scrollTo after URL navigation", () => {
  const first = { id: "a" } as unknown as HTMLElement;
  const middle = { id: "b" } as unknown as HTMLElement;
  const last = { id: "c" } as unknown as HTMLElement;
  const list = [first, middle, last];

  assert.equal(computeNextFocusTarget(list, last, false), first);
  assert.equal(computeNextFocusTarget(list, first, true), last);
  assert.equal(computeNextFocusTarget(list, middle, false), null);
  assert.equal(computeNextFocusTarget(list, middle, true), null);
  assert.equal(computeNextFocusTarget(list, null, false), first);
  assert.equal(computeNextFocusTarget([], null, false), null);

  resetScrollLockForTest();
  let scrollRestored = 0;
  const mockWin = {
    scrollY: 420,
    innerWidth: 1440,
    location: { href: "http://localhost:3000/community" },
    scrollTo: () => {
      scrollRestored++;
    },
  };
  const mockDoc = {
    body: {
      style: {} as Record<string, string>,
      dataset: {} as Record<string, string | undefined>,
    },
    documentElement: { scrollTop: 420, clientWidth: 1440, style: {} as Record<string, string> },
  };
  lockBodyScroll(mockWin, mockDoc);
  // Simulate Next.js client navigation while modal was open
  mockWin.location.href = "http://localhost:3000/trading";
  unlockBodyScroll(mockWin, mockDoc);
  assert.equal(scrollRestored, 0, "must not jump scroll back to old Y after navigating to new route");
  assert.equal(mockDoc.body.style.position, "");
  resetScrollLockForTest();
});

test("Wave4: Korean label formatters localize enums and client error beacon truncates under 2KB", () => {
  assert.equal(formatNewsCategoryKr("CRYPTO"), "가상자산");
  assert.equal(formatNewsCategoryKr("MACRO"), "거시경제");
  assert.equal(formatEngineStatusKr("READY"), "연결됨");
  assert.equal(formatOrderTypeKr("LIMIT"), "지정가");
  assert.equal(formatOrderStatusKr("FILLED"), "체결 완료");
  assert.equal(formatPositionStatusKr("LIQUIDATED"), "강제청산");
  assert.equal(formatInquiryCategoryKr("ACCOUNT"), "계정·로그인");

  const payload = buildClientErrorPayload({
    route: "/trading?" + "a".repeat(500),
    message: "Boom: " + "x".repeat(1000),
    stack: "Error\n" + "at line\n".repeat(400),
    digest: "d".repeat(200),
    userAgent: "Mozilla/" + "u".repeat(500),
  });
  assert.ok(JSON.stringify(payload).length <= 2048);
  assert.ok(payload.route.length <= 180);
  assert.ok(payload.message.length <= 320);
});

test("Wave4: session-probe short-circuits anonymous cold mount with zero /auth/refresh 401s and handles SUSPENDED & 429", async () => {
  const calledPaths: string[] = [];
  const anonSession = createMemberSession(
    "http://localhost:8080",
    async url => {
      calledPaths.push(String(url));
      if (String(url).endsWith("/auth/session-probe")) {
        return Response.json({ authenticated: false, hasRefreshCookie: false });
      }
      throw new Error(`Unexpected call: ${url}`);
    },
    () => Date.now(),
    fn => fn(),
    () => true,
    () => null,
  );
  await anonSession.restore({ probeFirst: true });
  assert.equal(anonSession.getSnapshot().phase, "anonymous");
  assert.deepEqual(calledPaths, ["http://localhost:8080/api/v1/auth/session-probe"]);

  // SUSPENDED member 403 & 429 Retry-After messages
  assert.match(
    contentMessage(new ContentApiError(403, "MEMBER_SUSPENDED")),
    /일시 정지/,
  );
  assert.match(
    contentMessage(new ContentApiError(409, "REPORT_ALREADY_RESOLVED")),
    /이미 처리 완료된 신고/,
  );
  assert.match(
    contentMessage(new ContentApiError(429, "RATE_LIMITED", undefined, 15)),
    /15초/,
  );
});

test("Wave4: Notification routing covers all 6 categories, SUPPORT tab, and localized inquiryCategory", () => {
  const base = {
    actorMemberId: null,
    isRead: false,
    createdAt: "2026-11-22T01:00:00Z",
    lastEventAt: null,
    source: "CONTENT" as const,
  };
  const items: NotificationItem[] = [
    {
      ...base,
      uid: "CONTENT:1",
      notificationId: 1,
      type: "SUPPORT_INQUIRY_ANSWERED",
      category: "SUPPORT",
      payload: { inquiryId: 42, inquiryCategory: "ACCOUNT", title: "계정 문의" },
    },
    {
      ...base,
      uid: "CONTENT:2",
      notificationId: 2,
      type: "POST_COMMENT_CREATED",
      category: "COMMUNITY",
      payload: { postId: 9, commentId: 77 },
    },
    {
      ...base,
      uid: "CONTENT:3",
      notificationId: 3,
      type: "POST_LIKED",
      category: "COMMUNITY",
      payload: { postId: 12 },
    },
    {
      ...base,
      uid: "CONTENT:4",
      notificationId: 4,
      type: "FOLLOW_CREATED",
      category: "FOLLOW",
      actorMemberId: 5,
      payload: { followerId: 5 },
    },
    {
      ...base,
      uid: "TRADING:5",
      notificationId: 5,
      source: "TRADING",
      type: "LIQUIDATION_COMPLETED",
      category: "MOCK",
      payload: { symbol: "BTCUSDT" },
    },
    {
      ...base,
      uid: "TRADING:6",
      notificationId: 6,
      source: "TRADING",
      type: "CONTEST_SEASON_SETTLED",
      category: "CONTEST",
      payload: { seasonId: 202602 },
    },
  ];

  assert.equal(getNotificationNavigationTarget(items[0])?.href, "/support?inquiryId=42");
  assert.equal(getNotificationNavigationTarget(items[1])?.href, "/community/all/9#comment-77");
  assert.equal(getNotificationNavigationTarget(items[2])?.href, "/community/all/12");
  assert.equal(getNotificationNavigationTarget(items[3])?.href, "/members/5");
  assert.equal(getNotificationNavigationTarget(items[4])?.href, "/me?tab=mock-assets&detailTab=trades");
  assert.equal(
    getNotificationNavigationTarget(items[5])?.href,
    "/me?tab=contest-assets&contestSubTab=finished&seasonId=202602",
  );

  assert.equal(getNotificationListTabValue(items[0].category), "SUPPORT");
  assert.equal(getNotificationListTabValue(items[1].category), "COMMUNITY");
  assert.equal(getNotificationListTabValue(items[4].category), "MOCK");
  assert.equal(getNotificationListTabValue(items[5].category), "CONTEST");

  const desc = formatNotificationDescription(items[0]);
  const fields = getNotificationDetailFields(items[0]);
  assert.equal(desc.includes("ACCOUNT"), false);
  assert.equal(fields.some(f => f.value.includes("ACCOUNT")), false);
  assert.equal(fields.some(f => f.value.includes("계정·로그인")), true);
});

test("Wave4: News server filters & Community WEEKLY_POPULAR query path work cleanly", () => {
  assert.deepEqual(resolveNewsServerFilter("BREAKING", "COIN", "ALL"), {
    section: "BREAKING",
    subCategory: "COIN_FLASH",
  });
  assert.deepEqual(resolveNewsServerFilter("NEWSROOM", "ALL", "FX_RATES"), {
    section: "NEWSROOM",
    subCategory: "FX_RATES",
  });
  assert.match(newsPath({ section: "BREAKING", subCategory: "ECONOMY_FLASH" }), /section=BREAKING/);
  assert.match(newsPath({ section: "BREAKING", subCategory: "ECONOMY_FLASH" }), /subCategory=ECONOMY_FLASH/);
  assert.match(communityPostsPath({ sort: "WEEKLY_POPULAR", size: 20 }), /sort=WEEKLY_POPULAR/);
});

test("Wave4: Trading MARKET OPEN supports optional TP/SL in request & journal, URL params parse safely, and TP/SL modals are symmetric", () => {
  const openCmd = {
    kind: "open" as const,
    tradingSymbolId: 1,
    type: "MARKET" as const,
    side: "LONG" as const,
    quantity: "0.25",
    leverage: 10,
    stopLossPrice: "88000",
    takeProfitPrice: "96000",
  };
  const req = mutationRequest(openCmd);
  assert.equal(req.path, "account/orders");
  assert.equal((req.body as Record<string, unknown>).stopLossPrice, "88000");
  assert.equal((req.body as Record<string, unknown>).takeProfitPrice, "96000");

  const canonical = canonicalJournalCommand(openCmd);
  assert.deepEqual(canonical, openCmd);

  assert.match(
    mutationMessage(new TradingApiError(403, undefined, "MEMBER_SUSPENDED")),
    /정지된 계정/,
  );
  assert.match(
    mutationMessage(new TradingApiError(429, undefined, "RATE_LIMITED", undefined, undefined, undefined, undefined, 12)),
    /12초/,
  );

  const parsed = parseTradingSearchParams(
    new URLSearchParams("symbol=ethusdt&tab=orders&side=short&leverage=25"),
  );
  assert.deepEqual(parsed, {
    urlSymbol: "ETH",
    urlTab: "orders",
    urlSide: "SHORT",
    urlLeverage: 25,
  });

  // TP & SL modal symmetry check: both render Liq. Price and [취소 | 확인]
  const client = new QueryClient();
  const session = createGuestSession("http://trade.example", () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }));
  const samplePos = parsePosition({
    id: 10,
    tradingSymbolId: 1,
    side: "LONG",
    status: "OPEN",
    leverage: 10,
    marginMode: "ISOLATED",
    openedMarginMode: "ISOLATED",
    quantity: "1",
    reservedCloseQuantity: "0",
    freeCloseQuantity: "1",
    entryPrice: "90000",
    margin: "9000",
    realizedPnl: "0",
    markPrice: "91000",
    unrealizedPnl: "1000",
    liquidationPrice: "81500",
    liquidationPriceStatus: "ESTIMATED_DOWNWARD",
    liquidationPriceAsOf: "2026-11-22T00:05:00Z",
    priceStatus: "FRESH",
    priceEventTime: "2026-11-22T00:05:00Z",
    openedAt: "2026-11-22T00:00:00Z",
    stopLoss: {
      positionId: 10,
      tradingSymbolId: 1,
      side: "LONG",
      status: "ACTIVE",
      stopPrice: "86000",
      version: 1,
      updatedAt: "2026-11-22T00:01:00Z",
      triggeredAt: null,
      priceEventTime: null,
      triggerPrice: null,
      triggerOrderId: null,
      reason: null,
    },
    takeProfit: {
      positionId: 10,
      tradingSymbolId: 1,
      side: "LONG",
      status: "ACTIVE",
      takeProfitPrice: "98000",
      version: 1,
      updatedAt: "2026-11-22T00:01:00Z",
      triggeredAt: null,
      priceEventTime: null,
      triggerPrice: null,
      triggerOrderId: null,
      reason: null,
    },
  });
  assert.ok(samplePos);
  try {
    const tpHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <TradingDataProvider session={session} client={client}>
          <PositionTakeProfit position={samplePos} symbol="BTC / USDT" />
        </TradingDataProvider>
      </MemberProvider>,
    );
    const slHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <TradingDataProvider session={session} client={client}>
          <PositionStopLoss position={samplePos} symbol="BTC / USDT" />
        </TradingDataProvider>
      </MemberProvider>,
    );
    assert.match(tpHtml, /data-active-tp="true"/);
    assert.match(tpHtml, /Liq\. Price/);
    assert.match(tpHtml, /class="ym-modal-btn-cancel"[^>]*>취소<\/button><button[^>]*class="ym-modal-btn-confirm"/);

    assert.match(slHtml, /data-active-sl="true"/);
    assert.match(slHtml, /Liq\. Price/);
    assert.match(slHtml, /class="ym-modal-btn-cancel"[^>]*>취소<\/button><button[^>]*class="ym-modal-btn-confirm"/);
  } finally {
    client.clear();
  }
});

test("Wave4: Admin Wave 2 & Wave 3 API parsers handle banned OAuth, audit logs, CLOSED support, and full ops summaries", () => {
  const banned = parseAdminBannedOAuthPage({
    totalCount: 1,
    page: 0,
    size: 20,
    items: [
      {
        id: 7,
        provider: "GOOGLE",
        providerSubjectHash: "hash123",
        originalMemberId: 99,
        reason: "어뷰징",
        bannedByAdminId: 1,
        bannedByAdminNickname: "운영자",
        bannedAt: "2026-11-22T00:00:00Z",
      },
    ],
    nextCursorId: null,
    hasNext: false,
  });
  assert.equal(banned.totalCount, 1);
  assert.equal(banned.items[0]?.provider, "GOOGLE");

  const contentAudit = parseContentAdminAuditLogs({
    items: [
      {
        id: 1,
        adminMemberId: 1,
        adminNickname: "운영자",
        action: "MEMBER_SUSPEND",
        targetType: "MEMBER",
        targetId: "42",
        summary: "정책 위반",
        requestId: "req-1",
        createdAt: "2026-11-22T00:00:00Z",
      },
    ],
    nextCursorId: null,
    hasNext: false,
  });
  assert.equal(contentAudit.items[0]?.action, "MEMBER_SUSPEND");

  const tradingAudit = parseTradingAdminAuditLogs({
    items: [
      {
        id: 2,
        adminMemberId: 1,
        action: "CONTEST_PARTICIPANT_DISQUALIFY",
        targetType: "CONTEST_PARTICIPANT",
        targetId: "99",
        detail: "실격 처리",
        requestId: "req-2",
        createdAt: "2026-11-22T00:00:00Z",
      },
    ],
    nextCursorId: null,
    hasNext: false,
  });
  assert.equal(tradingAudit.items[0]?.action, "CONTEST_PARTICIPANT_DISQUALIFY");

  const supportPage = parseAdminSupportInquiryPage({
    items: [
      {
        id: 10,
        memberId: 5,
        memberNickname: "트레이더5",
        category: "ACCOUNT",
        title: "계정 문의",
        content: "내용",
        status: "CLOSED",
        adminReply: "답변",
        repliedByMemberId: 1,
        repliedAt: "2026-11-22T01:00:00Z",
        createdAt: "2026-11-22T00:00:00Z",
        closedAt: "2026-11-22T02:00:00Z",
      },
    ],
    openCount: 1,
    answeredCount: 2,
    closedCount: 3,
    hasNext: false,
    nextCursorId: null,
  });
  assert.equal(supportPage.closedCount, 3);
  assert.equal(supportPage.items[0]?.status, "CLOSED");

  const contentOps = parseContentOpsSummary({
    generatedAt: "2026-11-22T01:00:00Z",
    db: { up: true, latencyMs: 4 },
    dbLatencyMs: 4,
    runtime: { heapUsedMb: 120, heapMaxMb: 512, heapUsagePct: 23, uptimeSeconds: 3700, activeProfiles: ["prod"] },
    hikari: { active: 2, idle: 8, total: 10, threadsAwaiting: 0, maxPoolSize: 20 },
    newsIngestion: { live: true, collectorEnabled: true, lastCollectedAt: "2026-11-22T00:59:00Z", consecutiveFailures: 0 },
    rssSources: [{ name: "CoinDesk", section: "BREAKING", subCategory: "COIN_FLASH", healthy: true, consecutiveFailures: 0, lastIngestedCount: 15 }],
    s3Storage: { mode: "S3", pendingCleanupCount: 1, failedCleanupCount: 0, recentFailedTasks: [] },
    outbox: { pendingWithdrawals: 0, stuckWithdrawals: 0, pendingProvisions: 0, stuckProvisions: 0, pendingSuspensions: 1, stuckSuspensions: 0, pendingS3Cleanup: 1, failedS3Cleanup: 0, stuckDetails: [] },
    openSupportInquiries: 2,
    activeSse: { newsSse: 3, communitySse: 2, notificationSse: 4 },
    alerts: { configured: true, targetType: "DISCORD", cooldownSeconds: 60, recentDispatches: [] },
    errorMetrics: { last5m5xx: 0, last1h5xx: 1, total5xx: 2, total429: 3, total409: 4, criticalErrors: [], recentErrors: [] },
    recentErrors: [],
    clientErrors: [{ occurredAt: "2026-11-22T01:00:00Z", route: "/trading", message: "ChunkLoadError", digest: "d1", requestId: "r1" }],
  });
  assert.equal(contentOps.runtime?.heapUsedMb, 120);
  assert.equal(contentOps.outbox.pendingSuspensions, 1);
  assert.equal(contentOps.rssSources[0]?.name, "CoinDesk");
  assert.equal(contentOps.clientErrors.length, 1);

  const tradingOps = parseTradingOpsSummary({
    status: { engineStatus: "OPEN", marketClockStatus: "FRESH", clockSkewMs: 12 },
    dependencies: { db: "UP", redis: "UP", binanceMarkWs: "CONNECTED", binanceOrderBookWs: "CONNECTED" },
    riskHolds: { unresolvedCount: 0, items: [] },
    pendingRiskWork: { pendingCount: 0, heldCount: 0 },
    ledgerMismatches: 0,
    ledgerMismatchDetails: [],
    activeWebSockets: { market: 5, trading: 3 },
    sse: { tradingNotificationSseCount: 7 },
    runtime: { heapUsedMb: 200, heapMaxMb: 1024, heapUsagePercent: 19, uptimeSeconds: 90000, activeThreads: 44, buildVersion: "2.0.0" },
    hikari: { active: 3, idle: 7, total: 10, max: 20, pending: 0 },
    dbLatencyMs: 3,
    redis: { status: "UP", latencyMs: 1, gapSequence: 0 },
    binance: { markState: "CONNECTED", markReconnectCount: 0, markLastTickAgeMs: 120, orderBookConnected: true, orderBookReconnectCount: 0 },
    marketOverview: { healthy: true, staleGroupCount: 0, lastError: null },
    capturedAt: "2026-11-22T01:00:00Z",
  });
  assert.equal(tradingOps.sse?.tradingNotificationSseCount, 7);
  assert.equal(tradingOps.runtime?.buildVersion, "2.0.0");
  assert.equal(tradingOps.marketOverview?.healthy, true);
});
