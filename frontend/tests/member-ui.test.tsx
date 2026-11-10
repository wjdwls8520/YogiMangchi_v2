import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { MemberConsents } from "../src/features/member/components/member-consents";
import { MemberLoginView, ProfileEditForm, SignupForm } from "../src/features/member/components/member-views";
import { GuestStartDialog } from "../src/features/trading/components/guest-access";
import { AccountQueryState } from "../src/features/trading/components/account-query-state";
import { TradingDataProvider } from "../src/features/trading/components/trading-data-provider";
import { TradingAccountTabs } from "../src/features/trading/components/trading-account-tabs";
import { WithdrawalConfirmation } from "../src/features/member/components/withdrawal-confirmation";
import { MemberWithdrawal } from "../src/features/member/components/member-withdrawal";
import { createMemberSession } from "../src/features/member/api/session";
import { clearWithdrawalIntent, saveWithdrawalIntent } from "../src/features/member/api/withdrawal-intent";
import { parsePolicyState, type PolicyBundle } from "../src/features/member/api/policies";
import { ContentApiError, contentJson, contentMessage } from "../src/features/member/api/client";
import {
  communityCommentsPath,
  communityPostsPath,
  newsPath,
  parseCommentLike,
  parseCommunityComments,
  parseCommunityLike,
  parseCommunityPostPage,
  parseCommunityReport,
  parseLatestPostsCheck,
  parseMemberCommunityCommentPage,
  parseMemberCommunityReportPage,
  parseNewsHighlights,
  parseNewsPage,
  parseNewsReaction,
  parseNewsSentimentSummary,
  SYMBOL_FILTER_TAGS,
  parsePublicMemberPortfolio,
  parseReportReasons,
  parseSharedPositionSnapshot,
  readCommunityOrPublic,
} from "../src/features/member/api/community-news";
import {
  NewsFeed,
  applyIdempotentNewsView,
  computeLiveNewsSentiment,
  getKstDateString,
  getOrCreateAnonNewsViewerId,
  hasAnonViewedNewsToday,
  hasMemberViewedNews,
  markAnonViewedNewsToday,
  markMemberViewedNews,
  sortNewsItems,
} from "../src/features/member/components/news-feed";
import { CommunityBoard, SHAREABLE_POSITIONS } from "../src/features/member/components/community-board";
import { MainPortal, mapRedisTickersToPopularCoins } from "../src/features/member/components/main-portal";
import {
  MemberSignupPage,
  clearLoginReturnPath,
  consumeLoginReturnPath,
  normalizeLoginReturnPath,
  saveLoginReturnPath,
} from "../src/features/member/components/member-auth";
import { MemberAccount } from "../src/features/member/components/member-account";
import { MemberMyProfilePage } from "../src/features/member/components/member-profile-portfolio";
import { PublicMember } from "../src/features/member/components/public-member";
import { V1Header } from "../src/features/member/components/v1-ui";
import { SiteFooter } from "../src/components/site-footer";
import {
  FALLBACK_MARKET_OVERVIEW,
  buildDeterministicUsdKrwHistory,
  buildExchangeRateChartGeometry,
  classifyFearGreedLabelKr,
  computeBtcDominanceChange24h,
  computeKimchiPremiumPercent,
  fetchLiveMarketOverview,
  fetchRedisMarketOverview,
  parseMarketOverviewPayload,
} from "../src/features/member/api/market-overview";
import { DimModal, lockBodyScroll, unlockBodyScroll, resetScrollLockForTest } from "../src/features/member/components/dim-modal";
import { ContestHub } from "../src/features/contest/components/contest-hub";
import { ContestTradingSubheader } from "../src/features/contest/components/contest-trading-terminal";
import {
  AdminContestList,
  ContestCreateEditModal,
} from "../src/features/admin/components/admin-contest-list";
import { AdminContestDetail } from "../src/features/admin/components/admin-contest-detail";
import {
  applyForContestSeason,
  approveAdminContestApplicant,
  bulkApproveAdminContestApplicants,
  cleanupRemainingAdminContestSeason,
  createAdminContestSeason,
  fetchAdminContestSeasonDetail,
  fetchAdminContestSeasons,
  fetchContestSeasonSummary,
  fetchMyContestOverview,
  fetchMyContestSeasons,
  fetchPublicContestLeaderboard,
  fetchPublicContestSeasons,
  fetchPublicMemberContestSeasons,
  formatContestDateTime,
  formatContestSignedRoi,
  formatContestSignedUsdt,
  formatContestUsdt,
  formatContestWinRate,
  toDatetimeLocalInput,
  toIsoInstantFromInput,
  patchAdminContestSeasonStatus,
  rejectAdminContestApplicant,
  settleAdminContestSeason,
  updateAdminContestSeason,
} from "../src/features/contest/api/contest-client";
import { parseAccess } from "../src/features/member/api/contracts";
import {
  authenticateGuestTradingSocket,
  resolveContestTradingPath,
} from "../src/features/trading/api/guest-session";
import { AdminUsers } from "../src/features/admin/components/admin-users";
import { AdminCommunity } from "../src/features/admin/components/admin-community";
import { AdminReportsView } from "../src/features/admin/components/admin-reports";
import {
  deleteAdminCommunityPost,
  deleteAdminCommunityReply,
  dismissAdminReport,
  fetchAdminCommunityPosts,
  fetchAdminCommunityReplies,
  fetchAdminMembers,
  fetchAdminReports,
  moderateAdminReportTarget,
  withdrawAdminMember,
} from "../src/features/admin/api/admin-api";

test("signup waits for the versioned original policies and blocks duplicate pending submissions", () => {
  const html = renderToStaticMarkup(<MemberProvider><SignupForm onSubmit={() => {}} pending={false}/></MemberProvider>);
  assert.match(html, /disabled=""[^>]*>동의하고 가입하기/);
  assert.equal(html.includes('checked=""'), false); assert.equal(html.includes('type="password"'), false);
  assert.match(html, /필수 동의 문서를 확인/);
  assert.match(html, /최대 8자/);
  const pending = renderToStaticMarkup(<MemberProvider><SignupForm onSubmit={() => {}} pending /></MemberProvider>);
  assert.match(pending, /fieldset disabled=""/);
  assert.match(pending, /disabled=""[^>]*>가입 처리 중/);
});
test("login exposes only supported providers and profile content is escaped", () => {
  const login = renderToStaticMarkup(<MemberLoginView google="http://localhost:8080/oauth2/authorization/google" kakao="http://localhost:8080/oauth2/authorization/kakao"/>);
  assert.match(login, /Google로 계속하기/); assert.match(login, /Kakao로 계속하기/);
  const html = renderToStaticMarkup(<MemberProvider><ProfileEditForm nickname="회원" message="<script>alert(1)</script>" pending={false} onSubmit={() => {}} /></MemberProvider>);
  assert.equal(html.includes("<script>"), false); assert.match(html, /&lt;script&gt;/);
});
test("an unchanged legacy nickname remains readable and does not prevent message-only profile edits", () => {
  const html = renderToStaticMarkup(<MemberProvider><ProfileEditForm nickname="legacyname12" message="" pending={false} onSubmit={() => {}} /></MemberProvider>);
  assert.match(html, /value="legacyname12"/);
  assert.equal(html.includes('pattern="[\\p{L}\\p{N}]{1,8}"'), false);
});
test("Member account opening describes server initial grant and preserves existing account and Guest separation", () => {
  const html = renderToStaticMarkup(<GuestStartDialog member dialogRef={createRef<HTMLDialogElement>()} creating={false} failed={false} onStart={() => {}} onCancel={() => {}} onClose={() => {}} />);
  assert.match(html, /1회차 시작 자금은 10,000 USDT/); assert.match(html, /기존 계정 잔액은 자동 변경하지 않습니다/);
  assert.match(html, /Guest의 체험 자산과 금융 이력을 가져오거나 초기화하지 않습니다/);
});
test("failed member preparation directs a read-only lookup instead of offering another creation", () => {
  const html = renderToStaticMarkup(<GuestStartDialog member dialogRef={createRef<HTMLDialogElement>()} creating={false} failed onStart={() => {}} onCancel={() => {}} onClose={() => {}} />);
  assert.match(html, /창을 닫고 계정을 다시 조회/);
  assert.match(html, /disabled=""[^>]*>10,000 USDT로 시작하기/);
  assert.doesNotMatch(html, /서버 연결과 인증 설정/);
  const error = renderToStaticMarkup(<AccountQueryState loading={false} error onRetry={() => {}} />);
  assert.match(error, /잔액과 거래 상태를 알 수 없습니다/);
  assert.doesNotMatch(error, /저장소|0 USDT/);
});
test("account tabs wait for login and account lookup without asking the user to open another account", () => {
  let client: QueryClient | undefined;
  function Tabs() { client = useQueryClient(); return <TradingAccountTabs symbols={[]} />; }
  const html = renderToStaticMarkup(<MemberProvider><TradingDataProvider><Tabs /></TradingDataProvider></MemberProvider>);
  client?.clear();
  assert.match(html, /로그인과 거래 계정을 확인하는 중/);
  assert.doesNotMatch(html, /계정을 열면|로그인 또는 게스트로 참여하면/);
});
test("withdrawal explains irreversible identity removal and preserved records, requires explicit confirmation and blocks the unsupported API", () => {
  const html = renderToStaticMarkup(<WithdrawalConfirmation onSubmit={event => event.preventDefault()} onCancel={() => {}} />);
  for (const text of ["복구할 수 없", "새로운 회원", "이전되지 않", "관리상 종료", "새로운 체결·손익·수수료", "게시글·댓글·대댓글", "탈퇴한회원", "Guest 기록", "서버의 확인 문구 검증과 즉시 거래 차단"])
    assert.equal(html.includes(text), true, text);
  assert.match(html, /<input(?=[^>]*name="acknowledged")(?=[^>]*required="")[^>]*>/);
  assert.match(html, /<input(?=[^>]*name="confirmation")(?=[^>]*required="")(?=[^>]*pattern="탈퇴합니다")[^>]*>/);
  assert.match(html, /disabled=""[^>]*>본인 확인 필요/);
  assert.equal(html.includes('checked=""'), false);
  assert.equal(html.includes("모든 정보가 완전히 삭제"), false);
  assert.equal(html.includes("공인된 전자서명"), false);
});
test("MemberWithdrawal automatically opens the confirmation dialog when rendered with a returned WithdrawalIntent for the active member", async () => {
  const epoch = Date.now();
  const session = createMemberSession("http://localhost:8080", async url => String(url).endsWith("csrf")
    ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
    : Response.json({ memberId: 7, nickname: "회원", accessToken: "header.payload.sig", tokenType: "Bearer", expiresIn: 900, expiresAt: new Date(epoch + 900000).toISOString() }), () => epoch, fn => fn(), () => true, () => null);
  await session.restore();
  const store = new Map<string, string>();
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
  };
  try {
    saveWithdrawalIntent(7, true);
    const html = renderToStaticMarkup(<MemberProvider session={session}><MemberWithdrawal /></MemberProvider>);
    assert.match(html, /<dialog[^>]*\sopen=""/);
    assert.match(html, />탈퇴 요청<\/button>/);
    assert.doesNotMatch(html, /Google로 본인 확인|본인 확인 필요/);
    clearWithdrawalIntent();
    const closed = renderToStaticMarkup(<MemberProvider session={session}><MemberWithdrawal /></MemberProvider>);
    assert.doesNotMatch(closed, /<dialog[^>]*\sopen=/);
    assert.match(closed, />본인 확인 필요<\/button>/);
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previousWindow;
  }
});

test("MemberConsents displays consented policy versions, agreed timestamps, and expandable policy text when reconsent is not required", async () => {
  const epoch = Date.now();
  const session = createMemberSession("http://localhost:8080", async url => String(url).endsWith("csrf")
    ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
    : Response.json({ memberId: 7, nickname: "회원", accessToken: "header.payload.sig", tokenType: "Bearer", expiresIn: 900, expiresAt: new Date(epoch + 900000).toISOString() }), () => epoch, fn => fn(), () => true, () => null);
  await session.restore();
  const snapshot = session.getSnapshot();
  const policyState = parsePolicyState({
    reconsentRequired: false,
    policies: [
      { type: "TERMS", version: "ym-terms-v1", required: true, accepted: true, lastAcceptedVersion: "ym-terms-v1", lastAcceptedAt: "2026-10-25T12:00:00Z", documentUrl: "/api/v1/policies/TERMS/ym-terms-v1" },
      { type: "PRIVACY", version: "ym-privacy-v1", required: true, accepted: true, lastAcceptedVersion: "ym-privacy-v1", lastAcceptedAt: "2026-10-25T12:00:00Z", documentUrl: "/api/v1/policies/PRIVACY/ym-privacy-v1" },
    ],
  });
  const bundle: PolicyBundle = {
    state: policyState,
    documents: {
      TERMS: { type: "TERMS", version: "ym-terms-v1", documentStatus: "DEVELOPMENT_DRAFT", sha256: "a".repeat(64), text: "제1조 이용약관 등록 원문" },
      PRIVACY: { type: "PRIVACY", version: "ym-privacy-v1", documentStatus: "DEVELOPMENT_DRAFT", sha256: "b".repeat(64), text: "제1조 개인정보처리방침 등록 원문" },
    },
  };
  const client = new QueryClient();
  client.setQueryData(["member", "consents", snapshot.memberId, snapshot.generation], policyState);
  client.setQueryData(["public-policies", "http://localhost:8080"], bundle);
  try {
    const html = renderToStaticMarkup(<MemberProvider session={session} client={client}><MemberConsents /></MemberProvider>);
    assert.match(html, /현재 필요한 정책 동의가 완료되었습니다\./);
    assert.match(html, /<strong>이용약관<\/strong> · 동의 버전 ym-terms-v1 · 동의 시각 2026-10-25T12:00:00Z/);
    assert.match(html, /<strong>개인정보처리방침<\/strong> · 동의 버전 ym-privacy-v1 · 동의 시각 2026-10-25T12:00:00Z/);
    assert.match(html, /<details><summary>이용약관 원문 보기 \(ym-terms-v1\)<\/summary><pre class="policy-original">제1조 이용약관 등록 원문<\/pre><\/details>/);
    assert.match(html, /<details><summary>개인정보처리방침 원문 보기 \(ym-privacy-v1\)<\/summary><pre class="policy-original">제1조 개인정보처리방침 등록 원문<\/pre><\/details>/);
  } finally {
    client.clear();
  }
});

