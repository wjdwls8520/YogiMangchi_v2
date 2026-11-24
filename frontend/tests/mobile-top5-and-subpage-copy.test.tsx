import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { MemberProvider } from "../src/features/member/components/member-provider";
import { createMemberSession } from "../src/features/member/api/session";
import { CommunityBoard } from "../src/features/member/components/community-board";
import { MemberLoginView } from "../src/features/member/components/member-views";
import { MemberAccount } from "../src/features/member/components/member-account";
import { MemberWithdrawal } from "../src/features/member/components/member-withdrawal";
import { WithdrawalConfirmation } from "../src/features/member/components/withdrawal-confirmation";
import { SupportCenter } from "../src/features/member/components/support-center";
import { PolicyContent } from "../src/features/member/components/policy-content";
import { PublicPolicyPage } from "../src/features/member/components/policy-controls";
import { TradingWorkspace } from "../src/features/trading/components/trading-workspace";
import { MemberAccountPreparation } from "../src/features/trading/components/member-simulation-views";
import { initialSession } from "../src/features/trading/api/guest-session";
import type {
  LeaderboardPageResponse,
  PublicSeasonsOverviewResponse,
} from "../src/features/contest/api/contest-client";

function makeReadySession(memberId = 7, nickname = "트레이더7") {
  const epoch = Date.parse("2026-11-22T00:00:00Z");
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: String(memberId), roles: ["ROLE_MEMBER"] })).toString("base64url")}.sig`;
  return createMemberSession(
    "http://localhost:8080",
    async url =>
      String(url).endsWith("csrf")
        ? Response.json({ headerName: "X-CSRF-TOKEN", token: "csrf-token" })
        : Response.json({
            memberId,
            nickname,
            accessToken: jwt,
            tokenType: "Bearer",
            expiresIn: 900,
            expiresAt: new Date(epoch + 900_000).toISOString(),
          }),
    () => epoch,
    fn => fn(),
    () => true,
    () => null,
  );
}

const sampleLiveSeason = {
  id: 2,
  title: "요기망치 제2회 선물 실전 대회 · WINTER CHAMPIONSHIP",
  description: "실시간 수익률 랭킹 대회",
  seedMoney: "10000",
  recruitmentStartAt: "2026-11-05T14:33:13Z",
  recruitmentEndAt: "2026-11-24T14:33:13Z",
  contestStartAt: "2026-11-08T14:33:13Z",
  contestEndAt: "2026-11-24T14:33:13Z",
  isPublic: true,
  isCanceled: false,
  settledAt: null,
  displayStatus: "LIVE" as const,
  statusLabel: "대회 진행중",
  participantCount: 2,
  applicantCount: 0,
  pendingOrderCount: 0,
  openPositionCount: 1,
  createdAt: "2026-11-10T14:33:13Z",
  updatedAt: "2026-11-10T14:33:13Z",
};

const sampleSeasons: PublicSeasonsOverviewResponse = {
  recruiting: [],
  running: [sampleLiveSeason],
  finished: [],
  seasons: [sampleLiveSeason],
};

const samplePositiveLeaderboard: LeaderboardPageResponse = {
  season: sampleLiveSeason,
  items: [
    {
      rank: 1,
      participantId: 2,
      memberId: 1,
      nickname: "구닉네임",
      accountId: 34,
      seedMoney: "10000",
      totalEquity: "12840.5",
      balance: "11000",
      realizedPnl: "1000",
      unrealizedPnl: "1840.5",
      roiPct: "28.405",
      openPositionCount: 1,
      settled: false,
      settledAt: null,
    },
  ],
  nextCursorId: null,
  hasNext: false,
};

test("모바일 커뮤니티 대회투자 TOP5는 단일 aside를 피드 상단 접이식 카드로 배치하고 1위 요약·펼침/접힘·데스크톱 우측 배치를 유지한다", () => {
  const renderBoard = (element: ReactElement) => {
    const queryClient = new QueryClient();
    try {
      return renderToStaticMarkup(<MemberProvider client={queryClient}>{element}</MemberProvider>);
    } finally {
      queryClient.clear();
    }
  };

  const collapsedHtml = renderBoard(
    <CommunityBoard
      initialContestSeasons={sampleSeasons}
      initialContestLeaderboard={samplePositiveLeaderboard}
      initialContestProfiles={{
        1: {
          memberId: 1,
          nickname: "안녕4",
          profileImgUrl: null,
          withdrawn: false,
        },
      }}
    />,
  );

  // 1. 2컬럼 컨테이너 및 단일 aside / 단일 카드 / 단일 시즌 셀렉트 / 단일 h2 검증
  assert.equal(
    collapsedHtml.includes("flex flex-col lg:flex-row lg:items-start lg:gap-14"),
    true,
  );
  assert.equal((collapsedHtml.match(/<aside\b/g) ?? []).length, 1);
  assert.equal((collapsedHtml.match(/data-contest-top5-card="true"/g) ?? []).length, 1);
  assert.equal((collapsedHtml.match(/aria-label="대회 시즌 선택"/g) ?? []).length, 1);
  assert.equal((collapsedHtml.match(/<h2 class="sr-only">대회투자 TOP5<\/h2>/g) ?? []).length, 1);
  assert.equal(
    collapsedHtml.includes("order-first mb-6 w-full shrink-0 space-y-6 lg:order-last lg:mb-0 lg:mt-0 lg:w-72"),
    true,
  );

  // 2. 기본 접힘 상태(aria-expanded="false", 펼치기, 본문 hidden lg:block, 1위 수익률 요약 + 초록 하이라이트)
  assert.match(
    collapsedHtml,
    /<button[^>]*aria-expanded="false"[^>]*aria-controls="community-contest-top5-body"[^>]*data-contest-top5-toggle="true"[^>]*class="[^"]*lg:hidden[^"]*"/,
  );
  assert.match(
    collapsedHtml,
    /data-contest-top5-summary="true">1위 안녕4 · <span class="font-extrabold tabular-nums text-bull">\+28\.40%<\/span><\/span>/,
  );
  assert.equal(collapsedHtml.includes("<span>펼치기</span>"), true);
  assert.equal(collapsedHtml.includes("<span>접기</span>"), false);
  assert.match(
    collapsedHtml,
    /<div id="community-contest-top5-body" class="hidden lg:mt-1\.5 lg:block">/,
  );

  // 3. 펼침 상태(aria-expanded="true", 접기, 셰브론 rotate-180, 본문 block 표시)
  const expandedHtml = renderBoard(
    <CommunityBoard
      initialContestSeasons={sampleSeasons}
      initialContestLeaderboard={samplePositiveLeaderboard}
      initialContestProfiles={{
        1: {
          memberId: 1,
          nickname: "안녕4",
          profileImgUrl: null,
          withdrawn: false,
        },
      }}
      initialMobileTop5Open
    />,
  );
  assert.match(
    expandedHtml,
    /<button[^>]*aria-expanded="true"[^>]*aria-controls="community-contest-top5-body"[^>]*data-contest-top5-toggle="true"/,
  );
  assert.equal(expandedHtml.includes("<span>접기</span>"), true);
  assert.equal(expandedHtml.includes("rotate-180"), true);
  assert.match(
    expandedHtml,
    /<div id="community-contest-top5-body" class="mt-3\.5 block border-t border-gray-100 pt-3\.5 lg:mt-1\.5 lg:border-t-0 lg:pt-0">/,
  );

  // 4. 마이너스 1위 수익률(빨간색 #F6465D) + 탈퇴 회원 보호
  const negativeWithdrawnHtml = renderBoard(
    <CommunityBoard
      initialContestSeasons={sampleSeasons}
      initialContestLeaderboard={{
        ...samplePositiveLeaderboard,
        items: [
          {
            ...samplePositiveLeaderboard.items[0]!,
            memberId: 999,
            nickname: "숨겨야할닉네임",
            roiPct: "-6.25",
          },
        ],
      }}
      initialContestProfiles={{
        999: {
          memberId: 999,
          nickname: "탈퇴한회원",
          profileImgUrl: null,
          withdrawn: true,
        },
      }}
    />,
  );
  assert.match(
    negativeWithdrawnHtml,
    /data-contest-top5-summary="true">1위 탈퇴한회원 · <span class="font-extrabold tabular-nums text-\[#F6465D\]">-6\.25%<\/span><\/span>/,
  );
  assert.equal(negativeWithdrawnHtml.includes("숨겨야할닉네임"), false);

  // 5. 로딩 상태 & 빈 상태 요약 문구 검증
  const loadingHtml = renderBoard(<CommunityBoard />);
  assert.match(
    loadingHtml,
    /data-contest-top5-summary="true">실시간 대회 랭킹 불러오는 중…<\/span>/,
  );

  const emptyHtml = renderBoard(
    <CommunityBoard
      initialContestSeasons={sampleSeasons}
      initialContestLeaderboard={{ ...samplePositiveLeaderboard, items: [] }}
    />,
  );
  assert.match(
    emptyHtml,
    /data-contest-top5-summary="true">진행 중인 대회 랭킹 보기<\/span>/,
  );
});

test("전 사용자 서브페이지(/login, /mypage, /withdraw, /support, /privacy, /terms, /contest, /trading)에 내부 기술·개발 문구가 노출되지 않는다", async () => {
  const session = makeReadySession(7, "트레이더7");
  await session.restore();
  const snap = session.getSnapshot();
  const client = new QueryClient();
  try {
    // 1. /login
    const loginHtml = renderToStaticMarkup(
      <MemberLoginView google="/oauth/google" kakao="/oauth/kakao" />,
    );
    assert.equal(loginHtml.includes("암호화된 보안 세션으로 안전하게 인증됩니다."), true);
    assert.equal(loginHtml.includes("HttpOnly"), false);

    // 2. /mypage (/account)
    client.setQueryData(["member", "own", snap.memberId, snap.generation], {
      memberId: 7,
      nickname: "트레이더7",
      profileMessage: "선물 모의투자",
      profileImgUrl: null,
      status: "SUSPENDED",
      suspendedReason: "스팸 게시물 반복 등록",
      createdAt: "2026-11-01T00:00:00Z",
    });
    const accountHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <MemberAccount />
      </MemberProvider>,
    );
    assert.equal(
      accountHtml.includes("현재 브라우저를 포함해 로그인된 모든 PC·모바일 기기의 로그인 상태를 즉시 해제합니다."),
      true,
    );
    assert.equal(accountHtml.includes("Refresh 세션"), false);
    assert.equal(accountHtml.includes("보안 세션 일괄 폐기"), false);
    const accountSource = readFileSync(
      path.resolve(process.cwd(), "src/features/member/components/member-account.tsx"),
      "utf8",
    );
    assert.equal(accountSource.includes('subtitle="모든 기기 로그인 해제"'), true);
    assert.equal(accountSource.includes("보안 세션 일괄 폐기"), false);
    assert.equal(accountSource.includes("Refresh 세션"), false);

    // 3. /withdraw & MemberWithdrawal
    const withdrawalConfirmHtml = renderToStaticMarkup(
      <WithdrawalConfirmation
        ready={false}
        onSubmit={e => e.preventDefault()}
        onCancel={() => {}}
      />,
    );
    assert.equal(
      withdrawalConfirmHtml.includes("회원 탈퇴 전 아래 안내 사항을 모두 확인한 뒤 확인 문구를 입력해 주세요."),
      true,
    );
    assert.equal(
      withdrawalConfirmHtml.includes(
        "모의투자 기록 정합성 유지에 필요한 비식별 거래 이력과 탈퇴 시각은 개인정보 처리방침 및 관련 법령에 따라 정해진 기간 동안 안전하게 분리 보관됩니다.",
      ),
      true,
    );
    assert.equal(
      withdrawalConfirmHtml.includes("최근 동일 소셜 계정으로 본인 확인을 완료한 뒤 탈퇴를 요청할 수 있습니다."),
      true,
    );
    for (const leak of ["새로 확정된 탈퇴 정책", "서버 보존 정책", "서버의 확인 문구 검증"]) {
      assert.equal(withdrawalConfirmHtml.includes(leak), false, leak);
    }

    const withdrawalSource = readFileSync(
      path.resolve(process.cwd(), "src/features/member/components/member-withdrawal.tsx"),
      "utf8",
    );
    assert.equal(withdrawalSource.includes("모의투자 정리와 개인정보 제거가 완료되었습니다."), true);
    assert.equal(
      withdrawalSource.includes("모의투자 주문·포지션 정리와 개인정보 제거를 진행 중이며 아직 완료되지 않았습니다."),
      true,
    );
    assert.equal(withdrawalSource.includes("Trading 정리"), false);
    assert.equal(withdrawalSource.includes("Trading 주문·포지션"), false);

    // Render MemberWithdrawal directly to verify markup has no Trading jargon
    const withdrawalHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <MemberWithdrawal />
      </MemberProvider>,
    );
    assert.equal(withdrawalHtml.includes("Trading 정리"), false);
    assert.equal(withdrawalHtml.includes("Trading 주문·포지션"), false);

    // 4. /support (suspended banner)
    const supportHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <SupportCenter />
      </MemberProvider>,
    );
    assert.equal(supportHtml.includes("계정 일시 정지 안내 — 1:1 이의제기 접수 가능"), true);
    assert.equal(supportHtml.includes("SUSPENDED"), false);

    // 5. /privacy & /terms (PUBLISHED v3, DEVELOPMENT_DRAFT, missing fallback, and PublicPolicyPage pending)
    const termsV3Html = renderToStaticMarkup(
      <PolicyContent
        type="TERMS"
        document={{
          type: "TERMS",
          version: "ym-terms-v3",
          documentStatus: "PUBLISHED",
          sha256: "a".repeat(64),
          text: "# 요기망치 이용약관 (ym-terms-v3)\n시행일: 2026-11-22 · 문서 상태: 확정(PUBLISHED)\n\n제1조 (목적) 요기망치 공식 이용약관입니다.",
        }}
      />,
    );
    assert.equal(termsV3Html.includes("시행 중인 공식 이용약관"), true);
    assert.equal(termsV3Html.includes("<h2>이용약관 전문</h2>"), true);
    assert.equal(termsV3Html.includes("현재 서비스에 적용 중인 공식 약관입니다."), true);
    assert.equal(termsV3Html.includes("ym-terms-"), false);
    assert.equal(termsV3Html.includes("(PUBLISHED)"), false);
    assert.equal(termsV3Html.includes("[추후"), false);
    assert.equal(termsV3Html.includes("frontend-draft"), false);

    const privacyDraftHtml = renderToStaticMarkup(
      <PolicyContent
        type="PRIVACY"
        document={{
          type: "PRIVACY",
          version: "ym-privacy-v3",
          documentStatus: "DEVELOPMENT_DRAFT",
          sha256: "b".repeat(64),
          text: "# 요기망치 개인정보처리방침 (ym-privacy-v3)\n\n제1조 (목적) 요기망치 개인정보처리방침입니다.",
        }}
      />,
    );
    assert.equal(privacyDraftHtml.includes("<span>개인정보처리방침</span>"), true);
    assert.equal(privacyDraftHtml.includes("<h2>개인정보처리방침 전문</h2>"), true);
    assert.equal(privacyDraftHtml.includes("현재 동의 대상 약관입니다."), true);
    assert.equal(privacyDraftHtml.includes("ym-privacy-"), false);
    for (const leak of ["[추후", "frontend-draft", "서버 등록 개발 초안", "초안 · 정식 게시 전 법률 검토 필요"]) {
      assert.equal(privacyDraftHtml.includes(leak), false, leak);
    }

    const fallbackHtml = renderToStaticMarkup(<PolicyContent type="PRIVACY" />);
    assert.equal(
      fallbackHtml.includes("현재 약관 원문을 불러오지 못했습니다. 잠시 후 다시 시도하거나 1:1 고객센터로 문의해 주세요."),
      true,
    );
    assert.equal(fallbackHtml.includes('href="/support"'), true);
    assert.equal(fallbackHtml.includes("[추후"), false);
    assert.equal(fallbackHtml.includes("frontend-draft"), false);

    const pendingPolicyHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={new QueryClient()}>
        <PublicPolicyPage type="TERMS" />
      </MemberProvider>,
    );
    assert.equal(pendingPolicyHtml.includes("약관 원문을 불러오는 중입니다."), true);
    assert.equal(pendingPolicyHtml.includes("검토용 원고"), false);
    assert.equal(pendingPolicyHtml.includes("[추후"), false);

    // 6. /contest
    const contestHubSource = readFileSync(
      path.resolve(process.cwd(), "src/features/contest/components/contest-hub.tsx"),
      "utf8",
    );
    assert.equal(contestHubSource.includes("자동 취소 처리되고"), true);
    assert.equal(contestHubSource.includes("소프트 취소"), false);

    // 7. /trading
    const tradingHtml = renderToStaticMarkup(
      <MemberProvider session={session} client={client}>
        <TradingWorkspace />
      </MemberProvider>,
    );
    assert.equal(tradingHtml.includes("모의투자 본문으로 바로가기"), true);
    assert.equal(tradingHtml.includes("Trading 본문으로 바로가기"), false);

    const prepHtml = renderToStaticMarkup(
      <MemberAccountPreparation
        snapshot={{ ...initialSession, mode: "member", phase: "anonymous" }}
        disabled={false}
        onPrepare={() => {}}
        onRestore={() => {}}
      />,
    );
    assert.equal(prepHtml.includes("회원 모의투자 계정이 아직 준비되지 않았습니다."), true);
    assert.equal(prepHtml.includes("회원 Trading 계정"), false);
  } finally {
    client.clear();
  }
});
