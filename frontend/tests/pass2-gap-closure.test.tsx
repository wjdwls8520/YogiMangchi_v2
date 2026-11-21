import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { resolveOpsHealthTone } from "../src/features/admin/components/admin-ops";
import {
  parseMemberCommunityReportItem,
  parseSharedPositionSnapshot,
} from "../src/features/member/api/community-news";
import { SharedPositionCard } from "../src/features/member/components/community-board";
import { MainPortal } from "../src/features/member/components/main-portal";
import { parseMarketOverviewPayload } from "../src/features/member/api/market-overview";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { V1Header } from "../src/features/member/components/v1-ui";
import {
  getActiveDimModalStack,
  registerOverlayEscape,
  resetDimModalStackForTest,
} from "../src/features/member/components/dim-modal";
import { ContestTradingSubheader } from "../src/features/contest/components/contest-trading-terminal";
import {
  extractRequestId,
  getErrorRequestId,
  isUnexpectedApiError,
  sanitizeRequestId,
} from "../src/lib/request-id";
import { RequestIdChip } from "../src/components/request-id-copy";
import {
  ContentApiError,
  contentJson,
  contentMessage,
} from "../src/features/member/api/client";
import { createMemberSession } from "../src/features/member/api/session";
import { TradingApiError, tradingJson } from "../src/features/trading/api/client";
import { ContestApiError, fetchPublicContestSeasons } from "../src/features/contest/api/contest-client";
import {
  AdminApiError,
  fetchAdminTradingSymbols,
  restoreAdminCommunityReply,
  updateAdminTradingSymbolStatus,
} from "../src/features/admin/api/admin-api";
import {
  canonicalJournalCommand,
  createCommandJournal,
} from "../src/features/trading/api/command-journal";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { OrderBookPanel } from "../src/features/trading/components/order-book-panel";
import { FillHistoryTable } from "../src/features/trading/components/account-tables";
import { NotificationsPageView } from "../src/features/member/notifications/notifications-page-view";
import { NotificationCenterProvider } from "../src/features/member/notifications/notification-context";
import { metadata as communityDetailMetadata } from "../src/app/community/[category]/[id]/page";
import {
  DEFAULT_CONTENT_ORIGIN,
  DEFAULT_TRADING_ORIGIN,
  resolveContentOrigin,
  resolveTradingOrigin,
} from "../src/lib/api-origins";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

test("F-1: resolveOpsHealthTone maps READY/LIVE to green and STARTING/CONNECTING/RECONNECTING to yellow", () => {
  assert.equal(resolveOpsHealthTone("READY"), "green");
  assert.equal(resolveOpsHealthTone("ready"), "green");
  assert.equal(resolveOpsHealthTone("LIVE"), "green");
  assert.equal(resolveOpsHealthTone("UP"), "green");
  assert.equal(resolveOpsHealthTone("STARTING"), "yellow");
  assert.equal(resolveOpsHealthTone("CONNECTING"), "yellow");
  assert.equal(resolveOpsHealthTone("RECONNECTING"), "yellow");
  assert.equal(resolveOpsHealthTone("DEGRADED"), "yellow");
  assert.equal(resolveOpsHealthTone("DOWN"), "red");
  assert.equal(resolveOpsHealthTone("CLOSED"), "red");
});

test("F-2: SharedPositionSnapshot defaults verified=false and MainPortal never invents fake prices or 50x cap", () => {
  const unverified = parseSharedPositionSnapshot({
    id: "MOCK_POS_1",
    marketLabel: "모의투자 선물",
    symbol: "BTC",
    pair: "BTCUSDT",
    side: "LONG",
    leverage: 10,
    entryPrice: "90000",
    markPrice: "91000",
    liquidationPrice: "81000",
    roePct: "+11.11%",
    pnlUsdt: "+111.10 USDT",
    positive: true,
  });
  assert.ok(unverified !== null);
  assert.equal(unverified.verified, false);

  const unverifiedHtml = renderToStaticMarkup(<SharedPositionCard snapshot={unverified} />);
  assert.match(unverifiedHtml, /작성자 첨부 포지션 스냅샷/);
  assert.equal(unverifiedHtml.includes("원장 스냅샷 검증됨"), false);

  const verified = parseSharedPositionSnapshot({
    ...unverified,
    verified: true,
  });
  assert.ok(verified !== null);
  assert.equal(verified.verified, true);
  const verifiedHtml = renderToStaticMarkup(<SharedPositionCard snapshot={verified} />);
  assert.match(verifiedHtml, /원장 스냅샷 검증됨/);

  assert.equal(parseMarketOverviewPayload({}), null);
  assert.equal(parseMarketOverviewPayload(null), null);

  const client = new QueryClient();
  try {
    const portalHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal />
      </MemberProvider>,
    );
    assert.equal(portalHtml.includes("$94,280.50"), false);
    assert.equal(portalHtml.includes("56.4%"), false);
    assert.equal(portalHtml.includes("1,384.50"), false);
    assert.match(portalHtml, /100x/);
    assert.match(portalHtml, /최대 100x 격리마진 지원/);
  } finally {
    client.clear();
  }
});