test("NewsFeed renders category/symbol filters, expandable article content, and trading shortcut links", async () => {
  const path = newsPath({ category: "CRYPTO", symbolTag: "BTC", keyword: "ETF", cursorId: 12, size: 10 });
  assert.equal(path, "/news?category=CRYPTO&symbolTag=BTC&keyword=ETF&cursorId=12&size=10");
  assert.equal(
    newsPath({ section: "NEWSROOM", subCategory: "CRYPTO", sort: "POPULAR", size: 10 }),
    "/news?section=NEWSROOM&subCategory=CRYPTO&sort=POPULAR&size=10",
  );

  for (const allowedNewsPath of ["/news/highlights", "/news/stream", "/news/10/reactions"]) {
    const res = await contentJson("http://localhost:8080", allowedNewsPath, {}, async () =>
      Response.json({ ok: true }),
    );
    assert.deepEqual(res, { ok: true }, allowedNewsPath);
  }

  assert.deepEqual(
    parseNewsReaction({
      newsId: 10,
      reaction: "BULL",
      bullCount: 45,
      bearCount: 12,
      bullPct: 79,
      bearPct: 21,
    }),
    {
      newsId: 10,
      reaction: "BULL",
      bullCount: 45,
      bearCount: 12,
      bullPct: 79,
      bearPct: 21,
    },
  );

  const rawPage = {
    items: [
      {
        id: 10,
        category: "CRYPTO",
        section: "BREAKING",
        subCategory: "COIN_FLASH",
        title: "비트코인 현물 ETF 자금 유입 확대",
        summary: "기관 중심 순유입이 이어지며 선물 미결제약정이 증가했습니다.",
        content: "미국 현물 ETF 순유입과 함께 BTC 선물 시장의 유동성이 확대되고 있습니다.",
        sourceName: "Yogimangchi Market Desk",
        sourceUrl: "https://www.coindesk.com/markets/btc-etf-inflows",
        thumbnailUrl: "https://images.coindesk.com/btc-etf-thumb.jpg",
        aiSummary: "기관 ETF 자금 유입 확대로 BTC 단기 매수 우위 지속",
        sentiment: "BULLISH",
        bullCount: 52,
        bearCount: 11,
        viewCount: 180,
        symbolTag: "BTC",
        publishedAt: "2026-11-01T09:00:00Z",
      },
      {
        id: 9,
        category: "MACRO",
        title: "미 연준 금리 동결 시사 및 달러 인덱스 보합",
        summary: "거시 불확실성 완화로 위험자산 선호 심리가 회복세를 보였습니다.",
        content: "FOMC 의사록 공개 이후 국채 금리 변동성이 축소되었습니다.",
        sourceName: "Global Macro Wire",
        symbolTag: null,
        publishedAt: "2026-11-01T08:00:00Z",
      },
    ],
    hasNext: true,
    nextCursorId: 9,
  };
  const page = parseNewsPage(rawPage);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].aiSummary, "기관 ETF 자금 유입 확대로 BTC 단기 매수 우위 지속");
  assert.equal(page.items[0].sourceUrl, "https://www.coindesk.com/markets/btc-etf-inflows");

  const parsedHighlights = parseNewsHighlights({
    mustReadBreaking: [rawPage.items[0]],
    popularByViews: [rawPage.items[0]],
    popularByReactions: [rawPage.items[0]],
    keywordIssues: [
      {
        keyword: "현물ETF",
        label: "비트코인 현물 ETF 순유입",
        articleCount: 4,
        sentiment: "BULLISH",
        articles: [rawPage.items[0]],
      },
    ],
    recommendedNewsroom: [rawPage.items[0]],
    sentimentSummary: {
      totalBullVotes: 74,
      totalBearVotes: 26,
      bullPct: 74,
      bearPct: 26,
      dominantSentiment: "BULLISH",
    },
  });
  assert.equal(parsedHighlights.sentimentSummary.bullPct, 74);

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPage={page} initialHighlights={parsedHighlights} />
      </MemberProvider>,
    );
    for (const label of ["코인 시황 (CRYPTO)", "거시·세계 경제 (MACRO)", "온체인·수급 (ONCHAIN)", "규제·정책 (REGULATION)", "#BTC", "#ETH", "#SOL", "#XRP"]) {
      assert.equal(html.includes(label), true, label);
    }
    assert.match(html, /비트코인 현물 ETF 자금 유입 확대/);
    assert.match(html, /aria-label="실시간 뉴스 섹션 메뉴"/);
    assert.match(html, /속보/);
    assert.match(html, /최근 6시간 실시간 속보/);
    assert.match(html, /data-live-status="on"/);
    assert.match(html, /뉴스룸/);
    assert.match(html, /전체 속보/);
    assert.match(html, /코인 속보/);
    assert.match(html, /경제 속보/);
    assert.equal(
      html.indexOf("전체 속보") < html.indexOf("코인 속보") &&
        html.indexOf("코인 속보") < html.indexOf("경제 속보"),
      true,
    );
    assert.match(html, /최신순/);
    assert.match(html, /오래된순/);
    assert.match(html, /지금 꼭 봐야할 속보/);
    assert.match(html, /인기 속보/);
    assert.match(html, /키워드로 보는 이슈/);
    assert.match(html, /강세 74%/);
    assert.match(html, /data-flat-icon="sparkle"/);
    assert.match(html, /AI 분석: 기관 ETF 자금 유입 확대로 BTC 단기 매수 우위 지속/);
    assert.match(html, /<span>원문 기사 보기<\/span><svg[^>]*data-flat-icon="external"/);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(html), false);
    assert.match(html, /href="https:\/\/www\.coindesk\.com\/markets\/btc-etf-inflows"/);
    assert.match(html, /data-infinite-scroll="news-sentinel"/);
    assert.equal(html.includes("새 실시간 속보"), false);
    assert.equal(html.includes("data-news-new-badge="), false);
    assert.match(html, /<select[^>]*aria-label="뉴스 카테고리 필터"/);
    assert.match(html, /<select[^>]*aria-label="뉴스 종목 태그 필터"/);
    assert.match(html, /<select[^>]*aria-label="뉴스 브리핑 보기 방식"/);
    assert.match(html, /미국 현물 ETF 순유입과 함께 BTC 선물 시장의 유동성이 확대되고 있습니다\./);
    assert.equal(html.includes("선물 모의투자 이동"), false);
    assert.equal(html.includes("선물 거래 바로가기"), false);
    assert.match(html, /이전 뉴스 더보기/);
    assert.match(html, /href="\/news">실시간 뉴스/);
    assert.match(html, /href="\/community">커뮤니티/);
    assert.equal(
      html.indexOf("비트코인 현물 ETF 자금 유입 확대") <
        html.indexOf("미 연준 금리 동결 시사 및 달러 인덱스 보합"),
      true,
    );

    const oldestBreakingHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPage={page} initialBreakingSort="OLDEST" initialLiveActive={false} />
      </MemberProvider>,
    );
    assert.match(oldestBreakingHtml, /data-live-status="off"/);
    assert.match(oldestBreakingHtml, /OFF/);
    assert.equal(
      oldestBreakingHtml.indexOf("미 연준 금리 동결 시사 및 달러 인덱스 보합") <
        oldestBreakingHtml.indexOf("비트코인 현물 ETF 자금 유입 확대"),
      true,
    );

    const toastNewsHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPage={page} initialPendingNewNewsCount={2} />
      </MemberProvider>,
    );
    assert.match(toastNewsHtml, /fixed left-1\/2 top-20/);
    assert.match(toastNewsHtml, /새 실시간 속보 2건 보기/);
    assert.match(toastNewsHtml, /data-news-new-badge="10"[^>]*>NEW<\/span>/);
    assert.match(toastNewsHtml, /data-news-new-badge="9"[^>]*>NEW<\/span>/);

    const partitionedBadgeHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed
          initialPage={page}
          initialBreakingSubTab="COIN"
          initialPendingCoinCount={1}
          initialPendingEconomyCount={3}
        />
      </MemberProvider>,
    );
    assert.match(partitionedBadgeHtml, /data-breaking-badge="all"[^>]*>4<\/span>/);
    assert.match(partitionedBadgeHtml, /data-breaking-badge="coin"[^>]*>1<\/span>/);
    assert.match(partitionedBadgeHtml, /data-breaking-badge="economy"[^>]*>3<\/span>/);
    assert.match(partitionedBadgeHtml, /새 실시간 속보 1건 보기/);
    assert.match(partitionedBadgeHtml, /data-news-new-badge="10"[^>]*>NEW<\/span>/);
    assert.equal((partitionedBadgeHtml.match(/data-news-new-badge="/g) ?? []).length, 1);
    assert.equal(partitionedBadgeHtml.includes("미 연준 금리 동결 시사 및 달러 인덱스 보합"), false);

    const newsroomHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPage={page} initialSection="NEWSROOM" />
      </MemberProvider>,
    );
    assert.match(newsroomHtml, /전체/);
    assert.match(newsroomHtml, /암호화폐/);
    assert.match(newsroomHtml, /해외증시/);
    assert.match(newsroomHtml, /환율\/금리/);
    assert.match(newsroomHtml, /최신 뉴스/);
    assert.match(newsroomHtml, /많이 본 뉴스/);
    assert.match(newsroomHtml, /오래된 순/);
    assert.equal(newsroomHtml.includes("선물 모의투자 이동"), false);
    assert.equal(newsroomHtml.includes("선물 거래 바로가기"), false);
    assert.equal(newsroomHtml.includes("data-news-new-badge="), false);
    assert.equal((newsroomHtml.match(/data-s3-slot="news-thumbnail"/g) ?? []).length, 1);
    assert.equal((newsroomHtml.match(/data-newsroom-hashtags="true"/g) ?? []).length, 2);
    assert.equal(
      newsroomHtml.indexOf('data-newsroom-hashtags="true"') <
        newsroomHtml.indexOf("출처 Yogimangchi Market Desk"),
      true,
    );

    const newsroomToastHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPage={page} initialSection="NEWSROOM" initialPendingNewNewsCount={1} />
      </MemberProvider>,
    );
    assert.match(newsroomToastHtml, /새 실시간 속보 1건 보기/);
    assert.match(newsroomToastHtml, /data-news-new-badge="10"[^>]*>NEW<\/span>/);
    assert.equal((newsroomToastHtml.match(/data-news-new-badge="/g) ?? []).length, 1);
  } finally {
    client.clear();
  }
});

test("CommunityBoard renders LATEST/POPULAR sort, post creation, likes, comments/replies, and withdrawn author 탈퇴한회원", async () => {
  assert.equal(
    communityPostsPath({ category: "ANALYSIS", sort: "POPULAR", symbolTag: "ETH", keyword: "돌파", cursorId: 5, size: 10 }),
    "/community/posts?category=ANALYSIS&sort=POPULAR&symbolTag=ETH&keyword=%EB%8F%8C%ED%8C%8C&cursorId=5&size=10",
  );
  assert.match(contentMessage(new ContentApiError(404, "RESOURCE_NOT_FOUND")), /찾을 수 없습니다/);

  const seenUrls: string[] = [];
  await contentJson("http://localhost:8080", "/community/posts/21/likes", { method: "PUT", access: "tok" }, async url => {
    seenUrls.push(String(url));
    return Response.json({ postId: 21, likeCount: 4, likedByMe: true });
  });
  assert.equal(seenUrls[0], "http://localhost:8080/api/v1/community/posts/21/likes");
  assert.deepEqual(parseCommunityLike({ postId: 21, likeCount: 4, likedByMe: true }), { postId: 21, likeCount: 4, likedByMe: true });

  const epoch = Date.now();
  const session = createMemberSession(
    "http://localhost:8080",
    async url =>
      String(url).endsWith("csrf")
        ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
        : Response.json({
            memberId: 7,
            nickname: "트레이더7",
            accessToken: "header.payload.sig",
            tokenType: "Bearer",
            expiresIn: 900,
            expiresAt: new Date(epoch + 900000).toISOString(),
          }),
    () => epoch,
    fn => fn(),
    () => true,
    () => null,
  );
  await session.restore();

  let bearerHeader: string | null = null;
  await readCommunityOrPublic(
    "http://localhost:8080",
    {
      request: async (path, options) => {
        bearerHeader = "Bearer header.payload.sig";
        assert.equal(path, "/community/posts?sort=LATEST&size=10");
        void options;
        return { items: [], hasNext: false, nextCursorId: null };
      },
    },
    session.getSnapshot(),
    "/community/posts?sort=LATEST&size=10",
  );
  assert.equal(bearerHeader, "Bearer header.payload.sig");

  const postPage = parseCommunityPostPage({
    items: [
      {
        id: 21,
        memberId: 7,
        authorNickname: "트레이더7",
        authorProfileImgUrl: "https://s3.ap-northeast-2.amazonaws.com/yogimangchi/profile/7/avatar.png",
        authorWithdrawn: false,
        category: "POSITION",
        symbolTag: "BTC",
        title: "BTC 10배 롱 포지션 진입 및 손절가 공유",
        content: "지지 구간 확인 후 진입했으며 손절가는 -25% ROE 지점으로 설정했습니다.",
        likeCount: 5,
        commentCount: 2,
        likedByMe: true,
        mine: true,
        sharedPosition: SHAREABLE_POSITIONS[0],
        createdAt: "2026-11-01T10:00:00Z",
        updatedAt: "2026-11-01T10:00:00Z",
      },
      {
        id: 20,
        memberId: 99,
        authorNickname: "옛날닉네임",
        authorProfileImgUrl: "https://s3.ap-northeast-2.amazonaws.com/yogimangchi/profile/99/old.png",
        authorWithdrawn: true,
        category: "FREE",
        symbolTag: null,
        title: "탈퇴 회원이 남긴 이전 시황 글",
        content: "탈퇴 후에도 커뮤니티 글과 댓글은 보존됩니다.",
        likeCount: 1,
        commentCount: 0,
        likedByMe: false,
        mine: false,
        createdAt: "2026-11-01T09:30:00Z",
        updatedAt: "2026-11-01T09:30:00Z",
      },
    ],
    hasNext: false,
    nextCursorId: null,
  });

  const commentList = parseCommunityComments({
    items: [
      {
        id: 301,
        postId: 21,
        memberId: 99,
        authorNickname: "탈퇴한회원",
        authorWithdrawn: true,
        parentCommentId: null,
        content: "좋은 관점이네요.",
        mine: false,
        createdAt: "2026-11-01T10:05:00Z",
        updatedAt: "2026-11-01T10:05:00Z",
      },
      {
        id: 302,
        postId: 21,
        memberId: 7,
        authorNickname: "트레이더7",
        authorWithdrawn: false,
        parentCommentId: 301,
        content: "감사합니다! 리스크 관리가 최우선입니다.",
        mine: true,
        createdAt: "2026-11-01T10:06:00Z",
        updatedAt: "2026-11-01T10:06:00Z",
      },
    ],
  });

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <CommunityBoard initialPage={postPage} initialComments={{ 21: commentList.items }} />
      </MemberProvider>,
    );
    assert.match(html, /<option value="LATEST"[^>]*>최신글<\/option>/);
    assert.match(html, /<select[^>]*aria-label="카테고리 필터"/);
    assert.match(html, /<select[^>]*aria-label="종목 태그 필터"/);
    assert.match(html, /<select[^>]*aria-label="정렬 선택"/);
    assert.match(html, /<span>원장 스냅샷 검증됨<\/span><svg[^>]*data-flat-icon="check"/);
    assert.match(html, /BTCUSDT 무기한/);
    assert.match(html, /data-flat-icon="pen"[\s\S]*?<span>글쓰기 모달 열기<\/span>/);
    assert.match(html, /data-flat-icon="chart-bar"[\s\S]*?<span>포지션 공유하기<\/span>/);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(html), false);
    assert.match(html, /<option value="POPULAR"[^>]*>인기글<\/option>/);
    assert.equal(html.includes("새 게시글 보기"), false);
    assert.match(html, /data-infinite-scroll="community-sentinel"/);
    assert.equal(html.includes('id="community-inline-write-form"'), false);
    assert.equal(html.includes('aria-label="댓글 및 대댓글"'), false);
    assert.match(html, /BTC 10배 롱 포지션 진입 및 손절가 공유/);
    assert.match(html, /좋아요 5/);
    assert.match(html, /댓글 2/);
    assert.match(html, /더보기 →/);
    assert.match(html, /href="\/community\/all\/21"/);
    assert.match(html, /게시글 수정/);
    assert.match(html, /게시글 삭제/);
    assert.match(html, /href="\/members\/7">트레이더7<\/a>/);
    assert.equal(postPage.items[0].authorProfileImgUrl, "https://s3.ap-northeast-2.amazonaws.com/yogimangchi/profile/7/avatar.png");
    assert.equal(postPage.items[1].authorProfileImgUrl, null);
    assert.match(html, /src="https:\/\/s3\.ap-northeast-2\.amazonaws\.com\/yogimangchi\/profile\/7\/avatar\.png"/);
    assert.equal(html.includes("old.png"), false);
    assert.match(html, /<span class="member-note" data-withdrawn="true">탈퇴한회원<\/span>/);
    assert.equal(html.includes("옛날닉네임"), false);
    assert.equal(html.includes("/members/99"), false);

    const toastHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <CommunityBoard initialPage={postPage} initialPendingNewPostsCount={3} />
      </MemberProvider>,
    );
    assert.match(toastHtml, /fixed left-1\/2 top-20/);
    assert.match(toastHtml, /새 게시글 보기/);
    assert.match(toastHtml, />3</);

    const detailHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <CommunityBoard
          initialPage={postPage}
          initialComments={{ 21: commentList.items }}
          highlightPostId={21}
        />
      </MemberProvider>,
    );
    assert.match(detailHtml, /커뮤니티 피드로 돌아가기/);
    assert.equal(detailHtml.includes("게시글 상세 #"), false);
    assert.match(detailHtml, /좋은 관점이네요\./);
    assert.match(
      detailHtml,
      /data-flat-icon="corner-down-right"[^>]*>[\s\S]*?<a href="\/members\/7">트레이더7<\/a>: 감사합니다! 리스크 관리가 최우선입니다\./,
    );
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(detailHtml), false);
  } finally {
    client.clear();
  }
});

