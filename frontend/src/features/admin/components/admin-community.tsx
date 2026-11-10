"use client";

import { useEffect, useState } from "react";
import { DimModal } from "../../member/components/dim-modal";
import { useOptionalMember } from "../../member/components/member-provider";
import {
  cn,
  V1IconComment,
} from "../../member/components/v1-ui";
import {
  deleteAdminCommunityPost,
  deleteAdminCommunityReply,
  fetchAdminCommunityPosts,
  fetchAdminCommunityReplies,
  formatAdminDateTime,
  type AdminPostDto,
  type AdminReplyDto,
} from "../api/admin-api";
import { AdminShell } from "./admin-layout";

export function AdminCommunity() {
  const memberCtx = useOptionalMember();
  const [subTab, setSubTab] = useState<"posts" | "replies">("posts");
  const [authorMode, setAuthorMode] = useState<"ALL" | "ACTIVE" | "WITHDRAWN">("ALL");
  const [reloadTick, setReloadTick] = useState(0);

  // 게시글 검색 입력
  const [titleInput, setTitleInput] = useState("");
  const [contentInput, setContentInput] = useState("");
  const [postAuthorInput, setPostAuthorInput] = useState("");
  const [appliedPostFilters, setAppliedPostFilters] = useState<{
    mode: "ALL" | "ACTIVE" | "WITHDRAWN";
    title: string;
    content: string;
    authorNickname: string;
  }>({
    mode: "ALL",
    title: "",
    content: "",
    authorNickname: "",
  });

  // 댓글 검색 입력
  const [replyPostTitleInput, setReplyPostTitleInput] = useState("");
  const [replyContentInput, setReplyContentInput] = useState("");
  const [replyAuthorInput, setReplyAuthorInput] = useState("");
  const [appliedReplyFilters, setAppliedReplyFilters] = useState<{
    mode: "ALL" | "ACTIVE" | "WITHDRAWN";
    postTitle: string;
    replyContent: string;
    authorNickname: string;
  }>({
    mode: "ALL",
    postTitle: "",
    replyContent: "",
    authorNickname: "",
  });

  // 게시글 목록 상태
  const [posts, setPosts] = useState<AdminPostDto[]>([]);
  const [postNextCursor, setPostNextCursor] = useState<number | null>(null);
  const [postHasNext, setPostHasNext] = useState(false);

  // 댓글 목록 상태
  const [replies, setReplies] = useState<AdminReplyDto[]>([]);
  const [replyNextCursor, setReplyNextCursor] = useState<number | null>(null);
  const [replyHasNext, setReplyHasNext] = useState(false);

  const [loadingMore, setLoadingMore] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  const [deletePostTarget, setDeletePostTarget] = useState<AdminPostDto | null>(null);
  const [deleteReplyTarget, setDeleteReplyTarget] = useState<AdminReplyDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (memberCtx?.snapshot.phase !== "ready" || !memberCtx.session) return;
    const controller = new AbortController();
    if (subTab === "posts") {
      void memberCtx.session
        .authorized(cred =>
          fetchAdminCommunityPosts(
            cred.accessToken,
            appliedPostFilters.mode,
            {
              title: appliedPostFilters.title,
              content: appliedPostFilters.content,
              authorNickname: appliedPostFilters.authorNickname,
              size: 10,
            },
            { signal: controller.signal },
          ),
        )
        .then(res => {
          setPosts(res.content);
          setPostNextCursor(res.nextCursorId);
          setPostHasNext(res.hasNext);
        })
        .catch(() => {
          // Keep current list on transient error
        });
    } else {
      void memberCtx.session
        .authorized(cred =>
          fetchAdminCommunityReplies(
            cred.accessToken,
            appliedReplyFilters.mode,
            {
              postTitle: appliedReplyFilters.postTitle,
              replyContent: appliedReplyFilters.replyContent,
              authorNickname: appliedReplyFilters.authorNickname,
              size: 10,
            },
            { signal: controller.signal },
          ),
        )
        .then(res => {
          setReplies(res.content);
          setReplyNextCursor(res.nextCursorId);
          setReplyHasNext(res.hasNext);
        })
        .catch(() => {
          // Keep current list on transient error
        });
    }
    return () => controller.abort();
  }, [subTab, appliedPostFilters, appliedReplyFilters, reloadTick, memberCtx]);

  const handleApplySearch = () => {
    if (subTab === "posts") {
      setAppliedPostFilters({
        mode: authorMode,
        title: titleInput.trim(),
        content: contentInput.trim(),
        authorNickname: postAuthorInput.trim(),
      });
    } else {
      setAppliedReplyFilters({
        mode: authorMode,
        postTitle: replyPostTitleInput.trim(),
        replyContent: replyContentInput.trim(),
        authorNickname: replyAuthorInput.trim(),
      });
    }
  };

  const handleResetSearch = () => {
    setAuthorMode("ALL");
    if (subTab === "posts") {
      setTitleInput("");
      setContentInput("");
      setPostAuthorInput("");
      setAppliedPostFilters({
        mode: "ALL",
        title: "",
        content: "",
        authorNickname: "",
      });
    } else {
      setReplyPostTitleInput("");
      setReplyContentInput("");
      setReplyAuthorInput("");
      setAppliedReplyFilters({
        mode: "ALL",
        postTitle: "",
        replyContent: "",
        authorNickname: "",
      });
    }
  };

  const handleLoadMorePosts = async () => {
    if (!postHasNext || postNextCursor == null || loadingMore) return;
    if (memberCtx?.snapshot.phase !== "ready" || !memberCtx.session) return;
    setLoadingMore(true);
    try {
      const res = await memberCtx.session.authorized(cred =>
        fetchAdminCommunityPosts(cred.accessToken, appliedPostFilters.mode, {
          title: appliedPostFilters.title,
          content: appliedPostFilters.content,
          authorNickname: appliedPostFilters.authorNickname,
          cursorId: postNextCursor,
          size: 10,
        }),
      );
      setPosts(prev => [...prev, ...res.content]);
      setPostNextCursor(res.nextCursorId);
      setPostHasNext(res.hasNext);
    } catch {
      setActionToast("추가 게시글 목록을 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLoadMoreReplies = async () => {
    if (!replyHasNext || replyNextCursor == null || loadingMore) return;
    if (memberCtx?.snapshot.phase !== "ready" || !memberCtx.session) return;
    setLoadingMore(true);
    try {
      const res = await memberCtx.session.authorized(cred =>
        fetchAdminCommunityReplies(cred.accessToken, appliedReplyFilters.mode, {
          postTitle: appliedReplyFilters.postTitle,
          replyContent: appliedReplyFilters.replyContent,
          authorNickname: appliedReplyFilters.authorNickname,
          cursorId: replyNextCursor,
          size: 10,
        }),
      );
      setReplies(prev => [...prev, ...res.content]);
      setReplyNextCursor(res.nextCursorId);
      setReplyHasNext(res.hasNext);
    } catch {
      setActionToast("추가 댓글 목록을 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleConfirmDeletePost = async () => {
    if (!deletePostTarget || deleting) return;
    if (memberCtx?.snapshot.phase !== "ready" || !memberCtx.session) {
      setActionToast("관리자 인증 세션이 필요합니다.");
      setDeletePostTarget(null);
      return;
    }
    setDeleting(true);
    try {
      const target = deletePostTarget;
      await memberCtx.session.authorized(cred =>
        deleteAdminCommunityPost(cred.accessToken, target.postId),
      );
      setActionToast(`게시글 #${target.postId} 삭제 처리가 완료되었습니다.`);
      setDeletePostTarget(null);
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast("게시글 삭제 처리에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDeleteReply = async () => {
    if (!deleteReplyTarget || deleting) return;
    if (memberCtx?.snapshot.phase !== "ready" || !memberCtx.session) {
      setActionToast("관리자 인증 세션이 필요합니다.");
      setDeleteReplyTarget(null);
      return;
    }
    setDeleting(true);
    try {
      const target = deleteReplyTarget;
      await memberCtx.session.authorized(cred =>
        deleteAdminCommunityReply(cred.accessToken, target.replyId),
      );
      setActionToast(`댓글 #${target.replyId} 삭제 처리가 완료되었습니다.`);
      setDeleteReplyTarget(null);
      setReloadTick(prev => prev + 1);
    } catch {
      setActionToast("댓글 삭제 처리에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminShell activeSection="community">
      <div className="space-y-8" data-admin-community-page="true">
        {/* 상단 타이틀 & 탭 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-black tracking-wide text-[#0058FF]">
              <V1IconComment className="h-4 w-4" />
              <span>COMMUNITY MODERATION</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
              커뮤니티 관리
            </h1>
            <p className="text-sm font-medium text-gray-500">
              커뮤니티 게시글 및 댓글 현황을 조회하고 운영 정책 위반 게시물을 소프트 삭제 처리합니다.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="커뮤니티 관리 구분"
            className="inline-flex shrink-0 rounded-2xl bg-gray-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={subTab === "posts"}
              onClick={() => setSubTab("posts")}
              className={cn(
                "h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-black transition-colors",
                subTab === "posts"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900",
              )}
            >
              게시글 관리
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === "replies"}
              onClick={() => setSubTab("replies")}
              className={cn(
                "h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-black transition-colors",
                subTab === "replies"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900",
              )}
            >
              댓글 관리
            </button>
          </div>
        </div>

        {actionToast ? (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-xs font-bold text-[#0058FF]"
          >
            <span>{actionToast}</span>
            <button
              type="button"
              onClick={() => setActionToast(null)}
              className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-black text-blue-700 hover:bg-blue-100"
            >
              닫기
            </button>
          </div>
        ) : null}

        {/* 검색 및 필터 바 */}
        <form
          aria-label="커뮤니티 검색 필터"
          onSubmit={e => {
            e.preventDefault();
            handleApplySearch();
          }}
          className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5 text-xs font-bold text-gray-600">
              <span>작성자 상태</span>
              <select
                aria-label="작성자 상태 필터"
                value={authorMode}
                onChange={e =>
                  setAuthorMode(e.target.value as "ALL" | "ACTIVE" | "WITHDRAWN")
                }
                className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-bold text-gray-900 focus:border-[#0058FF] focus:bg-white focus:outline-none"
              >
                <option value="ALL">전체 작성자 (ALL)</option>
                <option value="ACTIVE">활동 작성자 (ACTIVE)</option>
                <option value="WITHDRAWN">탈퇴 작성자 (WITHDRAWN)</option>
              </select>
            </label>

            {subTab === "posts" ? (
              <>
                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>제목 검색</span>
                  <input
                    type="search"
                    value={titleInput}
                    onChange={e => setTitleInput(e.target.value)}
                    placeholder="게시글 제목"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>본문 검색</span>
                  <input
                    type="search"
                    value={contentInput}
                    onChange={e => setContentInput(e.target.value)}
                    placeholder="게시글 본문 키워드"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>작성자 닉네임</span>
                  <input
                    type="search"
                    value={postAuthorInput}
                    onChange={e => setPostAuthorInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleApplySearch();
                    }}
                    placeholder="작성자 닉네임"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>원글 제목</span>
                  <input
                    type="search"
                    value={replyPostTitleInput}
                    onChange={e => setReplyPostTitleInput(e.target.value)}
                    placeholder="원글 제목"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>댓글 내용</span>
                  <input
                    type="search"
                    value={replyContentInput}
                    onChange={e => setReplyContentInput(e.target.value)}
                    placeholder="댓글 내용 키워드"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>

                <label className="space-y-1.5 text-xs font-bold text-gray-600">
                  <span>작성자 닉네임</span>
                  <input
                    type="search"
                    value={replyAuthorInput}
                    onChange={e => setReplyAuthorInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleApplySearch();
                    }}
                    placeholder="작성자 닉네임"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-[#F9FAFB] px-3 text-xs font-semibold text-gray-900 placeholder:text-gray-400 focus:border-[#0058FF] focus:bg-white focus:outline-none"
                  />
                </label>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleResetSearch}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              초기화
            </button>
            <button
              type="submit"
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-[#0058FF] px-4 text-xs font-black text-white hover:bg-[#0047D1]"
            >
              조회하기
            </button>
          </div>
        </form>

        {/* 게시글 테이블 / 댓글 테이블 */}
        {subTab === "posts" ? (
          <section
            aria-label="게시글 목록"
            className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-[#F9FAFB] text-[11px] font-black uppercase tracking-wider text-gray-400">
                    <th className="px-4 py-3.5 whitespace-nowrap">글 번호</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">카테고리</th>
                    <th className="w-[260px] max-w-[260px] px-4 py-3.5 whitespace-nowrap">제목 · 본문 요약</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성자</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">반응 지표</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성일</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">삭제 여부</th>
                    <th className="px-4 py-3.5 text-right whitespace-nowrap">관리 액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {posts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-12 text-center text-xs font-semibold text-gray-400"
                      >
                        조건에 맞는 게시글이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    posts.map(post => {
                      const isDeleted = post.deleteYn === "Y";
                      return (
                        <tr
                          key={post.postId}
                          className="transition-colors hover:bg-gray-50/70"
                        >
                          <td className="px-4 py-3.5 font-black tabular-nums text-gray-900 whitespace-nowrap">
                            #{post.postId}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="inline-flex shrink-0 whitespace-nowrap rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                              {post.category}
                            </span>
                          </td>
                          <td className="w-[260px] max-w-[260px] px-4 py-3.5">
                            <div className="truncate font-bold text-gray-900">{post.title}</div>
                            <div className="mt-0.5 truncate text-[11px] text-gray-500">
                              {post.content}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap">
                            <span className="font-bold">{post.authorNickname ?? "탈퇴회원"}</span>
                            <span className="ml-1 text-[11px] text-gray-400">
                              (#{post.authorId})
                            </span>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-[11px] text-gray-600 whitespace-nowrap">
                            <span>좋아요 {post.likeCount}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>댓글 {post.replyCount}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span
                              className={cn(
                                post.reportCount > 0 ? "font-black text-rose-600" : "text-gray-500",
                              )}
                            >
                              신고 {post.reportCount}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-gray-500 whitespace-nowrap">
                            {formatAdminDateTime(post.createdAt)}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={cn(
                                "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                                isDeleted
                                  ? "bg-gray-100 text-gray-500"
                                  : "bg-emerald-50 text-emerald-600",
                              )}
                            >
                              {isDeleted ? "삭제됨 (Y)" : "정상 (N)"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {!isDeleted ? (
                              <button
                                type="button"
                                onClick={() => setDeletePostTarget(post)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-black text-rose-600 transition-colors hover:bg-rose-100"
                              >
                                삭제
                              </button>
                            ) : (
                              <span className="whitespace-nowrap text-[11px] font-semibold text-gray-400">
                                삭제 완료
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {postHasNext ? (
              <div className="border-t border-gray-100 bg-[#F9FAFB] px-4 py-3 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMorePosts()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-5 text-xs font-black text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? "불러오는 중..." : "더 보기"}
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section
            aria-label="댓글 목록"
            className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-[#F9FAFB] text-[11px] font-black uppercase tracking-wider text-gray-400">
                    <th className="px-4 py-3.5 whitespace-nowrap">댓글 번호</th>
                    <th className="w-[200px] max-w-[200px] px-4 py-3.5 whitespace-nowrap">원글</th>
                    <th className="w-[260px] max-w-[260px] px-4 py-3.5 whitespace-nowrap">댓글 내용</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성자</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">반응 지표</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">작성일</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">삭제 여부</th>
                    <th className="px-4 py-3.5 text-right whitespace-nowrap">관리 액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {replies.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-12 text-center text-xs font-semibold text-gray-400"
                      >
                        조건에 맞는 댓글이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    replies.map(reply => {
                      const isDeleted = reply.deleteYn === "Y";
                      return (
                        <tr
                          key={reply.replyId}
                          className="transition-colors hover:bg-gray-50/70"
                        >
                          <td className="px-4 py-3.5 font-black tabular-nums text-gray-900 whitespace-nowrap">
                            #{reply.replyId}
                          </td>
                          <td className="w-[200px] max-w-[200px] px-4 py-3.5">
                            <div className="truncate font-bold text-gray-800">
                              {reply.postTitle ?? "(제목 없음)"}
                            </div>
                            <div className="text-[11px] text-gray-400 whitespace-nowrap">글 #{reply.postId}</div>
                          </td>
                          <td className="w-[260px] max-w-[260px] px-4 py-3.5">
                            <div className="truncate text-gray-800">{reply.content}</div>
                          </td>
                          <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap">
                            <span className="font-bold">{reply.authorNickname ?? "탈퇴회원"}</span>
                            <span className="ml-1 text-[11px] text-gray-400">
                              (#{reply.authorId})
                            </span>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-[11px] text-gray-600 whitespace-nowrap">
                            <span>좋아요 {reply.likeCount}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span
                              className={cn(
                                reply.reportCount > 0 ? "font-black text-rose-600" : "text-gray-500",
                              )}
                            >
                              신고 {reply.reportCount}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 tabular-nums text-gray-500 whitespace-nowrap">
                            {formatAdminDateTime(reply.createdAt)}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={cn(
                                "inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black",
                                isDeleted
                                  ? "bg-gray-100 text-gray-500"
                                  : "bg-emerald-50 text-emerald-600",
                              )}
                            >
                              {isDeleted ? "삭제됨 (Y)" : "정상 (N)"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {!isDeleted ? (
                              <button
                                type="button"
                                onClick={() => setDeleteReplyTarget(reply)}
                                className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-black text-rose-600 transition-colors hover:bg-rose-100"
                              >
                                삭제
                              </button>
                            ) : (
                              <span className="whitespace-nowrap text-[11px] font-semibold text-gray-400">
                                삭제 완료
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {replyHasNext ? (
              <div className="border-t border-gray-100 bg-[#F9FAFB] px-4 py-3 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMoreReplies()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-5 text-xs font-black text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? "불러오는 중..." : "더 보기"}
                </button>
              </div>
            ) : null}
          </section>
        )}

        {/* 게시글 삭제 확인 모달 */}
        <DimModal
          open={deletePostTarget !== null}
          onClose={() => {
            if (!deleting) setDeletePostTarget(null);
          }}
          title="게시글 삭제 확인"
        >
          {deletePostTarget ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-gray-600">
                게시글 <strong className="font-black text-gray-900">#{deletePostTarget.postId} ({deletePostTarget.title})</strong> 항목을 삭제 처리하시겠습니까?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeletePostTarget(null)}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleConfirmDeletePost()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? "삭제 중..." : "삭제 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>

        {/* 댓글 삭제 확인 모달 */}
        <DimModal
          open={deleteReplyTarget !== null}
          onClose={() => {
            if (!deleting) setDeleteReplyTarget(null);
          }}
          title="댓글 삭제 확인"
        >
          {deleteReplyTarget ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-gray-600">
                댓글 <strong className="font-black text-gray-900">#{deleteReplyTarget.replyId}</strong> 항목을 삭제 처리하시겠습니까?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteReplyTarget(null)}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleConfirmDeleteReply()}
                  className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-rose-600 px-4 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleting ? "삭제 중..." : "삭제 실행"}
                </button>
              </div>
            </div>
          ) : null}
        </DimModal>
      </div>
    </AdminShell>
  );
}
