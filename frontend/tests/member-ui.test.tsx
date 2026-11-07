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