test("Community API binding supports FormData multipart, S3 files, sharedPosition, comment likes/mentions, deleted parent comment masking, reports, and latest-check", async () => {
  const form = new FormData();
  form.append("category", "ANALYSIS");
  form.append("title", "S3 멀티파트 테스트");
  form.append("content", "차트 이미지 첨부 본문");

  let capturedContentType: string | null = "not-checked";
  let capturedBodyIsFormData = false;
  await contentJson(
    "http://localhost:8080",
    "/community/posts",
    { method: "POST", access: "tok", body: form },
    async (_url, init) => {
      const headers = new Headers(init?.headers);
      capturedContentType = headers.get("Content-Type");
      capturedBodyIsFormData = init?.body instanceof FormData;
      return Response.json({
        id: 55,
        memberId: 7,
        authorNickname: "트레이더7",
        authorWithdrawn: false,
        category: "ANALYSIS",
        symbolTag: "BTC",
        title: "S3 멀티파트 테스트",
        content: "차트 이미지 첨부 본문",
        likeCount: 0,
        commentCount: 0,
        reportCount: 0,
        likedByMe: false,
        reportedByMe: false,
        mine: true,
        files: [],
        sharedPosition: null,
        createdAt: "2026-11-08T10:00:00Z",
        updatedAt: "2026-11-08T10:00:00Z",
      });
    },
  );
  assert.equal(capturedContentType, null);
  assert.equal(capturedBodyIsFormData, true);

  assert.equal(
    contentMessage(new ContentApiError(400, "FILE_VIDEO_NOT_ALLOWED")),
    "동영상 파일은 업로드할 수 없습니다. 이미지(JPG, PNG, WEBP 최대 5MB) 또는 GIF 움짤(최대 3MB)만 첨부해 주세요.",
  );
  assert.equal(
    contentMessage(new ContentApiError(400, "FILE_TYPE_NOT_ALLOWED")),
    "지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 또는 GIF(움짤) 파일만 첨부할 수 있습니다.",
  );
  assert.equal(
    contentMessage(new ContentApiError(400, "GIF_FILE_TOO_LARGE")),
    "GIF 움짤 용량이 제한(최대 3MB)을 초과했습니다. 3MB 이하의 가벼운 GIF 파일만 첨부해 주세요.",
  );
  assert.equal(
    contentMessage(new ContentApiError(400, "IMAGE_FILE_TOO_LARGE")),
    "이미지 파일 용량이 제한(장당 최대 5MB)을 초과했습니다. 5MB 이하의 이미지를 선택해 주세요.",
  );
  assert.equal(
    contentMessage(new ContentApiError(400, "FILE_TOTAL_SIZE_EXCEEDED")),
    "첨부 파일의 총합 용량이 제한(최대 20MB)을 초과했습니다.",
  );
  assert.equal(
    contentMessage(new ContentApiError(400, "FILE_COUNT_EXCEEDED")),
    "첨부 가능한 최대 이미지 장수를 초과했습니다.",
  );

  for (const allowedPath of [
    "/community/posts/latest-check?sincePostId=21",
    "/community/ux/subscribe/feed",
    "/community/report-reasons",
    "/community/posts/21/reports",
    "/community/posts/21/comments/301",
    "/community/posts/21/comments/301/likes",
    "/community/posts/21/comments/301/reports",
    "/community/comments/301",
    "/community/comments/301/likes",
    "/community/comments/301/reports",
  ]) {
    const res = await contentJson("http://localhost:8080", allowedPath, {}, async () =>
      Response.json({ ok: true }),
    );
    assert.deepEqual(res, { ok: true }, allowedPath);
  }

  assert.deepEqual(
    parseCommentLike({ commentId: 302, likeCount: 9, likedByMe: true }),
    { commentId: 302, likeCount: 9, likedByMe: true },
  );
  assert.deepEqual(
    parseCommunityReport({ targetId: 21, reportCount: 2, reportedByMe: true }),
    { targetId: 21, reportCount: 2, reportedByMe: true },
  );
  assert.deepEqual(
    parseReportReasons([
      { code: "SPAM", description: "스팸 홍보/도배글입니다." },
      { code: "ABUSE", description: "욕설/생명경시/혐오/차별적 표현입니다." },
    ]),
    [
      { code: "SPAM", description: "스팸 홍보/도배글입니다." },
      { code: "ABUSE", description: "욕설/생명경시/혐오/차별적 표현입니다." },
    ],
  );

  const latestChecked = parseLatestPostsCheck({
    newPostCount: 1,
    latestPostId: 77,
    items: [
      {
        id: 77,
        memberId: 15,
        authorNickname: "퀀트매니저",
        authorWithdrawn: false,
        category: "POSITION",
        symbolTag: "SOL",
        title: "SOL 20배 대회 포지션 스냅샷 및 S3 차트 공유",
        content: "돌파 구간에서 롱 포지션 유지 중입니다.",
        likeCount: 12,
        commentCount: 3,
        reportCount: 1,
        likedByMe: false,
        reportedByMe: true,
        mine: false,
        files: [
          {
            id: 901,
            postId: 77,
            originalName: "sol-breakout-chart.png",
            size: 124800,
            url: "https://s3.ap-northeast-2.amazonaws.com/yogimangchi/community/77/sol-breakout-chart.png",
            contentType: "image/png",
            createdAt: "2026-11-08T11:00:00Z",
          },
        ],
        sharedPosition: {
          id: "POS_SOL_LONG_20X",
          marketLabel: "시즌 1 대회",
          symbol: "SOL",
          pair: "SOLUSDT",
          side: "LONG",
          leverage: 20,
          entryPrice: "176.20",
          markPrice: "184.50",
          liquidationPrice: "168.10",
          roePct: "+94.21%",
          pnlUsdt: "+471.05 USDT",
          positive: true,
          showPnlAmount: true,
          verified: true,
        },
        createdAt: "2026-11-08T11:00:00Z",
        updatedAt: "2026-11-08T11:00:00Z",
      },
    ],
  });
  assert.equal(latestChecked.newPostCount, 1);
  assert.equal(latestChecked.latestPostId, 77);
  assert.equal(latestChecked.items[0].files?.length, 1);
  assert.equal(latestChecked.items[0].sharedPosition?.pair, "SOLUSDT");

  const commentsWithDeletedAndMention = parseCommunityComments({
    items: [
      {
        id: 401,
        postId: 77,
        memberId: 22,
        authorNickname: "솔라나고래",
        authorWithdrawn: false,
        parentCommentId: null,
        targetCommentId: null,
        targetMemberId: null,
        targetNickname: null,
        content: "삭제된 댓글입니다.",
        likeCount: 0,
        reportCount: 0,
        likedByMe: false,
        reportedByMe: false,
        mine: false,
        deleted: true,
        createdAt: "2026-11-08T11:01:00Z",
        updatedAt: "2026-11-08T11:02:00Z",
      },
      {
        id: 402,
        postId: 77,
        memberId: 31,
        authorNickname: "매크로워처",
        authorWithdrawn: false,
        parentCommentId: 401,
        targetCommentId: 401,
        targetMemberId: 22,
        targetNickname: "솔라나고래",
        content: "타겟 멘션 대댓글이 정상적으로 유지됩니다.",
        likeCount: 7,
        reportCount: 1,
        likedByMe: true,
        reportedByMe: true,
        mine: false,
        deleted: false,
        createdAt: "2026-11-08T11:03:00Z",
        updatedAt: "2026-11-08T11:03:00Z",
      },
    ],
  });

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider client={client}>
        <CommunityBoard
          initialPage={{
            items: latestChecked.items,
            hasNext: false,
            nextCursorId: null,
          }}
          initialComments={{ 77: commentsWithDeletedAndMention.items }}
          highlightPostId={77}
        />
      </MemberProvider>,
    );
    assert.match(html, /data-shared-position="POS_SOL_LONG_20X"/);
    assert.match(html, /SOLUSDT 무기한/);
    assert.match(html, /\+94\.21%/);
    assert.match(html, /\(\+471\.05 USDT\)/);
    assert.match(html, /data-post-files="77"/);
    assert.match(html, /sol-breakout-chart\.png/);
    assert.match(html, /data-deleted-comment="true">삭제된 댓글입니다\.<\/p>/);
    assert.match(html, /data-mention="솔라나고래">@솔라나고래<\/span>/);
    assert.match(html, /타겟 멘션 대댓글이 정상적으로 유지됩니다\./);
    assert.match(html, /data-flat-icon="heart"[^>]*>[\s\S]*?<span>7<\/span>/);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(html), false);
    assert.match(html, /신고 취소/);
    assert.match(html, /data-comment-auth-notice="true"/);
    assert.match(html, /댓글 작성은 로그인 이후 가능합니다\./);
    assert.equal(html.includes("댓글 등록"), false);
    assert.equal(html.includes("답글 등록"), false);
    assert.match(html, /bg-gray-200 text-gray-400 cursor-default/);
    assert.equal(html.includes("cursor-not-allowed"), false);
  } finally {
    client.clear();
  }

  assert.equal(communityCommentsPath(21, 401, 20), "/community/posts/21/comments?cursorId=401&size=20");
  const pagedComments = parseCommunityComments({
    items: commentsWithDeletedAndMention.items,
    hasNext: true,
    nextCursorId: 401,
  });
  assert.equal(pagedComments.hasNext, true);
  assert.equal(pagedComments.nextCursorId, 401);

  const memberCommentPage = parseMemberCommunityCommentPage({
    items: [
      {
        id: 501,
        postId: 21,
        postTitle: "BTC 10배 롱 포지션 진입 및 손절가 공유",
        postCategory: "POSITION",
        postSymbolTag: "BTC",
        memberId: 7,
        authorNickname: "트레이더7",
        authorWithdrawn: false,
        parentCommentId: 301,
        targetCommentId: 301,
        targetMemberId: 99,
        targetNickname: "탈퇴한회원",
        content: "감사합니다! 리스크 관리가 최우선입니다.",
        likeCount: 3,
        reportCount: 0,
        likedByMe: true,
        reportedByMe: false,
        mine: true,
        createdAt: "2026-11-01T10:06:00Z",
        updatedAt: "2026-11-01T10:06:00Z",
      },
    ],
    hasNext: false,
    nextCursorId: null,
  });
  assert.equal(memberCommentPage.items.length, 1);
  assert.equal(memberCommentPage.items[0].postTitle, "BTC 10배 롱 포지션 진입 및 손절가 공유");

  const memberReportPage = parseMemberCommunityReportPage({
    items: [
      {
        id: 1001,
        targetType: "POST",
        targetId: 77,
        postId: 77,
        title: "외부 리딩방 홍보 글",
        reasonType: "SPAM",
        reasonDescription: "스팸 홍보/도배글입니다.",
        status: "RECEIVED",
        createdAt: "2026-11-08T12:00:00Z",
      },
    ],
    hasNext: false,
    nextCursorId: null,
  });
  assert.equal(memberReportPage.items.length, 1);
  assert.equal(memberReportPage.items[0].targetType, "POST");
  assert.equal(memberReportPage.items[0].reasonDescription, "스팸 홍보/도배글입니다.");

  const publicPortfolio = parsePublicMemberPortfolio({
    memberId: 7,
    accountExists: true,
    roundId: 1,
    roundNumber: 1,
    initialSeed: "10000",
    wallet: {
      balance: "10500",
      availableBalance: "8500",
      usedMargin: "2000",
      reservedMargin: "0",
      totalEquity: "10750",
      unrealizedPnl: "250",
      realizedPnl: "500",
      totalPnl: "750",
      totalRoiPct: "7.50",
      priceFresh: true,
    },
    allocation: {
      usedMarginRatioPct: "18.60",
      availableCashRatioPct: "81.40",
      longMarginUsdt: "2000",
      shortMarginUsdt: "0",
      longRatioPct: "100.00",
      shortRatioPct: "0.00",
      longPositionCount: 1,
      shortPositionCount: 0,
    },
    positions: [
      {
        id: 11,
        symbol: "BTCUSDT",
        tradingSymbolId: 1,
        side: "LONG",
        leverage: 10,
        quantity: "0.25",
        entryPrice: "80000",
        markPrice: "81000",
        liquidationPrice: "72500",
        margin: "2000",
        unrealizedPnl: "250",
        roePct: "12.50",
        marginRatioPct: "18.60",
      },
    ],
    symbolPerformances: [],
    closedTradeSummary: {
      closedPositionCount: 5,
      winCount: 4,
      lossCount: 1,
      winRatePct: "80.00",
    },
  });
  assert.equal(publicPortfolio.accountExists, true);
  assert.equal(publicPortfolio.wallet.totalEquity, "10750");
  assert.equal(publicPortfolio.closedTradeSummary.winRatePct, "80.00");

  const globalsCss = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  assert.equal(globalsCss.includes("not-allowed"), false);
  assert.match(globalsCss, /\.trading-workspace textarea:focus-visible/);
});