test("F-4 & F-5: Mobile GNB hides admin/mypage pills below sm and ContestTradingSubheader renders mobile KPI strip", () => {
  const adminHeaderHtml = renderToStaticMarkup(<V1Header theme="light" role="ADMIN" />);
  assert.match(adminHeaderHtml, /hidden sm:inline-flex[^>]*href="\/admin\/contest"|href="\/admin\/contest"[^>]*hidden sm:inline-flex|hidden sm:inline-flex[^<]*>관리자<\/a>/);

  const subheaderHtml = renderToStaticMarkup(<ContestTradingSubheader seasonId={1} />);
  assert.match(subheaderHtml, /data-contest-mobile-kpi="true"/);
  assert.match(subheaderHtml, /flex md:hidden/);
  assert.match(subheaderHtml, /순위/);
  assert.match(subheaderHtml, /수익률/);
  assert.match(subheaderHtml, /평가자산/);
  assert.match(subheaderHtml, /가용증거금/);
});

test("F-8: Shared registerOverlayEscape closes ONLY the topmost active overlay on Escape", () => {
  const listeners: Array<(e: KeyboardEvent) => void> = [];
  const originalWindow = globalThis.window;
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener(_type: string, fn: (e: KeyboardEvent) => void) {
      listeners.push(fn);
    },
    removeEventListener(_type: string, fn: (e: KeyboardEvent) => void) {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };
  resetDimModalStackForTest();

  try {
    const closed: string[] = [];
    const unregDrawer = registerOverlayEscape("mobile-drawer", () => closed.push("mobile-drawer"));
    const unregNotif = registerOverlayEscape("notif-drawer", () => closed.push("notif-drawer"));
    const unregModal = registerOverlayEscape("confirm-modal", () => closed.push("confirm-modal"));

    assert.deepEqual(getActiveDimModalStack(), ["mobile-drawer", "notif-drawer", "confirm-modal"]);
    assert.equal(listeners.length, 1);

    const dispatchEscape = () => {
      const ev = {
        key: "Escape",
        preventDefault() {},
        stopPropagation() {},
      } as unknown as KeyboardEvent;
      for (const fn of [...listeners]) fn(ev);
    };

    dispatchEscape();
    assert.deepEqual(closed, ["confirm-modal"]);
    unregModal();

    dispatchEscape();
    assert.deepEqual(closed, ["confirm-modal", "notif-drawer"]);
    unregNotif();

    dispatchEscape();
    assert.deepEqual(closed, ["confirm-modal", "notif-drawer", "mobile-drawer"]);
    unregDrawer();

    assert.deepEqual(getActiveDimModalStack(), []);
    assert.equal(listeners.length, 0);
  } finally {
    resetDimModalStackForTest();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  }
});

