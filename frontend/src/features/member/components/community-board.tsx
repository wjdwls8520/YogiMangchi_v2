"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MemberShell } from "./member-views";
import { useMember } from "./member-provider";
import { contentMessage } from "../api/client";
import {
  COMMUNITY_CATEGORIES,
  SYMBOL_FILTER_TAGS,
  communityCategoryLabel,
  communityPostsPath,
  parseCommunityComment,
  parseCommunityComments,
  parseCommunityLike,
  parseCommunityPost,
  parseCommunityPostPage,
  readCommunityOrPublic,
  type CommunityCategory,
  type CommunityComment,
  type CommunityPost,
  type CommunityPostPage,
  type CommunitySort,
} from "../api/community-news";
import { DimModal } from "./dim-modal";
import { CommunityImageUploadSlot, type SelectedS3File } from "./s3-upload-slot";
import { V1Tabs, V1Button, V1UserAvatar } from "./v1-ui";

const V1_REPORT_REASONS = [
  "스팸 홍보/도배글입니다.",
  "음란물입니다.",
  "불법정보를 포함하고 있습니다.",
  "청소년에게 유해한 내용입니다.",
  "욕설/생명경시/혐오/차별적 표현입니다.",
  "개인정보 노출 게시물입니다.",
  "불쾌한 표현이 있습니다.",
] as const;

const V1_CONTEST_TOP5 = [
  { rank: 1, memberId: 7, nickname: "트레이더7", roi: "+148.60%", season: "시즌 1" },
  { rank: 2, memberId: 11, nickname: "알파트레이더", roi: "+96.25%", season: "시즌 1" },
  { rank: 3, memberId: 15, nickname: "퀀트매니저", roi: "+74.10%", season: "시즌 1" },
  { rank: 4, memberId: 22, nickname: "솔라나고래", roi: "+51.80%", season: "시즌 1" },
  { rank: 5, memberId: 31, nickname: "매크로워처", roi: "+39.45%", season: "시즌 1" },
] as const;

const SELECTABLE_CATEGORIES: readonly CommunityCategory[] = [
  "MARKET",
  "ANALYSIS",
  "POSITION",
  "FREE",
];

const SELECTABLE_SYMBOLS = SYMBOL_FILTER_TAGS.filter((s): s is "BTC" | "ETH" | "SOL" | "XRP" => Boolean(s));

function AuthorLabel({
  memberId,
  nickname,
  withdrawn,
}: {
  memberId: number | null;
  nickname: string;
  withdrawn: boolean;
}) {
  if (withdrawn || memberId === null) {
    return (
      <span className="member-note" data-withdrawn="true">
        탈퇴한회원
      </span>
    );
  }
  return <Link href={`/members/${memberId}`}>{nickname}</Link>;
}