test("MainPortal, MemberSignupPage, MemberAccount, MemberMyProfilePage, and V1Header render unified V1/xrhub/CoinNess layouts, 4-tab My Page, and auth button rules", async () => {
  const client = new QueryClient();
  const epoch = Date.now();
  const loggedInSession = createMemberSession(
    "http://localhost:8080",
    async url =>
      String(url).endsWith("csrf")
        ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
        : Response.json({
            memberId: 7,
            nickname: "트레이더7",
            accessToken: "header.payload.sig",
            tokenType: "Bearer",
            expiresIn: 900,
            expiresAt: new Date(epoch + 900000).toISOString(),
          }),
    () => epoch,
    fn => fn(),
    () => true,
    () => null,
  );
  await loggedInSession.restore();

  try {
    const portalHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal />
      </MemberProvider>,
    );
    assert.match(portalHtml, /나의 투자 욕망을 실현할 곳/);
    assert.match(portalHtml, /오늘의 요기 달러/);
    assert.match(portalHtml, /환율 계산기/);
    assert.match(portalHtml, /실시간 인기 종목 TOP 3/);
    assert.match(portalHtml, /YOGIMANGCHI PLAYBOOK/);
    assert.match(portalHtml, /24시 실시간 속보/);
    assert.match(portalHtml, /BTC 도미넌스/);
    assert.match(portalHtml, /선물 모의투자 퀵 시뮬레이터/);
    assert.match(portalHtml, /선물 모의투자 시작하기/);
    assert.match(portalHtml, /실시간 커뮤니티 HOT/);
    assert.match(portalHtml, /data-s3-slot="news-thumbnail"/);
    assert.equal(portalHtml.includes('href="/signup"'), false);
    assert.equal(portalHtml.includes('href="/assets"'), false);

    const signupAnonHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MemberSignupPage />
      </MemberProvider>,
    );
    assert.match(signupAnonHtml, /identity_verification_wrap/);
    assert.match(signupAnonHtml, /소셜 계정 본인인증/);
    assert.match(signupAnonHtml, /data-s3-slot="signup-profile-image"/);

    const signupLoggedInHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <MemberSignupPage />
      </MemberProvider>,
    );
    assert.match(signupLoggedInHtml, /이미 로그인되어 있습니다\. 메인 페이지로 자동 이동합니다/);
    assert.equal(signupLoggedInHtml.includes("동의하고 가입하기"), false);
    assert.equal(signupLoggedInHtml.includes('href="/login"'), false);
    assert.equal(signupLoggedInHtml.includes('href="/signup"'), false);

    const accountHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MemberAccount />
      </MemberProvider>,
    );
    assert.match(accountHtml, /회원정보 수정/);
    assert.match(accountHtml, /기본 정보/);
    assert.match(accountHtml, /data-s3-slot="account-profile-image"/);
    assert.equal(accountHtml.includes('href="/signup"'), false);
    assert.equal(accountHtml.includes('href="/assets"'), false);
    assert.equal(accountHtml.includes("마이페이지(/me)"), false);
    assert.equal(accountHtml.includes("마이페이지 (/me)"), false);
    assert.equal(accountHtml.includes("S3 프리뷰 지원"), false);
    assert.equal(accountHtml.includes("S3 스토리지 업로드"), false);
    assert.equal(accountHtml.includes("공개 프로필 보기"), false);
    assert.equal(accountHtml.includes("회원 #"), false);

    // 비로그인 시 마이페이지(/me): 오직 2탭(포트폴리오, 커뮤니티활동)만 노출, 자산 2탭 숨김
    const meAnonHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MemberMyProfilePage />
      </MemberProvider>,
    );
    assert.match(meAnonHtml, /마이페이지/);
    assert.match(meAnonHtml, /data-tab-variant="bookmark"/);
    assert.match(meAnonHtml, /포트폴리오/);
    assert.match(meAnonHtml, /커뮤니티활동/);
    assert.equal(meAnonHtml.includes("내 모의투자 자산"), false);
    assert.equal(meAnonHtml.includes("시즌별 대회 자산"), false);
    assert.match(meAnonHtml, /포지션 증거금 비중 \(%\)/);
    assert.match(meAnonHtml, /롱 \/ 숏 포지션 비율/);

    // 로그인 시 마이페이지(/me): 4대 메인 탭 전체 노출 + 모의투자 5탭 원장 기본 노출
    const meLoggedInHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <MemberMyProfilePage />
      </MemberProvider>,
    );
    assert.match(meLoggedInHtml, /내 모의투자 자산/);
    assert.equal(meLoggedInHtml.includes("터미널에서 주문하기"), false);
    assert.match(meLoggedInHtml, /data-tab-variant="bookmark"/);
    assert.equal(meLoggedInHtml.includes("border-t-[3px]"), false);
    assert.equal(meLoggedInHtml.includes("transition-all"), false);
    assert.match(
      meLoggedInHtml,
      /aria-selected="true"[^>]*class="[^"]*h-10[^"]*border-\[#0058FF\] bg-\[#0058FF\] font-black text-white/,
    );
    assert.match(
      meLoggedInHtml,
      /aria-selected="false"[^>]*class="[^"]*h-10[^"]*bg-\[#EEF1F6\] font-bold text-gray-500/,
    );
    assert.match(meLoggedInHtml, /시즌별 대회 자산/);
    assert.match(meLoggedInHtml, /포트폴리오/);
    assert.match(meLoggedInHtml, /커뮤니티활동/);
    assert.match(meLoggedInHtml, /포지션 현황/);
    assert.match(meLoggedInHtml, /손익현황/);
    assert.match(meLoggedInHtml, /주문내역/);
    assert.match(meLoggedInHtml, /거래내역/);
    assert.match(meLoggedInHtml, /미체결내역/);
    assert.equal(meLoggedInHtml.includes('href="/login"'), false);
    assert.equal(meLoggedInHtml.includes('href="/signup"'), false);

    // 헤더 비로그인 vs 로그인 버튼 및 라이트/다크 픽셀 단위 100% 동일 규격 검증
    const anonHeaderHtml = renderToStaticMarkup(
      <V1Header theme="dark" rightExtra={<span>불필요한우측요소</span>} />,
    );
    assert.match(anonHeaderHtml, /src="\/logo_dark\.png"/);
    assert.match(anonHeaderHtml, /href="\/login"[^>]*>로그인<\/a>/);
    assert.match(anonHeaderHtml, /h-16 w-full max-w-\[1280px\]/);
    assert.match(anonHeaderHtml, /h-9 min-w-\[96px\]/);
    assert.match(anonHeaderHtml, /border-white\/10 bg-\[#0B0E11\] text-white/);
    assert.equal(anonHeaderHtml.includes('href="/signup"'), false);
    assert.equal(anonHeaderHtml.includes("테마 전환"), false);
    assert.equal(anonHeaderHtml.includes("알림 열기"), false);
    assert.equal(anonHeaderHtml.includes("내 프로필 아바타"), false);
    assert.equal(anonHeaderHtml.includes("불필요한우측요소"), false);

    const loggedInHeaderHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <V1Header theme="light" />
      </MemberProvider>,
    );
    assert.match(loggedInHeaderHtml, /src="\/images\/logo\.webp"/);
    assert.match(loggedInHeaderHtml, /href="\/me"[^>]*>마이페이지<\/a>/);
    assert.match(loggedInHeaderHtml, /h-16 w-full max-w-\[1280px\]/);
    assert.match(loggedInHeaderHtml, /h-9 min-w-\[96px\]/);
    assert.match(loggedInHeaderHtml, /border-gray-200 bg-white text-gray-900/);
    assert.equal(loggedInHeaderHtml.includes('href="/login"'), false);
    assert.equal(loggedInHeaderHtml.includes('href="/signup"'), false);
    assert.equal(loggedInHeaderHtml.includes('href="/assets"'), false);
    assert.equal(loggedInHeaderHtml.includes("테마 전환"), false);
    assert.equal(loggedInHeaderHtml.includes("알림 열기"), false);
    assert.equal(loggedInHeaderHtml.includes("내 프로필 아바타"), false);
    const newsIdx = loggedInHeaderHtml.indexOf('href="/news"');
    const tradingIdx = loggedInHeaderHtml.indexOf('href="/trading"');
    const contestIdx = loggedInHeaderHtml.indexOf('href="/contest"');
    const communityIdx = loggedInHeaderHtml.indexOf('href="/community"');
    assert.equal(newsIdx > 0 && newsIdx < tradingIdx && tradingIdx < contestIdx && contestIdx < communityIdx, true);

    const publicMemberHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <PublicMember memberId={11} />
      </MemberProvider>,
    );
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(portalHtml), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(signupAnonHtml), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(meAnonHtml), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(meLoggedInHtml), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(publicMemberHtml), false);
    assert.match(portalHtml, /<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*data-flat-icon="swap"/);
    assert.match(portalHtml, /<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*data-flat-icon="bolt"/);
    assert.match(portalHtml, /<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*data-flat-icon="trophy"/);
    assert.match(portalHtml, /<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*data-flat-icon="heart"/);
    assert.match(portalHtml, /<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*data-flat-icon="comment"/);
    assert.match(signupAnonHtml, /<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*data-flat-icon="check"/);
  } finally {
    client.clear();
  }
});

test("DimModal and scroll lock preserve exact scrollY position and hide scrollbar without jumping to top", () => {
  resetScrollLockForTest();
  let restoredX = -1;
  let restoredY = -1;
  const mockWin = {
    scrollY: 480,
    scrollTo: (x: number, y: number) => {
      restoredX = x;
      restoredY = y;
    },
  };
  const mockDoc = {
    body: {
      style: {} as Record<string, string>,
      dataset: {} as Record<string, string | undefined>,
    },
    documentElement: {
      scrollTop: 480,
      style: {} as Record<string, string>,
    },
  };

  const saved = lockBodyScroll(mockWin, mockDoc);
  assert.equal(saved, 480);
  assert.equal(mockDoc.body.style.position, "fixed");
  assert.equal(mockDoc.body.style.top, "-480px");
  assert.equal(mockDoc.body.style.overflow, "hidden");
  assert.equal(mockDoc.documentElement.style.overflow, "hidden");
  assert.equal(mockDoc.documentElement.style.scrollbarWidth, "none");

  const unlockedY = unlockBodyScroll(mockWin, mockDoc);
  assert.equal(unlockedY, 480);
  assert.equal(mockDoc.body.style.position, "");
  assert.equal(mockDoc.body.style.top, "");
  assert.equal(restoredX, 0);
  assert.equal(restoredY, 480);

  const openModalHtml = renderToStaticMarkup(
    <DimModal open onClose={() => {}} title="속보 상세 팝업">
      <p>팝업 본문 내용</p>
    </DimModal>,
  );
  assert.match(openModalHtml, /data-dim-modal="open"/);
  assert.match(openModalHtml, /속보 상세 팝업/);
  assert.equal(
    renderToStaticMarkup(
      <DimModal open={false} onClose={() => {}} title="닫힌 팝업">
        <p>내용</p>
      </DimModal>,
    ),
    "",
  );
});

test("MemberShell and MemberLoginView render the official /images/logo.webp brand asset", () => {
  const client = new QueryClient();
  try {
    const loginHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MemberLoginView google="http://localhost:8080/oauth2/authorization/google" kakao="http://localhost:8080/oauth2/authorization/kakao" />
      </MemberProvider>,
    );
    assert.match(loginHtml, /src="\/images\/logo\.webp"/);
    assert.match(loginHtml, /ym-login-logo-img/);
    assert.match(loginHtml, /max-w-\[520px\]/);
    assert.match(loginHtml, /sm:whitespace-nowrap/);
    assert.match(loginHtml, /sm:flex-nowrap/);

    const globalsCss = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    assert.match(globalsCss, /\.ym-container-auth\s*\{[\s\S]*?max-width:\s*560px;/);
    assert.match(globalsCss, /\.ym-container-signup\s*\{[\s\S]*?max-width:\s*580px;/);

    const portalHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal />
      </MemberProvider>,
    );
    assert.match(portalHtml, /src="\/images\/logo\.webp"/);
    assert.match(portalHtml, /ym-brand-logo-img/);

    const footerHtml = renderToStaticMarkup(<SiteFooter />);
    assert.match(footerHtml, /© 2026 YogiMangchi\. All rights reserved\./);
    assert.equal(footerHtml.includes("Yogi-Mangchi"), false);
  } finally {
    client.clear();
  }
});

test("Market overview helpers and MainPortal top ticker bar bind free public market metrics with safe fallbacks", async () => {
  assert.equal(classifyFearGreedLabelKr(15), "극단적 공포");
  assert.equal(classifyFearGreedLabelKr(35), "공포");
  assert.equal(classifyFearGreedLabelKr(50), "중립");
  assert.equal(classifyFearGreedLabelKr(68), "탐욕");
  assert.equal(classifyFearGreedLabelKr(82), "극단적 탐욕");

  assert.equal(computeKimchiPremiumPercent(135_000_000, 96_500, 1_385), 1.01);
  const domDelta = computeBtcDominanceChange24h(58.2, 1.8, 4.2);
  assert.equal(domDelta > 0, true);

  const liveOverview = await fetchLiveMarketOverview(async url => {
    const target = String(url);
    if (target.includes("api.coingecko.com/api/v3/global")) {
      return Response.json({
        data: {
          market_cap_percentage: { btc: 58.34 },
          market_cap_change_percentage_24h_usd: 1.5,
        },
      });
    }
    if (target.includes("fapi.binance.com/fapi/v1/ticker/24hr")) {
      return Response.json({
        lastPrice: "97200.00",
        priceChangePercent: "3.10",
      });
    }
    if (target.includes("api.upbit.com/v1/ticker")) {
      return Response.json([{ trade_price: 136_500_000 }]);
    }
    if (target.includes("open.er-api.com")) {
      return Response.json({ rates: { KRW: 1390 } });
    }
    if (target.includes("api.coingecko.com/api/v3/derivatives/exchanges")) {
      return Response.json([
        { id: "binance_futures", open_interest_btc: 425_000 },
      ]);
    }
    if (target.includes("api.alternative.me/fng")) {
      return Response.json({
        data: [{ value: "74", value_classification: "Greed" }],
      });
    }
    if (target.includes("fapi.binance.com/futures/data/takerlongshortRatio")) {
      return Response.json([
        { buyVol: "620.0", sellVol: "380.0", buySellRatio: "1.6316" },
      ]);
    }
    return new Response("not found", { status: 404 });
  });

  assert.equal(liveOverview.btcDominancePercent, 58.3);
  assert.equal(liveOverview.btcDominanceChange24h > 0, true);
  assert.equal(liveOverview.kimchiPremiumPercent, 1.03);
  assert.equal(liveOverview.openInterestBillionsUsd, 41.3);
  assert.equal(liveOverview.fearGreedValue, 74);
  assert.equal(liveOverview.fearGreedLabelKr, "탐욕");
  assert.equal(liveOverview.futuresBullPct, 62);
  assert.equal(liveOverview.futuresBearPct, 38);
  assert.equal(liveOverview.btcChange24h, 3.1);

  const fallbackOverview = await fetchLiveMarketOverview(async () => {
    throw new Error("network down");
  });
  assert.equal(fallbackOverview.btcDominancePercent, FALLBACK_MARKET_OVERVIEW.btcDominancePercent);
  assert.equal(fallbackOverview.kimchiPremiumPercent, FALLBACK_MARKET_OVERVIEW.kimchiPremiumPercent);
  assert.equal(fallbackOverview.openInterestBillionsUsd, FALLBACK_MARKET_OVERVIEW.openInterestBillionsUsd);
  assert.equal(fallbackOverview.fearGreedValue, FALLBACK_MARKET_OVERVIEW.fearGreedValue);
  assert.equal(fallbackOverview.fearGreedLabelKr, FALLBACK_MARKET_OVERVIEW.fearGreedLabelKr);

  const parsed = parseMarketOverviewPayload({
    btcDominancePercent: 59.1,
    btcDominanceChange24h: -0.45,
    kimchiPremiumPercent: -0.32,
    openInterestBillionsUsd: 44.8,
    fearGreedValue: 22,
    fearGreedLabelKr: "극단적 공포",
    updatedAt: "2026-11-10T09:30:00Z",
  });

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal initialMarketOverview={parsed} />
      </MemberProvider>,
    );
    assert.match(html, /BTC 도미넌스[\s\S]*?>59\.1%<\/strong>[\s\S]*?text-blue-600">-0\.45%<\/em>/);
    assert.match(html, /김치프리미엄[\s\S]*?>-0\.32%<\/strong>/);
    assert.match(html, /24h 선물 미결제약정[\s\S]*?>\$44\.8B<\/strong>/);
    assert.match(html, /공포·탐욕 지수[\s\S]*?>22 \(극단적 공포\)<\/strong>/);
  } finally {
    client.clear();
  }
});

