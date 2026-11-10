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
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) return `${trimmed} USDT`;
  if (trimmed === "0" || trimmed === "0.00") return "0.00 USDT";
  return `+${trimmed} USDT`;
}

function formatSignedPct(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
    return trimmed.endsWith("%") ? trimmed : `${trimmed}%`;
  }
  if (trimmed === "0" || trimmed === "0.00") return "0.00%";
  return `+${trimmed.endsWith("%") ? trimmed : `${trimmed}%`}`;
}

export function PublicMember({ memberId }: { memberId: number }) {
  const { origin, session, snapshot } = useMember();
  const client = useQueryClient();
  const tradingBase = process.env.NEXT_PUBLIC_TRADING_API_BASE_URL ?? "http://localhost:8081";

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
    queryFn: async ({ signal }) => {
      const value = parseProfile(await contentJson(origin, `/members/${memberId}`, { signal }));
      if (value.memberId !== memberId) throw new ContentApiError(422);
      return value;
    },
  });

  const summary = useQuery({
    queryKey: ["member", "relationship", memberId, ...identity],
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
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ size: "10", keyword });
      if (pageParam) params.set("cursorId", String(pageParam));
      const page = parseFollowPage(
        await contentJson(origin, `/members/${memberId}/${kind}?${params}`, { signal }),
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
    enabled: memberId > 0,
    queryFn: async ({ signal }) =>
      parsePublicMemberPortfolio(
        await tradingJson(tradingBase, `portfolios/members/${memberId}`, { signal }),
      ),
  });

  const isOwner =
    snapshot.phase === "ready" && Boolean(summary.data?.mine || snapshot.memberId === memberId);

  // [C-6] 커뮤니티활동 커서 기반 무한스크롤 (게시글, 댓글, 좋아요, 좋아요 댓글 전체 공개 / 신고내역 본인 전용)
  const memberPostsInfinite = useInfiniteQuery({
    queryKey: ["member", "public-community-posts", memberId, snapshot.generation],
    enabled: memberId > 0,
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
    enabled: memberId > 0,
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
    enabled: memberId > 0,
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
    enabled: memberId > 0,
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
    enabled: isOwner,
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

  const livePortfolio =
    publicPortfolioQuery.data && publicPortfolioQuery.data.accountExists
      ? publicPortfolioQuery.data
      : null;

  const assetSummary = livePortfolio
    ? {
        title: `${displayNickname}님의 모의투자`,
        totalAsset: `${livePortfolio.wallet.totalEquity} USDT`,
        cashBalance: `${livePortfolio.wallet.availableBalance} USDT`,
        totalBuyAmount: `${livePortfolio.wallet.usedMargin} USDT`,
        totalCoinValue: `${livePortfolio.wallet.balance} USDT`,
        totalProfit: formatSignedUsdt(livePortfolio.wallet.totalPnl),
        totalRoi: formatSignedPct(livePortfolio.wallet.totalRoiPct),
        isPositive: !livePortfolio.wallet.totalPnl.trim().startsWith("-"),
        unit: "USDT",
      }
    : {
        title: `${displayNickname}님의 모의투자`,
        totalAsset: "10,840.00 USDT",
        cashBalance: "5,240.00 USDT",
        totalBuyAmount: "5,600.00 USDT",
        totalCoinValue: "6,440.00 USDT",
        totalProfit: "+840.00 USDT",
        totalRoi: "+8.40%",
        isPositive: true,
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
          <div className="space-y-6 lg:col-span-4">
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
                    가입 {new Date(currentProfile.createdAt).toLocaleDateString("ko-KR")}
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
                      disabled={pending || !summary.data || summary.isFetching || summary.isError}
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
          <div className="space-y-6 lg:col-span-8">
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

              const longRatioPct = livePortfolio ? livePortfolio.allocation.longRatioPct : "75";
              const shortRatioPct = livePortfolio ? livePortfolio.allocation.shortRatioPct : "25";

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
                        내 모의투자 자산 원장 ({ledgerTab})을 확인합니다. 상세 회차 초기화는{" "}
                        <Link href="/me" className="text-[#0058FF] underline">
                          마이페이지(/me)
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
                      <div className="py-6 text-xs font-bold text-gray-600">
                        {contestTab === "live"
                          ? "내 시즌별 대회 실시간 자산 내역을 확인합니다."
                          : "종료된 시즌의 대회 자산 및 정산 이력을 확인합니다."}
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
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                              <h3 className="text-sm font-black text-gray-900">포지션 증거금 비중 (%)</h3>
                              <p className="mt-2 text-xs text-gray-500">
                                {livePortfolio
                                  ? `사용 증거금 비중 ${livePortfolio.allocation.usedMarginRatioPct}% · 가용 USDT ${livePortfolio.allocation.availableCashRatioPct}%`
                                  : "BTCUSDT (65%) · ETHUSDT (35%) 중심으로 격리마진 운용 중입니다."}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-gray-100 bg-[#F9FAFB] p-5">
                              <h3 className="text-sm font-black text-gray-900">롱 / 숏 비율</h3>
                              <div className="mt-3 flex justify-between text-xs font-bold">
                                <span className="text-red-500">LONG {longRatioPct}%</span>
                                <span className="text-blue-600">SHORT {shortRatioPct}%</span>
                              </div>
                              <div className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-gray-200">
                                <div className="h-full bg-red-500" style={{ width: `${longRatioPct}%` }} />
                                <div className="h-full bg-blue-600" style={{ width: `${shortRatioPct}%` }} />
                              </div>
                            </div>
                          </div>

                          {livePortfolio && livePortfolio.positions.length > 0 && (
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
                                    <tr key={pos.id} className="hover:bg-gray-50">
                                      <td className="px-4 py-3 font-black text-gray-900">
                                        {pos.symbol} · {pos.leverage}x
                                      </td>
                                      <td className="px-4 py-3 font-bold">
                                        {pos.side}
                                      </td>
                                      <td className="px-4 py-3 text-right">{pos.quantity}</td>
                                      <td className="px-4 py-3 text-right">${pos.entryPrice}</td>
                                      <td className="px-4 py-3 text-right">${pos.markPrice}</td>
                                      <td className="px-4 py-3 text-right font-black text-red-500">
                                        {formatSignedUsdt(pos.unrealizedPnl)} (
                                        {formatSignedPct(pos.roePct)})
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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
                                  <span>{post.createdAt}</span>
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
                              커뮤니티에서 작성한 공개 게시글을 확인합니다.
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
                              커뮤니티에서 작성한 공개 댓글을 확인합니다.
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
                              좋아요를 누른 게시글 목록을 확인합니다.
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
                              좋아요를 누른 댓글 목록을 확인합니다.
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
                              내가 접수한 신고 내역 및 처리 상태를 확인합니다.
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