test("F-10: requestId is captured and sanitized across Content/Trading/Contest/Admin API errors", async () => {
  assert.equal(sanitizeRequestId("req-abc_123.45"), "req-abc_123.45");
  assert.equal(sanitizeRequestId("Bearer secret token"), undefined);
  assert.equal(sanitizeRequestId("ab"), undefined);

  const headerResp = new Response(JSON.stringify({ code: "INTERNAL_ERROR" }), {
    status: 500,
    headers: { "Content-Type": "application/json", "X-Request-Id": "req-hdr-9901" },
  });
  assert.equal(extractRequestId({ code: "INTERNAL_ERROR" }, headerResp), "req-hdr-9901");

  await assert.rejects(
    () =>
      contentJson("http://localhost:8080", "/members/me", {}, async () =>
        new Response(JSON.stringify({ code: "INTERNAL_ERROR", requestId: "req-content-500" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof ContentApiError);
      assert.equal(err.requestId, "req-content-500");
      assert.equal(getErrorRequestId(err), "req-content-500");
      assert.equal(isUnexpectedApiError(err), true);
      return true;
    },
  );

  await assert.rejects(
    () =>
      tradingJson("http://localhost:8081", "account/summary", {}, async () =>
        new Response(JSON.stringify({ code: "INTERNAL_ERROR" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "X-Request-Id": "req-trade-503" },
        }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof TradingApiError);
      assert.equal(err.requestId, "req-trade-503");
      assert.equal(isUnexpectedApiError(err), true);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchPublicContestSeasons({
        baseUrl: "http://localhost:8081",
        transport: async () =>
          new Response(JSON.stringify({ message: "boom", requestId: "req-contest-500" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof ContestApiError);
      assert.equal(err.requestId, "req-contest-500");
      return true;
    },
  );

  await assert.rejects(
    () =>
      restoreAdminCommunityReply("admin-jwt", 77, {
        origin: "http://localhost:8080",
        transport: async () =>
          new Response(JSON.stringify({ code: "INTERNAL_ERROR", requestId: "req-admin-500" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof AdminApiError);
      assert.equal(err.requestId, "req-admin-500");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchAdminTradingSymbols("admin-jwt", {
        origin: "http://localhost:8081",
        transport: async () =>
          new Response(JSON.stringify({ code: "INTERNAL_ERROR", requestId: "req-admin-trade-500" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof TradingApiError);
      assert.equal(err.requestId, "req-admin-trade-500");
      return true;
    },
  );

  const chipHtml = renderToStaticMarkup(<RequestIdChip requestId="req-ui-1234" />);
  assert.match(chipHtml, /요청 ID:/);
  assert.match(chipHtml, /req-ui-1234/);
  assert.match(chipHtml, /복사/);
});

test("F-11: MEMBER_BANNED message mapping and logoutAll pre-refreshes expired token", async () => {
  const bannedMsg = contentMessage(new ContentApiError(403, "MEMBER_BANNED"));
  assert.match(bannedMsg, /영구 정지/);
  const suspendedMsg = contentMessage(new ContentApiError(403, "MEMBER_SUSPENDED"));
  assert.match(suspendedMsg, /고객센터/);

  let nowMs = Date.parse("2026-11-22T00:00:00.000Z");
  const calls: Array<{ url: string; auth: string | null }> = [];
  const session = createMemberSession(
    "http://localhost:8080",
    async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get("Authorization") });
      if (url.endsWith("/api/v1/auth/csrf")) {
        return Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf-tok" });
      }
      if (url.endsWith("/api/v1/auth/refresh")) {
        const isSecond = calls.filter(c => c.url.endsWith("/api/v1/auth/refresh")).length > 1;
        return Response.json({
          memberId: 7,
          nickname: "트레이더7",
          accessToken: isSecond ? "header.payload.freshToken2" : "header.payload.expiringToken1",
          tokenType: "Bearer",
          expiresIn: 900,
          expiresAt: new Date(nowMs + (isSecond ? 900_000 : 10_000)).toISOString(),
        });
      }
      if (url.endsWith("/api/v1/auth/logout-all")) {
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    },
    () => nowMs,
    fn => fn(),
    () => true,
    () => null,
  );

  await session.restore();
  // Advance past expiry so logoutAll must refresh before POST /logout-all
  nowMs += 20_000;
  await session.logoutAll();

  const logoutCall = calls.find(c => c.url.endsWith("/api/v1/auth/logout-all"));
  assert.ok(logoutCall);
  assert.equal(logoutCall.auth, "Bearer header.payload.freshToken2");
});

test("F-12: takeProfit command journal persists, recovers via read-only GET, resends cleanly, and batch actions send Idempotency-Key", async () => {
  const canonical = canonicalJournalCommand({
    kind: "takeProfit",
    positionId: 42,
    expectedVersion: 1,
    takeProfitPrice: "105000",
  });
  assert.deepEqual(canonical, {
    kind: "takeProfit",
    positionId: 42,
    expectedVersion: 1,
    takeProfitPrice: "105000",
  });

  const store = memoryStorage();
  const journal = createCommandJournal(() => store, async (_name, op) => op(), () => 1_700_000_000_000);
  let tpServerVersion = 1;
  let tpPutCalls = 0;
  const seenBatchKeys: Record<string, string | null> = {};

  const guestCred = {
    accountId: 101,
    accessToken: `guest_${"a".repeat(43)}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  store.setItem("yogimangchi.guest.v1:http://localhost:8081", JSON.stringify(guestCred));

  const session = createGuestSession(
    "http://localhost:8081",
    () => store,
    async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      if (url.endsWith("/account/positions/42/take-profit") && method === "PUT") {
        tpPutCalls += 1;
        if (tpPutCalls === 1) {
          throw new TypeError("network reset after send");
        }
        tpServerVersion = 2;
        return Response.json({
          positionId: 42,
          tradingSymbolId: 1,
          side: "LONG",
          status: "ACTIVE",
          takeProfitPrice: "105000",
          version: tpServerVersion,
          updatedAt: "2026-11-22T01:00:00Z",
          triggeredAt: null,
          priceEventTime: null,
          triggerPrice: null,
          triggerOrderId: null,
          reason: null,
        });
      }
      if (url.endsWith("/account/positions/42/take-profit") && method === "GET") {
        return Response.json({
          positionId: 42,
          tradingSymbolId: 1,
          side: "LONG",
          status: tpServerVersion > 1 ? "ACTIVE" : "NONE",
          takeProfitPrice: tpServerVersion > 1 ? "105000" : null,
          version: tpServerVersion === 1 ? 0 : tpServerVersion,
          updatedAt: tpServerVersion > 1 ? "2026-11-22T01:00:00Z" : null,
          triggeredAt: null,
          priceEventTime: null,
          triggerPrice: null,
          triggerOrderId: null,
          reason: null,
        });
      }
      if (url.endsWith("/account/orders/cancel-all") && method === "POST") {
        seenBatchKeys.cancelAll = headers.get("Idempotency-Key");
        return Response.json({ canceledCount: 2, orders: [] });
      }
      if (url.endsWith("/account/positions/close-all") && method === "POST") {
        seenBatchKeys.closeAll = headers.get("Idempotency-Key");
        return Response.json({ closedCount: 1, orders: [] });
      }
      return new Response("not found", { status: 404 });
    },
    () => Date.parse("2026-11-22T00:00:00.000Z"),
    undefined,
    journal,
  );

  await session.restore();
  const snap = session.getSnapshot();
  assert.equal(snap.phase, "ready");

  // 1. Network error leaves takeProfit entry in command journal
  await assert.rejects(() =>
    session.writeTakeProfit(
      { positionId: 42, expectedVersion: 0, takeProfitPrice: "105000" },
      snap,
      "tp-key-12345678",
    ),
  );
  const pendingEntries = session.readCommandJournal();
  assert.equal(pendingEntries.length, 1);
  assert.equal(pendingEntries[0].command.kind, "takeProfit");

  // 2. Read-only lookup sees NOT_OBSERVED when version has not advanced
  const notObserved = await session.queryJournalEntry(pendingEntries[0]);
  assert.equal(notObserved.status, "NOT_OBSERVED");
  assert.equal(session.readCommandJournal().length, 1);

  // 3. Resend with same key succeeds and cleans journal
  await session.resendJournalEntry(pendingEntries[0]);
  assert.equal(session.readCommandJournal().length, 0);

  // 4. Batch cancel-all & close-all send Idempotency-Key headers
  await session.cancelAllOrders(snap);
  await session.closeAllPositions(snap);
  assert.ok(seenBatchKeys.cancelAll && seenBatchKeys.cancelAll.length >= 8);
  assert.ok(seenBatchKeys.closeAll && seenBatchKeys.closeAll.length >= 8);
});

test("F-14: OrderBookPanel trend, FillHistoryTable TAKE_PROFIT label, NotificationsPageView subtitle, reportStatus parsing, and detail metadata", () => {
  const btcSymbol = {
    id: 1,
    symbol: "BTC",
    quoteAsset: "USDT",
    displaySymbol: "BTC / USDT",
    name: "Bitcoin",
    priceTickSize: "0.1",
    quantityStepSize: "0.001",
    minOrderQuantity: "0.001",
    maxOrderQuantity: "100",
    maxLeverage: 100,
  };
  const upBookHtml = renderToStaticMarkup(
    <OrderBookPanel
      symbol={btcSymbol}
      book={{
        symbolId: 1,
        status: "FRESH",
        bids: [],
        asks: [],
        eventTime: Date.now(),
        receivedAt: Date.now(),
      }}
      mark="95000.0"
      trend="down"
    />,
  );
  assert.match(upBookHtml, /<strong data-trend="down">/);

  const fillsHtml = renderToStaticMarkup(
    <FillHistoryTable
      symbols={[btcSymbol]}
      fills={[
        {
          fillId: 10,
          orderId: 20,
          positionId: 30,
          lifecyclePositionId: 30,
          tradingSymbolId: 1,
          side: "LONG",
          action: "CLOSE",
          type: "MARKET",
          reason: "TAKE_PROFIT",
          leverage: 10,
          marginMode: "ISOLATED",
          quantity: "0.5",
          price: "96000",
          realizedPnl: "500",
          fee: "2",
          settlementAdjustment: "0",
          priceEventTime: "2026-11-22T01:00:00Z",
          executedAt: "2026-11-22T01:00:00Z",
        },
      ]}
    />,
  );
  assert.match(fillsHtml, /익절 청산/);

  const client = new QueryClient();
  try {
    const notifHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NotificationCenterProvider>
          <NotificationsPageView />
        </NotificationCenterProvider>
      </MemberProvider>,
    );
    assert.match(notifHtml, /시장가·지정가·익절·손절 체결/);
  } finally {
    client.clear();
  }

  const resolvedReport = parseMemberCommunityReportItem({
    id: 1,
    targetType: "POST",
    targetId: 10,
    title: "신고 대상 글",
    reasonDescription: "스팸",
    status: "RESOLVED",
    createdAt: "2026-11-22T00:00:00Z",
  });
  assert.equal(resolvedReport.reportStatus, "RESOLVED");
  const legacyReport = parseMemberCommunityReportItem({
    id: 2,
    targetType: "COMMENT",
    targetId: 11,
    title: "신고 대상 댓글",
    reasonDescription: "욕설",
    reportStatus: "RECEIVED",
    createdAt: "2026-11-22T00:00:00Z",
  });
  assert.equal(legacyReport.reportStatus, "PENDING");

  assert.equal(communityDetailMetadata.title, "커뮤니티 게시글");
});

test("F-15 & F-16: Shared localhost origins, Admin symbol halt/resume API, and Admin reply restore API", async () => {
  assert.equal(DEFAULT_CONTENT_ORIGIN, "http://localhost:8080");
  assert.equal(DEFAULT_TRADING_ORIGIN, "http://localhost:8081");
  assert.equal(resolveContentOrigin(), "http://localhost:8080");
  assert.equal(resolveTradingOrigin(), "http://localhost:8081");

  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, body });

    if (url.endsWith("/api/v1/trading/admin/symbols") && method === "GET") {
      return Response.json([
        {
          id: 1,
          symbol: "BTC",
          name: "Bitcoin",
          quoteAsset: "USDT",
          status: "ACTIVE",
          maxLeverage: 100,
          updatedAt: "2026-11-22T01:00:00Z",
        },
      ]);
    }
    if (url.endsWith("/api/v1/trading/admin/symbols/1/status") && method === "PATCH") {
      return Response.json({
        id: 1,
        symbol: "BTC",
        name: "Bitcoin",
        quoteAsset: "USDT",
        status: "HALTED",
        maxLeverage: 100,
        updatedAt: "2026-11-22T01:05:00Z",
      });
    }
    if (url.endsWith("/api/v1/admin/community/replies/77/restore") && method === "POST") {
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  };

  const symbols = await fetchAdminTradingSymbols("admin-jwt", {
    origin: "http://localhost:8081",
    transport: fakeFetch,
  });
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].status, "ACTIVE");

  const halted = await updateAdminTradingSymbolStatus("admin-jwt", 1, "HALTED", {
    origin: "http://localhost:8081",
    transport: fakeFetch,
  });
  assert.equal(halted.status, "HALTED");
  assert.equal(calls[1].body, JSON.stringify({ status: "HALTED" }));

  await restoreAdminCommunityReply("admin-jwt", 77, {
    origin: "http://localhost:8080",
    transport: fakeFetch,
  });
  assert.equal(calls[2].url, "http://localhost:8080/api/v1/admin/community/replies/77/restore");
  assert.equal(calls[2].method, "POST");
});