test("NewsFeed 실시간 뉴스 투자 심리 card dynamically binds real news sentiment, user reactions, and live market overview metrics", () => {
  const highlightsWithSummary = parseNewsHighlights({
    mustReadBreaking: [],
    popularByViews: [],
    popularByReactions: [],
    keywordIssues: [],
    recommendedNewsroom: [],
    sentimentSummary: {
      totalBullVotes: 15,
      totalBearVotes: 45,
      bullPct: 25,
      bearPct: 75,
      dominantSentiment: "BEARISH",
      bullishArticleCount: 2,
      bearishArticleCount: 7,
      neutralArticleCount: 1,
      summary: "거시 긴축 우려 및 선물 롱 청산 확대로 단기 매도 심리가 우세합니다.",
    },
  });
  assert.equal(highlightsWithSummary.sentimentSummary.bullishArticleCount, 2);
  assert.equal(highlightsWithSummary.sentimentSummary.bearishArticleCount, 7);
  assert.equal(highlightsWithSummary.sentimentSummary.neutralArticleCount, 1);
  assert.equal(
    highlightsWithSummary.sentimentSummary.summary,
    "거시 긴축 우려 및 선물 롱 청산 확대로 단기 매도 심리가 우세합니다.",
  );

  const bearishMarket = parseMarketOverviewPayload({
    btcDominancePercent: 57.2,
    btcDominanceChange24h: -0.25,
    kimchiPremiumPercent: -0.4,
    openInterestBillionsUsd: 36.1,
    fearGreedValue: 28,
    fearGreedLabelKr: "공포",
    futuresBullPct: 36,
    futuresBearPct: 64,
    btcChange24h: -4.2,
    updatedAt: "2026-11-10T09:40:00Z",
  });

  const computedBearish = computeLiveNewsSentiment({
    articles: [],
    highlights: highlightsWithSummary,
    marketOverview: bearishMarket,
  });
  assert.equal(computedBearish.bullPct + computedBearish.bearPct, 100);
  assert.equal(computedBearish.bullPct < 40, true);
  assert.match(
    computedBearish.summaryText,
    /거시 긴축 우려 및 선물 롱 청산 확대로 단기 매도 심리가 우세합니다\. \(공포·탐욕 28 공포 · 선물 매수수급 36%\)/,
  );

  const samplePage = parseNewsPage({
    items: [
      {
        id: 501,
        category: "CRYPTO",
        title: "비트코인 현물 ETF 순유입 및 기관 매수세 확대",
        summary: "기관 수요 유입으로 단기 반등 모멘텀이 강화되었습니다.",
        content: "본문",
        sourceName: "Desk",
        sentiment: "BULLISH",
        bullCount: 10,
        bearCount: 2,
        symbolTag: "BTC",
        publishedAt: "2026-11-10T09:00:00Z",
      },
      {
        id: 502,
        category: "MACRO",
        title: "미 국채 금리 급락에 따른 위험자산 선호 회복",
        summary: "거시 지표 안정으로 매수 심리가 유입되고 있습니다.",
        content: "본문",
        sourceName: "Desk",
        sentiment: "BULLISH",
        bullCount: 8,
        bearCount: 2,
        symbolTag: null,
        publishedAt: "2026-11-10T08:30:00Z",
      },
    ],
    hasNext: false,
    nextCursorId: null,
  });

  const beforeReaction = computeLiveNewsSentiment({
    articles: samplePage.items,
  });
  const afterBearSurge = computeLiveNewsSentiment({
    articles: samplePage.items,
    liveReactions: {
      501: { bullCount: 10, bearCount: 90 },
    },
    userReactions: {
      502: "bear",
    },
  });
  assert.equal(beforeReaction.bullPct + beforeReaction.bearPct, 100);
  assert.equal(afterBearSurge.bullPct + afterBearSurge.bearPct, 100);
  assert.equal(afterBearSurge.bullPct < beforeReaction.bullPct, true);
  assert.match(afterBearSurge.summaryText, /실시간 뉴스\(강세 2건·약세 0건, 투표 111표\)/);

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed
          initialPage={samplePage}
          initialHighlights={highlightsWithSummary}
          initialMarketOverview={bearishMarket}
        />
      </MemberProvider>,
    );
    assert.match(html, new RegExp(`강세 ${computedBearish.bullPct}%`));
    assert.match(html, new RegExp(`약세 ${computedBearish.bearPct}%`));
    assert.match(
      html,
      /거시 긴축 우려 및 선물 롱 청산 확대로 단기 매도 심리가 우세합니다\. \(공포·탐욕 28 공포 · 선물 매수수급 36%\)/,
    );
    assert.equal(
      html.includes("현물 ETF 자금 유입 및 거시 금리 동결 기조로 단기 매수 심리가 우위를 보이고 있습니다."),
      false,
    );
  } finally {
    client.clear();
  }
});

test("MainPortal binds live USD/KRW exchange rate 14-day history and trading-server Redis Top 3 popular coins", async () => {
  const detHistory = buildDeterministicUsdKrwHistory(1405.2);
  assert.equal(detHistory.length, 14);
  assert.equal(detHistory[13], 1405.2);

  const chartGeo = buildExchangeRateChartGeometry([
    1390.0, 1392.0, 1391.5, 1394.0, 1395.5, 1396.0, 1397.2, 1398.4, 1400.1, 1401.5,
    1403.0, 1404.2, 1408.6, 1405.2,
  ]);
  assert.equal(chartGeo.twoWeeksAgoRate, 1390.0);
  assert.equal(chartGeo.oneWeekAgoRate, 1398.4);
  assert.equal(chartGeo.todayRate, 1405.2);
  assert.match(chartGeo.polylinePoints, /^10,\d+\.\d+ .* 410,\d+\.\d+$/);

  const mappedCoins = mapRedisTickersToPopularCoins([
    {
      tradingSymbolId: 1,
      symbol: "BTC",
      quoteAsset: "USDT",
      markPrice: "96840.25",
      changePercent24h: "3.42",
      highPrice24h: "97500.00",
      lowPrice24h: "93200.00",
      quoteVolume24h: "2450800000",
      status: "FRESH",
    },
    {
      tradingSymbolId: 2,
      symbol: "ETH",
      quoteAsset: "USDT",
      markPrice: "3085.50",
      changePercent24h: "-1.75",
      highPrice24h: "3180.00",
      lowPrice24h: "3050.00",
      quoteVolume24h: "980400000",
      status: "FRESH",
    },
    {
      tradingSymbolId: 3,
      symbol: "SOL",
      quoteAsset: "USDT",
      markPrice: "228.90",
      changePercent24h: "6.15",
      highPrice24h: "232.00",
      lowPrice24h: "214.00",
      quoteVolume24h: "745200000",
      status: "FRESH",
    },
  ]);

  assert.equal(mappedCoins.length, 3);
  assert.equal(mappedCoins[0].price, "$96,840.25");
  assert.equal(mappedCoins[0].changeRate, 3.42);
  assert.equal(mappedCoins[0].volume, "2,450.8M USDT");
  assert.equal(mappedCoins[0].strokeColor, "#EF4444");

  assert.equal(mappedCoins[1].price, "$3,085.50");
  assert.equal(mappedCoins[1].changeRate, -1.75);
  assert.equal(mappedCoins[1].volume, "980.4M USDT");
  assert.equal(mappedCoins[1].strokeColor, "#2563EB");

  assert.equal(mappedCoins[2].price, "$228.90");
  assert.equal(mappedCoins[2].changeRate, 6.15);
  assert.equal(mappedCoins[2].volume, "745.2M USDT");
  assert.equal(mappedCoins[2].strokeColor, "#EF4444");

  const customOverview = parseMarketOverviewPayload({
    btcDominancePercent: 58.1,
    btcDominanceChange24h: 0.41,
    kimchiPremiumPercent: 1.12,
    openInterestBillionsUsd: 40.5,
    fearGreedValue: 71,
    fearGreedLabelKr: "탐욕",
    futuresBullPct: 58,
    futuresBearPct: 42,
    btcChange24h: 3.42,
    usdKrwRate: 1405.2,
    usdKrwChangeAmount: -3.4,
    usdKrwChangePct: -0.24,
    usdKrwHistory: [
      1390.0, 1392.0, 1391.5, 1394.0, 1395.5, 1396.0, 1397.2, 1398.4, 1400.1, 1401.5,
      1403.0, 1404.2, 1408.6, 1405.2,
    ],
    updatedAt: "2026-11-10T10:00:00Z",
  });

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal
          initialMarketOverview={customOverview}
          initialTickers={[
            {
              tradingSymbolId: 1,
              symbol: "BTC",
              quoteAsset: "USDT",
              markPrice: "96840.25",
              changePercent24h: "3.42",
              highPrice24h: "97500.00",
              lowPrice24h: "93200.00",
              quoteVolume24h: "2450800000",
              status: "FRESH",
            },
            {
              tradingSymbolId: 2,
              symbol: "ETH",
              quoteAsset: "USDT",
              markPrice: "3085.50",
              changePercent24h: "-1.75",
              highPrice24h: "3180.00",
              lowPrice24h: "3050.00",
              quoteVolume24h: "980400000",
              status: "FRESH",
            },
            {
              tradingSymbolId: 3,
              symbol: "SOL",
              quoteAsset: "USDT",
              markPrice: "228.90",
              changePercent24h: "6.15",
              highPrice24h: "232.00",
              lowPrice24h: "214.00",
              quoteVolume24h: "745200000",
              status: "FRESH",
            },
          ]}
        />
      </MemberProvider>,
    );

    assert.match(html, /1 YD = 1,405\.20 KRW/);
    assert.match(html, /▼ -3\.40 \(-0\.24%\)/);
    assert.match(html, /2주 전 \(1,390\.0원\)/);
    assert.match(html, /1주 전 \(1,398\.4원\)/);
    assert.match(html, /오늘 \(1,405\.2원\)/);
    assert.match(html, /value="140,520"/);

    assert.match(html, /\$96,840\.25/);
    assert.match(html, /\+3\.42%/);
    assert.match(html, /24h 거래대금 2,450\.8M USDT/);

    assert.match(html, /\$3,085\.50/);
    assert.match(html, /text-blue-600">-1\.75%<\/span>/);
    assert.match(html, /24h 거래대금 980\.4M USDT/);
    assert.match(html, /stroke="#2563EB"/);
  } finally {
    client.clear();
  }
});

test("모바일 반응형 레이아웃 클래스가 헤더·메인·뉴스·커뮤니티·마이페이지에 적용된다", () => {
  const client = new QueryClient();
  try {
    const headerHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <V1Header />
      </MemberProvider>,
    );
    assert.match(
      headerHtml,
      /ym-gnb-inner mx-auto flex h-16 w-full max-w-\[1280px\] items-center justify-between px-4 sm:px-6/,
    );

    const mainHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal />
      </MemberProvider>,
    );
    // 메인 시장 요약·환율·인기종목 반응형 클래스
    assert.match(mainHtml, /gap-x-3 gap-y-1\.5 text-\[11px\] sm:gap-4 sm:text-xs/);
    assert.match(mainHtml, /whitespace-nowrap text-xl font-black text-gray-900 sm:text-3xl/);
    assert.match(mainHtml, /h-11 w-24 shrink-0 sm:w-28/);

    const newsHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPendingCoinCount={2} initialPendingEconomyCount={1} />
      </MemberProvider>,
    );
    // 속보 서브탭 뉴스룸과 동일한 중앙 세그먼트 탭 바 및 투자 심리 바 줄바꿈 방지
    assert.match(newsHtml, /mx-auto grid max-w-xl grid-cols-3 gap-1 rounded-2xl bg-\[#F2F4F7\] p-1\.5/);
    assert.match(newsHtml, /bg-\[#2EBD85\] px-1\.5 whitespace-nowrap/);
    assert.match(newsHtml, /data-breaking-badge="all"/);

    const communityHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <CommunityBoard
          initialPage={{
            items: [
              {
                id: 901,
                memberId: 7,
                authorNickname: "트레이더7",
                authorProfileImgUrl: null,
                authorWithdrawn: false,
                category: "POSITION",
                symbolTag: "BTC",
                title: "모바일 반응형 테스트 게시글",
                content: "포지션 스냅샷 카드 반응형 확인",
                likeCount: 5,
                commentCount: 1,
                likedByMe: false,
                reportedByMe: false,
                mine: false,
                sharedPosition: SHAREABLE_POSITIONS[0],
                files: [],
                createdAt: "2026-11-10 10:00",
                updatedAt: "2026-11-10 10:00",
              },
            ],
            hasNext: false,
            nextCursorId: null,
          }}
        />
      </MemberProvider>,
    );
    // 커뮤니티 게시글 카드 모바일 패딩 및 포지션 공유 스냅샷 반응형 그리드
    assert.match(communityHtml, /rounded-2xl border border-gray-200 bg-white p-4 transition-colors sm:p-6/);
    assert.match(communityHtml, /grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white px-3\.5 py-2\.5 text-xs sm:grid-cols-3/);

    const myPageHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MemberMyProfilePage />
      </MemberProvider>,
    );
    // 마이페이지 북마크 탭 모바일 패딩, 도넛 차트 세로/가로 반응형 스택, 롱/숏 비율 줄바꿈 대응
    assert.match(myPageHtml, /px-3 sm:px-5 text-xs sm:text-sm/);
    assert.match(myPageHtml, /flex flex-col items-center gap-4 sm:flex-row sm:gap-6/);
    assert.match(
      myPageHtml,
      /flex flex-wrap items-center justify-between gap-1 text-\[11px\] sm:text-xs font-black/,
    );
  } finally {
    client.clear();
  }
});

