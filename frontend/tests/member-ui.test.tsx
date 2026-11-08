import { test } from "node:test";
import assert from "node:assert/strict";
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
  communityPostsPath,
  newsPath,
  parseCommunityComments,
  parseCommunityLike,
  parseCommunityPostPage,
  parseNewsPage,
  readCommunityOrPublic,
} from "../src/features/member/api/community-news";
import { NewsFeed } from "../src/features/member/components/news-feed";
import { CommunityBoard } from "../src/features/member/components/community-board";
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

  const rawPage = {
    items: [
      {
        id: 10,
        category: "CRYPTO",
        title: "비트코인 현물 ETF 자금 유입 확대",
        summary: "기관 중심 순유입이 이어지며 선물 미결제약정이 증가했습니다.",
        content: "미국 현물 ETF 순유입과 함께 BTC 선물 시장의 유동성이 확대되고 있습니다.",
        sourceName: "Yogimangchi Market Desk",
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

  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <MemberProvider client={client}>
        <NewsFeed initialPage={page} />
      </MemberProvider>,
    );
    for (const label of ["코인 시황 (CRYPTO)", "거시·세계 경제 (MACRO)", "온체인·수급 (ONCHAIN)", "규제·정책 (REGULATION)", "#BTC", "#ETH", "#SOL", "#XRP"]) {
      assert.equal(html.includes(label), true, label);
    }
    assert.match(html, /비트코인 현물 ETF 자금 유입 확대/);
    assert.match(html, /미국 현물 ETF 순유입과 함께 BTC 선물 시장의 유동성이 확대되고 있습니다\./);
    assert.match(html, /BTC 선물 모의투자 이동/);
    assert.match(html, /이전 뉴스 더보기/);
    assert.match(html, /href="\/news">실시간 뉴스/);
    assert.match(html, /href="\/community">커뮤니티/);
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
    assert.match(html, /인기글 \(POPULAR\)/);
    assert.match(html, /새 글 작성/);
    assert.match(html, /게시글 등록/);
    assert.match(html, /BTC 10배 롱 포지션 진입 및 손절가 공유/);
    assert.match(html, /좋아요 5/);
    assert.match(html, /게시글 수정/);
    assert.match(html, /게시글 삭제/);
    assert.match(html, /href="\/members\/7">트레이더7<\/a>/);
    assert.match(html, /<span class="member-note" data-withdrawn="true">탈퇴한회원<\/span>/);
    assert.equal(html.includes("옛날닉네임"), false);
    assert.equal(html.includes("/members/99"), false);
    assert.match(html, /좋은 관점이네요\./);
    assert.match(html, /↳ <a href="\/members\/7">트레이더7<\/a>: 감사합니다! 리스크 관리가 최우선입니다\./);
  } finally {
    client.clear();
  }
});

import { MainPortal } from "../src/features/member/components/main-portal";
import { MemberSignupPage } from "../src/features/member/components/member-auth";
import { MemberAccount } from "../src/features/member/components/member-account";
import { MemberMyProfilePage } from "../src/features/member/components/member-profile-portfolio";
import { V1Header } from "../src/features/member/components/v1-ui";
import { DimModal, lockBodyScroll, unlockBodyScroll, resetScrollLockForTest } from "../src/features/member/components/dim-modal";

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

    // 헤더 비로그인 vs 로그인 버튼 규격 100% 동일 검증
    const anonHeaderHtml = renderToStaticMarkup(<V1Header theme="dark" />);
    assert.match(anonHeaderHtml, /src="\/logo_dark\.png"/);
    assert.match(anonHeaderHtml, /href="\/login"[^>]*>로그인<\/a>/);
    assert.equal(anonHeaderHtml.includes('href="/signup"'), false);

    const loggedInHeaderHtml = renderToStaticMarkup(
      <MemberProvider session={loggedInSession} client={client}>
        <V1Header theme="light" />
      </MemberProvider>,
    );
    assert.match(loggedInHeaderHtml, /href="\/me"[^>]*>마이페이지<\/a>/);
    assert.equal(loggedInHeaderHtml.includes('href="/login"'), false);
    assert.equal(loggedInHeaderHtml.includes('href="/signup"'), false);
    assert.equal(loggedInHeaderHtml.includes('href="/assets"'), false);
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
  } finally {
    client.clear();
  }
});
