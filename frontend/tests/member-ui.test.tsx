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
  parsePublicMemberPortfolio,
  parseReportReasons,
  readCommunityOrPublic,
} from "../src/features/member/api/community-news";
import { NewsFeed, computeLiveNewsSentiment } from "../src/features/member/components/news-feed";
import { CommunityBoard } from "../src/features/member/components/community-board";
import { MainPortal } from "../src/features/member/components/main-portal";
import { MemberSignupPage } from "../src/features/member/components/member-auth";
import { MemberAccount } from "../src/features/member/components/member-account";
import { MemberMyProfilePage } from "../src/features/member/components/member-profile-portfolio";
import { PublicMember } from "../src/features/member/components/public-member";
import { V1Header } from "../src/features/member/components/v1-ui";
import { SiteFooter } from "../src/components/site-footer";
import {
  FALLBACK_MARKET_OVERVIEW,
  classifyFearGreedLabelKr,
  computeBtcDominanceChange24h,
  computeKimchiPremiumPercent,
  fetchLiveMarketOverview,
  parseMarketOverviewPayload,
} from "../src/features/member/api/market-overview";
import { DimModal, lockBodyScroll, unlockBodyScroll, resetScrollLockForTest } from "../src/features/member/components/dim-modal";

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
    assert.match(html, /<select[^>]*aria-label="뉴스 카테고리 필터"/);
    assert.match(html, /<select[^>]*aria-label="뉴스 종목 태그 필터"/);
    assert.match(html, /<select[^>]*aria-label="뉴스 브리핑 보기 방식"/);
    assert.match(html, /미국 현물 ETF 순유입과 함께 BTC 선물 시장의 유동성이 확대되고 있습니다\./);
    assert.match(html, /BTC 선물 모의투자 이동/);
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
    assert.equal((newsroomHtml.match(/data-s3-slot="news-thumbnail"/g) ?? []).length, 1);
    assert.equal((newsroomHtml.match(/data-newsroom-hashtags="true"/g) ?? []).length, 2);
    assert.equal(
      newsroomHtml.indexOf('data-newsroom-hashtags="true"') <
        newsroomHtml.indexOf("출처 Yogimangchi Market Desk"),
      true,
    );
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
    assert.match(html, /최신글 \(LATEST\)/);
    assert.match(html, /<select[^>]*aria-label="카테고리 필터"/);
    assert.match(html, /<select[^>]*aria-label="종목 태그 필터"/);
    assert.match(html, /<select[^>]*aria-label="정렬 선택"/);
    assert.match(html, /<span>원장 스냅샷 검증됨<\/span><svg[^>]*data-flat-icon="check"/);
    assert.match(html, /BTCUSDT 무기한/);
    assert.match(html, /data-flat-icon="pen"[\s\S]*?<span>글쓰기 모달 열기<\/span>/);
    assert.match(html, /data-flat-icon="chart-bar"[\s\S]*?<span>포지션 공유하기<\/span>/);
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(html), false);
    assert.match(html, /인기글 \(POPULAR\)/);
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
    assert.match(meLoggedInHtml, /data-tab-variant="bookmark"/);
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