test("뉴스 조회수 멱등 카운트(로그인 계정당 1회·비로그인 일일 1회) 및 많이 본 뉴스 정렬(조회수 내림차순, 동률 시 최신순)이 동작한다", async () => {
  const storeData = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => storeData.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storeData.set(key, val);
    },
  };

  // 1. KST 날짜 포맷 및 비로그인 익명 뷰어 식별자 유지 검증
  const kstDay1 = getKstDateString(new Date("2026-11-10T01:00:00Z"));
  assert.equal(kstDay1, "2026-11-10");
  const viewerId1 = getOrCreateAnonNewsViewerId(mockStorage);
  const viewerId2 = getOrCreateAnonNewsViewerId(mockStorage);
  assert.match(viewerId1, /^anon-[A-Za-z0-9._:-]+$/);
  assert.equal(viewerId1, viewerId2);

  // 2. 비로그인 유저: 같은 날(2026-11-10)에는 1번만 조회수가 증가하고, 다음 날(2026-11-11)에는 다시 1번 증가
  const baseArticle = {
    id: 501,
    category: "CRYPTO" as const,
    section: "NEWSROOM" as const,
    subCategory: "CRYPTO" as const,
    title: "비트코인 기관 수급 분석",
    summary: "요약",
    content: "본문",
    sourceName: "Yogimangchi Desk",
    sourceUrl: "https://example.com/news/501",
    thumbnailUrl: null,
    aiSummary: null,
    sentiment: "BULLISH" as const,
    bullCount: 10,
    bearCount: 2,
    viewCount: 100,
    symbolTag: "BTC",
    publishedAt: "2026-11-10T08:00:00Z",
  };

  assert.equal(hasAnonViewedNewsToday(501, "2026-11-10", mockStorage), false);
  const firstAnon = applyIdempotentNewsView(baseArticle, {
    today: "2026-11-10",
    storage: mockStorage,
  });
  assert.equal(firstAnon.incremented, true);
  assert.equal(firstAnon.viewCount, 101);
  assert.equal(hasAnonViewedNewsToday(501, "2026-11-10", mockStorage), true);

  const secondAnonSameDay = applyIdempotentNewsView(
    { ...baseArticle, viewCount: firstAnon.viewCount },
    { today: "2026-11-10", storage: mockStorage },
  );
  assert.equal(secondAnonSameDay.incremented, false);
  assert.equal(secondAnonSameDay.viewCount, 101);

  // 다음 날(2026-11-11)에는 이전 날짜 기록이 정리되고 다시 1회 카운트 가능
  assert.equal(hasAnonViewedNewsToday(501, "2026-11-11", mockStorage), false);
  markAnonViewedNewsToday(502, "2026-11-11", mockStorage);
  const nextDayAnon = applyIdempotentNewsView(
    { ...baseArticle, viewCount: 101 },
    { today: "2026-11-11", storage: mockStorage },
  );
  assert.equal(nextDayAnon.incremented, true);
  assert.equal(nextDayAnon.viewCount, 102);

  // 3. 로그인 회원: 계정당 영구 1회만 증가하고 다른 계정은 별도로 1회 증가
  assert.equal(hasMemberViewedNews(77, 501, mockStorage), false);
  const member77First = applyIdempotentNewsView(
    { ...baseArticle, viewCount: 200 },
    { memberId: 77, storage: mockStorage },
  );
  assert.equal(member77First.incremented, true);
  assert.equal(member77First.viewCount, 201);
  assert.equal(hasMemberViewedNews(77, 501, mockStorage), true);

  const member77Second = applyIdempotentNewsView(
    { ...baseArticle, viewCount: 201 },
    { memberId: 77, storage: mockStorage },
  );
  assert.equal(member77Second.incremented, false);
  assert.equal(member77Second.viewCount, 201);

  markMemberViewedNews(88, 999, mockStorage);
  const member88First = applyIdempotentNewsView(
    { ...baseArticle, viewCount: 201 },
    { memberId: 88, storage: mockStorage },
  );
  assert.equal(member88First.incremented, true);
  assert.equal(member88First.viewCount, 202);

  // 4. contentJson `/news/{id}/views` 경로 및 `X-Anon-Viewer-Id` 헤더 전달 검증
  let capturedUrl = "";
  let capturedAnonHeader = "";
  await contentJson(
    "http://localhost:8080",
    "/news/501/views",
    { method: "POST", anonViewerId: viewerId1 },
    async (input, init) => {
      capturedUrl = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAnonHeader = headers["X-Anon-Viewer-Id"] ?? "";
      return new Response(JSON.stringify({ ...baseArticle, viewCount: 105 }), { status: 200 });
    },
  );
  assert.equal(capturedUrl, "http://localhost:8080/api/v1/news/501/views");
  assert.equal(capturedAnonHeader, viewerId1);

  // 5. sortNewsItems(items, "POPULAR"): 반응수(bull+bear)와 무관하게 실제 viewCount 내림차순,
  //    조회수가 같을 때는 publishedAt 최신순(동일 시각이면 id 내림차순)으로 정렬
  const sampleItems = [
    {
      ...baseArticle,
      id: 1,
      title: "조회수 50 · 오래된 기사 (반응 매우 많음)",
      bullCount: 999,
      bearCount: 500,
      viewCount: 50,
      publishedAt: "2026-11-10T06:00:00Z",
    },
    {
      ...baseArticle,
      id: 2,
      title: "조회수 50 · 최신 기사",
      bullCount: 1,
      bearCount: 0,
      viewCount: 50,
      publishedAt: "2026-11-10T09:30:00Z",
    },
    {
      ...baseArticle,
      id: 3,
      title: "조회수 120 · 최다 조회 기사",
      bullCount: 2,
      bearCount: 1,
      viewCount: 120,
      publishedAt: "2026-11-10T07:00:00Z",
    },
    {
      ...baseArticle,
      id: 4,
      title: "조회수 50 · 중간 시각 기사",
      bullCount: 50,
      bearCount: 50,
      viewCount: 50,
      publishedAt: "2026-11-10T08:15:00Z",
    },
  ];

  const popularSorted = sortNewsItems(sampleItems, "POPULAR");
  assert.deepEqual(
    popularSorted.map(item => item.id),
    [3, 2, 4, 1],
  );

  // 모든 기사의 조회수가 동일할 때(예: 모두 0회) 최신순으로 정렬되는지 검증
  const equalViewItems = sampleItems.map(item => ({ ...item, viewCount: 0 }));
  const tieBrokenPopular = sortNewsItems(equalViewItems, "POPULAR");
  assert.deepEqual(
    tieBrokenPopular.map(item => item.id),
    [2, 4, 3, 1],
  );

  // 6. NewsFeed 렌더링 시 조회수 표기 및 POPULAR 정렬 순서 확인
  const client = new QueryClient();
  try {
    const popularNewsroomHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed
          initialPage={{ items: sampleItems, hasNext: false, nextCursorId: null }}
          initialSection="NEWSROOM"
          initialNewsroomSort="POPULAR"
        />
      </MemberProvider>,
    );
    assert.match(popularNewsroomHtml, /조회 120/);
    assert.match(popularNewsroomHtml, /조회 50/);
    assert.equal(
      popularNewsroomHtml.indexOf("조회수 120 · 최다 조회 기사") <
        popularNewsroomHtml.indexOf("조회수 50 · 최신 기사") &&
        popularNewsroomHtml.indexOf("조회수 50 · 최신 기사") <
          popularNewsroomHtml.indexOf("조회수 50 · 중간 시각 기사") &&
        popularNewsroomHtml.indexOf("조회수 50 · 중간 시각 기사") <
          popularNewsroomHtml.indexOf("조회수 50 · 오래된 기사 (반응 매우 많음)"),
      true,
    );
  } finally {
    client.clear();
  }
});

test("기존 회원 로그인 시 원래 보던 페이지 또는 메인 페이지로 복귀하고 회원가입 완료 시 메인 페이지로 이동한다", () => {
  const storeMap = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => storeMap.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storeMap.set(key, val);
    },
    removeItem: (key: string) => {
      storeMap.delete(key);
    },
  };

  // 1. 저장된 경로가 없을 때 기본값은 메인 페이지("/")
  assert.equal(consumeLoginReturnPath(mockStorage), "/");
  assert.equal(normalizeLoginReturnPath(null), "/");
  assert.equal(normalizeLoginReturnPath(""), "/");

  // 2. 인증/계정 전용 경로 및 외부 URL은 안전하게 메인 페이지("/")로 정규화
  assert.equal(normalizeLoginReturnPath("/login"), "/");
  assert.equal(normalizeLoginReturnPath("/signup"), "/");
  assert.equal(normalizeLoginReturnPath("/auth/callback?code=123"), "/");
  assert.equal(normalizeLoginReturnPath("/account"), "/");
  assert.equal(normalizeLoginReturnPath("https://evil.example.com/phish"), "/");
  assert.equal(normalizeLoginReturnPath("//evil.example.com"), "/");

  // 3. 원래 보던 내부 페이지(/community, /news?tab=newsroom, /trading 등) 저장 후 로그인 완료 시 정확히 복원 및 1회 소비
  assert.equal(
    saveLoginReturnPath("/news?tab=newsroom&sub=all&sort=popular", mockStorage),
    "/news?tab=newsroom&sub=all&sort=popular",
  );
  assert.equal(
    consumeLoginReturnPath(mockStorage),
    "/news?tab=newsroom&sub=all&sort=popular",
  );
  // 소비 후 다시 조회하면 메인 페이지("/")로 초기화됨
  assert.equal(consumeLoginReturnPath(mockStorage), "/");

  // 4. 회원가입 완료 시 clearLoginReturnPath로 기존 저장 경로를 비우고 메인 페이지("/")로 이동
  saveLoginReturnPath("/community", mockStorage);
  clearLoginReturnPath(mockStorage);
  assert.equal(consumeLoginReturnPath(mockStorage), "/");
});