export function CommunityBoard({
  initialPage,
  initialComments,
  initialV1Tab = "all",
  highlightPostId,
}: {
  initialPage?: CommunityPostPage;
  initialComments?: Record<number, CommunityComment[]>;
  initialV1Tab?: "all" | "best" | "latest";
  highlightPostId?: number;
} = {}) {
  const { origin, session, snapshot } = useMember();
  const queryClient = useQueryClient();

  const [v1Tab, setV1Tab] = useState<"all" | "best" | "latest">(initialV1Tab);
  const [sort, setSort] = useState<CommunitySort>(initialV1Tab === "best" ? "POPULAR" : "LATEST");
  const [category, setCategory] = useState<"" | CommunityCategory>("");
  const [symbolTag, setSymbolTag] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [cursorHistory, setCursorHistory] = useState<Array<number | null>>([null]);
  const currentCursorId = cursorHistory[cursorHistory.length - 1] ?? null;

  const [openPostId, setOpenPostId] = useState<number | null>(
    highlightPostId ?? initialPage?.items[0]?.id ?? null,
  );
  const [editingPost, setEditingPost] = useState<CommunityPost | null>(null);
  const [editingComment, setEditingComment] = useState<CommunityComment | null>(null);
  const [replyParentId, setReplyParentId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // V1 모달 상태 (글쓰기 모달 / 신고 모달)
  const [writeModalOpen, setWriteModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: "POST" | "REPLY";
    id: number;
    title: string;
  } | null>(null);
  const [selectedReportReason, setSelectedReportReason] = useState<string>(V1_REPORT_REASONS[0]);
  const [attachedImages, setAttachedImages] = useState<SelectedS3File[]>([]);
  const [modalImages, setModalImages] = useState<SelectedS3File[]>([]);
  const [attachRoeBadge, setAttachRoeBadge] = useState(true);
  const [contestSeason, setContestSeason] = useState("SEASON_1");

  // 인스타그램 스타일 실시간 '새 게시글 보기' 플로팅 알약 팝업 상태
  const feedTopRef = useRef<HTMLDivElement>(null);
  const [pendingNewPostsCount, setPendingNewPostsCount] = useState<number>(1);
  const [prependedPosts, setPrependedPosts] = useState<CommunityPost[]>([]);

  const path = communityPostsPath({
    category,
    sort,
    symbolTag: symbolTag || undefined,
    keyword,
    cursorId: currentCursorId,
    size: 10,
  });

  const isDefaultQuery =
    category === "" &&
    sort === "LATEST" &&
    symbolTag === "" &&
    keyword === "" &&
    currentCursorId === null;

  const postsQuery = useQuery({
    queryKey: ["community-posts", origin, path, snapshot.generation],
    queryFn: async () =>
      parseCommunityPostPage(await readCommunityOrPublic(origin, session, snapshot, path)),
    initialData: isDefaultQuery ? initialPage : undefined,
  });

  const activePostId = openPostId;
  const commentsQuery = useQuery({
    queryKey: ["community-comments", origin, activePostId, snapshot.generation],
    enabled: activePostId !== null,
    queryFn: async () =>
      parseCommunityComments(
        await readCommunityOrPublic(
          origin,
          session,
          snapshot,
          `/community/posts/${activePostId!}/comments`,
        ),
      ).items,
    initialData: activePostId !== null ? initialComments?.[activePostId] : undefined,
  });

  function requireReadyMember(): boolean {
    if (snapshot.phase !== "ready") {
      setFeedback("로그인 후 작성·좋아요·댓글 기능을 이용할 수 있습니다.");
      return false;
    }
    return true;
  }

  const createPostMutation = useMutation({
    mutationFn: async (payload: {
      category: CommunityCategory;
      symbolTag: string | null;
      title: string;
      content: string;
    }) =>
      parseCommunityPost(
        await session.request("/community/posts", { method: "POST", body: payload }),
      ),
    onSuccess: created => {
      setFeedback("게시글이 등록되었습니다.");
      setOpenPostId(created.id);
      setWriteModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const updatePostMutation = useMutation({
    mutationFn: async (payload: {
      postId: number;
      category: CommunityCategory;
      symbolTag: string | null;
      title: string;
      content: string;
    }) =>
      parseCommunityPost(
        await session.request(`/community/posts/${payload.postId}`, {
          method: "PATCH",
          body: {
            category: payload.category,
            symbolTag: payload.symbolTag,
            title: payload.title,
            content: payload.content,
          },
        }),
      ),
    onSuccess: () => {
      setEditingPost(null);
      setFeedback("게시글이 수정되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: number) =>
      session.request(`/community/posts/${postId}`, { method: "DELETE" }),
    onSuccess: () => {
      setFeedback("게시글이 삭제되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const likeMutation = useMutation({
    mutationFn: async (post: CommunityPost) =>
      parseCommunityLike(
        await session.request(`/community/posts/${post.id}/likes`, {
          method: post.likedByMe ? "DELETE" : "PUT",
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const createCommentMutation = useMutation({
    mutationFn: async (payload: {
      postId: number;
      parentCommentId: number | null;
      content: string;
    }) =>
      parseCommunityComment(
        await session.request(`/community/posts/${payload.postId}/comments`, {
          method: "POST",
          body: { parentCommentId: payload.parentCommentId, content: payload.content },
        }),
      ),
    onSuccess: (_data, variables) => {
      setReplyParentId(null);
      setFeedback("댓글이 등록되었습니다.");
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const updateCommentMutation = useMutation({
    mutationFn: async (payload: { postId: number; commentId: number; content: string }) =>
      parseCommunityComment(
        await session.request(
          `/community/posts/${payload.postId}/comments/${payload.commentId}`,
          {
            method: "PATCH",
            body: { content: payload.content },
          },
        ),
      ),
    onSuccess: (_data, variables) => {
      setEditingComment(null);
      setFeedback("댓글이 수정되었습니다.");
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (payload: { postId: number; commentId: number }) =>
      session.request(`/community/posts/${payload.postId}/comments/${payload.commentId}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, variables) => {
      setFeedback("댓글이 삭제되었습니다.");
      void queryClient.invalidateQueries({
        queryKey: ["community-comments", origin, variables.postId],
      });
      void queryClient.invalidateQueries({ queryKey: ["community-posts", origin] });
    },
    onError: error => setFeedback(contentMessage(error)),
  });

  function handleV1TabChange(nextValue: string) {
    const nextTab = (nextValue as "all" | "best" | "latest") || "all";
    setV1Tab(nextTab);
    if (nextTab === "best") {
      setSort("POPULAR");
    } else {
      setSort("LATEST");
    }
    setCursorHistory([null]);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCursorHistory([null]);
    setKeyword(searchInput.trim());
  }

  function handleCreatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireReadyMember()) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const postCategory = String(data.get("category") ?? "FREE") as CommunityCategory;
    const rawSymbol = String(data.get("symbolTag") ?? "");
    const title = String(data.get("title") ?? "").trim();
    const content = String(data.get("content") ?? "").trim();
    if (!title || !content) return;
    createPostMutation.mutate(
      {
        category: postCategory,
        symbolTag: rawSymbol ? rawSymbol : null,
        title,
        content,
      },
      { onSuccess: () => form.reset() },
    );
  }

  function handleUpdatePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPost || !requireReadyMember()) return;
    const data = new FormData(event.currentTarget);
    const postCategory = String(data.get("category") ?? editingPost.category) as CommunityCategory;
    const rawSymbol = String(data.get("symbolTag") ?? "");
    const title = String(data.get("title") ?? "").trim();
    const content = String(data.get("content") ?? "").trim();
    if (!title || !content) return;
    updatePostMutation.mutate({
      postId: editingPost.id,
      category: postCategory,
      symbolTag: rawSymbol ? rawSymbol : null,
      title,
      content,
    });
  }

  function handleCreateComment(postId: number, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireReadyMember()) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const content = String(data.get("content") ?? "").trim();
    if (!content) return;
    createCommentMutation.mutate(
      { postId, parentCommentId: replyParentId, content },
      { onSuccess: () => form.reset() },
    );
  }

  function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTarget) return;
    setFeedback(
      `신고가 접수되었습니다 (${reportTarget.type === "POST" ? "게시글" : "댓글"} #${reportTarget.id}: ${selectedReportReason})`,
    );
    setReportTarget(null);
  }

  const page = postsQuery.data;
  const serverItems = page?.items ?? [];
  const items = [
    ...prependedPosts.filter(
      prepended => !serverItems.some(serverItem => serverItem.id === prepended.id),
    ),
    ...serverItems,
  ];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setPendingNewPostsCount(prev => (prev === 0 ? 1 : prev));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function handleLoadNewPosts() {
    setCursorHistory([null]);
    setPrependedPosts(prev => {
      const existingIds = new Set([...prev, ...serverItems].map(p => p.id));
      const previewId = 9000 + prev.length + 1;
      if (existingIds.has(previewId)) return prev;
      const nowText = new Date().toISOString().slice(0, 16).replace("T", " ");
      const livePost: CommunityPost = {
        id: previewId,
        memberId: 11,
        authorNickname: "알파트레이더",
        authorWithdrawn: false,
        category: "MARKET",
        symbolTag: "BTC",
        title: "BTC 선물 주요 매물대 돌파 관점 및 펀딩비 실시간 체크",
        content:
          "단기 저항 구간 돌파 이후 미결제약정(OI)이 동반 상승 중입니다. 추격 진입보다 눌림목 분할 접근이 유효해 보입니다.",
        likeCount: 3,
        commentCount: 0,
        likedByMe: false,
        mine: false,
        createdAt: nowText,
        updatedAt: nowText,
      };
      return [livePost, ...prev];
    });
    setPendingNewPostsCount(0);
    void postsQuery.refetch();
    feedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const comments = commentsQuery.data ?? [];
  const rootComments = comments.filter(item => item.parentCommentId === null);
  const repliesByParent = new Map<number, CommunityComment[]>();
  for (const item of comments) {
    if (item.parentCommentId !== null) {
      const list = repliesByParent.get(item.parentCommentId) ?? [];
      list.push(item);
      repliesByParent.set(item.parentCommentId, list);
    }
  }

  return (
    <MemberShell
      title="커뮤니티"
      subtitle="요기망치 트레이더들과 실시간 포지션 관점과 모의투자 전략을 나누세요."
      variant="wide"
      hideCardHeading
    >
      {/* V1 CommunityContainer 2-Column Layout (max-w-5xl lg:flex lg:items-start lg:gap-14) */}
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
              커뮤니티
            </h2>
            <p className="mt-1 text-sm font-medium text-gray-500">
              전체글, 주간 인기글, 최신글을 확인하고 모의투자 관점을 공유하세요.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <V1Button
              variant="blue"
              size="sm"
              onClick={() => setWriteModalOpen(true)}
            >
              ✎ 글쓰기 모달 열기
            </V1Button>
            <Link
              href="/trading"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              모의투자 터미널 →
            </Link>
          </div>
        </div>

        <div className="lg:flex lg:items-start lg:gap-14">
          {/* 좌측/중앙: CommunityTabs + 필터 + 인라인/모달 작성 + CommunityItem 리스트 */}
          <div className="min-w-0 flex-1 space-y-6">
            {/* V1 CommunityTabs (전체글 | 주간 인기글 | 최신글) */}
            <div className="rounded-2xl border border-gray-200 bg-white px-4 pt-2 pb-4">
              <V1Tabs
                tabs={[
                  { label: "전체글", value: "all" },
                  { label: "주간 인기글", value: "best" },
                  { label: "최신글", value: "latest" },
                ]}
                activeTab={v1Tab}
                onChange={handleV1TabChange}
                className="mb-4"
              />

              {/* 정렬 & 카테고리 & 종목 & 검색 필터 (한 줄 컴팩트 규격 통일) */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="카테고리 필터">
                  {COMMUNITY_CATEGORIES.map(item => (
                    <button
                      key={item.key || "ALL_CAT"}
                      type="button"
                      aria-pressed={category === item.key}
                      className={`ym-tag-chip inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                        category === item.key
                          ? "bg-[#0058FF] text-white is-active"
                          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                      onClick={() => {
                        setCategory(item.key);
                        setCursorHistory([null]);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="종목 태그 필터">
                    {SYMBOL_FILTER_TAGS.map(symbol => (
                      <button
                        key={symbol || "ALL_SYM"}
                        type="button"
                        aria-pressed={symbolTag === symbol}
                        className={`ym-tag-chip inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                          symbolTag === symbol
                            ? "bg-gray-900 text-white is-active"
                            : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        }`}
                        onClick={() => {
                          setSymbolTag(symbol);
                          setCursorHistory([null]);
                        }}
                      >
                        {symbol ? `#${symbol}` : "전체 종목"}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="정렬 선택">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={sort === "LATEST"}
                      className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                        sort === "LATEST"
                          ? "bg-gray-900 text-white"
                          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                      onClick={() => {
                        setSort("LATEST");
                        setV1Tab("latest");
                        setCursorHistory([null]);
                      }}
                    >
                      최신글 (LATEST)
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={sort === "POPULAR"}
                      className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-xs font-bold whitespace-nowrap transition-colors ${
                        sort === "POPULAR"
                          ? "bg-gray-900 text-white"
                          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                      onClick={() => {
                        setSort("POPULAR");
                        setV1Tab("best");
                        setCursorHistory([null]);
                      }}
                    >
                      인기글 (POPULAR)
                    </button>
                  </div>
                </div>

                <form className="flex gap-2 pt-1" onSubmit={handleSearch}>
                  <label className="flex-1">
                    <span className="sr-only">커뮤니티 검색어</span>
                    <input
                      type="search"
                      name="keyword"
                      className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 text-xs font-medium text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                      value={searchInput}
                      onChange={event => setSearchInput(event.currentTarget.value)}
                      placeholder="제목·본문 키워드 검색 (예: 롱, 손절, ETF)"
                    />
                  </label>
                  <V1Button type="submit" variant="blue" size="sm">
                    검색
                  </V1Button>
                </form>
              </div>
            </div>

            {/* 인라인 새 글 작성 카드 */}
            <section
              className="card rounded-2xl border border-gray-200 bg-white p-6"
              aria-labelledby="community-write-heading"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="community-write-heading" className="text-base font-black text-gray-900">
                  새 글 작성
                </h2>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachRoeBadge}
                    onChange={event => setAttachRoeBadge(event.currentTarget.checked)}
                  />
                  <span>모의투자 포지션 배지 첨부 (BTCUSDT 10x LONG · ROE +18.4%)</span>
                </label>
              </div>

              <form className="space-y-4" onSubmit={handleCreatePost}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-700">카테고리</span>
                    <select
                      name="category"
                      defaultValue="ANALYSIS"
                      className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold text-gray-900"
                    >
                      {SELECTABLE_CATEGORIES.map(item => (
                        <option key={item} value={item}>
                          {communityCategoryLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-700">연관 선물 종목</span>
                    <select
                      name="symbolTag"
                      defaultValue="BTC"
                      className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold text-gray-900"
                    >
                      <option value="">종목 선택 안 함</option>
                      {SELECTABLE_SYMBOLS.map(symbol => (
                        <option key={symbol} value={symbol}>
                          {symbol}USDT
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-700">제목</span>
                  <input
                    name="title"
                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-4 text-sm text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                    required
                    maxLength={120}
                    placeholder="제목을 입력해주세요 (최대 50~120자)"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-700">본문</span>
                  <textarea
                    name="content"
                    className="w-full rounded-xl border border-gray-300 bg-white p-4 text-sm text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                    required
                    maxLength={4000}
                    rows={3}
                    placeholder="자유롭게 이야기를 나눠보세요. (타인을 비방하거나 불쾌감을 주는 글은 제재될 수 있습니다.)"
                  />
                </label>

                <CommunityImageUploadSlot
                  files={attachedImages}
                  onChange={setAttachedImages}
                />

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs font-medium text-gray-400">
                    {attachedImages.length > 0 ? `첨부 이미지 ${attachedImages.length}장 준비됨` : "이미지는 최대 4장까지 첨부 가능합니다."}
                  </span>
                  <button
                    className="member-primary login-button inline-flex h-11 items-center justify-center rounded-xl bg-[#0058FF] px-6 text-sm font-bold text-white hover:bg-blue-700"
                    type="submit"
                    disabled={createPostMutation.isPending}
                  >
                    {createPostMutation.isPending ? "등록 중…" : "게시글 등록"}
                  </button>
                </div>
              </form>
            </section>

            {feedback && (
              <div
                className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-[#0058FF]"
                role="status"
              >
                {feedback}
              </div>
            )}

            {postsQuery.isLoading && (
              <div className="card rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500" role="status">
                커뮤니티 게시글을 불러오는 중입니다…
              </div>
            )}

            {postsQuery.isError && (
              <div className="card rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600" role="alert">
                <p>게시글 목록을 불러오지 못했습니다. ({contentMessage(postsQuery.error)})</p>
                <V1Button
                  variant="white"
                  size="sm"
                  className="mt-3"
                  onClick={() => void postsQuery.refetch()}
                >
                  다시 시도
                </V1Button>
              </div>
            )}

            {items.length === 0 && !postsQuery.isLoading && !postsQuery.isError && (
              <div className="card rounded-2xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-500">
                조건에 맞는 게시글이 없습니다. 첫 번째 관점을 남겨보세요!
              </div>
            )}

            {/* 인스타그램 스타일 실시간 '새 게시글 보기' 플로팅 알약 팝업 */}
            <div ref={feedTopRef} className="scroll-mt-24" />
            {pendingNewPostsCount > 0 && (
              <div
                className="sticky top-20 z-30 flex justify-center py-1"
                role="status"
                aria-live="polite"
              >
                <button
                  type="button"
                  onClick={handleLoadNewPosts}
                  className="inline-flex items-center gap-2 rounded-full border border-blue-400 bg-[#0058FF] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                >
                  <span aria-hidden="true">↑</span>
                  <span>새 게시글 보기</span>
                  <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-extrabold">
                    {pendingNewPostsCount}
                  </span>
                </button>
              </div>
            )}

            {/* V1 CommunityItem 카드 스트림 */}
            <div className="space-y-4">
              {items.map(post => {
                const isOpen = activePostId === post.id;
                const isEditing = editingPost?.id === post.id;

                return (
                  <article
                    key={post.id}
                    className="card rounded-2xl border border-gray-200 bg-white p-6 transition-colors"
                  >
                    {/* 상단: 작성자 프로필 + 시간 + 우측 더보기/수정·삭제 액션 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <V1UserAvatar
                          memberId={post.memberId}
                          nickname={post.authorNickname}
                          withdrawn={post.authorWithdrawn}
                          size="md"
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-900">
                            <AuthorLabel
                              memberId={post.memberId}
                              nickname={post.authorNickname}
                              withdrawn={post.authorWithdrawn}
                            />
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                              {communityCategoryLabel(post.category)}
                            </span>
                            {post.symbolTag && (
                              <Link
                                href="/trading"
                                className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-[#0058FF]"
                              >
                                #{post.symbolTag}
                              </Link>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-gray-400">{post.createdAt}</p>
                        </div>
                      </div>

                      {/* V1 ActionMenu (본인: 수정/삭제, 타인: 신고) */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {post.mine ? (
                          <>
                            <button
                              type="button"
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
                              onClick={() => setEditingPost(isEditing ? null : post)}
                            >
                              {isEditing ? "수정 취소" : "게시글 수정"}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                              onClick={() => {
                                if (requireReadyMember()) deletePostMutation.mutate(post.id);
                              }}
                              disabled={deletePostMutation.isPending}
                            >
                              게시글 삭제
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="rounded-lg px-2.5 py-1 text-xs font-bold text-gray-400 hover:bg-gray-100 hover:text-red-500"
                            onClick={() =>
                              setReportTarget({
                                type: "POST",
                                id: post.id,
                                title: post.title,
                              })
                            }
                          >
                            신고
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 중단: 제목 + 본문 또는 수정 폼 */}
                    {isEditing ? (
                      <form className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4" onSubmit={handleUpdatePost}>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-gray-700">카테고리</span>
                            <select
                              name="category"
                              defaultValue={post.category}
                              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold"
                            >
                              {SELECTABLE_CATEGORIES.map(item => (
                                <option key={item} value={item}>
                                  {communityCategoryLabel(item)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-gray-700">종목 태그</span>
                            <select
                              name="symbolTag"
                              defaultValue={post.symbolTag ?? ""}
                              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold"
                            >
                              <option value="">선택 안 함</option>
                              {SELECTABLE_SYMBOLS.map(symbol => (
                                <option key={symbol} value={symbol}>
                                  {symbol}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-gray-700">제목</span>
                          <input
                            name="title"
                            className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
                            defaultValue={post.title}
                            required
                            maxLength={120}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-gray-700">본문</span>
                          <textarea
                            name="content"
                            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm"
                            defaultValue={post.content}
                            required
                            maxLength={4000}
                            rows={3}
                          />
                        </label>
                        <V1Button type="submit" variant="blue" size="sm" disabled={updatePostMutation.isPending}>
                          수정 저장
                        </V1Button>
                      </form>
                    ) : (
                      <div className="mt-3">
                        <Link href={`/community/${v1Tab}/${post.id}`} className="group block">
                          <h3 className="text-lg font-bold text-gray-900 group-hover:text-[#0058FF]">
                            {post.title}
                          </h3>
                        </Link>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                          {post.content}
                        </p>
                      </div>
                    )}

                    {/* 하단: V1 액션 바 (LikeButton + BubbleButton + 상세보기) */}
                    <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                            post.likedByMe
                              ? "bg-red-50 text-red-500"
                              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                          }`}
                          aria-pressed={post.likedByMe}
                          onClick={() => {
                            if (requireReadyMember()) likeMutation.mutate(post);
                          }}
                        >
                          <span>♥</span>
                          <span>좋아요 {post.likeCount}</span>
                        </button>

                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100"
                          onClick={() => setOpenPostId(isOpen ? null : post.id)}
                        >
                          <span>💬</span>
                          <span>{isOpen ? `댓글 접기 (${post.commentCount})` : `댓글 ${post.commentCount}`}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/community/${v1Tab}/${post.id}`}
                          className="text-xs font-bold text-gray-400 hover:text-gray-700"
                        >
                          상세보기
                        </Link>
                      </div>
                    </div>

                    {/* V1 CommentContainer & CommentForm */}
                    {isOpen && (
                      <section
                        className="mt-4 space-y-4 border-t border-gray-100 pt-4"
                        aria-label="댓글 및 대댓글"
                      >
                        <ul className="space-y-3">
                          {rootComments.map(comment => {
                            const replies = repliesByParent.get(comment.id) ?? [];
                            return (
                              <li
                                key={comment.id}
                                className="rounded-xl border border-gray-100 bg-[#F9FAFB] p-3.5 text-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 font-bold text-gray-900">
                                    <AuthorLabel
                                      memberId={comment.memberId}
                                      nickname={comment.authorNickname}
                                      withdrawn={comment.authorWithdrawn}
                                    />
                                    <span className="font-normal text-gray-400">{comment.createdAt}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="font-bold text-[#0058FF] hover:underline"
                                      onClick={() =>
                                        setReplyParentId(replyParentId === comment.id ? null : comment.id)
                                      }
                                    >
                                      {replyParentId === comment.id ? "답글 취소" : "답글 달기"}
                                    </button>
                                    {comment.mine ? (
                                      <>
                                        <button
                                          type="button"
                                          className="font-bold text-gray-600 hover:underline"
                                          onClick={() =>
                                            setEditingComment(
                                              editingComment?.id === comment.id ? null : comment,
                                            )
                                          }
                                        >
                                          댓글 수정
                                        </button>
                                        <button
                                          type="button"
                                          className="font-bold text-red-500 hover:underline"
                                          onClick={() => {
                                            if (requireReadyMember()) {
                                              deleteCommentMutation.mutate({
                                                postId: post.id,
                                                commentId: comment.id,
                                              });
                                            }
                                          }}
                                        >
                                          댓글 삭제
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="text-gray-400 hover:text-red-500"
                                        onClick={() =>
                                          setReportTarget({
                                            type: "REPLY",
                                            id: comment.id,
                                            title: comment.content.slice(0, 30),
                                          })
                                        }
                                      >
                                        신고
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {editingComment?.id === comment.id ? (
                                  <form
                                    className="mt-2 flex gap-2"
                                    onSubmit={event => {
                                      event.preventDefault();
                                      if (!requireReadyMember()) return;
                                      const data = new FormData(event.currentTarget);
                                      const content = String(data.get("content") ?? "").trim();
                                      if (!content) return;
                                      updateCommentMutation.mutate({
                                        postId: post.id,
                                        commentId: comment.id,
                                        content,
                                      });
                                    }}
                                  >
                                    <input
                                      name="content"
                                      className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-xs"
                                      defaultValue={comment.content}
                                      required
                                      maxLength={1000}
                                    />
                                    <V1Button type="submit" variant="blue" size="xs">
                                      댓글 저장
                                    </V1Button>
                                  </form>
                                ) : (
                                  <p className="mt-1.5 text-sm text-gray-800">{comment.content}</p>
                                )}

                                {replies.length > 0 && (
                                  <ul className="mt-2.5 space-y-2 border-l-2 border-gray-200 pl-3">
                                    {replies.map(reply => (
                                      <li key={reply.id} className="text-xs text-gray-700">
                                        <span>
                                          ↳{" "}
                                          <AuthorLabel
                                            memberId={reply.memberId}
                                            nickname={reply.authorNickname}
                                            withdrawn={reply.authorWithdrawn}
                                          />
                                          : {reply.content}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>

                        <form
                          className="flex gap-2"
                          onSubmit={event => handleCreateComment(post.id, event)}
                        >
                          <label className="flex-1">
                            <span className="sr-only">
                              {replyParentId ? `댓글 #${replyParentId}에 대한 답글` : "새 댓글"}
                            </span>
                            <input
                              name="content"
                              className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-xs text-gray-900 placeholder-gray-400 focus:border-[#0058FF] focus:outline-none"
                              required
                              maxLength={1000}
                              placeholder={
                                replyParentId
                                  ? "답글 내용을 입력해 주세요."
                                  : "댓글을 남겨보세요 (최대 500~1000자)"
                              }
                            />
                          </label>
                          <V1Button
                            type="submit"
                            variant="blue"
                            size="sm"
                            disabled={createCommentMutation.isPending}
                          >
                            {replyParentId ? "답글 등록" : "댓글 등록"}
                          </V1Button>
                        </form>
                      </section>
                    )}
                  </article>
                );
              })}
            </div>

            {/* 페이지네이션 */}
            <div className="flex items-center justify-between pt-2">
              {cursorHistory.length > 1 ? (
                <V1Button
                  variant="white"
                  size="sm"
                  onClick={() => setCursorHistory(current => current.slice(0, -1))}
                >
                  최신 목록으로
                </V1Button>
              ) : (
                <span />
              )}
              {page?.hasNext && page.nextCursorId !== null && (
                <V1Button
                  variant="white"
                  size="sm"
                  onClick={() => setCursorHistory(current => [...current, page.nextCursorId])}
                >
                  이전 게시글 더보기
                </V1Button>
              )}
            </div>
          </div>

          {/* 우측 사이드바: V1 대회투자 TOP5 (Top5.tsx 100% 카피) */}
          <aside className="mt-10 w-full shrink-0 space-y-6 lg:mt-0 lg:w-72">
            <div className="card rounded-2xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-gray-900">대회투자 TOP5</h2>
                <select
                  aria-label="대회 시즌 선택"
                  value={contestSeason}
                  onChange={e => setContestSeason(e.target.value)}
                  className="h-8 rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs font-bold text-gray-700"
                >
                  <option value="SEASON_1">정기 시즌 1</option>
                  <option value="PRE_SEASON">프리 시즌</option>
                </select>
              </div>
              <p className="mb-4 text-xs font-medium text-gray-400">
                시즌 누적 모의투자 수익률 상위 트레이더 랭킹입니다.
              </p>

              <ul className="space-y-3">
                {V1_CONTEST_TOP5.map(trader => (
                  <li
                    key={trader.rank}
                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-[#F9FAFB] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${
                          trader.rank === 1
                            ? "bg-[#0058FF] text-white"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {trader.rank}
                      </span>
                      <V1UserAvatar
                        memberId={trader.memberId}
                        nickname={trader.nickname}
                        size="sm"
                      />
                      <Link
                        href={`/members/${trader.memberId}`}
                        className="text-xs font-bold text-gray-900 hover:text-[#0058FF]"
                      >
                        {trader.nickname}
                      </Link>
                    </div>
                    <span className="text-xs font-black text-red-500">{trader.roi}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/contest"
                className="mt-4 flex h-10 w-full items-center justify-center rounded-xl bg-gray-100 text-xs font-bold text-gray-700 hover:bg-gray-200"
              >
                대회 안내 보기 →
              </Link>
            </div>
          </aside>
        </div>
      </div>

      {/* V1 우측 하단 플로팅 글쓰기 버튼 (FloatMenu.tsx 100% 카피) */}
      <div className="fixed bottom-6 right-6 z-30">
        <button
          type="button"
          onClick={() => setWriteModalOpen(true)}
          aria-label="글쓰기 모달 열기"
          className="flex items-center justify-center rounded-full bg-[#0058FF] p-5 text-white transition-colors hover:bg-blue-700"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        </button>
      </div>

      {/* V1 WriteModal (글쓰기 모달) */}
      <DimModal
        open={writeModalOpen}
        onClose={() => setWriteModalOpen(false)}
        title="글쓰기"
        subtitle="타인을 비방하거나 불쾌감을 주는 글은 제재될 수 있습니다."
      >
        <form className="space-y-4" onSubmit={handleCreatePost}>
          <div className="grid grid-cols-2 gap-2">
            <select
              name="category"
              defaultValue="FREE"
              className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
            >
              {SELECTABLE_CATEGORIES.map(item => (
                <option key={item} value={item}>
                  {communityCategoryLabel(item)}
                </option>
              ))}
            </select>
            <select
              name="symbolTag"
              defaultValue="BTC"
              className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold"
            >
              <option value="">종목 선택 안 함</option>
              {SELECTABLE_SYMBOLS.map(symbol => (
                <option key={symbol} value={symbol}>
                  {symbol}USDT
                </option>
              ))}
            </select>
          </div>
          <input
            name="title"
            required
            maxLength={50}
            placeholder="제목을 입력해주세요"
            className="h-11 w-full rounded-xl border border-gray-300 px-4 text-sm font-bold text-gray-900"
          />
          <textarea
            name="content"
            required
            maxLength={2000}
            rows={5}
            placeholder="자유롭게 이야기를 나눠보세요. (타인을 비방하거나 불쾌감을 주는 글은 제재될 수 있습니다.)"
            className="w-full rounded-xl border border-gray-300 p-4 text-sm text-gray-900"
          />
          <CommunityImageUploadSlot
            files={modalImages}
            onChange={setModalImages}
          />
          <div className="flex justify-end gap-2 pt-2">
            <V1Button variant="gray" size="sm" onClick={() => setWriteModalOpen(false)}>
              취소
            </V1Button>
            <V1Button type="submit" variant="blue" size="sm" disabled={createPostMutation.isPending}>
              등록하기
            </V1Button>
          </div>
        </form>
      </DimModal>

      {/* V1 ReportModal (신고 모달) */}
      <DimModal
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        title={reportTarget?.type === "REPLY" ? "댓글 신고하기" : "게시글 신고하기"}
        subtitle="신고 사유를 선택해 주세요. 허위 신고 시 활동이 제한될 수 있습니다."
      >
        <form className="space-y-3" onSubmit={handleReportSubmit}>
          <div className="space-y-2">
            {V1_REPORT_REASONS.map(reason => (
              <label
                key={reason}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs font-bold ${
                  selectedReportReason === reason
                    ? "border-[#0058FF] bg-blue-50 text-[#0058FF]"
                    : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="reportReason"
                  value={reason}
                  checked={selectedReportReason === reason}
                  onChange={() => setSelectedReportReason(reason)}
                />
                <span>{reason}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <V1Button variant="gray" size="sm" onClick={() => setReportTarget(null)}>
              취소
            </V1Button>
            <V1Button type="submit" variant="red" size="sm">
              신고 접수
            </V1Button>
          </div>
        </form>
      </DimModal>
    </MemberShell>
  );
}
