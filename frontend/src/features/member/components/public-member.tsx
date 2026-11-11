"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ContentApiError, contentJson, contentMessage } from "../api/client";
import { parseFollowChange, parseFollowPage, parseFollowSummary, parseProfile } from "../api/contracts";
import {
  communityCategoryLabel,
  parseCommunityPostPage,
  parseCommunityReport,
  parseMemberCommunityCommentPage,
  parseMemberCommunityReportPage,
  parsePublicMemberPortfolio,
  readCommunityOrPublic,
  type CommunityCategory,
} from "../api/community-news";
import { tradingJson } from "../../trading/api/client";
import { formatDecimal } from "../../trading/api/account";
import {
  formatExchangeCompactPct,
  formatExchangePrice,
  formatExchangeQuantity,
} from "../api/exchange-format";
import {
  fetchMyContestSeasons,
  fetchPublicMemberContestSeasons,
  formatContestSignedRoi,
  formatContestUsdt,
  formatContestWinRate,
  resolveTradingContestBaseUrl,
} from "../../contest/api/contest-client";
import { useMember } from "./member-provider";
import { MemberShell } from "./member-views";
import {
  V1AssetSummaryCard,
  V1Button,
  V1FolderTabs,
  V1ProfileSidebar,
  V1Tabs,
  V1UserAvatar,
  V1IconHeart,
} from "./v1-ui";

function formatSignedUsdt(raw: string): string {
  const trimmed = raw.trim();
  const formatted = formatDecimal(trimmed.replace(/^[+-]/, ""));
  const valueStr = formatted === "—" ? trimmed.replace(/^[+-]/, "") : formatted;
  if (!/[1-9]/.test(valueStr)) return "0.00 USDT";
  if (trimmed.startsWith("-")) return `-${valueStr} USDT`;
  return `+${valueStr} USDT`;
}

function formatSignedPct(raw: string): string {
  const trimmed = raw.trim().replace(/%$/, "");
  const formatted = formatDecimal(trimmed.replace(/^[+-]/, ""));
  const valueStr = formatted === "—" ? trimmed.replace(/^[+-]/, "") : formatted;
  if (!/[1-9]/.test(valueStr)) return "0.00%";
  if (trimmed.startsWith("-")) return `-${valueStr}%`;
  return `+${valueStr}%`;
}

function publicPnlColor(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) return "text-blue-600";
  if (!/[1-9]/.test(trimmed)) return "text-gray-500";
  return "text-red-500";
}

function formatPublicKstDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const kst = new Date(parsed + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

export function PublicMember({ memberId }: { memberId: number }) {
  const { origin, session, snapshot } = useMember();
  const client = useQueryClient();
  const tradingBase = resolveTradingContestBaseUrl();

  const [kind, setKind] = useState<"followers" | "followings">("followers");
  const [keyword, setKeyword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"mock-assets" | "contest-assets" | "portfolio" | "community">("portfolio");
  const [ledgerTab, setLedgerTab] = useState<"positions" | "pnl" | "orders" | "trades" | "open-orders">("positions");
  const [contestTab, setContestTab] = useState<"live" | "ended">("live");
  const [portfolioTab, setPortfolioTab] = useState<"mock" | "contest">("mock");
  const [communityTab, setCommunityTab] = useState<
    "posts" | "replies" | "liked-posts" | "liked-replies" | "reports"
  >("posts");
  const active = useRef(false);
  const communitySentinelRef = useRef<HTMLDivElement>(null);

  const identity = [snapshot.memberId, snapshot.generation] as const;

  const profile = useQuery({
    queryKey: ["member", "public", memberId],
    enabled: memberId > 0,
    retry: (failureCount, err) => {
      if (err instanceof ContentApiError && (err.status === 404 || err.code === "MEMBER_NOT_FOUND")) {
        return false;
      }
      return failureCount < 1;
    },
    queryFn: async ({ signal }) => {
      const value = parseProfile(await contentJson(origin, `/members/${memberId}`, { signal }));
      if (value.memberId !== memberId) throw new ContentApiError(422);
      return value;
    },
  });

  const isMemberNotFound =
    profile.isError &&
    profile.error instanceof ContentApiError &&
    (profile.error.status === 404 || profile.error.code === "MEMBER_NOT_FOUND");

  const summary = useQuery({
    queryKey: ["member", "relationship", memberId, ...identity],
    enabled: memberId > 0 && !isMemberNotFound,
    queryFn: async ({ signal }) =>
      parseFollowSummary(
        await (snapshot.phase === "ready"
          ? session.request(`/members/${memberId}/follows`, { signal })
          : contentJson(origin, `/members/${memberId}/follows`, { signal })),
        memberId,
      ),
  });

  const list = useInfiniteQuery({
    queryKey: ["member", "relations", memberId, kind, keyword],
    enabled: memberId > 0 && !isMemberNotFound,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ size: "10", keyword });
      if (pageParam) params.set("cursorId", String(pageParam));
      const page = parseFollowPage(
        await (snapshot.phase === "ready"
          ? session.request(`/members/${memberId}/${kind}?${params}`, { signal })
          : contentJson(origin, `/members/${memberId}/${kind}?${params}`, { signal })),
      );
      if (page.hasNext && pageParam && page.nextCursorId! >= pageParam) {
        throw new ContentApiError(422);
      }
      return page;
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  // [T-1] 공개 포트폴리오 조회 (누구나 조회 가능)
  const publicPortfolioQuery = useQuery({
    queryKey: ["member", "public-portfolio", memberId, tradingBase, snapshot.generation],
    enabled: memberId > 0 && !isMemberNotFound,
    queryFn: async ({ signal }) =>
      parsePublicMemberPortfolio(
        await tradingJson(tradingBase, `portfolios/members/${memberId}`, { signal }),
      ),
  });

  const isOwner =
    snapshot.phase === "ready" && Boolean(summary.data?.mine || snapshot.memberId === memberId);

  const publicContestSeasonsQuery = useQuery({
    queryKey: ["member", "public-contest-seasons", memberId, isOwner, tradingBase, snapshot.generation],
    enabled: memberId > 0 && !isMemberNotFound,
    queryFn: async ({ signal }) =>
      isOwner
        ? session.authorized(cred =>
            fetchMyContestSeasons(cred.accessToken, { baseUrl: tradingBase, signal }),
          )
        : fetchPublicMemberContestSeasons(memberId, { baseUrl: tradingBase, signal }),
  });

  const communityQueriesEnabled = memberId > 0 && !isMemberNotFound && mainTab === "community";

  // [C-6] 커뮤니티활동 커서 기반 무한스크롤 (활성 탭 진입 시 지연 조회)
  const memberPostsInfinite = useInfiniteQuery({
    queryKey: ["member", "public-community-posts", memberId, snapshot.generation],
    enabled: communityQueriesEnabled && communityTab === "posts",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      return parseCommunityPostPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          `/members/${memberId}/community/posts?${search.toString()}`,
          signal,
        ),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const memberCommentsInfinite = useInfiniteQuery({
    queryKey: ["member", "public-community-comments", memberId, snapshot.generation],
    enabled: communityQueriesEnabled && communityTab === "replies",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      return parseMemberCommunityCommentPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          `/members/${memberId}/community/comments?${search.toString()}`,
          signal,
        ),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const memberLikedPostsInfinite = useInfiniteQuery({
    queryKey: ["member", "public-community-liked-posts", memberId, snapshot.generation],
    enabled: communityQueriesEnabled && communityTab === "liked-posts",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      return parseCommunityPostPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          `/members/${memberId}/community/liked-posts?${search.toString()}`,
          signal,
        ),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const memberLikedCommentsInfinite = useInfiniteQuery({
    queryKey: ["member", "public-community-liked-comments", memberId, snapshot.generation],
    enabled: communityQueriesEnabled && communityTab === "liked-replies",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      return parseMemberCommunityCommentPage(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          `/members/${memberId}/community/liked-comments?${search.toString()}`,
          signal,
        ),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const ownerReportsInfinite = useInfiniteQuery({
    queryKey: ["member", "public-community-reports", memberId, snapshot.generation],
    enabled: communityQueriesEnabled && isOwner && communityTab === "reports",
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ size: "10" });
      if (pageParam) search.set("cursorId", String(pageParam));
      return parseMemberCommunityReportPage(
        await session.request(`/members/me/community/reports?${search.toString()}`, { signal }),
      );
    },
    getNextPageParam: page => (page.hasNext ? (page.nextCursorId ?? undefined) : undefined),
  });

  const cancelReportMutation = useMutation({
    mutationFn: async (item: { targetType: "POST" | "COMMENT"; targetId: number }) => {
      const endpoint =
        item.targetType === "POST"
          ? `/community/posts/${item.targetId}/reports`
          : `/community/comments/${item.targetId}/reports`;
      return parseCommunityReport(await session.request(endpoint, { method: "DELETE" }));
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["member", "public-community-reports", memberId],
      });
    },
  });

  const activeCommunityInfinite =
    communityTab === "posts"
      ? memberPostsInfinite
      : communityTab === "replies"
        ? memberCommentsInfinite
        : communityTab === "liked-posts"
          ? memberLikedPostsInfinite
          : communityTab === "liked-replies"
            ? memberLikedCommentsInfinite
            : ownerReportsInfinite;

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      mainTab !== "community" ||
      !activeCommunityInfinite.hasNextPage ||
      activeCommunityInfinite.isFetchingNextPage
    ) {
      return;
    }
    const node = communitySentinelRef.current;
    if (!node || typeof window.IntersectionObserver !== "function") return;
    const observer = new window.IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          void activeCommunityInfinite.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  async function changeFollow() {
    if (active.current || snapshot.phase !== "ready" || !summary.data || summary.data.mine) return;
    active.current = true;
    setPending(true);
    setError(null);
    try {
      parseFollowChange(
        await session.request(`/members/${memberId}/follows`, {
          method: summary.data.followed ? "DELETE" : "PUT",
        }),
        memberId,
      );
      await client.invalidateQueries({ queryKey: ["member"] });
    } catch (err) {
      setError(contentMessage(err));
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  if (memberId <= 0 || isMemberNotFound) {
    return (
      <MemberShell
        title="공개 프로필"
        subtitle="요청하신 회원 정보를 확인할 수 없습니다."
        variant="wide"
        hideCardHeading
      >
        <div
          className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-4"
          data-member-not-found="true"
        >
          <h2 className="text-xl font-black text-gray-900">
            탈퇴했거나 존재하지 않는 회원입니다.
          </h2>
          <p className="text-sm font-medium text-gray-500">
            회원이 탈퇴했거나 잘못된 주소여서 공개 프로필과 포트폴리오를 표시할 수 없습니다.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/community"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#0058FF] px-5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
            >
              커뮤니티로 이동
            </Link>
            <Link
              href="/contest"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              실전 투자대회 보기
            </Link>
          </div>
        </div>
      </MemberShell>
    );
  }

  const entries =
    list.isError && !list.isFetchNextPageError
      ? undefined
      : list.data?.pages
          .flatMap(page => page.content)
          .filter(
            (entry, index, all) =>
              all.findIndex(value => value.memberId === entry.memberId) === index,
          );

  const currentProfile = profile.isError ? undefined : profile.data;
  const displayNickname = currentProfile?.nickname ?? `트레이더 #${memberId}`;

  const portfolioResolved = publicPortfolioQuery.isSuccess;
  const livePortfolio =
    publicPortfolioQuery.data && publicPortfolioQuery.data.accountExists
      ? publicPortfolioQuery.data
      : null;

  const assetSummary = livePortfolio
    ? {
        title: `${displayNickname}님의 모의투자`,
        totalAsset: `${formatDecimal(livePortfolio.wallet.totalEquity)} USDT`,
        cashBalance: `${formatDecimal(livePortfolio.wallet.availableBalance)} USDT`,
        totalBuyAmount: `${formatDecimal(livePortfolio.wallet.usedMargin)} USDT`,
        totalCoinValue: `${formatDecimal(livePortfolio.wallet.balance)} USDT`,
        totalProfit: formatSignedUsdt(livePortfolio.wallet.totalPnl),
        totalRoi: formatSignedPct(livePortfolio.wallet.totalRoiPct),
        isPositive:
          !livePortfolio.wallet.totalPnl.trim().startsWith("-") &&
          /[1-9]/.test(livePortfolio.wallet.totalPnl),
        isNegative: livePortfolio.wallet.totalPnl.trim().startsWith("-"),
        unit: "USDT",
      }
    : {
        title: `${displayNickname}님의 모의투자`,
        totalAsset: "0.00 USDT",
        cashBalance: "0.00 USDT",
        totalBuyAmount: "0.00 USDT",
        totalCoinValue: "0.00 USDT",
        totalProfit: "0.00 USDT",
        totalRoi: "0.00%",
        isPositive: false,
        isNegative: false,
        unit: "USDT",
      };

  const livePosts = memberPostsInfinite.data
    ? memberPostsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveComments = memberCommentsInfinite.data
    ? memberCommentsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveLikedPosts = memberLikedPostsInfinite.data
    ? memberLikedPostsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveLikedComments = memberLikedCommentsInfinite.data
    ? memberLikedCommentsInfinite.data.pages.flatMap(p => p.items)
    : null;
  const liveReports = ownerReportsInfinite.data
    ? ownerReportsInfinite.data.pages.flatMap(p => p.items)
    : null;

  return (
    <MemberShell
      title={currentProfile?.nickname ?? "공개 프로필"}
      subtitle="회원의 공개 프로필 및 선물 모의투자 포트폴리오를 조회합니다."
      variant="wide"
      hideCardHeading
    >
      <div className="mx-auto max-w-[1280px]">
        {profile.isPending && (
          <p role="status" className="mb-4 rounded-xl bg-white p-4 text-xs text-gray-500 border border-gray-200">
            프로필을 불러오는 중입니다.
          </p>
        )}
        {profile.isError && (
          <p role="alert" className="member-message mb-4 rounded-xl bg-red-50 p-4 text-xs font-bold text-red-600 border border-red-200">
            {contentMessage(profile.error)}
          </p>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* 좌측: V1 ProfileSidebar + AssetSummaryCard + 팔로워/팔로잉 패널 */}
          <div className="min-w-0 space-y-6 lg:col-span-4">
            <V1ProfileSidebar
              profile={{
                memberId,
                nickname: displayNickname,
                profileMsg: currentProfile?.profileMessage || "등록된 소개가 없습니다.",
                profileImgUrl: currentProfile?.profileImgUrl,
                role: "USER",
                followerCount: summary.data?.followerCount ?? 0,
                followingCount: summary.data?.followingCount ?? 0,
              }}
              onClickFollowers={() => setKind("followers")}
              onClickFollowings={() => setKind("followings")}
              relationArea={
                currentProfile ? (
                  <p className="member-note text-center text-xs text-gray-400">
                    가입 {formatPublicKstDate(currentProfile.createdAt)}
                  </p>
                ) : null
              }
              actionArea={
                <div className="member-actions space-y-2">
                  {summary.data?.mine ? (
                    <Link
                      href="/me/settings"
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
                    >
                      프로필 수정
                    </Link>
                  ) : snapshot.phase === "ready" ? (
                    <button
                      type="button"
                      className="member-primary flex h-10 w-full items-center justify-center rounded-xl bg-[#0058FF] text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                      disabled={pending || !summary.data || summary.isError}
                      onClick={() => void changeFollow()}
                    >
                      {pending ? "처리 중…" : summary.data?.followed ? "팔로우 취소" : "팔로우"}
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="flex h-10 w-full items-center justify-center rounded-xl bg-[#0058FF] text-xs font-bold text-white hover:bg-blue-700"
                    >
                      로그인하고 팔로우
                    </Link>
                  )}
                </div>
              }
            />

            {summary.isError && (
              <p role="alert" className="member-message rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                {contentMessage(summary.error)}{" "}
                <button className="account-refresh underline font-bold" onClick={() => void summary.refetch()}>
                  다시 조회
                </button>
              </p>
            )}
            {error && (
              <p role="alert" className="member-message rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                {error}
              </p>
            )}

            <V1AssetSummaryCard summary={assetSummary} />

            {/* 팔로우 목록 섹션 (기존 테스트 호환 마크업 유지) */}
            <div className="card rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="member-actions flex gap-2" role="tablist" aria-label="팔로우 목록">
                {(["followers", "followings"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    className={`member-secondary flex-1 rounded-xl py-2 text-xs font-bold ${
                      kind === value
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                    role="tab"
                    aria-selected={kind === value}
                    id={`member-${value}-tab`}
                    aria-controls="member-follow-panel"
                    onClick={() => setKind(value)}
                  >
                    {value === "followers" ? "팔로워" : "팔로잉"}{" "}
                    {summary.data
                      ? value === "followers"
                        ? summary.data.followerCount
                        : summary.data.followingCount
                      : "—"}
                  </button>
                ))}
              </div>

              <section
                id="member-follow-panel"
                role="tabpanel"
                aria-labelledby={`member-${kind}-tab`}
                className="space-y-3"
              >
                <form
                  className="member-search flex gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    setKeyword(String(new FormData(event.currentTarget).get("keyword") ?? "").trim());
                  }}
                >
                  <input
                    name="keyword"
                    aria-label="닉네임 검색"
                    maxLength={12}
                    placeholder="닉네임 검색"
                    className="h-9 flex-1 rounded-xl border border-gray-300 px-3 text-xs"
                  />
                  <button
                    type="submit"
                    className="member-secondary rounded-xl bg-gray-100 px-3 text-xs font-bold text-gray-700"
                  >
                    검색
                  </button>
                </form>

                {list.isPending && <p role="status" className="text-xs text-gray-400">목록을 불러오는 중입니다.</p>}
                {list.isError && (
                  <p role="alert" className="member-message text-xs text-red-500">
                    {contentMessage(list.error)}
                  </p>
                )}
                {entries?.length === 0 && (
                  <p className="member-message text-xs text-gray-400">표시할 회원이 없습니다.</p>
                )}

                <ul className="member-follow-list divide-y divide-gray-100">
                  {entries?.map(entry => (
                    <li key={entry.memberId} className="flex items-center gap-3 py-2.5">
                      <V1UserAvatar src={entry.profileImgUrl} memberId={entry.memberId} nickname={entry.nickname} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/members/${entry.memberId}`}
                          className="text-xs font-bold text-gray-900 hover:text-[#0058FF]"
                        >
                          {entry.nickname}
                        </Link>
                        <p className="member-profile-message truncate text-[11px] text-gray-400">
                          {entry.profileMessage}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="member-actions flex gap-2">
                  {list.hasNextPage && (
                    <button
                      className="member-secondary rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold"
                      disabled={list.isFetching}
                      onClick={() => void list.fetchNextPage()}
                    >
                      {list.isFetching ? "불러오는 중…" : "더 보기"}
                    </button>
                  )}
                  {list.isError && !list.isFetchNextPageError && (
                    <button
                      className="member-secondary rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold"
                      disabled={list.isFetching}
                      onClick={() => void list.refetch()}
                    >
                      다시 조회
                    </button>
                  )}
                </div>
              </section>
            </div>
          </div>

          {/* 우측: 통합 4대 탭 (본인 로그인 시 4탭 전체, 타인/비로그인 시 포트폴리오 + 커뮤니티활동 2탭만 노출) */}
          <div className="min-w-0 space-y-6 lg:col-span-8">
            {(() => {
              const visibleMainTabs = isOwner
                ? [
                    { label: "내 모의투자 자산", value: "mock-assets" },
                    { label: "시즌별 대회 자산", value: "contest-assets" },
                    { label: "포트폴리오", value: "portfolio" },
                    { label: "커뮤니티활동", value: "community" },
                  ]
                : [
                    { label: "포트폴리오", value: "portfolio" },
                    { label: "커뮤니티활동", value: "community" },
                  ];
              const effectiveTab =
                !isOwner && (mainTab === "mock-assets" || mainTab === "contest-assets")
                  ? "portfolio"
                  : mainTab;

              const longRatioPct = livePortfolio ? livePortfolio.allocation.longRatioPct : "0";
              const shortRatioPct = livePortfolio ? livePortfolio.allocation.shortRatioPct : "0";
              const liveContestSeasons = publicContestSeasonsQuery.data?.participatingSeasons ?? [];
              const pastContestSeasons = publicContestSeasonsQuery.data?.pastSeasons ?? [];

              return (
                <>
                  <div data-mypage-bookmark-nav="true">
                    <V1Tabs
                      tabs={visibleMainTabs}
                      activeTab={effectiveTab}
                      variant="bookmark"
                      onChange={val =>
                        setMainTab(val as "mock-assets" | "contest-assets" | "portfolio" | "community")
                      }
                    />
                  </div>

                  {effectiveTab === "mock-assets" && isOwner && (
                    <V1FolderTabs
                      tabs={[
                        { id: "positions", label: "포지션 현황" },
                        { id: "pnl", label: "손익현황" },
                        { id: "orders", label: "주문내역" },
                        { id: "trades", label: "거래내역" },
                        { id: "open-orders", label: "미체결내역" },
                      ]}
                      activeId={ledgerTab}
                      onChange={id =>
                        setLedgerTab(id as "positions" | "pnl" | "orders" | "trades" | "open-orders")
                      }
                    >
                      <div className="py-6 text-xs font-bold text-gray-600">
                        내 모의투자 자산 원장을 확인합니다. 상세 주문·체결 원장 필터 및 회차 초기화는{" "}
                        <Link href="/me" className="text-[#0058FF] underline">
                          마이페이지
                        </Link>
                        에서 관리할 수 있습니다.
                      </div>
                    </V1FolderTabs>
                  )}

                  {effectiveTab === "contest-assets" && isOwner && (
                    <V1FolderTabs
                      tabs={[
                        { id: "live", label: "진행 시즌 실시간 대회 자산" },
                        { id: "ended", label: "종료된 시즌 대회 자산" },
                      ]}
                      activeId={contestTab}
                      onChange={id => setContestTab(id as "live" | "ended")}
                    >
                      <div className="space-y-3 py-4 text-xs">
                        {(() => {
                          const listItems =
                            contestTab === "live" ? liveContestSeasons : pastContestSeasons;
                          if (listItems.length === 0) {
                            return (
                              <p className="py-6 text-center font-bold text-gray-400">
                                {contestTab === "live"
                                  ? "현재 진행 중인 참가 대회 시즌이 없습니다."
                                  : "종료된 참가 대회 시즌 이력이 없습니다."}
                              </p>
                            );
                          }
                          return listItems.map(item => {
                            const roiStr = formatContestSignedRoi(item.roiPct);
                            return (
                              <div
                                key={item.seasonId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-[#F9FAFB] p-4"
                              >
                                <div>
                                  <span className="font-black text-gray-900">{item.title}</span>
                                  <p className="mt-0.5 text-gray-500">
                                    순위 {item.rank ?? "-"}위 / {item.totalParticipants}명 · 평가자산{" "}
                                    {formatContestUsdt(item.totalEquity)}
                                  </p>
                                </div>
                                <span className={`text-base font-black ${publicPnlColor(roiStr)}`}>
                                  {roiStr}
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </V1FolderTabs>
                  )}

                  {effectiveTab === "portfolio" && (
                    <V1FolderTabs
                      tabs={[
                        { id: "mock", label: "모의투자 (선물)" },
                        { id: "contest", label: "시즌 대회" },
                      ]}
                      activeId={portfolioTab}
                      onChange={id => setPortfolioTab(id as "mock" | "contest")}
                    >
                      {portfolioTab === "mock" ? (
                        <div className="space-y-6">
                          {publicPortfolioQuery.isError && (
                            <div
                              role="alert"
                              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-600"
                            >
                              공개 포트폴리오 데이터를 불러오지 못했습니다.{" "}
                              <button
                                type="button"
                                className="underline"
                                onClick={() => void publicPortfolioQuery.refetch()}
                              >
                                다시 시도
                              </button>
                            </div>
                          )}

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                              <h3 className="text-sm font-black text-gray-900">포지션 증거금 비중 (%)</h3>
                              <p className="mt-2 text-xs text-gray-500">
                                {livePortfolio
                                  ? `사용 증거금 비중 ${formatDecimal(livePortfolio.allocation.usedMarginRatioPct)}% · 가용 USDT ${formatDecimal(livePortfolio.allocation.availableCashRatioPct)}%`
                                  : portfolioResolved
                                    ? "개설된 모의투자 계좌가 없거나 보유 중인 포지션이 없습니다."
                                    : "모의투자 증거금 운용 비중을 불러오고 있습니다."}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                              <h3 className="text-sm font-black text-gray-900">롱 / 숏 비율</h3>
                              <div className="mt-3 flex justify-between text-xs font-bold">
                                <span className="text-red-500">LONG {formatExchangeCompactPct(longRatioPct)}</span>
                                <span className="text-blue-600">SHORT {formatExchangeCompactPct(shortRatioPct)}</span>
                              </div>
                              <div className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-gray-200">
                                <div className="h-full bg-red-500" style={{ width: `${longRatioPct}%` }} />
                                <div className="h-full bg-blue-600" style={{ width: `${shortRatioPct}%` }} />
                              </div>
                            </div>
                          </div>

                          {livePortfolio && (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5">
                                <span className="text-[11px] font-bold text-gray-400">종료 거래 수</span>
                                <p className="mt-1 text-base font-black text-gray-900">
                                  {livePortfolio.closedTradeSummary.closedPositionCount}회
                                </p>
                              </div>
                              <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5">
                                <span className="text-[11px] font-bold text-gray-400">승률</span>
                                <p className="mt-1 text-base font-black text-gray-900">
                                  {formatDecimal(livePortfolio.closedTradeSummary.winRatePct)}%
                                </p>
                              </div>
                              <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5">
                                <span className="text-[11px] font-bold text-gray-400">익절 / 손절</span>
                                <p className="mt-1 text-base font-black text-gray-900">
                                  {livePortfolio.closedTradeSummary.winCount}승 ·{" "}
                                  {livePortfolio.closedTradeSummary.lossCount}패
                                </p>
                              </div>
                              <div className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5">
                                <span className="text-[11px] font-bold text-gray-400">순실현손익</span>
                                <p
                                  className={`mt-1 text-sm font-black ${publicPnlColor(livePortfolio.wallet.realizedPnl)}`}
                                >
                                  {formatSignedUsdt(livePortfolio.wallet.realizedPnl)}
                                </p>
                              </div>
                            </div>
                          )}

                          {livePortfolio && livePortfolio.positions.length > 0 ? (
                            <div className="overflow-x-auto rounded-2xl border border-gray-200">
                              <table className="w-full min-w-[600px] text-left text-xs">
                                <thead className="border-b border-gray-200 bg-gray-50 font-bold text-gray-500">
                                  <tr>
                                    <th className="px-4 py-3">종목 / 배율</th>
                                    <th className="px-4 py-3">포지션</th>
                                    <th className="px-4 py-3 text-right">수량</th>
                                    <th className="px-4 py-3 text-right">진입가</th>
                                    <th className="px-4 py-3 text-right">마크가</th>
                                    <th className="px-4 py-3 text-right">평가손익 (ROE)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                  {livePortfolio.positions.map(pos => (
                                    <tr key={`${pos.id}-${pos.side}`} className="hover:bg-gray-50">
                                      <td className="px-4 py-3 font-black text-gray-900">
                                        {pos.symbol} · {pos.leverage}x
                                      </td>
                                      <td
                                        className={`px-4 py-3 font-bold ${
                                          pos.side === "LONG" ? "text-red-500" : "text-blue-600"
                                        }`}
                                      >
                                        {pos.side}
                                      </td>
                                      <td className="px-4 py-3 text-right">{formatExchangeQuantity(pos.quantity, pos.symbol.replace(/USDT$/i, ""))}</td>
                                      <td className="px-4 py-3 text-right">${formatExchangePrice(pos.entryPrice)}</td>
                                      <td className="px-4 py-3 text-right">${formatExchangePrice(pos.markPrice)}</td>
                                      <td className={`px-4 py-3 text-right font-black ${publicPnlColor(pos.unrealizedPnl)}`}>
                                        {formatSignedUsdt(pos.unrealizedPnl)} (
                                        {formatSignedPct(pos.roePct)})
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : portfolioResolved ? (
                            <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] py-8 text-center text-xs font-bold text-gray-400">
                              {livePortfolio
                                ? "현재 보유 중인 오픈 포지션이 없습니다."
                                : "아직 개설된 선물 모의투자 계좌가 없습니다."}
                            </div>
                          ) : null}

                          {livePortfolio && livePortfolio.symbolPerformances.length > 0 && (
                            <div className="space-y-3">
                              <h3 className="text-sm font-black text-gray-900">종목별 누적 트레이딩 성과</h3>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {livePortfolio.symbolPerformances.map(perf => (
                                  <div
                                    key={perf.tradingSymbolId}
                                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-[#F9FAFB] px-4 py-3 text-xs"
                                  >
                                    <div>
                                      <span className="font-black text-gray-900">{perf.symbol}</span>
                                      <p className="mt-0.5 text-[11px] text-gray-500">
                                        체결 {perf.fillCount}회 · 비중 {formatDecimal(perf.turnoverSharePercent)}%
                                      </p>
                                    </div>
                                    <span className={`font-black ${publicPnlColor(perf.economicPnl)}`}>
                                      {formatSignedUsdt(perf.economicPnl)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : liveContestSeasons.length > 0 || pastContestSeasons.length > 0 ? (
                        <div className="space-y-6">
                          {liveContestSeasons.length > 0 && (
                            <div className="space-y-3">
                              <h3 className="text-xs font-black text-[#0058FF]">
                                진행 중인 대회 시즌 ({liveContestSeasons.length})
                              </h3>
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {liveContestSeasons.map(item => (
                                  <div
                                    key={`live-${item.seasonId}`}
                                    className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-[#0058FF]">{item.title}</span>
                                      <span className="rounded-full bg-[#0058FF] px-2 py-0.5 text-[10px] font-bold text-white">
                                        실시간 LIVE
                                      </span>
                                    </div>
                                    <p className={`mt-2 text-2xl font-black ${publicPnlColor(item.roiPct)}`}>
                                      {formatContestSignedRoi(item.roiPct)}
                                    </p>
                                    <p className="mt-1 text-xs font-bold text-gray-600">
                                      현재 {item.rank ?? "-"}위 / {item.totalParticipants}명 · 평가자산{" "}
                                      {formatContestUsdt(item.totalEquity)}
                                    </p>
                                    {item.tradeCount !== undefined && (
                                      <p className="mt-1 text-[11px] text-gray-500">
                                        거래 {item.tradeCount}회 · 승률 {formatContestWinRate(item.winRate)}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {pastContestSeasons.length > 0 && (
                            <div className="space-y-3">
                              <h3 className="text-xs font-black text-gray-700">
                                종료 · 정산 완료 시즌 ({pastContestSeasons.length})
                              </h3>
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {pastContestSeasons.map(item => (
                                  <div
                                    key={`past-${item.seasonId}`}
                                    className="rounded-2xl border border-gray-200 bg-[#F9FAFB] p-5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-gray-800">{item.title}</span>
                                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-700">
                                        최종 {item.rank ?? "-"}위
                                      </span>
                                    </div>
                                    <p className={`mt-2 text-2xl font-black ${publicPnlColor(item.roiPct)}`}>
                                      {formatContestSignedRoi(item.roiPct)}
                                    </p>
                                    <p className="mt-1 text-xs font-bold text-gray-600">
                                      최종 {item.rank ?? "-"}위 / {item.totalParticipants}명 · 최종자산{" "}
                                      {formatContestUsdt(item.totalEquity)}
                                    </p>
                                    {item.tradeCount !== undefined && (
                                      <p className="mt-1 text-[11px] text-gray-500">
                                        거래 {item.tradeCount}회 · 승률 {formatContestWinRate(item.winRate)}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="py-10 text-center text-xs font-bold text-gray-400">
                          참여한 모의투자 대회 시즌 기록이 없습니다.
                        </div>
                      )}
                    </V1FolderTabs>
                  )}

                  {effectiveTab === "community" && (
                    <V1FolderTabs
                      tabs={
                        isOwner
                          ? [
                              { id: "posts", label: "게시글" },
                              { id: "replies", label: "댓글" },
                              { id: "liked-posts", label: "좋아요" },
                              { id: "liked-replies", label: "좋아요 댓글" },
                              { id: "reports", label: "신고내역" },
                            ]
                          : [
                              { id: "posts", label: "게시글" },
                              { id: "replies", label: "댓글" },
                              { id: "liked-posts", label: "좋아요" },
                              { id: "liked-replies", label: "좋아요 댓글" },
                            ]
                      }
                      activeId={communityTab}
                      onChange={id =>
                        setCommunityTab(
                          id as "posts" | "replies" | "liked-posts" | "liked-replies" | "reports",
                        )
                      }
                    >
                      {communityTab === "posts" && (
                        <div className="space-y-3">
                          {livePosts && livePosts.length > 0 ? (
                            livePosts.map(post => (
                              <article key={post.id} className="rounded-xl border border-gray-200 p-4">
                                <div className="flex items-center justify-between text-xs text-gray-400">
                                  <span className="font-bold text-[#0058FF]">
                                    {communityCategoryLabel(post.category as CommunityCategory)}
                                    {post.symbolTag ? ` · #${post.symbolTag}` : ""}
                                  </span>
                                  <span>{formatPublicKstDate(post.createdAt)}</span>
                                </div>
                                <Link
                                  href={`/community/all/${post.id}`}
                                  className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]"
                                >
                                  {post.title}
                                </Link>
                                <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                                  {post.content}
                                </p>
                              </article>
                            ))
                          ) : (
                            <div className="py-8 text-center text-xs font-medium text-gray-500">
                              {memberPostsInfinite.isPending
                                ? "작성한 게시글을 불러오는 중입니다."
                                : "작성한 공개 게시글이 없습니다."}
                            </div>
                          )}
                        </div>
                      )}

                      {communityTab === "replies" && (
                        <div className="space-y-3">
                          {liveComments && liveComments.length > 0 ? (
                            liveComments.map(comment => (
                              <div
                                key={comment.id}
                                className="rounded-xl border border-gray-200 p-4 text-xs"
                              >
                                <Link
                                  href={`/community/all/${comment.postId}`}
                                  className="font-bold text-gray-900 hover:text-[#0058FF]"
                                >
                                  “{comment.content}”
                                </Link>
                                <p className="mt-1 text-gray-400">원문: {comment.postTitle}</p>
                              </div>
                            ))
                          ) : (
                            <div className="py-8 text-center text-xs font-medium text-gray-500">
                              {memberCommentsInfinite.isPending
                                ? "작성한 댓글을 불러오는 중입니다."
                                : "작성한 공개 댓글이 없습니다."}
                            </div>
                          )}
                        </div>
                      )}

                      {communityTab === "liked-posts" && (
                        <div className="space-y-3">
                          {liveLikedPosts && liveLikedPosts.length > 0 ? (
                            liveLikedPosts.map(post => (
                              <div
                                key={post.id}
                                className="rounded-xl border border-gray-200 p-4 text-xs"
                              >
                                <span className="inline-flex items-center gap-1 font-bold text-gray-700">
                                  <V1IconHeart className="h-3.5 w-3.5" />
                                  <span>좋아요 표시한 게시글</span>
                                </span>
                                <Link
                                  href={`/community/all/${post.id}`}
                                  className="mt-1 block text-sm font-black text-gray-900 hover:text-[#0058FF]"
                                >
                                  {post.title}
                                </Link>
                              </div>
                            ))
                          ) : (
                            <div className="py-8 text-center text-xs font-medium text-gray-500">
                              {memberLikedPostsInfinite.isPending
                                ? "좋아요한 게시글을 불러오는 중입니다."
                                : "좋아요를 누른 게시글이 없습니다."}
                            </div>
                          )}
                        </div>
                      )}

                      {communityTab === "liked-replies" && (
                        <div className="space-y-3">
                          {liveLikedComments && liveLikedComments.length > 0 ? (
                            liveLikedComments.map(comment => (
                              <div
                                key={comment.id}
                                className="rounded-xl border border-gray-200 p-4 text-xs"
                              >
                                <span className="inline-flex items-center gap-1 font-bold text-gray-700">
                                  <V1IconHeart className="h-3.5 w-3.5" />
                                  <span>좋아요 표시한 댓글</span>
                                </span>
                                <Link
                                  href={`/community/all/${comment.postId}`}
                                  className="mt-1 block font-bold text-gray-900 hover:text-[#0058FF]"
                                >
                                  “{comment.content}”
                                </Link>
                                <p className="mt-0.5 text-gray-400">원문: {comment.postTitle}</p>
                              </div>
                            ))
                          ) : (
                            <div className="py-8 text-center text-xs font-medium text-gray-500">
                              {memberLikedCommentsInfinite.isPending
                                ? "좋아요한 댓글을 불러오는 중입니다."
                                : "좋아요를 누른 댓글이 없습니다."}
                            </div>
                          )}
                        </div>
                      )}

                      {isOwner && communityTab === "reports" && (
                        <div className="space-y-3">
                          {liveReports && liveReports.length > 0 ? (
                            liveReports.map(item => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between rounded-xl border border-gray-200 p-4 text-xs"
                              >
                                <div>
                                  <span className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">
                                    {item.targetType === "POST" ? "게시글" : "댓글"} 신고 · 접수완료
                                  </span>
                                  <p className="mt-1.5 font-bold text-gray-900">{item.title}</p>
                                  <p className="mt-0.5 text-gray-500">
                                    사유: {item.reasonDescription}
                                  </p>
                                </div>
                                <V1Button
                                  variant="white"
                                  size="xs"
                                  disabled={cancelReportMutation.isPending}
                                  onClick={() =>
                                    cancelReportMutation.mutate({
                                      targetType: item.targetType,
                                      targetId: item.targetId,
                                    })
                                  }
                                >
                                  신고 취소
                                </V1Button>
                              </div>
                            ))
                          ) : (
                            <div className="py-8 text-center text-xs font-medium text-gray-500">
                              내가 접수한 신고 내역이 없습니다.
                            </div>
                          )}
                        </div>
                      )}

                      {/* 커서 기반 무한스크롤 센티넬 & 더 보기 버튼 */}
                      <div
                        ref={communitySentinelRef}
                        data-infinite-scroll="public-member-community-sentinel"
                        className="mt-4 flex flex-col items-center justify-center gap-2"
                      >
                        {activeCommunityInfinite.hasNextPage && (
                          <V1Button
                            variant="white"
                            size="xs"
                            disabled={activeCommunityInfinite.isFetchingNextPage}
                            onClick={() => void activeCommunityInfinite.fetchNextPage()}
                          >
                            {activeCommunityInfinite.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
                          </V1Button>
                        )}
                      </div>
                    </V1FolderTabs>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </MemberShell>
  );
}