test("시즌별 대회 허브(/contest), 대회 전용 트레이딩 서브헤더(/contest/[seasonId]/trading), 관리자 대회 목록(/admin/contest) 및 상세/청크500 정산(/admin/contest/[seasonId]) 화면이 정상 렌더링된다", async () => {
  const client = new QueryClient();
  const epoch = Date.now();
  const loggedInSession = createMemberSession(
    "http://localhost:8080",
    async url =>
      String(url).endsWith("csrf")
        ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
        : Response.json({
            memberId: 7,
            nickname: "트레이더7",
            accessToken: "header.payload.sig",
            tokenType: "Bearer",
            expiresIn: 900,
            expiresAt: new Date(epoch + 900000).toISOString(),
          }),
    () => epoch,
    fn => fn(),
    () => true,
    () => null,
  );
  await loggedInSession.restore();

  try {
    // 1. V1Header: 관리자 권한일 때 우측 '관리자'(/admin/contest) 이동 배지 노출
    const adminHeaderHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <V1Header theme="light" role="ADMIN" />
      </MemberProvider>,
    );
    assert.match(adminHeaderHtml, /href="\/admin\/contest"[^>]*>관리자<\/a>/);
    assert.match(adminHeaderHtml, /href="\/me"[^>]*>마이페이지<\/a>/);
    assert.equal(adminHeaderHtml.includes("준비중"), false);

    // 2. 비로그인/게스트 ContestHub: 로그인 유도 앰버 배너 + 공개 대회 3단 섹션 + 리더보드
    const anonContestHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <ContestHub />
      </MemberProvider>,
    );
    assert.match(anonContestHtml, /시즌별 선물 모의투자 대회/);
    assert.match(anonContestHtml, /대회 규칙·상금 안내/);
    assert.match(
      anonContestHtml,
      /현재 대회 목록만 열람하고 계십니다\. 대회에 참가 신청하고 수익률 랭킹에 도전하려면 로그인이 필요합니다\./,
    );
    assert.match(anonContestHtml, /href="\/login"[^>]*>지금 로그인하기<\/a>/);
    assert.match(anonContestHtml, /data-public-contest-stage="running"/);
    assert.match(anonContestHtml, /data-public-contest-stage="recruiting"/);
    assert.match(anonContestHtml, /data-public-contest-stage="finished"/);
    assert.match(anonContestHtml, /data-contest-section="leaderboard"/);
    assert.match(anonContestHtml, /1위 · 골드 메달/);
    assert.match(anonContestHtml, /2위 · 실버 메달/);
    assert.match(anonContestHtml, /3위 · 브론즈 메달/);
    assert.equal(anonContestHtml.includes("cursor-not-allowed"), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(anonContestHtml), false);

    // 3. 정식 로그인 회원 ContestHub: 내 진행 중인 대회 캐러셀 + 참가 신청 가능/참가 심사 중/종료 및 반려 3탭 + 리더보드
    const memberContestHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <ContestHub />
      </MemberProvider>,
    );
    assert.match(memberContestHtml, /data-contest-section="ongoing"/);
    assert.match(memberContestHtml, /내 진행 중인 대회/);
    assert.match(memberContestHtml, /href="\/contest\/202602\/trading"/);
    assert.match(memberContestHtml, /대회장 입장/);
    assert.match(memberContestHtml, /data-contest-section="catalog"/);
    assert.match(memberContestHtml, /참가 신청 가능 \(3\)/);
    assert.match(memberContestHtml, /참가 심사 중 \(1\)/);
    assert.match(memberContestHtml, /종료 및 반려 \(2\)/);
    assert.match(memberContestHtml, /초기 시드머니/);
    assert.match(memberContestHtml, /10,000 USDT/);
    assert.equal(memberContestHtml.includes("cursor-not-allowed"), false);

    // 4. 대회 전용 선물 트레이딩 48px 서브헤더 (/contest/[seasonId]/trading)
    const subheaderHtml = renderToStaticMarkup(
      <ContestTradingSubheader seasonId={202602} />,
    );
    assert.match(subheaderHtml, /data-contest-trading-subheader="202602"/);
    assert.match(subheaderHtml, /href="\/contest"/);
    assert.match(subheaderHtml, /대회 목록/);
    assert.match(subheaderHtml, /2026 정규 시즌 2 선물 수익률 대회/);
    assert.match(subheaderHtml, /ACTIVE/);
    assert.match(subheaderHtml, /시즌 시드/);
    assert.match(subheaderHtml, /대회 평가자산/);
    assert.match(subheaderHtml, /대회 가용증거금/);
    assert.match(subheaderHtml, /CONTEST MODE/);

    // 5. 관리자 대회 목록 (/admin/contest) 권한 가드 및 시즌 생성/수정 모달 (ContestCreateEditModal)
    const blockedMemberAdminHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <AdminContestList />
      </MemberProvider>,
    );
    assert.match(blockedMemberAdminHtml, /data-admin-guard="blocked"/);
    assert.equal(blockedMemberAdminHtml.includes("data-admin-edit-season"), false);

    const adminJwtToken = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "1", roles: ["ROLE_ADMIN"] })).toString("base64url")}.sig`;
    const adminContestSession = createMemberSession(
      "http://localhost:8080",
      async url =>
        String(url).endsWith("csrf")
          ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
          : Response.json({
              memberId: 1,
              nickname: "구름관리자",
              accessToken: adminJwtToken,
              tokenType: "Bearer",
              expiresIn: 900,
              expiresAt: new Date(epoch + 900000).toISOString(),
            }),
      () => epoch,
      fn => fn(),
      () => true,
      () => null,
    );
    await adminContestSession.restore();

    const adminListHtml = renderToStaticMarkup(
      <MemberProvider session={adminContestSession} client={client}>
        <AdminContestList />
      </MemberProvider>,
    );
    assert.match(adminListHtml, /data-admin-header="true"/);
    assert.match(adminListHtml, /ADMIN/);
    assert.match(adminListHtml, /대회 관리/);
    assert.match(adminListHtml, /회원 관리/);
    assert.match(adminListHtml, /커뮤니티 관리/);
    assert.match(adminListHtml, /신고 관리/);
    assert.match(adminListHtml, /서비스 홈으로/);
    assert.match(adminListHtml, /대회 시즌 관리/);
    assert.match(adminListHtml, /\+ 새 대회 시즌 생성/);
    assert.match(adminListHtml, /전체 대회 시즌/);
    assert.match(adminListHtml, /참가 모집중 시즌/);
    assert.match(adminListHtml, /진행중\(LIVE\) 시즌/);
    assert.match(adminListHtml, /role="switch"/);
    assert.match(adminListHtml, /<th[^>]*whitespace-nowrap[^>]*>시즌 ID<\/th>/);
    assert.match(adminListHtml, /<th[^>]*w-\[220px\] max-w-\[220px\][^>]*whitespace-nowrap[^>]*>대회명<\/th>/);
    assert.match(adminListHtml, /<th[^>]*whitespace-nowrap[^>]*>공개여부<\/th>/);
    assert.match(adminListHtml, /<th[^>]*whitespace-nowrap[^>]*>취소여부<\/th>/);
    assert.match(adminListHtml, /<th[^>]*whitespace-nowrap[^>]*>초기 시드머니<\/th>/);
    assert.match(adminListHtml, /<th[^>]*whitespace-nowrap[^>]*>정산 상태<\/th>/);
    assert.match(adminListHtml, /<th[^>]*whitespace-nowrap[^>]*>관리<\/th>/);
    assert.match(adminListHtml, /<button[^>]*data-admin-edit-season="202602"[^>]*whitespace-nowrap[^>]*>수정<\/button>/);
    assert.match(adminListHtml, /<a[^>]*whitespace-nowrap[^>]*>상세 운영<\/a>/);
    assert.equal(adminListHtml.includes("cursor-not-allowed"), false);

    const createModalHtml = renderToStaticMarkup(
      <ContestCreateEditModal
        open={true}
        mode="create"
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    assert.match(createModalHtml, /새 대회 시즌 생성/);
    assert.match(createModalHtml, /시즌 초기 시드머니 \(USDT\)/);
    assert.match(createModalHtml, /참가 신청 시작 일시/);
    assert.match(createModalHtml, /참가 신청 마감 일시/);
    assert.match(createModalHtml, /대회 진행 시작 일시/);
    assert.match(createModalHtml, /대회 진행 종료 일시/);
    assert.match(createModalHtml, /즉시 공개 여부/);

    // 6. 관리자 대회 시즌 상세 및 청크 500 정산/신청자 운영 (/admin/contest/[seasonId])
    const adminDetailHtml = renderToStaticMarkup(
      <MemberProvider session={adminContestSession} client={client}>
        <AdminContestDetail seasonId={202602} />
      </MemberProvider>,
    );
    assert.match(adminDetailHtml, /대회 목록으로 돌아가기/);
    assert.match(adminDetailHtml, /data-admin-action="early-finish-settle"/);
    assert.match(adminDetailHtml, /대회 조기 종료 및 강제 정산/);
    assert.match(adminDetailHtml, /data-admin-action="cleanup-remaining"/);
    assert.match(adminDetailHtml, /남은 포지션·미체결 주문 재정리/);
    assert.match(adminDetailHtml, /대회 개요 및 상태 제어/);
    assert.match(adminDetailHtml, /주요 일정 및 자동 종료 스케줄/);
    assert.match(adminDetailHtml, /청크 500 정산 시스템 상태 &amp; 실행 이력/);
    assert.match(
      adminDetailHtml,
      /가격 스냅샷 → 지갑 비활성화 → 미체결 주문 500청크 소프트 취소 → 오픈 포지션 500청크 강제청산 → 올림픽 순위 확정/,
    );
    assert.match(adminDetailHtml, /신청자 관리 \(3\)/);
    assert.match(adminDetailHtml, /참가자 및 시즌 지갑 목록 \(4\)/);
    assert.match(adminDetailHtml, /반려 이력 \(1\)/);
    assert.match(adminDetailHtml, /선택 일괄 승인 \(0\)/);
    assert.match(adminDetailHtml, /델타헤저/);
    assert.match(adminDetailHtml, /data-admin-approve-applicant="501"[^>]*whitespace-nowrap[^>]*>승인<\/button>/);
    assert.match(adminDetailHtml, /data-admin-reject-applicant="501"[^>]*whitespace-nowrap[^>]*>반려<\/button>/);
    assert.equal(adminDetailHtml.includes("cursor-not-allowed"), false);

    // 7. contest-client API 계약 검증 (공개·회원·관리자 엔드포인트, 메서드, Authorization 헤더, Decimal 포맷)
    const calls: Array<{ url: string; method: string; auth: string; body: string }> = [];
    const mockTransport: typeof fetch = async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        auth: headers.Authorization ?? "",
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const opts = { baseUrl: "http://localhost:8081", transport: mockTransport };
    await fetchPublicContestSeasons(opts);
    await fetchPublicContestLeaderboard(202602, { ...opts, size: 20 });
    await fetchPublicMemberContestSeasons(11, opts);
    await fetchMyContestOverview("jwt-token", opts);
    await applyForContestSeason(202605, "트레이더7", "jwt-token", opts);
    await fetchMyContestSeasons("jwt-token", opts);
    await fetchContestSeasonSummary(202602, "jwt-token", opts);
    await fetchAdminContestSeasons({ ...opts, token: "admin-jwt", size: 20 });
    await createAdminContestSeason(
      {
        title: "신규 시즌",
        description: "설명",
        seedMoney: "10000",
        recruitmentStartAt: "2026-12-01T00:00:00Z",
        recruitmentEndAt: "2026-12-10T23:59:00Z",
        contestStartAt: "2026-12-11T09:00:00Z",
        contestEndAt: "2026-12-31T23:59:00Z",
        isPublic: true,
      },
      { ...opts, token: "admin-jwt" },
    );
    await updateAdminContestSeason(
      202602,
      {
        title: "수정 시즌",
        description: "설명",
        seedMoney: "10000",
        recruitmentStartAt: "2026-12-01T00:00:00Z",
        recruitmentEndAt: "2026-12-10T23:59:00Z",
        contestStartAt: "2026-12-11T09:00:00Z",
        contestEndAt: "2026-12-31T23:59:00Z",
        isPublic: true,
      },
      { ...opts, token: "admin-jwt" },
    );
    await patchAdminContestSeasonStatus(
      202602,
      { isPublic: false, isCanceled: true },
      { ...opts, token: "admin-jwt" },
    );
    await fetchAdminContestSeasonDetail(202602, { ...opts, token: "admin-jwt" });
    await approveAdminContestApplicant(202602, 501, { ...opts, token: "admin-jwt" });
    await bulkApproveAdminContestApplicants(202602, [501, 502], { ...opts, token: "admin-jwt" });
    await rejectAdminContestApplicant(202602, 503, "사유", { ...opts, token: "admin-jwt" });
    await settleAdminContestSeason(202602, { ...opts, token: "admin-jwt" });
    await cleanupRemainingAdminContestSeason(202602, { ...opts, token: "admin-jwt" });

    assert.equal(calls[0]?.url, "http://localhost:8081/api/v1/trading/contest/public/seasons");
    assert.equal(
      calls[1]?.url,
      "http://localhost:8081/api/v1/trading/contest/public/seasons/202602/leaderboard?size=20",
    );
    assert.equal(
      calls[2]?.url,
      "http://localhost:8081/api/v1/trading/contest/public/members/11/seasons",
    );
    assert.equal(calls[3]?.url, "http://localhost:8081/api/v1/trading/contest/me/overview");
    assert.equal(calls[3]?.auth, "Bearer jwt-token");
    assert.equal(
      calls[4]?.url,
      "http://localhost:8081/api/v1/trading/contest/seasons/202605/applications",
    );
    assert.equal(calls[4]?.method, "POST");
    assert.equal(calls[5]?.url, "http://localhost:8081/api/v1/trading/contest/account/seasons");
    assert.equal(
      calls[6]?.url,
      "http://localhost:8081/api/v1/trading/contest/seasons/202602/summary",
    );
    assert.equal(
      calls[7]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons?size=20",
    );
    assert.equal(calls[8]?.method, "POST");
    assert.equal(calls[9]?.method, "PUT");
    assert.equal(
      calls[10]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602/status",
    );
    assert.equal(calls[10]?.method, "PATCH");
    assert.equal(
      calls[11]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602",
    );
    assert.equal(
      calls[12]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602/applicants/501/approve",
    );
    assert.equal(
      calls[13]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602/applicants/bulk-approve",
    );
    assert.equal(
      calls[14]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602/applicants/503/reject",
    );
    assert.equal(
      calls[15]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602/settle",
    );
    assert.equal(
      calls[16]?.url,
      "http://localhost:8081/api/v1/trading/admin/contest/seasons/202602/cleanup-remaining",
    );

    assert.equal(formatContestUsdt("10000"), "10,000.00 USDT");
    assert.equal(formatContestSignedUsdt("3480.5"), "+3,480.50 USDT");
    assert.equal(formatContestSignedRoi("-5.8"), "-5.80%");
    assert.equal(formatContestWinRate("68.40"), "68.4%");
  } finally {
    client.clear();
  }
});

test("GNB admin button role gate, contest trading path routing, and AdminUsers/AdminCommunity pages", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  try {
    const makeJwt = (payloadObj: Record<string, unknown>) => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
      return `${header}.${payload}.sig`;
    };

    const adminToken = makeJwt({ sub: "1", roles: ["ROLE_ADMIN"] });
    const memberToken = makeJwt({ sub: "2", roles: ["ROLE_MEMBER"] });

    const parsedAdmin = parseAccess({
      memberId: 1,
      nickname: "총괄관리자",
      accessToken: adminToken,
      tokenType: "Bearer",
      expiresIn: 900,
      expiresAt: "2026-12-31T23:59:59Z",
    });
    assert.equal(parsedAdmin.role, "ADMIN");

    const parsedMember = parseAccess({
      memberId: 2,
      nickname: "일반회원",
      accessToken: memberToken,
      tokenType: "Bearer",
      expiresIn: 900,
      expiresAt: "2026-12-31T23:59:59Z",
    });
    assert.equal(parsedMember.role, "MEMBER");

    // GNB V1Header: 일반회원 세션에서는 관리자 버튼 미노출, ADMIN 세션에서만 노출
    const epoch = Date.now();
    const memberSession = createMemberSession(
      "http://localhost:8080",
      async url =>
        String(url).endsWith("csrf")
          ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
          : Response.json({
              memberId: 2,
              nickname: "일반회원",
              accessToken: memberToken,
              tokenType: "Bearer",
              expiresIn: 900,
              expiresAt: new Date(epoch + 900000).toISOString(),
            }),
      () => epoch,
      fn => fn(),
      () => true,
      () => null,
    );
    await memberSession.restore();
    const memberHeaderHtml = renderToStaticMarkup(
      <MemberProvider session={memberSession} client={client}>
        <V1Header />
      </MemberProvider>,
    );
    assert.equal(memberHeaderHtml.includes('href="/admin/contest"'), false);

    const adminSession = createMemberSession(
      "http://localhost:8080",
      async url =>
        String(url).endsWith("csrf")
          ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
          : Response.json({
              memberId: 1,
              nickname: "총괄관리자",
              accessToken: adminToken,
              tokenType: "Bearer",
              expiresIn: 900,
              expiresAt: new Date(epoch + 900000).toISOString(),
            }),
      () => epoch,
      fn => fn(),
      () => true,
      () => null,
    );
    await adminSession.restore();
    const adminHeaderHtml = renderToStaticMarkup(
      <MemberProvider session={adminSession} client={client}>
        <V1Header />
      </MemberProvider>,
    );
    assert.equal(adminHeaderHtml.includes('href="/admin/contest"'), true);

    // Contest trading path routing & WS authenticate frame
    assert.equal(
      resolveContestTradingPath("account/summary", 202602),
      "contest/seasons/202602/account/summary",
    );
    assert.equal(
      resolveContestTradingPath("account/orders/market", 202602),
      "contest/seasons/202602/orders/market",
    );
    assert.equal(
      resolveContestTradingPath("account/positions/10/stop-loss", 202602),
      "contest/seasons/202602/positions/10/stop-loss",
    );
    assert.equal(
      resolveContestTradingPath("account/symbols/1/leverage?side=LONG", 202602),
      "contest/seasons/202602/symbols/1/leverage?side=LONG",
    );
    assert.equal(
      resolveContestTradingPath("account/events?afterId=0&limit=50", 202602),
      "contest/seasons/202602/events?afterId=0&limit=50",
    );
    assert.equal(
      resolveContestTradingPath("account/recovery", 202602),
      "contest/seasons/202602/recovery",
    );
    assert.equal(resolveContestTradingPath("account/summary", undefined), "account/summary");

    const sentFrames: string[] = [];
    authenticateGuestTradingSocket(
      { send: msg => sentFrames.push(String(msg)) },
      "jwt-123",
      0,
      202602,
    );
    assert.deepEqual(JSON.parse(sentFrames[0]!), {
      type: "AUTHENTICATE",
      credential: "jwt-123",
      afterEventId: "0",
      contestSeasonId: 202602,
    });

    // AdminUsers (/admin/users) & AdminCommunity (/admin/community) SSR rendering
    const adminUsersHtml = renderToStaticMarkup(
      <MemberProvider session={adminSession} client={client}>
        <AdminUsers />
      </MemberProvider>,
    );
    assert.match(adminUsersHtml, /data-admin-users-page="true"/);
    assert.match(adminUsersHtml, /회원 관리/);
    assert.match(adminUsersHtml, /전체 회원/);
    assert.match(adminUsersHtml, /활동 회원/);
    assert.match(adminUsersHtml, /탈퇴 회원/);
    assert.match(adminUsersHtml, /href="\/admin\/users"/);
    assert.match(adminUsersHtml, /href="\/admin\/community"/);
    assert.match(adminUsersHtml, /<th[^>]*whitespace-nowrap[^>]*>회원번호<\/th>/);
    assert.match(adminUsersHtml, /<th[^>]*whitespace-nowrap[^>]*>관리 액션<\/th>/);
    assert.equal(adminUsersHtml.includes("cursor-not-allowed"), false);

    const adminCommunityHtml = renderToStaticMarkup(
      <MemberProvider session={adminSession} client={client}>
        <AdminCommunity />
      </MemberProvider>,
    );
    assert.match(adminCommunityHtml, /data-admin-community-page="true"/);
    assert.match(adminCommunityHtml, /커뮤니티 관리/);
    assert.match(adminCommunityHtml, /게시글 관리/);
    assert.match(adminCommunityHtml, /댓글 관리/);
    assert.match(adminCommunityHtml, /<th[^>]*whitespace-nowrap[^>]*>글 번호<\/th>/);
    assert.match(adminCommunityHtml, /<th[^>]*whitespace-nowrap[^>]*>삭제 여부<\/th>/);
    assert.equal(adminCommunityHtml.includes("cursor-not-allowed"), false);
    assert.equal(adminCommunityHtml.includes("확장슬롯"), false);

    const adminReportsHtml = renderToStaticMarkup(
      <MemberProvider session={adminSession} client={client}>
        <AdminReportsView />
      </MemberProvider>,
    );
    assert.match(adminReportsHtml, /data-admin-reports="true"/);
    assert.match(adminReportsHtml, /커뮤니티 신고 관리 센터/);
    assert.match(adminReportsHtml, /href="\/admin\/reports"/);
    assert.match(adminReportsHtml, /<th[^>]*whitespace-nowrap[^>]*>대상 누적신고<\/th>/);
    assert.match(adminReportsHtml, /<th[^>]*whitespace-nowrap[^>]*>신고 사유<\/th>/);
    assert.equal(adminReportsHtml.includes("cursor-not-allowed"), false);
    assert.equal(adminReportsHtml.includes("확장슬롯"), false);

    // admin-api.ts contract verification
    const adminCalls: Array<{ url: string; method: string; auth: string }> = [];
    const adminTransport: typeof fetch = async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      adminCalls.push({
        url: String(input),
        method: init?.method ?? "GET",
        auth: headers.Authorization ?? "",
      });
      if ((init?.method ?? "GET") === "DELETE" || (init?.method ?? "GET") === "POST") {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({
          totalCount: 2,
          activeCount: 1,
          withdrawnCount: 1,
          content: [],
          nextCursorId: null,
          hasNext: false,
          totalElements: 0,
          totalPages: 0,
          postReportCount: 0,
          commentReportCount: 0,
          activeTargetReportCount: 0,
        }),
        { status: 200 },
      );
    };
    const adminOpts = { origin: "http://localhost:8080", transport: adminTransport };
    await fetchAdminMembers("admin-jwt", { status: "ACTIVE", role: "MEMBER", size: 10 }, adminOpts);
    await withdrawAdminMember("admin-jwt", 77, adminOpts);
    await fetchAdminCommunityPosts("admin-jwt", "ACTIVE", { title: "비트", size: 10 }, adminOpts);
    await deleteAdminCommunityPost("admin-jwt", 301, adminOpts);
    await fetchAdminCommunityReplies("admin-jwt", "WITHDRAWN", { replyContent: "댓글", size: 10 }, adminOpts);
    await deleteAdminCommunityReply("admin-jwt", 401, adminOpts);
    await fetchAdminReports("admin-jwt", { targetType: "POST", reasonType: "SPAM", page: 0, size: 20 }, adminOpts);
    await dismissAdminReport("admin-jwt", "COMMENT", 401, 15, adminOpts);
    await moderateAdminReportTarget("admin-jwt", "POST", 301, "DELETE_TARGET", adminOpts);

    assert.equal(
      adminCalls[0]?.url,
      "http://localhost:8080/api/v1/admin/members?status=ACTIVE&role=MEMBER&size=10",
    );
    assert.equal(adminCalls[0]?.auth, "Bearer admin-jwt");
    assert.equal(adminCalls[1]?.url, "http://localhost:8080/api/v1/admin/members/77");
    assert.equal(adminCalls[1]?.method, "DELETE");
    assert.match(
      adminCalls[2]?.url ?? "",
      /^http:\/\/localhost:8080\/api\/v1\/admin\/community\/posts\/active-author\?/,
    );
    assert.equal(adminCalls[3]?.url, "http://localhost:8080/api/v1/admin/community/posts/301");
    assert.equal(adminCalls[3]?.method, "DELETE");
    assert.match(
      adminCalls[4]?.url ?? "",
      /^http:\/\/localhost:8080\/api\/v1\/admin\/community\/replies\/withdrawn-author\?/,
    );
    assert.equal(adminCalls[5]?.url, "http://localhost:8080/api/v1/admin/community/replies/401");
    assert.equal(adminCalls[5]?.method, "DELETE");
    assert.equal(
      adminCalls[6]?.url,
      "http://localhost:8080/api/v1/admin/community/reports?targetType=POST&targetStatus=ALL&reasonType=SPAM&page=0&size=20",
    );
    assert.equal(
      adminCalls[7]?.url,
      "http://localhost:8080/api/v1/admin/community/reports/COMMENT/401/reporters/15",
    );
    assert.equal(adminCalls[7]?.method, "DELETE");
    assert.equal(
      adminCalls[8]?.url,
      "http://localhost:8080/api/v1/admin/community/reports/POST/301/moderate?action=DELETE_TARGET",
    );
    assert.equal(adminCalls[8]?.method, "POST");
  } finally {
    client.clear();
  }
});

test("메인페이지(/) 새로고침 시 SSR과 클라이언트 초기 Hydration(localStorage ADMIN 힌트 존재) 마크업이 100% 일치하여 Hydration Mismatch가 발생하지 않는다", async () => {
  const client = new QueryClient();
  const globalRef = globalThis as Record<string, unknown>;
  const prevWindow = globalRef.window;
  const prevDocument = globalRef.document;

  try {
    // 1. 서버 SSR 환경 (window === undefined, phase === "loading")
    delete globalRef.window;
    delete globalRef.document;

    const ssrHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal />
      </MemberProvider>,
    );

    assert.match(ssrHtml, /ym-gnb-auth-loading/);
    assert.match(ssrHtml, /ym-auth-slot-admin/);
    assert.match(ssrHtml, /ym-auth-slot-member/);
    assert.match(ssrHtml, /ym-auth-slot-anon/);

    // 2. 브라우저 초기 Hydration 환경 (window.localStorage에 ADMIN 힌트 존재, useEffect 전 phase === "loading")
    const store = new Map<string, string>([
      ["yogimangchi:header-auth-hint:v1", JSON.stringify({ loggedIn: true, role: "ADMIN" })],
    ]);
    const dataset: Record<string, string> = { ymAuthHint: "admin" };
    globalRef.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => {
          store.set(key, val);
        },
      },
    };
    globalRef.document = {
      documentElement: { dataset },
    };

    const clientHydrationHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal />
      </MemberProvider>,
    );

    // SSR과 클라이언트 첫 렌더 HTML이 바이트 단위로 100% 일치해야 React 19 Hydration Mismatch가 발생하지 않음
    assert.equal(ssrHtml, clientHydrationHtml);
  } finally {
    if (prevWindow === undefined) {
      delete globalRef.window;
    } else {
      globalRef.window = prevWindow;
    }
    if (prevDocument === undefined) {
      delete globalRef.document;
    } else {
      globalRef.document = prevDocument;
    }
    client.clear();
  }
});

test("fetchRedisMarketOverview는 trading-server의 Redis 기반 /api/v1/market/overview decimal string 응답을 파싱하고 UNAVAILABLE 상태는 거부하여 이전 신선값을 유지한다", async () => {
  const requestedUrls: string[] = [];
  const freshOverview = await fetchRedisMarketOverview(
    "http://localhost:8081",
    undefined,
    async input => {
      requestedUrls.push(String(input));
      return Response.json({
        btcDominancePercent: "59.7",
        btcDominanceChange24h: "1.85",
        kimchiPremiumPercent: "1.26",
        openInterestBillionsUsd: "30.4",
        fearGreedValue: 32,
        fearGreedLabelKr: "공포",
        futuresBullPct: 58,
        futuresBearPct: 42,
        btcChange24h: "-2.14",
        usdKrwRate: "1343.92",
        usdKrwChangeAmount: "3.64",
        usdKrwChangePct: "0.27",
        usdKrwHistory: [
          "1325.1",
          "1326.0",
          "1328.4",
          "1331.2",
          "1333.5",
          "1330.8",
          "1334.0",
          "1336.5",
          "1338.1",
          "1339.9",
          "1342.0",
          "1341.2",
          "1340.5",
          "1343.92",
        ],
        status: "FRESH",
        updatedAt: "2026-11-10T17:58:00Z",
      });
    },
  );

  assert.deepEqual(requestedUrls, ["http://localhost:8081/api/v1/market/overview"]);
  assert.equal(freshOverview.btcDominancePercent, 59.7);
  assert.equal(freshOverview.btcDominanceChange24h, 1.85);
  assert.equal(freshOverview.kimchiPremiumPercent, 1.26);
  assert.equal(freshOverview.openInterestBillionsUsd, 30.4);
  assert.equal(freshOverview.fearGreedValue, 32);
  assert.equal(freshOverview.fearGreedLabelKr, "공포");
  assert.equal(freshOverview.usdKrwRate, 1343.92);
  assert.equal(freshOverview.usdKrwChangeAmount, 3.64);
  assert.equal(freshOverview.usdKrwChangePct, 0.27);
  assert.equal(freshOverview.usdKrwHistory[13], 1343.92);

  await assert.rejects(
    () =>
      fetchRedisMarketOverview("http://localhost:8081", undefined, async () =>
        Response.json({
          ...freshOverview,
          status: "UNAVAILABLE",
          updatedAt: null,
        }),
      ),
    /not ready yet/,
  );
});

test("실시간 뉴스 투자 심리는 SSE 센티먼트 요약과 Redis 마켓 지표를 동기화해 상단 바와 요약 수치를 일치시키고 전체 화면에서 터미널 문구를 노출하지 않는다", () => {
  const sseSentiment = parseNewsSentimentSummary({
    totalBullVotes: 24,
    totalBearVotes: 8,
    bullPct: 63,
    bearPct: 37,
    dominantSentiment: "BULLISH",
    bullishArticleCount: 10,
    bearishArticleCount: 7,
    neutralArticleCount: 23,
    summary:
      "최근 실시간 뉴스 40건(강세 10·약세 7·중립 23) 분석 결과, #BTC 및 거시경제·금리 이슈를 중심으로 단기 매수·강세 심리(63%)가 우위를 보이고 있습니다.",
  });
  assert.equal(sseSentiment.bullPct, 63);
  assert.equal(sseSentiment.bearPct, 37);

  const redisMarket = parseMarketOverviewPayload({
    btcDominancePercent: 59.7,
    btcDominanceChange24h: 1.85,
    kimchiPremiumPercent: 1.26,
    openInterestBillionsUsd: 30.4,
    fearGreedValue: 32,
    fearGreedLabelKr: "공포",
    futuresBullPct: 64,
    futuresBearPct: 36,
    btcChange24h: -1.2,
    updatedAt: "2026-11-10T18:00:00Z",
  });

  const highlights = parseNewsHighlights({
    mustReadBreaking: [],
    popularByViews: [],
    popularByReactions: [],
    keywordIssues: [],
    recommendedNewsroom: [],
    sentimentSummary: sseSentiment,
  });

  const synced = computeLiveNewsSentiment({
    articles: [],
    highlights,
    marketOverview: redisMarket,
  });
  assert.equal(synced.bullPct + synced.bearPct, 100);
  assert.equal(
    synced.summaryText.includes(`심리(${synced.bullPct}%)`),
    true,
    `summaryText(${synced.summaryText})가 상단 바 강세 비율(${synced.bullPct}%)과 일치해야 합니다.`,
  );
  assert.equal(synced.summaryText.includes("심리(63%)"), false);
  assert.equal(synced.summaryText.includes("(공포·탐욕 32 공포 · 선물 매수수급 64%)"), true);

  const bearishShift = computeLiveNewsSentiment({
    articles: [],
    highlights,
    liveReactions: {
      9001: { bullCount: 0, bearCount: 120 },
    },
    marketOverview: parseMarketOverviewPayload({
      ...redisMarket,
      fearGreedValue: 20,
      fearGreedLabelKr: "극단적 공포",
      futuresBullPct: 30,
      futuresBearPct: 70,
      btcChange24h: -6.5,
    }),
  });
  assert.equal(bearishShift.bullPct < synced.bullPct, true);
  assert.equal(
    bearishShift.summaryText.includes(`단기 매도·경계 심리(${bearishShift.bearPct}%)`),
    true,
  );

  const client = new QueryClient();
  try {
    const newsHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialHighlights={highlights} initialMarketOverview={redisMarket} />
      </MemberProvider>,
    );
    const portalHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <MainPortal initialMarketOverview={redisMarket} />
      </MemberProvider>,
    );
    const communityHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <CommunityBoard />
      </MemberProvider>,
    );
    const contestHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <ContestHub />
      </MemberProvider>,
    );

    assert.equal(newsHtml.includes("모의투자 하러가기"), true);
    assert.equal(portalHtml.includes("모의투자 하러가기"), true);
    assert.equal(communityHtml.includes("모의투자 하러가기"), true);
    assert.equal(newsHtml.includes("터미널"), false);
    assert.equal(portalHtml.includes("터미널"), false);
    assert.equal(communityHtml.includes("터미널"), false);
    assert.equal(contestHtml.includes("터미널"), false);
  } finally {
    client.clear();
  }
});

test("전역 포인터 커서, KST 대회 시각 변환, 12종목 포지션 스냅샷 파서 및 포지션 미첨부 글 비위조 검증", () => {
  const globalsCss = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  assert.match(globalsCss, /button:not\(:disabled\)[\s\S]*?cursor:\s*pointer;/);
  assert.equal(globalsCss.includes("not-allowed"), false);

  // KST(UTC+9) 시각 변환 및 datetime-local 왕복 검증
  assert.equal(formatContestDateTime("2026-11-10T15:00:00Z"), "2026.11.11 00:00");
  assert.equal(toDatetimeLocalInput("2026-11-10T15:00:00Z"), "2026-11-11T00:00");
  assert.equal(toIsoInstantFromInput("2026-11-11T00:00"), "2026-11-10T15:00:00.000Z");

  // 12종목 필터 태그 지원 및 null/빈 청산가·마크가 안전 파싱
  assert.equal(SYMBOL_FILTER_TAGS.length, 13);
  assert.equal(SYMBOL_FILTER_TAGS.includes("DOGE"), true);
  assert.equal(SYMBOL_FILTER_TAGS.includes("PEPE"), true);
  assert.equal(SYMBOL_FILTER_TAGS.includes("SHIB"), true);

  const parsedSnap = parseSharedPositionSnapshot({
    id: "MOCK_POS_42",
    marketLabel: "모의투자 선물",
    symbol: "DOGE",
    pair: "DOGEUSDT",
    side: "SHORT",
    leverage: 5,
    entryPrice: "0.3820",
    markPrice: "",
    liquidationPrice: null,
    roePct: "-3.12%",
    pnlUsdt: "-15.60 USDT",
    positive: false,
  });
  assert.equal(parsedSnap.markPrice, "-");
  assert.equal(parsedSnap.liquidationPrice, "-");
  assert.equal(parsedSnap.positive, false);

  // sharedPosition이 null인 POSITION 카테고리 글은 가짜 포지션 카드를 위조 렌더링하지 않는다
  const client = new QueryClient();
  try {
    const textOnlyPositionPostHtml = renderToStaticMarkup(
      <MemberProvider client={client}>
        <CommunityBoard
          initialPage={{
            items: [
              {
                id: 999,
                memberId: 7,
                authorNickname: "트레이더7",
                authorProfileImgUrl: null,
                authorWithdrawn: false,
                category: "POSITION",
                symbolTag: "BTC",
                title: "포지션 스냅샷 없이 올린 텍스트 관점 글",
                content: "진입 전 관점 공유입니다.",
                likeCount: 0,
                commentCount: 0,
                likedByMe: false,
                reportedByMe: false,
                mine: false,
                sharedPosition: null,
                files: [],
                createdAt: "2026-11-10T15:00:00Z",
                updatedAt: "2026-11-10T15:00:00Z",
              },
            ],
            hasNext: false,
            nextCursorId: null,
          }}
        />
      </MemberProvider>,
    );
    assert.equal(textOnlyPositionPostHtml.includes("data-shared-position="), false);
    assert.match(textOnlyPositionPostHtml, /2026\.11\.11 00:00/);
  } finally {
    client.clear();
  }
});
